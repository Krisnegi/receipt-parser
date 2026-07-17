import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set in the environment variables.');
  process.exit(1);
}

// Create a connection pool to reuse database connections efficiently
export const pool = new Pool({
  connectionString,
});

/**
 * Initializes the database by creating the required `receipts` table if it does not exist.
 * This runs automatically at application startup to ensure schema alignment.
 */
export async function initializeDatabase(): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(50) DEFAULT 'processing',
      category VARCHAR(50) DEFAULT 'Other',
      store_name VARCHAR(255),
      receipt_date DATE,
      total_amount NUMERIC(10, 2),
      taxes NUMERIC(10, 2),
      items JSONB,
      raw_image BYTEA NOT NULL,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(query);
    console.log('Database initialized successfully: "users" and "receipts" tables are ready.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}
