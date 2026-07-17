import { Queue, Worker } from 'bullmq';
import dotenv from 'dotenv';
import { pool } from './db.js';
import { parseReceipt } from './parser.js';

// Load environment variables
dotenv.config();

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

const connection = {
  host: redisHost,
  port: redisPort,
};

// 1. Initialize BullMQ Queue
export const receiptQueue = new Queue('receipt-parsing', { connection });

/**
 * Adds a new receipt processing job to the Redis queue.
 *
 * @param data Job payload containing the database receipt ID
 */
export async function addReceiptJob(data: { receiptId: number }): Promise<void> {
  await receiptQueue.add('parse-receipt-job', data, {
    attempts: 1, // Disable BullMQ queue retries since the parser code already retries internally
  });
  console.log(`[Queue] Added parsing job for Receipt ID ${data.receiptId} to Redis queue.`);
}

// 2. Initialize Worker processor
const worker = new Worker(
  'receipt-parsing',
  async (job) => {
    const { receiptId } = job.data;
    console.log(`[Worker] Processing Job ${job.id} for Receipt ID ${receiptId}...`);

    try {
      // Retrieve the receipt raw image and format metadata from PostgreSQL
      const selectQuery = 'SELECT raw_image, mime_type FROM receipts WHERE id = $1;';
      const dbResult = await pool.query(selectQuery, [receiptId]);

      if (dbResult.rows.length === 0) {
        throw new Error(`Receipt record not found in database for ID ${receiptId}`);
      }

      const { raw_image: imageBuffer, mime_type: mimeType } = dbResult.rows[0];

      // Invoke the Gemini API parser with retries/fallbacks
      const receiptData = await parseReceipt(imageBuffer, mimeType);

      // Save parsed details back to PostgreSQL and mark as completed
      const updateQuery = `
        UPDATE receipts
        SET store_name = $1, 
            receipt_date = $2, 
            total_amount = $3, 
            taxes = $4, 
            items = $5, 
            status = 'completed',
            category = $6
        WHERE id = $7;
      `;

      await pool.query(updateQuery, [
        receiptData.storeName,
        receiptData.date,
        receiptData.totalAmount,
        receiptData.taxes,
        JSON.stringify(receiptData.lineItems),
        receiptData.category,
        receiptId,
      ]);

      console.log(`[Worker] Job ${job.id} (Receipt ID ${receiptId}) processed and saved successfully.`);
    } catch (error: any) {
      console.error(`[Worker] Job ${job.id} failed for Receipt ID ${receiptId}:`, error);

      // Save the failure status and error details in PostgreSQL
      const failQuery = `
        UPDATE receipts
        SET status = 'failed', 
            error_message = $1
        WHERE id = $2;
      `;
      await pool.query(failQuery, [error.message || String(error), receiptId]);
      
      // Re-throw so BullMQ marks the job as failed and tracks attempt metrics
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // Process up to 2 receipts in parallel
  }
);

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed permanently: ${err.message}`);
});

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully.`);
});
