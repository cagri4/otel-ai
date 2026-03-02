/**
 * Zod validation schemas for hotel settings form.
 *
 * Used by:
 * - hotel-settings-form.tsx (hotelSettingsSchema + HotelSettingsInput)
 * - settings/actions.ts (server-side validation)
 *
 * IMPORTANT: timezone is validated as a valid IANA timezone string using
 * Intl.DateTimeFormat — not just a non-empty string. Invalid timezone strings
 * like "America/FooBar" are rejected before they reach the database.
 */
import { z } from 'zod'

// =============================================================================
// Hotel Settings Schema
// Validates all editable fields on the hotel settings page.
// =============================================================================

export const hotelSettingsSchema = z.object({
  name: z
    .string()
    .min(1, 'Hotel name is required')
    .max(100, 'Hotel name must be 100 characters or fewer'),

  address: z
    .string()
    .max(255, 'Address must be 255 characters or fewer')
    .optional()
    .or(z.literal('')),

  city: z
    .string()
    .max(100, 'City must be 100 characters or fewer')
    .optional()
    .or(z.literal('')),

  country: z
    .string()
    .max(100, 'Country must be 100 characters or fewer')
    .optional()
    .or(z.literal('')),

  timezone: z.string().refine(
    (tz) => {
      try {
        // Intl.DateTimeFormat will throw if the timezone is invalid
        Intl.DateTimeFormat(undefined, { timeZone: tz })
        return true
      } catch {
        return false
      }
    },
    { message: 'Invalid timezone' }
  ),

  contactEmail: z
    .string()
    .email('Invalid email')
    .optional()
    .or(z.literal('')),

  contactPhone: z
    .string()
    .max(30, 'Phone number must be 30 characters or fewer')
    .optional()
    .or(z.literal('')),
})

export type HotelSettingsInput = z.infer<typeof hotelSettingsSchema>
