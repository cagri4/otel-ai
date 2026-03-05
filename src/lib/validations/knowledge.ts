/**
 * Zod validation schemas for knowledge base forms.
 *
 * Used by:
 * - Knowledge base UI (03-02-PLAN.md) — fact and room forms
 * - src/lib/actions/knowledge.ts — server-side validation for CRUD operations
 *
 * Schemas:
 * - factSchema: validates hotel_facts rows (category + fact text)
 * - roomSchema: validates rooms rows (name, type, bed, occupancy, amenities, price note)
 */

import { z } from 'zod';

// =============================================================================
// Fact Schema
// Validates hotel_facts rows. Category must be one of the defined categories.
// =============================================================================

export const FACT_CATEGORIES = [
  'policy',
  'faq',
  'amenity',
  'pricing_note',
  'recommendation',
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const factSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  fact: z
    .string()
    .min(5, 'Fact must be at least 5 characters')
    .max(500, 'Fact must be under 500 characters'),
});

export type FactInput = z.infer<typeof factSchema>;

// =============================================================================
// Room Schema
// Validates rooms rows. amenities is submitted as comma-separated string
// from the UI form; splitting into string[] happens in the Server Action.
// =============================================================================

export const roomSchema = z.object({
  name: z
    .string()
    .min(2, 'Room name required')
    .max(100, 'Room name must be 100 characters or fewer'),
  room_type: z.string().min(1, 'Room type required'),
  bed_type: z.string().optional(),
  max_occupancy: z.number().int().min(1).max(20).optional(),
  description: z.string().max(1000, 'Description must be under 1000 characters').optional(),
  amenities: z.string().optional(), // comma-separated string, split in Server Action
  base_price_note: z
    .string()
    .max(100, 'Price note must be under 100 characters')
    .optional(),
});

export type RoomInput = z.infer<typeof roomSchema>;
