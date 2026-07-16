import express from 'express';
import multer from 'multer';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { initializeDatabase, pool } from './db.js';
import { parseReceipt } from './parser.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Standard middleware
app.use(morgan('dev')); // Dev-friendly request logging
app.use(express.json()); // Parses application/json
app.use(express.urlencoded({ extended: true })); // Parses form submissions

// Configure Multer memory storage with a 10MB size limit and file type filters
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept common image mime types
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Only JPEG, PNG, WEBP, and GIF images are allowed.'));
    }
  },
});

/**
 * POST /api/receipts
 * Uploads a receipt image, parses it using Gemini 2.5 Flash, saves details and raw bytes in DB, and returns receipt.
 */
app.post('/api/receipts', upload.single('receipt'), async (req, res, next) => {
  try {
    // 1. Validate file existence
    if (!req.file) {
      res.status(400);
      throw new Error('No receipt file uploaded. Please upload an image under the form key "receipt".');
    }

    const { buffer, mimetype } = req.file;

    // 2. Save the raw image bytes in the database immediately, setting status to 'processing'
    const insertQuery = `
      INSERT INTO receipts (raw_image, status)
      VALUES ($1, 'processing')
      RETURNING id;
    `;

    const dbResult = await pool.query(insertQuery, [buffer]);
    const receiptId = dbResult.rows[0].id;

    // 3. Immediately return 202 Accepted status response with the assigned ID
    res.status(202).json({
      success: true,
      receiptId,
      status: 'processing',
      message: 'Receipt uploaded successfully. Parsing and extraction are running in the background. Please query GET /api/receipts/:id to check status.',
    });

    // 4. Trigger the heavy Gemini parsing and metadata extraction in the background (fire-and-forget)
    (async () => {
      try {
        console.log(`[Queue] Starting background extraction for Receipt ID ${receiptId}...`);
        const receiptData = await parseReceipt(buffer, mimetype);

        const updateQuery = `
          UPDATE receipts
          SET store_name = $1, 
              receipt_date = $2, 
              total_amount = $3, 
              taxes = $4, 
              items = $5, 
              status = 'completed'
          WHERE id = $6;
        `;

        await pool.query(updateQuery, [
          receiptData.storeName,
          receiptData.date,
          receiptData.totalAmount,
          receiptData.taxes,
          JSON.stringify(receiptData.lineItems),
          receiptId,
        ]);
        console.log(`[Queue] Receipt ID ${receiptId} processed and saved successfully.`);
      } catch (error: any) {
        console.error(`[Queue] Failed to process receipt ID ${receiptId}:`, error);

        const failQuery = `
          UPDATE receipts
          SET status = 'failed', 
              error_message = $1
          WHERE id = $2;
        `;
        await pool.query(failQuery, [error.message || String(error), receiptId]);
      }
    })();

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/receipts
 * Retrieves a list of all parsed receipts from the database, newest first.
 * Omit raw_image from retrieval to prevent slow downloads of massive binary payloads.
 */
app.get('/api/receipts', async (req, res, next) => {
  try {
    const selectQuery = `
      SELECT id, status, store_name, receipt_date, total_amount, taxes, items, error_message, created_at
      FROM receipts
      ORDER BY created_at DESC;
    `;

    const dbResult = await pool.query(selectQuery);

    res.status(200).json({
      success: true,
      receipts: dbResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/receipts/:id
 * Retrieves detail of a single receipt by ID (excluding raw_image).
 */
app.get('/api/receipts/:id', async (req, res, next) => {
  try {
    const receiptId = req.params.id;

    const selectQuery = `
      SELECT id, status, store_name, receipt_date, total_amount, taxes, items, error_message, created_at
      FROM receipts
      WHERE id = $1;
    `;

    const dbResult = await pool.query(selectQuery, [receiptId]);

    if (dbResult.rows.length === 0) {
      res.status(404);
      throw new Error(`Receipt with ID ${receiptId} not found.`);
    }

    res.status(200).json({
      success: true,
      receipt: dbResult.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// Global Error Handler Middleware
// Ensures the application always returns a unified, formatted JSON response on failure
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled request error:', err);

  // Capture standard validation or upload errors
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let errorMessage = err.message || 'Internal Server Error';

  // Handle specific Multer limits errors
  if (err instanceof multer.MulterError) {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      errorMessage = 'File size limit exceeded. Maximum upload size is 10 MB.';
    } else {
      errorMessage = `File upload error: ${err.message}`;
    }
  } else if (err.message && err.message.includes('Invalid image type')) {
    statusCode = 400;
  }

  res.status(statusCode).json({
    success: false,
    error: errorMessage,
  });
});

// Boot Database first, then launch server
async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Receipt Parser API Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server due to database initialization failure:', error);
    process.exit(1);
  }
}

startServer();
