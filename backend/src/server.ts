import express from 'express';
import multer from 'multer';
import morgan from 'morgan';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { initializeDatabase, pool } from './db.js';
import { addReceiptJob } from './queue.js';
import { RegisterSchema, LoginSchema } from './schemas.js';

// Extend Express Request interface to include userId from JWT token verification
declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set in the environment variables.');
  process.exit(1);
}

/**
 * Authentication middleware that extracts the Bearer JWT token from the Authorization header.
 * Verifies the token and attaches the authenticated userId to the request object.
 */
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401);
      throw new Error('Authentication token required. Use format: Bearer <token>');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    
    req.userId = decoded.userId;
    next();
  } catch (error: any) {
    res.status(401);
    next(new Error(error.message || 'Authentication failed. Please login again.'));
  }
};

// Standard middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

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
/**
 * POST /api/auth/register
 * Registers a new user account. Validates inputs, hashes password, and saves user.
 */
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const validatedData = RegisterSchema.parse(req.body);
    const { email, password } = validatedData;

    // 1. Check if user already exists
    const checkUserQuery = 'SELECT id FROM users WHERE email = $1;';
    const checkResult = await pool.query(checkUserQuery, [email]);
    if (checkResult.rows.length > 0) {
      res.status(400);
      throw new Error('Email address already registered.');
    }

    // 2. Hash password with bcryptjs
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 3. Save to database
    const insertUserQuery = `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id;
    `;
    const insertResult = await pool.query(insertUserQuery, [email, passwordHash]);
    const userId = insertResult.rows[0].id;

    res.status(201).json({
      success: true,
      userId,
      message: 'User registered successfully. You can now login.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/login
 * Logs in a user. Validates credentials, issues JWT token valid for 24h.
 */
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const validatedData = LoginSchema.parse(req.body);
    const { email, password } = validatedData;

    // 1. Fetch user
    const selectUserQuery = 'SELECT id, password_hash FROM users WHERE email = $1;';
    const dbResult = await pool.query(selectUserQuery, [email]);
    if (dbResult.rows.length === 0) {
      res.status(401);
      throw new Error('Invalid email or password.');
    }

    const user = dbResult.rows[0];

    // 2. Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401);
      throw new Error('Invalid email or password.');
    }

    // 3. Issue signed JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

    res.status(200).json({
      success: true,
      token,
      message: 'Login successful.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/receipts
 * Protected Endpoint. Uploads a receipt image and starts background parsing task.
 * Links the receipt task to the authenticated user ID.
 */
app.post('/api/receipts', authMiddleware, upload.single('receipt'), async (req, res, next) => {
  try {
    // 1. Validate file existence
    if (!req.file) {
      res.status(400);
      throw new Error('No receipt file uploaded. Please upload an image under the form key "receipt".');
    }

    const { buffer, mimetype } = req.file;

    // 2. Save the raw image bytes and mime type in the database immediately, setting status to 'processing' linked to userId
    const insertQuery = `
      INSERT INTO receipts (raw_image, status, user_id, mime_type)
      VALUES ($1, 'processing', $2, $3)
      RETURNING id;
    `;

    const dbResult = await pool.query(insertQuery, [buffer, req.userId, mimetype]);
    const receiptId = dbResult.rows[0].id;

    // 3. Immediately return 202 Accepted status response with the assigned ID
    res.status(202).json({
      success: true,
      receiptId,
      status: 'processing',
      message: 'Receipt uploaded successfully. Parsing and extraction are running in the background. Please query GET /api/receipts/:id to check status.',
    });

    // 4. Dispatch the parsing job to the BullMQ Redis queue
    await addReceiptJob({ receiptId });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/receipts
 * Protected Endpoint. Retrieves a list of all receipts belonging to the authenticated user.
 */
app.get('/api/receipts', authMiddleware, async (req, res, next) => {
  try {
    const selectQuery = `
      SELECT id, status, store_name, receipt_date, total_amount, taxes, items, error_message, created_at
      FROM receipts
      WHERE user_id = $1
      ORDER BY created_at DESC;
    `;

    const dbResult = await pool.query(selectQuery, [req.userId]);

    res.status(200).json({
      success: true,
      receipts: dbResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/receipts/summary
 * Protected Endpoint. Retrieves aggregated expenses by category, filtered by date range.
 * Supports: today, yesterday, this_week, this_month, this_year. Defaults to this_month.
 */
app.get('/api/receipts/summary', authMiddleware, async (req, res, next) => {
  try {
    // 1. Parse and validate the filter query parameter
    const querySchema = z.object({
      filter: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'this_year']).default('this_month'),
    });
    
    const { filter } = querySchema.parse(req.query);

    // 2. Map date filter to SQL date clauses
    let dateCondition = '';
    switch (filter) {
      case 'today':
        dateCondition = 'receipt_date = CURRENT_DATE';
        break;
      case 'yesterday':
        dateCondition = "receipt_date = CURRENT_DATE - INTERVAL '1 day'";
        break;
      case 'this_week':
        dateCondition = "receipt_date >= DATE_TRUNC('week', CURRENT_DATE)";
        break;
      case 'this_month':
        dateCondition = "receipt_date >= DATE_TRUNC('month', CURRENT_DATE)";
        break;
      case 'this_year':
        dateCondition = "receipt_date >= DATE_TRUNC('year', CURRENT_DATE)";
        break;
    }

    // 3. Query PostgreSQL to sum total amounts grouped by category
    const summaryQuery = `
      SELECT category, SUM(total_amount) as total
      FROM receipts
      WHERE user_id = $1 AND status = 'completed' AND ${dateCondition}
      GROUP BY category;
    `;

    const dbResult = await pool.query(summaryQuery, [req.userId]);

    // 4. Build output map ensuring all predefined categories exist in the response
    const allowedCategories = [
      'Medical & Pharmacy',
      'Grocery',
      'Food & Dining',
      'Shopping',
      'Fuel',
      'Bills',
      'Other',
    ];

    const expensesMap: Record<string, number> = {};
    allowedCategories.forEach((cat) => {
      expensesMap[cat] = 0.00;
    });

    let totalExpenses = 0.00;
    dbResult.rows.forEach((row) => {
      const cat = allowedCategories.includes(row.category) ? row.category : 'Other';
      const amount = parseFloat(row.total || '0');
      expensesMap[cat] = parseFloat((expensesMap[cat] + amount).toFixed(2));
      totalExpenses += amount;
    });

    res.status(200).json({
      success: true,
      filter,
      expenses: expensesMap,
      totalExpenses: parseFloat(totalExpenses.toFixed(2)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/receipts/:id
 * Protected Endpoint. Retrieves detail of a single receipt by ID, ensuring it belongs to the authenticated user.
 */
app.get('/api/receipts/:id', authMiddleware, async (req, res, next) => {
  try {
    const receiptId = req.params.id;

    const selectQuery = `
      SELECT id, status, store_name, receipt_date, total_amount, taxes, items, error_message, created_at
      FROM receipts
      WHERE id = $1 AND user_id = $2;
    `;

    const dbResult = await pool.query(selectQuery, [receiptId, req.userId]);

    if (dbResult.rows.length === 0) {
      res.status(404);
      throw new Error(`Receipt with ID ${receiptId} not found or you do not have permission to view it.`);
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

  // Handle specific validation/parsing errors
  if (err instanceof z.ZodError) {
    statusCode = 400;
    errorMessage = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  } else if (err instanceof multer.MulterError) {
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
