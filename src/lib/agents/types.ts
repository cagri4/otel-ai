/**
 * Agent domain types for OtelAI multi-agent system.
 *
 * Phase 2 implements a single agent role (FRONT_DESK).
 * Future phases will add specialized roles (RESERVATION, COMPLAINT, etc.).
 *
 * Design principles:
 * - Stateless invocation: no persistent agent processes
 * - Context assembled from DB on every call (Vercel serverless constraint)
 * - Tool-first policy: agents cannot state availability/prices without tool calls
 * - claude-opus-4-6 for guest-facing, claude-sonnet-4-6 for internal tasks
 *
 * Source: .planning/phases/02-agent-core/02-RESEARCH.md
 */

// =============================================================================
// Agent Roles
// =============================================================================

/**
 * Defines the specialized roles available in the multi-agent system.
 * Each role maps to a distinct Claude model configuration and prompt template.
 *
 * Phase 2 implements FRONT_DESK only.
 * Future roles (commented as placeholders):
 *   - RESERVATION: Handles booking lookups and modifications
 *   - COMPLAINT: Handles guest complaints and escalations
 *   - CONCIERGE: Handles local recommendations and activities
 *   - HOUSEKEEPER: Handles room status and maintenance requests
 */
export enum AgentRole {
  FRONT_DESK = "front_desk",
  // RESERVATION = "reservation",   // Phase 5
  // COMPLAINT = "complaint",        // Phase 6
  // CONCIERGE = "concierge",        // Phase 7
  // HOUSEKEEPER = "housekeeper",    // Phase 7
}

// =============================================================================
// Inline content block types
// TODO: Replace with Anthropic.Messages.* types after @anthropic-ai/sdk install (Plan 02-02)
// =============================================================================

/**
 * Text content block matching Anthropic MessageParam content structure.
 * Used in loadConversationTurns() return type.
 */
export type TextBlock = {
  type: "text";
  text: string;
};

/**
 * Tool use content block matching Anthropic tool_use structure.
 */
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/**
 * Tool result content block matching Anthropic tool_result structure.
 */
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | TextBlock[];
};

/**
 * Content block union type for message content arrays.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/**
 * Message parameter matching Anthropic MessageParam shape.
 * TODO: Replace with import type { MessageParam } from '@anthropic-ai/sdk'
 */
export type MessageParam = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

// =============================================================================
// Tool type placeholder
// TODO: Replace with Anthropic.Tool after SDK install
// =============================================================================

/**
 * Minimal tool descriptor matching Anthropic's tool definition schema.
 * TODO: Replace with import type { Tool } from '@anthropic-ai/sdk'
 */
export type Tool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

// =============================================================================
// Agent Configuration
// =============================================================================

/**
 * Configuration for a specific agent role.
 * Defines the model, tools, memory scope, and prompt templates.
 *
 * memoryScope controls how much episodic history is loaded:
 *   - "full": all guest interactions (up to 100 safety cap)
 *   - "recent_30": last 30 interactions
 *   - "none": no episodic history (stateless mode)
 */
export interface AgentConfig {
  model: string;              // Anthropic model ID (e.g. "claude-opus-4-6")
  tools: Tool[];              // Available tools for this agent role
  memoryScope: "full" | "recent_30" | "none"; // Episodic history loading scope
  promptTemplate: {
    identity: string;         // Who the agent is (role, hotel name injection point)
    behavioral: string;       // How the agent should behave (rules, tone, constraints)
  };
}

// =============================================================================
// Agent Invocation
// =============================================================================

/**
 * Parameters for invoking an agent.
 * All context needed to assemble the full system prompt and message history.
 *
 * Note: hotelId and conversationId are required because agents are stateless —
 * all context must be looked up from the database on every invocation.
 */
export interface InvokeAgentParams {
  role: AgentRole;                    // Which agent role to invoke
  userMessage: string;                // The new user message to process
  conversationId: string;             // UUID grouping this conversation's turns
  hotelId: string;                    // UUID for DB queries and RLS enforcement
  guestIdentifier?: string;           // email, phone, or session token (for episodic memory lookup)
  onToken?: (token: string) => void;  // Streaming callback for SSE (called with each delta)
}

// =============================================================================
// Chat Message (UI layer type)
// =============================================================================

/**
 * Chat message type for frontend display.
 * Simpler than MessageParam — no tool blocks, only user/assistant turns.
 * Used in the chat UI components and API response shapes.
 */
export type ChatMessage = {
  id: string;           // UUID for React key and optimistic update tracking
  role: "user" | "assistant";
  content: string;      // Plain text content for display
  created_at: string;   // ISO 8601 UTC timestamp for ordering and display
};
