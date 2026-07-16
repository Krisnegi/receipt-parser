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

/**
 * Sends a receipt image buffer to Google Gemini 2.5 Flash and extracts the receipt data.
 * Enforces structured JSON output matching the Zod schema configuration.
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
    - totalAmount: The total transaction amount as a number. Use null if not found.
    - taxes: The tax amount as a number. Use null if not found.
    - lineItems: An array of item objects, each with a description, quantity, and price.

    Instructions:
    1. Only extract information that is explicitly stated or can be safely inferred from the receipt.
    2. NEVER hallucinate any value. If a field cannot be determined, set it to null.
    3. Return monetary amounts as numbers (not formatted strings like "$10.50").
    4. Return quantity amounts as numbers (e.g., 2 instead of "2x").
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
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

    // Parse the JSON output from the model
    const parsedData = JSON.parse(text);

    // Validate the response using Zod to ensure type-safety and check constraints
    const validatedReceipt = ReceiptSchema.parse(parsedData);
    return validatedReceipt;
  } catch (error: any) {
    console.error('Gemini receipt extraction failed:', error);
    throw new Error(`Failed to parse receipt: ${error.message || error}`);
  }
}
