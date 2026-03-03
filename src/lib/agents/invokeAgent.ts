/**
 * invokeAgent() — Stateless agent orchestrator for the OtelAI system.
 *
 * This is the central entry point for all AI employee interactions.
 * Every guest message flows through this function.
 *
 * What it does on each call:
 * 1. Fetches role config from the Agent Factory
 * 2. Assembles a fresh four-layer system prompt from DB (never cached)
 * 3. Loads the last 20 conversation turns from working memory
 * 4. Persists the new user message
 * 5. Calls Claude API with streaming
 * 6. Handles tool_use stop_reason: executes tools and recurses with results
 * 7. Persists the final assistant response
 * 8. Returns the full response text
 *
 * Tool-first policy enforcement:
 * - If the message contains keywords for availability/pricing/rooms,
 *   tool_choice is set to "any" (forces Claude to call a tool first)
 * - Otherwise tool_choice is "auto" (Claude decides)
 * - This structurally prevents Claude from answering from training data
 *
 * Anti-patterns avoided (per research):
 * - No module-level caching of hotel data
 * - No calling from Server Components or Server Actions (Route Handlers only)
 * - Tool_use content stored as JSON string in conversation_turns
 * - Recursion depth limit of 5 prevents infinite tool loops
 *
 * Source: .planning/phases/02-agent-core/02-02-PLAN.md
 * Research: .planning/phases/02-agent-core/02-RESEARCH.md
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import { agentFactory } from './agentFactory';
import { assembleSystemPrompt } from './assembleContext';
import { loadConversationTurns, persistTurn } from './memory';
import { executeTool } from './tools/executor';
import { getToolsForRole } from './tools/registry';
import type { InvokeAgentParams } from './types';

// =============================================================================
// Anthropic Client
// =============================================================================

/**
 * Module-level Anthropic client — safe to cache (stateless, no hotel data).
 * Uses ANTHROPIC_API_KEY env var automatically.
 */
const client = new Anthropic();

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Invokes an AI agent with a user message and returns the assistant's response.
 *
 * @param params - Role, message, conversation ID, hotel ID, and optional onToken callback
 * @returns The full assistant response text
 * @throws Error if Claude API call fails or context assembly fails
 */
export async function invokeAgent(params: InvokeAgentParams): Promise<string> {
  return invokeAgentInternal(params, 0);
}

// =============================================================================
// Internal Recursive Orchestrator
// =============================================================================

/**
 * Internal implementation with depth tracking for tool recursion limit.
 *
 * @param params - Agent invocation parameters
 * @param depth - Current recursion depth (0 = initial call)
 * @returns The full assistant response text
 */
async function invokeAgentInternal(
  params: InvokeAgentParams,
  depth: number,
): Promise<string> {
  if (depth > 5) {
    throw new Error(
      'Agent tool recursion limit exceeded (max 5 rounds). ' +
        'This indicates an infinite tool loop in the agent response.',
    );
  }

  // -------------------------------------------------------------------------
  // Step 1: Get role configuration
  // -------------------------------------------------------------------------
  const config = agentFactory.getConfig(params.role);

  // -------------------------------------------------------------------------
  // Step 2: Assemble fresh system prompt from DB (never cached)
  // -------------------------------------------------------------------------
  const systemPrompt = await assembleSystemPrompt({
    role: params.role,
    hotelId: params.hotelId,
    conversationId: params.conversationId,
    config,
  });

  // -------------------------------------------------------------------------
  // Step 3: Load working memory (last 20 turns)
  // -------------------------------------------------------------------------
  const messages = await loadConversationTurns(params.conversationId);

  // -------------------------------------------------------------------------
  // Step 4 & 5: Persist user turn and add to messages array
  // Only persist on the initial call (depth 0) to avoid duplicate turns
  // -------------------------------------------------------------------------
  if (depth === 0) {
    await persistTurn(params.conversationId, params.hotelId, 'user', params.userMessage);
    messages.push({ role: 'user', content: params.userMessage });
  }

  // -------------------------------------------------------------------------
  // Step 6: Determine tool_choice based on message content
  // Tool-first policy: force tool calls for availability/pricing queries
  // -------------------------------------------------------------------------
  const hasTools = config.tools.length > 0;
  const toolChoice: Anthropic.Messages.ToolChoiceAuto | Anthropic.Messages.ToolChoiceAny =
    hasTools && isToolRequired(params.userMessage)
      ? { type: 'any' as const }
      : { type: 'auto' as const };

  // -------------------------------------------------------------------------
  // Step 7 & 8: Call Claude with streaming and forward tokens via callback
  // -------------------------------------------------------------------------
  let stream: MessageStream;

  try {
    stream = client.messages.stream({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: getToolsForRole(params.role),
      tool_choice: toolChoice,
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Anthropic API call failed: ${message}`);
  }

  // Forward streaming tokens via callback
  stream.on('text', (text: string) => {
    params.onToken?.(text);
  });

  // -------------------------------------------------------------------------
  // Step 9: Get final message
  // -------------------------------------------------------------------------
  let finalMessage: Anthropic.Messages.Message;

  try {
    finalMessage = await stream.finalMessage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Anthropic API streaming failed: ${message}`);
  }

  // -------------------------------------------------------------------------
  // Step 10: Handle stop_reason
  // -------------------------------------------------------------------------

  if (finalMessage.stop_reason === 'tool_use') {
    return handleToolUse(params, finalMessage, messages, depth);
  }

  // stop_reason === 'end_turn' (or any other terminal reason)
  return handleEndTurn(params, finalMessage);
}

// =============================================================================
// Tool Use Handler
// =============================================================================

/**
 * Handles the tool_use stop reason:
 * 1. Extracts tool_use blocks from the assistant message
 * 2. Executes each tool via the executor
 * 3. Persists the assistant turn and tool results
 * 4. Recurses with updated messages (original + assistant + tool results)
 *
 * @param params - Original invocation params
 * @param assistantMessage - The Claude message that stopped with tool_use
 * @param previousMessages - Messages array before the assistant response
 * @param depth - Current recursion depth
 * @returns Final text response after tool results are processed
 */
async function handleToolUse(
  params: InvokeAgentParams,
  assistantMessage: Anthropic.Messages.Message,
  previousMessages: Anthropic.Messages.MessageParam[],
  depth: number,
): Promise<string> {
  // Extract tool_use blocks from the assistant message content
  const toolUseBlocks = assistantMessage.content.filter(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  );

  // Persist assistant turn with JSON-serialized content blocks
  // (must be stored as JSON string, not plain text, to preserve tool_use metadata)
  await persistTurn(
    params.conversationId,
    params.hotelId,
    'assistant',
    JSON.stringify(assistantMessage.content),
  );

  // Execute all tools in parallel
  const toolResults = await Promise.all(
    toolUseBlocks.map(async (toolUseBlock) => {
      const resultContent = await executeTool(
        toolUseBlock.name,
        toolUseBlock.input as Record<string, unknown>,
        { hotelId: params.hotelId, fromRole: params.role },
      );

      // Persist each tool result with its correlation ID
      await persistTurn(
        params.conversationId,
        params.hotelId,
        'tool',
        resultContent,
        toolUseBlock.id,
      );

      return resultContent;
    }),
  );

  // Build tool_result content blocks for the recursive call
  const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = toolUseBlocks.map(
    (toolUseBlock, index) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUseBlock.id,
      content: toolResults[index],
    }),
  );

  // Build updated messages array for the recursive Claude call
  // Append assistant response + tool results as the next user turn
  const updatedMessages: Anthropic.Messages.MessageParam[] = [
    ...previousMessages,
    {
      role: 'assistant' as const,
      content: assistantMessage.content,
    },
    {
      role: 'user' as const,
      content: toolResultBlocks,
    },
  ];

  // Recurse with updated messages (depth + 1)
  // Re-use all params but skip user turn persistence (depth > 0)
  return invokeAgentRecursive(params, updatedMessages, depth + 1);
}

// =============================================================================
// End Turn Handler
// =============================================================================

/**
 * Handles the end_turn stop reason:
 * 1. Extracts all text blocks from the assistant message
 * 2. Persists the assistant turn as plain text
 * 3. Returns the full response text
 *
 * @param params - Original invocation params
 * @param finalMessage - The Claude message that stopped with end_turn
 * @returns Full assistant response text
 */
async function handleEndTurn(
  params: InvokeAgentParams,
  finalMessage: Anthropic.Messages.Message,
): Promise<string> {
  // Collect all text blocks from the final message content
  const textBlocks = finalMessage.content.filter(
    (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
  );
  const fullText = textBlocks.map((block) => block.text).join('');

  // Persist the final assistant response
  await persistTurn(params.conversationId, params.hotelId, 'assistant', fullText);

  return fullText;
}

// =============================================================================
// Recursive Continuation (tool loop)
// =============================================================================

/**
 * Recursive continuation after tool execution.
 * Takes pre-assembled messages instead of loading from DB to avoid
 * race conditions with in-progress persistence.
 *
 * @param params - Original invocation params
 * @param messages - Updated messages array including tool results
 * @param depth - Current recursion depth
 * @returns Final text response
 */
async function invokeAgentRecursive(
  params: InvokeAgentParams,
  messages: Anthropic.Messages.MessageParam[],
  depth: number,
): Promise<string> {
  if (depth > 5) {
    throw new Error(
      'Agent tool recursion limit exceeded (max 5 rounds). ' +
        'This indicates an infinite tool loop in the agent response.',
    );
  }

  const config = agentFactory.getConfig(params.role);

  const systemPrompt = await assembleSystemPrompt({
    role: params.role,
    hotelId: params.hotelId,
    conversationId: params.conversationId,
    config,
  });

  // On recursive calls, use auto tool_choice — tools have already been called
  let stream: MessageStream;

  try {
    stream = client.messages.stream({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: getToolsForRole(params.role),
      tool_choice: { type: 'auto' as const },
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Anthropic API call failed during tool continuation: ${message}`);
  }

  // Forward streaming tokens via callback
  stream.on('text', (text: string) => {
    params.onToken?.(text);
  });

  let finalMessage: Anthropic.Messages.Message;

  try {
    finalMessage = await stream.finalMessage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Anthropic API streaming failed during tool continuation: ${message}`);
  }

  if (finalMessage.stop_reason === 'tool_use') {
    return handleToolUse(params, finalMessage, messages, depth);
  }

  return handleEndTurn(params, finalMessage);
}

// =============================================================================
// Tool-First Policy Helper
// =============================================================================

/**
 * Determines if a tool call should be forced for the given message.
 *
 * Checks for keywords related to availability, pricing, rooms, bookings, and
 * reservations. Errs on the side of requiring tools (false positives are
 * acceptable — false negatives would allow Claude to answer from training data).
 *
 * @param message - The user message to analyze
 * @returns true if tool_choice should be forced to "any"
 */
export function isToolRequired(message: string): boolean {
  const lower = message.toLowerCase();
  const keywords = [
    'available',
    'availability',
    'price',
    'pricing',
    'cost',
    'rate',
    'room',
    'book',
    'booking',
    'reservation',
    'how much',
    'per night',
    'vacant',
    'free room',
  ];
  return keywords.some((keyword) => lower.includes(keyword));
}
