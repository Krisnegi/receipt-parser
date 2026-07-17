# Receipt Parser API Walkthrough & Instructions

We have built a clean, beginner-friendly, non-overengineered receipt parsing API service using Express, PostgreSQL, Redis, and the modern Google Gen AI SDK. Below are the complete instructions to set up, run, compile, and test the project.

---

## 1. Installing Dependencies

Make sure you are in the project root directory and run:

```bash
npm install
```

This installs:
* `@google/genai` (Unified Google Gen AI SDK)
* `express` (Web framework)
* `multer` (Handling file uploads)
* `pg` (PostgreSQL client)
* `zod` (Data validation and parsing)
* `dotenv` (Environment variable management)
* `morgan` (HTTP request logger)
* `typescript` & `tsx` (TypeScript compiling and hot-reload runner)
* `bullmq` (Redis-backed task queue for background parsing)

---

## 2. Configuring PostgreSQL & Redis (Docker)

We manage database (PostgreSQL) and message queue (Redis) setup using Docker Compose.

1. Start both containers in the background:
   ```bash
   docker compose up -d
   ```
2. This creates:
   * **PostgreSQL**: Accessible at `localhost:5432` (with database `receipt_parser_db` and volume `postgres_data`).
   * **Redis**: Accessible at `localhost:6379` (with volume `redis_data` for queue persistence).

*(If you are running services locally without Docker, ensure local Postgres and Redis services are active).*

---

### Environment Setup

1. **Copy `.env.example` to `.env`**:
   ```bash
   cp .env.example .env
   ```
2. **Configure environment variables** in `.env`:
   * **DATABASE_URL**: Connect using:
     `postgres://postgres:postgres@localhost:5432/receipt_parser_db`
   * **PORT**: Set your preferred port (defaults to `3000`).
   * **REDIS_HOST**: Set to `localhost` (or container IP).
   * **REDIS_PORT**: Set to `6379`.
   * **GEMINI_API_KEY**: Set your API key from Google AI Studio.

---

## 3. Running Database Initialization

You **do not need** to run database initialization as a separate step!
* When the Express server starts, it calls the `initializeDatabase()` helper in `src/db.ts`.
* This automatically runs the `CREATE TABLE IF NOT EXISTS receipts` query, setting up the required schema including the `JSONB` item storage and `BYTEA` binary image column.

---

## 4. Starting the Development Server

To run the application with hot-reloading (auto-restarts on save), run:

```bash
npm run dev
```

You should see output similar to this:
```text
Database initialized successfully: "receipts" table is ready.
Receipt Parser API Server running on port 3000
```

---

## 5. Compiling TypeScript

To compile the TypeScript source files to production-ready JavaScript in the `dist/` directory:

```bash
npm run build
```

This compiles `src/*.ts` into `dist/*.js`. You can then run the production build using:

```bash
npm start
```

---

## 6. Testing the API Using `curl`

To access any receipt endpoints, you must first register a user account, log in, and acquire a JSON Web Token (JWT). You will then include this token in the header of all subsequent requests: `-H "Authorization: Bearer <your_token>"`.

### Test 1: POST /api/auth/register (User Registration)
Register a new user:
```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com", "password":"password123"}'
```
**Expected Response (201 Created):**
```json
{
  "success": true,
  "userId": 1,
  "message": "User registered successfully. You can now login."
}
```

### Test 2: POST /api/auth/login (User Login)
Log in with the registered credentials to obtain your JWT token:
```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com", "password":"password123"}'
```
**Expected Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOi...",
  "message": "Login successful."
}
```
*(Copy the returned `"token"` value. We will refer to this as `<TOKEN>` in the tests below.)*

---

### Test 3: POST /api/receipts (Validation - Non-Image File)
Test that validation rejects non-image files even when authenticated. Replace `<TOKEN>` with your login token:
```bash
curl -i -X POST http://localhost:3000/api/receipts \
  -H "Authorization: Bearer <TOKEN>" \
  -F "receipt=@package.json"
```
**Expected Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Invalid image type. Only JPEG, PNG, WEBP, and GIF images are allowed."
}
```

### Test 4: POST /api/receipts (Start Asynchronous Parsing)
Upload a valid receipt image (e.g. `receipt.jpg`) to register a parsing task. The task is tied to your authenticated user:
```bash
curl -i -X POST http://localhost:3000/api/receipts \
  -H "Authorization: Bearer <TOKEN>" \
  -F "receipt=@/path/to/your/receipt.jpg"
```
**Expected Response (202 Accepted):**
```json
{
  "success": true,
  "receiptId": 1,
  "status": "processing",
  "message": "Receipt uploaded successfully. Parsing and extraction are running in the background. Please query GET /api/receipts/:id to check status."
}
```

### Test 5: GET /api/receipts (List Receipts)
Get a list of all receipts belonging to your authenticated account:
```bash
curl -i http://localhost:3000/api/receipts \
  -H "Authorization: Bearer <TOKEN>"
```
**Expected Response (200 OK):**
```json
{
  "success": true,
  "receipts": [
    {
      "id": 1,
      "status": "completed",
      "store_name": "Target Store",
      "receipt_date": "2026-07-16T00:00:00.000Z",
      "total_amount": "42.50",
      "taxes": "3.40",
      "items": [
        {
          "description": "Premium Notebook",
          "quantity": 2,
          "price": 15
        },
        {
          "description": "Blue Ink Pen Pack",
          "quantity": 1,
          "price": 9.1
        }
      ],
      "error_message": null,
      "created_at": "2026-07-16T11:15:23.000Z"
    }
  ]
}
```

### Test 6: GET /api/receipts/:id (Retrieve Single Receipt Status/Detail)
Get details and parsing status of a single receipt using its database ID. While it is processing, `status` will show `"processing"`. Once finished, it will display `"completed"` with parsed data, or `"failed"` with the error description under `error_message`.
```bash
curl -i http://localhost:3000/api/receipts/1 \
  -H "Authorization: Bearer <TOKEN>"
```
**Expected Response (200 OK - Completed):**
```json
{
  "success": true,
  "receipt": {
    "id": 1,
    "status": "completed",
    "store_name": "Target Store",
    "receipt_date": "2026-07-16T00:00:00.000Z",
    "total_amount": "42.50",
    "taxes": "3.40",
    "items": [
      {
        "description": "Premium Notebook",
        "quantity": 2,
        "price": 15
      },
      {
        "description": "Blue Ink Pen Pack",
        "quantity": 1,
        "price": 9.1
      }
    ],
    "error_message": null,
    "created_at": "2026-07-16T11:15:23.000Z"
  }
}
```
If you request an ID that does not exist or belongs to another user (e.g. `/api/receipts/999`):
**Expected Response (404 Not Found):**
```json
{
  "success": false,
  "error": "Receipt with ID 999 not found or you do not have permission to view it."
}
```

### Test 7: GET /api/receipts/summary (Category-based Expense Summary)
Retrieve aggregated expenses by category. You can filter by date using the `?filter=` query parameter (`today`, `yesterday`, `this_week`, `this_month`, `this_year`). Defaults to `this_month`.
```bash
curl -i "http://localhost:3000/api/receipts/summary?filter=this_month" \
  -H "Authorization: Bearer <TOKEN>"
```
**Expected Response (200 OK):**
```json
{
  "success": true,
  "filter": "this_month",
  "expenses": {
    "Medical & Pharmacy": 1132.00,
    "Grocery": 0.00,
    "Food & Dining": 0.00,
    "Shopping": 42.50,
    "Fuel": 0.00,
    "Bills": 0.00,
    "Other": 0.00
  },
  "totalExpenses": 1174.50
}
```
If you pass an invalid filter parameter (e.g. `?filter=next_year`):
**Expected Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "filter: Invalid enum value. Expected 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year', received 'next_year'"
}
```
