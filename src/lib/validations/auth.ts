/**
 * Zod validation schemas for authentication forms.
 *
 * Used by:
 * - signup-form.tsx (signupSchema + SignupInput)
 * - login-form.tsx (loginSchema + LoginInput)
 *
 * Shared between client (react-hook-form resolver) and potentially
 * server-side validation in future Server Actions.
 */
import { z } from 'zod'

// =============================================================================
// Signup Schema
// Validates: email, password, hotel name (required), full name (optional)
// =============================================================================

export const signupSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  hotelName: z
    .string()
    .min(1, 'Hotel name is required')
    .max(100, 'Hotel name must be 100 characters or fewer'),
  fullName: z
    .string()
    .min(1)
    .max(100, 'Full name must be 100 characters or fewer')
    .optional(),
})

export type SignupInput = z.infer<typeof signupSchema>

// =============================================================================
// Login Schema
// Validates: email, password
// =============================================================================

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginInput = z.infer<typeof loginSchema>
