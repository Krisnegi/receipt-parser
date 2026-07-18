# AI-Powered Receipt Parser & Expense Tracker

A full-stack portfolio application designed to securely upload, queue, parse, and categorize receipt images using an Express.js backend, Google Gemini API cascades, Redis background workers, and a PostgreSQL database, paired with a Next.js frontend.

---

## 🏗️ Core Backend Architecture & Features

This project was built to showcase production-grade backend design patterns focusing on scalability, security, and API resilience.

### Architecture Data Flow:
1. **Next.js Client** sends the receipt image and the JWT auth header to the Express backend.
2. **Express API Gateway** verifies the token, saves a pending state record in PostgreSQL, and pushes the `{ receiptId }` to the Redis queue.
3. **BullMQ Redis Queue** routes the job to the next available worker.
4. **Background Worker Processor** pulls the job, loads the raw image buffer from PostgreSQL, and calls the Gemini Vision API.
5. **Google Gemini API** parses and categorizes the receipt content.
6. **Worker** updates the PostgreSQL database with the parsed data and marks the job as completed.

### 1. Scalable Background Processing (Redis & BullMQ)
* **The Problem**: Image parsing is a heavy CPU/network operation. Handling it inside the main API request cycle causes gateway timeouts, blocks the event loop, and leads to server crashes under high volume.
* **The Solution**: Implemented a **producer-consumer architecture** using **Redis 7** and **BullMQ**.
* **Payload Optimization**: To prevent Redis memory bloat, only the `{ receiptId }` is enqueued. The background worker queries PostgreSQL using connection pooling to retrieve the raw image buffer and MIME type only when processing starts.

### 2. Resilient AI Cascade Wrapper
* **Cascade Routing**: To guard against transient 503 errors and rate limits, requests cascade dynamically: `gemini-3.5-flash` ➡️ `gemini-1.5-flash` ➡️ `gemini-1.5-pro`.
* **Dynamic Vision Filtering**: The backend queries `ai.models.list()` on boot, filters out text-only or embedding models, and selects only active, vision-capable Gemini models (matching the `gemini-` prefix) to prevent 404 version routing errors.
* **Fail-Fast Configuration**: Configured a strict `30s` request timeout to quickly abort hung connections and failover to alternative models, returning descriptive error logs to the database on final failure.

### 3. JWT Security & Row-Level Owner Isolation
* Secure password hashing using **bcryptjs** (10 salt rounds).
* Protected Express endpoints using a custom JWT authentication middleware verifying Bearer tokens.
* **Resource Isolation**: Enforced owner checks at the query level; users can only view, query, list, or aggregate summaries for receipts linked to their own `user_id`.

### 4. Categorized Aggregations & Date Filters
* Implemented `GET /api/receipts/summary` returning aggregated totals grouped by expense category.
* Leveraged Gemini OpenAPI response schemas to guarantee raw classification into 7 standard categories: `Medical & Pharmacy`, `Grocery`, `Food & Dining`, `Shopping`, `Fuel`, `Bills`, and `Other`.
* Renders zero-spend categories automatically in queries to maintain structural consistency for the frontend.
* Filters data dynamically using query strings (`?filter=today|yesterday|this_week|this_month|this_year`).

---

## 🗄️ Database Schema

The database utilizes PostgreSQL with relational integrity and cascading deletes:

```sql
-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Receipts Table
CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'processing', -- 'processing', 'completed', 'failed'
  raw_image BYTEA NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  store_name VARCHAR(255),
  receipt_date DATE,
  total_amount NUMERIC(10, 2),
  taxes NUMERIC(10, 2),
  category VARCHAR(100),
  items JSONB,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔌 API Endpoint Reference

### Authentication
* `POST /api/auth/register` - Registers a new user.
* `POST /api/auth/login` - Authenticates a user and returns a 24h JWT.

### Receipts
* `POST /api/receipts` - Uploads a receipt image (multipart form data). Queues background parsing. Returns `202 Accepted` and the `receiptId`.
* `GET /api/receipts` - Lists all receipts belonging to the authenticated user.
* `GET /api/receipts/:id` - Retrieves processing status, metadata, and itemized line items for a specific receipt.

### Expense Reporting
* `GET /api/receipts/summary?filter=this_month` - Returns aggregated spending by category. Supports `today`, `yesterday`, `this_week`, `this_month`, and `this_year`.

---

## 💻 Frontend Overview

While the project is backend-focused, a responsive **Next.js 14** SPA dashboard is included in the `/frontend` directory:
* **Dark Theme**: Custom slate-dark layout with glowing gradient accents.
* **Multipart Uploader**: Handles binary uploads directly in the client.
* **Auto-Polling Status**: The dashboard detects pending row items and polls `GET /api/receipts/:id` automatically every 3 seconds, refreshing metric cards and lists once processing finishes.
* **Interactive Modals**: Clicking completed receipts pops up detailed drawers displaying merchant receipts, tax breakouts, and line-item checklists.

---

## 🚀 Setup & Installation (Local Development)

### 1. Clone & Spin up Services
The repository includes a root `docker-compose.yml` to spin up PostgreSQL and Redis:
```bash
docker compose up -d
```

### 2. Configure Backend
Create `backend/.env` matching the template:
```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/receipt_parser_db
GEMINI_API_KEY=your_gemini_api_key_here
JWT_SECRET=your_jwt_signing_secret_here
REDIS_HOST=localhost
REDIS_PORT=6379
```
Install dependencies and run the server:
```bash
cd backend
npm install
npm run dev
```

### 3. Configure Frontend
Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```
Run the frontend:
```bash
cd ../frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) (or Vercel port) in your browser!
