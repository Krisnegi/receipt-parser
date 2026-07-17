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
    timeout: 30000, // 30 seconds (in milliseconds) - fail fast on hung connections
  },
});

// A prioritized list of preferred fallback models
const PREFERRED_MODELS = ['gemini-3.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
const MAX_RETRIES = 0; // 1 attempt per model

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cache the active models in memory to avoid repetitive API requests
let cachedActiveModels: string[] | null = null;

const isModelMatch = (name: string, preferred: string) => {
  const normName = name.replace(/^models\//, '');
  const normPreferred = preferred.replace(/^models\//, '');
  return normName === normPreferred;
};

const isVisionModel = (name: string) => {
  const norm = name.toLowerCase();
  // All modern Gemini models (e.g. gemini-1.5, gemini-2.0, gemini-3.5) support vision and image inputs
  return norm.includes('gemini-');
};

/**
 * Dynamically queries the Google Gen AI API to list available models that support generateContent
 * and filters them down to our preferred subset to prevent 404 or unsupported method errors.
 */
async function getActiveModels(): Promise<string[]> {
  if (cachedActiveModels) {
    return cachedActiveModels;
  }

  try {
    console.log('[Parser] Dynamically listing available models from Google API...');
    const response = await ai.models.list();
    
    const apiModelNames: string[] = [];
    for await (const m of response) {
      if (m.name && m.supportedActions?.includes('generateContent') && isVisionModel(m.name)) {
        apiModelNames.push(m.name);
      }
    }

    // Edge Case: If the listing request completes but returns 0 active models,
    // we throw an error because any subsequent parsing attempt is guaranteed to fail.
    if (apiModelNames.length === 0) {
      throw new Error('No available models supporting generateContent found for this API key. Please check your Google AI Studio configuration and permissions.');
    }

    // Build a list of up to 3 fallback models
    const selected: string[] = [];

    // 1. Search for our preferred models in order of priority
    for (const pref of PREFERRED_MODELS) {
      if (selected.length === 3) break;

      const found = apiModelNames.find(apiMod => isModelMatch(apiMod, pref));
      if (found && !selected.includes(found)) {
        selected.push(found);
      }
    }

    // 2. If we have less than 3 models, fill the remaining slots with other available models from the list
    if (selected.length < 3) {
      for (const apiMod of apiModelNames) {
        if (!selected.includes(apiMod)) {
          selected.push(apiMod);
          if (selected.length === 3) {
            break;
          }
        }
      }
    }

    cachedActiveModels = selected;
    console.log('[Parser] Resolved active fallback models successfully:', cachedActiveModels);
  } catch (error: any) {
    // If the API list call fails (e.g. network glitch or listing blocked), default to static preferred list
    console.warn('[Parser] Failed to list models from Google API. Defaulting to static preferred list. Error:', error.message || error);
    cachedActiveModels = PREFERRED_MODELS;
  }

  return cachedActiveModels;
}

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
    - category: The classified category of the receipt. Choose exactly one of the allowed categories: "Medical & Pharmacy", "Grocery", "Food & Dining", "Shopping", "Fuel", "Bills", "Other".
    - storeName: Name of the store. Use null if not found.
    - date: Transaction date formatted as YYYY-MM-DD. Use null if not found.
    - totalAmount: The total transaction amount on the receipt as a number. Use null if not found.
    - taxes: The tax amount as a number. Use null if not found.
    - lineItems: An array of item objects, each with a description, quantity, and price.

    Instructions:
    1. Classify the receipt into one of the allowed categories based on the merchant name and items purchased.
    2. Only extract information that is explicitly stated or can be safely inferred from the receipt.
    3. NEVER hallucinate any value. If a field cannot be determined, set it to null.
    4. Return monetary amounts as numbers (not formatted strings like "$10.50").
    5. Return quantity amounts as numbers (e.g., 2 instead of "2x").
  `;

  let lastError: any = null;
  const activeModels = await getActiveModels();

  for (const modelName of activeModels) {
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
