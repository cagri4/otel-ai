/**
 * TypeScript types for OtelAI database tables.
 *
 * These mirror the Supabase database schema defined in:
 *   supabase/migrations/0001_foundation.sql
 *   supabase/migrations/0002_agent_core.sql
 *   supabase/migrations/0003_knowledge_base.sql
 *   supabase/migrations/0004_guest_facing.sql
 *   supabase/migrations/0005_guest_experience.sql
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

// Widget appearance and behavior configuration stored as JSONB on hotels.widget_config
export type WidgetConfig = {
  primary_color?: string;    // Hex color e.g. "#1a73e8"
  logo_url?: string;         // URL to hotel logo for widget header
  welcome_message?: string;  // Initial greeting shown to guests
  position?: 'bottom-right' | 'bottom-left'; // Widget floating button position
};

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
  widget_token: string;                   // Unique embed token for the chat widget (added in 0004)
  widget_config: Record<string, unknown> | null; // JSONB widget appearance config (added in 0004)
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
// Escalation — Human escalation requests (added in 0004_guest_facing.sql)
// Corresponds to: public.escalations table
// Records conversations where the AI could not resolve the guest's issue
// and staff follow-up is required.
// =============================================================================

export type EscalationChannel = 'whatsapp' | 'widget';

export interface Escalation {
  id: string;               // UUID primary key
  hotel_id: string;         // UUID — references public.hotels.id (NOT NULL)
  conversation_id: string;  // Conversation identifier (NOT NULL)
  channel: EscalationChannel; // Source channel: 'whatsapp' or 'widget' (NOT NULL)
  guest_message: string;    // The guest message that triggered escalation (NOT NULL)
  agent_response: string | null; // Last agent response before escalation (if any)
  notified_at: string | null;    // When the hotel was notified (NULL until notification sent)
  resolved_at: string | null;    // When the escalation was resolved by staff (NULL until resolved)
  created_at: string;       // ISO 8601 UTC timestamp (timestamptz)
}

// =============================================================================
// HotelWhatsAppNumber — Twilio phone number assignments (added in 0004_guest_facing.sql)
// Corresponds to: public.hotel_whatsapp_numbers table
// Maps inbound Twilio WhatsApp numbers to hotels for routing.
// =============================================================================

export interface HotelWhatsAppNumber {
  id: string;             // UUID primary key
  hotel_id: string;       // UUID — references public.hotels.id (NOT NULL)
  twilio_number: string;  // Twilio phone number e.g. "+14155552671" (NOT NULL, UNIQUE)
  created_at: string;     // ISO 8601 UTC timestamp (timestamptz)
}

// =============================================================================
// Booking — Guest stay records for milestone messaging (added in 0005_guest_experience.sql)
// Corresponds to: public.bookings table
// Used by cron jobs to send pre-arrival, checkout reminder, and review request messages.
// =============================================================================

export type BookingChannel = 'email' | 'whatsapp';

export interface Booking {
  id: string;                        // UUID primary key
  hotel_id: string;                  // UUID — references public.hotels.id (NOT NULL)
  guest_name: string;                // Guest display name (NOT NULL)
  guest_email: string | null;        // Guest email address
  guest_phone: string | null;        // WhatsApp-formatted phone e.g. "+31612345678"
  channel: BookingChannel;           // Delivery channel (NOT NULL, default 'email')
  check_in_date: string;             // ISO 8601 date string (DATE type, NOT NULL)
  check_out_date: string;            // ISO 8601 date string (DATE type, NOT NULL)
  pre_arrival_sent: boolean;         // Whether pre-arrival message was sent (NOT NULL, default false)
  checkout_reminder_sent: boolean;   // Whether checkout reminder was sent (NOT NULL, default false)
  review_request_sent: boolean;      // Whether review request was sent (NOT NULL, default false)
  created_at: string;                // ISO 8601 UTC timestamp (timestamptz)
}

// =============================================================================
// MessageTemplate — Per-hotel per-milestone per-channel message templates
// Corresponds to: public.message_templates table
// Hotel owner configures these; cron uses them to send milestone messages.
// =============================================================================

export type MessageMilestone = 'pre_arrival' | 'checkout_reminder' | 'review_request';

export interface MessageTemplate {
  id: string;           // UUID primary key
  hotel_id: string;     // UUID — references public.hotels.id (NOT NULL)
  milestone: MessageMilestone; // Which milestone this template covers (NOT NULL)
  channel: BookingChannel;     // Delivery channel (NOT NULL)
  subject: string | null;      // Email subject line (NULL for WhatsApp)
  body: string;                // Message body (NOT NULL)
  created_at: string;          // ISO 8601 UTC timestamp (timestamptz)
  updated_at: string;          // ISO 8601 UTC timestamp (timestamptz, auto-updated by trigger)
}

// =============================================================================
// Agent — Per-hotel AI agent configuration (added in 0005_guest_experience.sql)
// Corresponds to: public.agents table
// Controls is_enabled (on/off toggle) and behavior_config per role.
// =============================================================================

export interface Agent {
  id: string;                           // UUID primary key
  hotel_id: string;                     // UUID — references public.hotels.id (NOT NULL)
  role: string;                         // Agent role identifier e.g. 'front_desk', 'guest_experience'
  is_enabled: boolean;                  // Whether this agent is active (NOT NULL, default true)
  behavior_config: Record<string, unknown>; // Role-specific tuning config (JSONB, default '{}')
  created_at: string;                   // ISO 8601 UTC timestamp (timestamptz)
  updated_at: string;                   // ISO 8601 UTC timestamp (timestamptz, auto-updated by trigger)
}

// =============================================================================
// ActionClass — Audit classification for tool calls (used in audit.ts and agent_audit_log)
// OBSERVE: read-only data queries (no side effects)
// INFORM:  notifications and informational writes
// ACT:     writes, modifications, or state changes (require owner confirmation gate in future)
// =============================================================================

export type ActionClass = 'OBSERVE' | 'INFORM' | 'ACT';

// =============================================================================
// AgentAuditLog — Append-only tool call audit trail (added in 0005_guest_experience.sql)
// Corresponds to: public.agent_audit_log table
// Every tool execution by any agent writes one row here (fire-and-forget).
// No UPDATE or DELETE policies — audit log is immutable.
// =============================================================================

export interface AgentAuditLog {
  id: string;               // UUID primary key
  hotel_id: string;         // UUID — references public.hotels.id (NOT NULL)
  agent_role: string;       // Role of the agent that made the tool call (NOT NULL)
  conversation_id: string;  // Conversation identifier (NOT NULL)
  tool_name: string;        // Name of the tool called (NOT NULL)
  action_class: ActionClass; // Classification of the action (NOT NULL, CHECK constraint)
  input_json: Record<string, unknown>;  // Tool input parameters (JSONB, NOT NULL)
  result_json: Record<string, unknown>; // Tool result (JSONB, NOT NULL)
  created_at: string;       // ISO 8601 UTC timestamp (timestamptz)
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
        Insert: Omit<Hotel, 'id' | 'created_at' | 'updated_at' | 'widget_token' | 'widget_config'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          widget_token?: string;
          widget_config?: Record<string, unknown> | null;
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
      escalations: {
        Row: Escalation;
        Insert: Omit<Escalation, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Escalation, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      hotel_whatsapp_numbers: {
        Row: HotelWhatsAppNumber;
        Insert: Omit<HotelWhatsAppNumber, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<HotelWhatsAppNumber, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      bookings: {
        Row: Booking;
        Insert: Omit<Booking, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Booking, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      message_templates: {
        Row: MessageTemplate;
        Insert: Omit<MessageTemplate, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<MessageTemplate, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      agents: {
        Row: Agent;
        Insert: Omit<Agent, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Agent, 'id' | 'created_at'>>;
        Relationships: Relationship[];
      };
      agent_audit_log: {
        Row: AgentAuditLog;
        Insert: Omit<AgentAuditLog, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<AgentAuditLog, 'id' | 'created_at'>>;
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
