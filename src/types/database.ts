/**
 * TypeScript types for OtelAI database tables.
 *
 * These mirror the Supabase database schema defined in:
 *   supabase/migrations/0001_foundation.sql
 *
 * Column naming: snake_case in database, snake_case in TypeScript
 * (matching what Supabase client returns from queries).
 *
 * Full generated types (via `supabase gen types typescript`) should replace
 * these manually-defined types in a later phase once the schema stabilizes.
 */

// =============================================================================
// Hotel
// Corresponds to: public.hotels table
// =============================================================================

export interface Hotel {
  id: string;                   // UUID primary key
  name: string;                 // Hotel display name (NOT NULL)
  address: string | null;       // Street address
  city: string | null;          // City name
  country: string | null;       // Country name
  timezone: string;             // IANA timezone string e.g. "Europe/Istanbul" (NOT NULL, default 'UTC')
  contact_email: string | null; // Primary contact email
  contact_phone: string | null; // Primary contact phone
  created_at: string;           // ISO 8601 UTC timestamp (timestamptz)
  updated_at: string;           // ISO 8601 UTC timestamp (timestamptz, auto-updated by trigger)
}

// =============================================================================
// Profile
// Corresponds to: public.profiles table
// Links auth.users to hotels (one profile per user)
// =============================================================================

export interface Profile {
  id: string;        // UUID — same as auth.users.id (PK + FK)
  hotel_id: string;  // UUID — references public.hotels.id (NOT NULL)
  full_name: string | null; // User's display name
  role: string;      // User role within hotel, default 'owner'
  created_at: string; // ISO 8601 UTC timestamp (timestamptz)
}

// =============================================================================
// Database wrapper type
// Provides basic structure for Supabase client typing.
// Replace with generated types (`supabase gen types typescript`) in a later phase.
// =============================================================================

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  public: {
    Tables: {
      hotels: {
        Row: Hotel;
        Insert: Omit<Hotel, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Hotel, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'> & {
          created_at?: string;
        };
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
