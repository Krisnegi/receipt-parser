# Receipt Parser API Walkthrough & Instructions

We have built a clean, beginner-friendly, non-overengineered receipt parsing API service using Express, PostgreSQL, and the modern Google Gen AI SDK. Below are the complete instructions to set up, run, compile, and test the project.

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

---

## 2. Configuring PostgreSQL

You can run PostgreSQL either locally or via a **Docker** container.

### Option A: Run PostgreSQL in Docker (Recommended)
We have added a `docker-compose.yml` file to the root of the project to manage database setup.
1. Run the following command in your terminal to start the PostgreSQL container:
   ```bash
   docker compose up -d
   ```
2. This maps port `5432` of the container to port `5432` on your host machine, makes it accessible at `localhost:5432`, and creates a named volume (`postgres_data`) to persist your database files.

### Option B: Run PostgreSQL Locally
1. Start your local PostgreSQL service.
2. Connect to it and create a database named `receipt_parser_db`:
   ```sql
   CREATE DATABASE receipt_parser_db;
   ```

---

### Environment Setup

1. **Copy `.env.example` to `.env`**:
   ```bash
   cp .env.example .env
   ```
2. **Configure environment variables** in `.env`:
   * **DATABASE_URL**: Connect using:
     `postgres://postgres:postgres@localhost:5432/receipt_parser_db`
   * **GEMINI_API_KEY**: Set your API key from Google AI Studio.
   * **PORT**: Set your preferred port (defaults to `3000`).

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

Here are the curl requests to test our endpoints:

### Test 1: POST /api/receipts (Validation - Non-Image File)
Test that upload validation rejects non-image files. Replace `package.json` with any non-image file path:
```bash
curl -i -X POST http://localhost:3000/api/receipts \
  -F "receipt=@package.json"
```
**Expected Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Invalid image type. Only JPEG, PNG, WEBP, and GIF images are allowed."
}
```

### Test 2: POST /api/receipts (Start Asynchronous Parsing)
Upload a valid receipt image (e.g. `receipt.jpg`) to register a parsing task. The server will immediately save the raw image and return a response without holding the connection:
```bash
curl -i -X POST http://localhost:3000/api/receipts \
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

### Test 3: GET /api/receipts (List Receipts)
Get a list of all receipts and their current processing status (binary image data is omitted automatically to keep payloads small):
```bash
curl -i http://localhost:3000/api/receipts
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

### Test 4: GET /api/receipts/:id (Retrieve Single Receipt Status/Detail)
Get details and parsing status of a single receipt using its database ID. While it is processing, `status` will show `"processing"`. Once finished, it will display `"completed"` with parsed data, or `"failed"` with the error description under `error_message`.
```bash
curl -i http://localhost:3000/api/receipts/1
```
**Expected Response (200 OK - Processing):**
```json
{
  "success": true,
  "receipt": {
    "id": 1,
    "status": "processing",
    "store_name": null,
    "receipt_date": null,
    "total_amount": null,
    "taxes": null,
    "items": null,
    "error_message": null,
    "created_at": "2026-07-16T11:15:23.000Z"
  }
}
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
If you request an ID that does not exist (e.g. `/api/receipts/999`):
**Expected Response (404 Not Found):**
```json
{
  "success": false,
  "error": "Receipt with ID 999 not found."
}
```
