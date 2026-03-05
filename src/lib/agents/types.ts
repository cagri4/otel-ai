/**
 * Agent domain types for OtelAI multi-agent system.
 *
 * Phase 2 implements FRONT_DESK. Phase 5 adds GUEST_EXPERIENCE. Phase 7 adds BOOKING_AI.
 * Future phases will add specialized roles (COMPLAINT, CONCIERGE, etc.).
 *
 * Design principles:
 * - Stateless invocation: no persistent agent processes
 * - Context assembled from DB on every call (Vercel serverless constraint)
 * - Tool-first policy: agents cannot state availability/prices without tool calls
 * - claude-opus-4-6 for guest-facing, claude-sonnet-4-6 for internal tasks
 *
 * Source: .planning/phases/02-agent-core/02-RESEARCH.md
 */

import type Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// Agent Roles
// =============================================================================

/**
 * Defines the specialized roles available in the multi-agent system.
 * Each role maps to a distinct Claude model configuration and prompt template.
 *
 * Phase 2 implements FRONT_DESK only.
 * Phase 5 adds GUEST_EXPERIENCE (milestone messaging: pre-arrival, checkout, review request).
 * Phase 7 adds BOOKING_AI (dedicated booking agent with upsell behavior and availability tools).
 * Future roles (commented as placeholders):
 *   - COMPLAINT: Handles guest complaints and escalations
 *   - CONCIERGE: Handles local recommendations and activities
 *   - HOUSEKEEPER: Handles room status and maintenance requests
 */
export enum AgentRole {
  FRONT_DESK = "front_desk",
  GUEST_EXPERIENCE = "guest_experience",
  BOOKING_AI = "booking_ai",
  // COMPLAINT = "complaint",        // Future
  // CONCIERGE = "concierge",        // Future
  // HOUSEKEEPER = "housekeeper",    // Future
}

// =============================================================================
// Anthropic SDK type re-exports
// Using SDK types directly now that @anthropic-ai/sdk is installed.
// =============================================================================

/**
 * Text content block — re-exported from Anthropic SDK.
 */
export type TextBlock = Anthropic.Messages.TextBlock;

/**
 * Tool use content block — re-exported from Anthropic SDK.
 */
export type ToolUseBlock = Anthropic.Messages.ToolUseBlock;

/**
 * Tool result content block — re-exported from Anthropic SDK.
 */
export type ToolResultBlock = Anthropic.Messages.ToolResultBlockParam;

/**
 * Content block union type for message content arrays.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/**
 * Message parameter matching Anthropic MessageParam shape.
 * Uses SDK type directly for full compatibility.
 */
export type MessageParam = Anthropic.Messages.MessageParam;

// =============================================================================
// Tool type
// =============================================================================

/**
 * Tool descriptor using Anthropic SDK type for full compatibility.
 */
export type Tool = Anthropic.Messages.Tool;

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
