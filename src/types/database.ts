/**
 * TypeScript types for OtelAI database tables.
 *
 * These mirror the Supabase database schema defined in:
 *   supabase/migrations/0001_foundation.sql
 *   supabase/migrations/0002_agent_core.sql
 *   supabase/migrations/0003_knowledge_base.sql
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
  onboarding_completed_at: string | null; // Set when hotel owner completes onboarding wizard (added in 0003)
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
// HotelFact — Semantic memory (Tier 1)
// Corresponds to: public.hotel_facts table
// Static knowledge base: policies, amenities, FAQs, pricing notes
// =============================================================================

export type HotelFactCategory = 'policy' | 'amenity' | 'faq' | 'pricing_note' | 'recommendation';

export interface HotelFact {
  id: string;           // UUID primary key
  hotel_id: string;     // UUID — references public.hotels.id (NOT NULL)
  category: HotelFactCategory; // Type of fact
  fact: string;         // The fact content (NOT NULL)
  created_at: string;   // ISO 8601 UTC timestamp (timestamptz)
  updated_at: string;   // ISO 8601 UTC timestamp (timestamptz, auto-updated by trigger)
}

// =============================================================================
// Room — Structured room inventory (added in 0003_knowledge_base.sql)
// Corresponds to: public.rooms table
// Room data is injected into agent context alongside semantic facts (KNOW-04)
// =============================================================================

export interface Room {
  id: string;                    // UUID primary key
  hotel_id: string;              // UUID — references public.hotels.id (NOT NULL)
  name: string;                  // Room display name e.g. "Deluxe Ocean View" (NOT NULL)
  room_type: string;             // e.g. "standard", "deluxe", "suite" (NOT NULL)
  bed_type: string | null;       // e.g. "king", "twin", "queen"
  max_occupancy: number | null;  // Maximum number of guests
  description: string | null;   // Long-form room description
  amenities: string[] | null;   // PostgreSQL text array of amenity strings
  base_price_note: string | null; // e.g. "from $120/night" — for agent display, not booking engine
  sort_order: number;            // Display sort order (NOT NULL, default 0)
  created_at: string;            // ISO 8601 UTC timestamp (timestamptz)
  updated_at: string;            // ISO 8601 UTC timestamp (timestamptz, auto-updated by trigger)
}

// =============================================================================
// GuestInteraction — Episodic memory (Tier 2)
// Corresponds to: public.guest_interactions table
// Agent-written summaries of past guest interactions
// =============================================================================

export type InteractionSentiment = 'positive' | 'neutral' | 'negative';

export interface GuestInteraction {
  id: string;                // UUID primary key
  hotel_id: string;          // UUID — references public.hotels.id (NOT NULL)
  guest_identifier: string;  // email, phone, or session token (NOT NULL)
  summary: string;           // Agent-written summary of the interaction (NOT NULL)
  sentiment: InteractionSentiment | null; // Overall sentiment of the interaction
  created_at: string;        // ISO 8601 UTC timestamp (timestamptz)
}

// =============================================================================
// ConversationTurn — Working memory (Tier 3)
// Corresponds to: public.conversation_turns table
// Per-conversation message history for active context window
// =============================================================================

export type ConversationRole = 'user' | 'assistant' | 'tool';

export interface ConversationTurn {
  id: string;               // UUID primary key
  conversation_id: string;  // UUID — groups turns into a conversation (NOT NULL)
  hotel_id: string;         // UUID — references public.hotels.id (NOT NULL)
  role: ConversationRole;   // Message role (NOT NULL, CHECK constraint)
  content: string;          // Message content or JSON-encoded tool result (NOT NULL)
  tool_use_id: string | null; // For tool/tool_result correlation (NULL for user/assistant)
  created_at: string;       // ISO 8601 UTC timestamp (timestamptz)
}

// =============================================================================
// AgentTask — Task coordination
// Corresponds to: public.agent_tasks table
// Queue for multi-agent task delegation and handoffs
// =============================================================================

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AgentTask {
  id: string;              // UUID primary key
  hotel_id: string;        // UUID — references public.hotels.id (NOT NULL)
  from_role: string;       // Originating agent role (NOT NULL)
  to_role: string;         // Target agent role (NOT NULL)
  task_type: string;       // e.g. 'reservation_lookup', 'complaint_escalate' (NOT NULL)
  payload: Record<string, unknown>; // Task-specific data (JSONB, default '{}')
  status: TaskStatus;      // Current task status (NOT NULL, default 'pending')
  result: Record<string, unknown> | null; // Populated by executing agent on completion
  error_message: string | null; // Populated on failure
  created_at: string;      // ISO 8601 UTC timestamp (timestamptz)
  updated_at: string;      // ISO 8601 UTC timestamp (timestamptz, auto-updated by trigger)
  completed_at: string | null; // NULL until status becomes 'completed' or 'failed'
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
      hotel_facts: {
        Row: HotelFact;
        Insert: Omit<HotelFact, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<HotelFact, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      rooms: {
        Row: Room;
        Insert: Omit<Room, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Room, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      guest_interactions: {
        Row: GuestInteraction;
        Insert: Omit<GuestInteraction, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<GuestInteraction, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      conversation_turns: {
        Row: ConversationTurn;
        Insert: Omit<ConversationTurn, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ConversationTurn, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      agent_tasks: {
        Row: AgentTask;
        Insert: Omit<AgentTask, 'id' | 'created_at' | 'updated_at' | 'completed_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Omit<AgentTask, 'id' | 'created_at'>>;
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
      task_status: TaskStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
