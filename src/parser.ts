import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { GeminiReceiptSchema, ReceiptSchema, type Receipt } from './schemas.js';

// Load environment variables
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('GEMINI_API_KEY is not set in the environment variables.');
  process.exit(1);
}

// Initialize the Google Gen AI client with the provided API key and request timeout options
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    timeout: 120000, // 2 minutes (in milliseconds)
  },
});

// A list of fallback models in priority order
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
const MAX_RETRIES = 2; // 3 attempts per model

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a receipt image buffer to Google Gemini and extracts the receipt data.
 * Utilizes a retry strategy with exponential backoff and cascades to fallback models if needed.
 *
 * @param imageBuffer The raw binary image buffer of the receipt
 * @param mimeType The image MIME type (e.g., image/jpeg, image/png)
 * @returns The parsed and validated receipt object
 */
export async function parseReceipt(imageBuffer: Buffer, mimeType: string): Promise<Receipt> {
  const prompt = `
    Analyze the provided receipt image and extract details precisely matching the response schema:
    - storeName: Name of the store. Use null if not found.
    - date: Transaction date formatted as YYYY-MM-DD. Use null if not found.
    - totalAmount: The total transaction amount on the receipt as a number. Use null if not found.
    - taxes: The tax amount as a number. Use null if not found.
    - lineItems: An array of item objects, each with a description, quantity, and price.

    Instructions:
    1. Only extract information that is explicitly stated or can be safely inferred from the receipt.
    2. NEVER hallucinate any value. If a field cannot be determined, set it to null.
    3. Return monetary amounts as numbers (not formatted strings like "$10.50").
    4. Return quantity amounts as numbers (e.g., 2 instead of "2x").
  `;

  let lastError: any = null;

  for (const modelName of FALLBACK_MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Parser] Attempting extraction with model: ${modelName} (Attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
        
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType: mimeType,
              },
            },
            prompt,
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: GeminiReceiptSchema,
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error('Gemini API returned an empty text response.');
        }

        // Parse and validate using Zod
        const parsedData = JSON.parse(text);
        const validatedReceipt = ReceiptSchema.parse(parsedData);
        
        console.log(`[Parser] Successfully parsed receipt using model: ${modelName}`);
        return validatedReceipt;
      } catch (error: any) {
        lastError = error;
        console.warn(`[Parser] Attempt ${attempt + 1} failed for model ${modelName}. Error: ${error.message || error}`);

        // If this is not the last attempt, sleep with exponential backoff before retrying
        if (attempt < MAX_RETRIES) {
          const backoffDelay = Math.pow(2, attempt) * 1000;
          console.log(`[Parser] Waiting ${backoffDelay}ms before retrying ${modelName}...`);
          await delay(backoffDelay);
        }
      }
    }
    console.warn(`[Parser] Model ${modelName} exhausted. Falling back to the next model...`);
  }

  // If we reach here, all models and retries failed
  console.error('[Parser] All fallback models and retry attempts failed.');
  throw new Error(`Failed to parse receipt after multiple attempts. Last error: ${lastError?.message || lastError}`);
}
