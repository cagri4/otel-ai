'use server';

/**
 * Server Actions for knowledge base CRUD operations.
 *
 * Handles hotel_facts (text-based knowledge) and rooms (structured room inventory).
 *
 * Flow for each action:
 * 1. Authenticate user via supabase.auth.getUser()
 * 2. Get hotel_id via RLS-scoped hotels query (returns only user's hotel)
 * 3. Validate form data with Zod schema
 * 4. Execute Supabase CRUD operation
 * 5. Revalidate /knowledge path
 * 6. Return { success: true } or { error: string }
 *
 * INSERT queries cast supabase to SupabaseClient (postgrest-js v12 workaround).
 * UPDATE/DELETE queries use standard client with .eq('id', id) — RLS provides
 * additional enforcement at the DB level.
 *
 * Source: .planning/phases/03-knowledge-base-and-onboarding/03-01-PLAN.md
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { factSchema, roomSchema } from '@/lib/validations/knowledge';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface KnowledgeActionResult {
  success?: boolean;
  error?: string;
}

// =============================================================================
// Hotel Facts CRUD
// =============================================================================

/**
 * Adds a new hotel fact to the knowledge base.
 *
 * @param formData - FormData with 'category' and 'fact' fields
 * @returns { success: true } or { error: string }
 */
export async function addFact(formData: FormData): Promise<KnowledgeActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('id')
    .single() as { data: { id: string } | null; error: Error | null };

  if (hotelError || !hotel) {
    return { error: 'Hotel not found' };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = factSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { error: firstError ?? 'Validation failed' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as unknown as SupabaseClient)
    .from('hotel_facts')
    .insert({
      hotel_id: hotel.id,
      category: parsed.data.category,
      fact: parsed.data.fact,
    } as Record<string, unknown>);

  if (insertError) {
    return { error: insertError.message };
  }

  revalidatePath('/knowledge');
  return { success: true };
}

/**
 * Updates an existing hotel fact.
 *
 * @param id - UUID of the hotel_fact to update
 * @param formData - FormData with 'category' and 'fact' fields
 * @returns { success: true } or { error: string }
 */
export async function updateFact(
  id: string,
  formData: FormData,
): Promise<KnowledgeActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('id')
    .single() as { data: { id: string } | null; error: Error | null };

  if (hotelError || !hotel) {
    return { error: 'Hotel not found' };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = factSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { error: firstError ?? 'Validation failed' };
  }

  const { error: updateError } = await (supabase
    .from('hotel_facts') as ReturnType<typeof supabase.from>)
    .update({
      category: parsed.data.category,
      fact: parsed.data.fact,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', id);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath('/knowledge');
  return { success: true };
}

/**
 * Deletes a hotel fact from the knowledge base.
 *
 * @param id - UUID of the hotel_fact to delete
 * @returns { success: true } or { error: string }
 */
export async function deleteFact(id: string): Promise<KnowledgeActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { error: deleteError } = await (supabase
    .from('hotel_facts') as ReturnType<typeof supabase.from>)
    .delete()
    .eq('id', id);

  if (deleteError) {
    return { error: deleteError.message };
  }

  revalidatePath('/knowledge');
  return { success: true };
}

// =============================================================================
// Rooms CRUD
// =============================================================================

/**
 * Adds a new room to the hotel's room inventory.
 * Splits amenities from comma-separated string into string[] for storage.
 *
 * @param formData - FormData matching roomSchema fields
 * @returns { success: true } or { error: string }
 */
export async function addRoom(formData: FormData): Promise<KnowledgeActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('id')
    .single() as { data: { id: string } | null; error: Error | null };

  if (hotelError || !hotel) {
    return { error: 'Hotel not found' };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = roomSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { error: firstError ?? 'Validation failed' };
  }

  // Split comma-separated amenities string into array (filter out empty strings)
  const amenitiesArray = parsed.data.amenities
    ? parsed.data.amenities
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as unknown as SupabaseClient)
    .from('rooms')
    .insert({
      hotel_id: hotel.id,
      name: parsed.data.name,
      room_type: parsed.data.room_type,
      bed_type: parsed.data.bed_type ?? null,
      max_occupancy: parsed.data.max_occupancy ?? null,
      description: parsed.data.description ?? null,
      amenities: amenitiesArray,
      base_price_note: parsed.data.base_price_note ?? null,
    } as Record<string, unknown>);

  if (insertError) {
    return { error: insertError.message };
  }

  revalidatePath('/knowledge');
  return { success: true };
}

/**
 * Updates an existing room in the hotel's room inventory.
 * Splits amenities from comma-separated string into string[] for storage.
 *
 * @param id - UUID of the room to update
 * @param formData - FormData matching roomSchema fields
 * @returns { success: true } or { error: string }
 */
export async function updateRoom(
  id: string,
  formData: FormData,
): Promise<KnowledgeActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { data: hotel, error: hotelError } = await supabase
    .from('hotels')
    .select('id')
    .single() as { data: { id: string } | null; error: Error | null };

  if (hotelError || !hotel) {
    return { error: 'Hotel not found' };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = roomSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { error: firstError ?? 'Validation failed' };
  }

  // Split comma-separated amenities string into array (filter out empty strings)
  const amenitiesArray = parsed.data.amenities
    ? parsed.data.amenities
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : null;

  const { error: updateError } = await (supabase
    .from('rooms') as ReturnType<typeof supabase.from>)
    .update({
      name: parsed.data.name,
      room_type: parsed.data.room_type,
      bed_type: parsed.data.bed_type ?? null,
      max_occupancy: parsed.data.max_occupancy ?? null,
      description: parsed.data.description ?? null,
      amenities: amenitiesArray,
      base_price_note: parsed.data.base_price_note ?? null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', id);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath('/knowledge');
  return { success: true };
}

/**
 * Deletes a room from the hotel's room inventory.
 *
 * @param id - UUID of the room to delete
 * @returns { success: true } or { error: string }
 */
export async function deleteRoom(id: string): Promise<KnowledgeActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { error: deleteError } = await (supabase
    .from('rooms') as ReturnType<typeof supabase.from>)
    .delete()
    .eq('id', id);

  if (deleteError) {
    return { error: deleteError.message };
  }

  revalidatePath('/knowledge');
  return { success: true };
}
