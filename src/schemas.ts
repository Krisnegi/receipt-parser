import { z } from 'zod';
import { Type } from '@google/genai';

// 1. Line Item Zod Schema for local API responses and verification
export const LineItemSchema = z.object({
  description: z.string({
    required_error: 'Line item description is required',
  }).trim(),
  quantity: z.number({
    required_error: 'Line item quantity is required',
    invalid_type_error: 'Line item quantity must be a number',
  }),
  price: z.number({
    required_error: 'Line item price is required',
    invalid_type_error: 'Line item price must be a number',
  }),
});

// 2. Receipt Zod Schema for validation and TypeScript inference
export const ReceiptSchema = z.object({
  storeName: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  totalAmount: z.number().nullable().default(null),
  taxes: z.number().nullable().default(null),
  lineItems: z.array(LineItemSchema).default([]),
});

export type LineItem = z.infer<typeof LineItemSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

// 3. Gemini Response Schema using OpenAPI types from the official @google/genai SDK
export const GeminiReceiptSchema = {
  type: Type.OBJECT,
  properties: {
    storeName: {
      type: Type.STRING,
      description: 'The name of the store. Return null if it cannot be determined.',
      nullable: true,
    },
    date: {
      type: Type.STRING,
      description: 'The transaction date converted to YYYY-MM-DD format. Return null if it cannot be determined.',
      nullable: true,
    },
    totalAmount: {
      type: Type.NUMBER,
      description: 'The total transaction amount on the receipt as a number. Return null if it cannot be determined.',
      nullable: true,
    },
    taxes: {
      type: Type.NUMBER,
      description: 'The tax amount on the receipt as a number. Return null if it cannot be determined.',
      nullable: true,
    },
    lineItems: {
      type: Type.ARRAY,
      description: 'The list of individual items purchased on the receipt.',
      items: {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description: 'The name or description of the product or service.',
          },
          quantity: {
            type: Type.NUMBER,
            description: 'The quantity purchased. Must be a number.',
          },
          price: {
            type: Type.NUMBER,
            description: 'The total price or amount of this line item as written on the receipt. Must be a number.',
          },
        },
        required: ['description', 'quantity', 'price'],
      },
    },
  },
  required: ['lineItems'],
};

// 4. User registration validation schema
export const RegisterSchema = z.object({
  email: z.string({
    required_error: 'Email is required',
  }).email('Invalid email address').trim().toLowerCase(),
  password: z.string({
    required_error: 'Password is required',
  }).min(6, 'Password must be at least 6 characters long'),
});

// 5. User login validation schema
export const LoginSchema = z.object({
  email: z.string({
    required_error: 'Email is required',
  }).email('Invalid email address').trim().toLowerCase(),
  password: z.string({
    required_error: 'Password is required',
  }),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

