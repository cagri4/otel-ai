'use client';

/**
 * useChatStream — React hook for SSE-based chat streaming.
 *
 * Manages chat state and consumes the /api/agent/stream SSE endpoint.
 *
 * State:
 *   messages: ChatMessage[]  — ordered list of user/assistant messages
 *   isStreaming: boolean     — true while Claude is generating a response
 *   error: string | null     — last error message, if any
 *
 * SSE parsing strategy:
 *   The Fetch response body is read as a ReadableStream byte by byte.
 *   Chunks may not align with SSE message boundaries, so partial lines are
 *   buffered until a double-newline delimiter (\n\n) is received.
 *   This avoids JSON.parse errors on incomplete SSE frames.
 *
 * Conversation ID:
 *   Uses a fixed suffix "owner_chat". The server prepends hotel_id to form
 *   the full ID: `${hotelId}_owner_chat`. This gives each hotel owner one
 *   persistent conversation without requiring the frontend to know hotel_id.
 *
 * Source: .planning/phases/02-agent-core/02-04-PLAN.md
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/agents/types';

// =============================================================================
// Types
// =============================================================================

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string) => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useChatStream(): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref — cancel in-flight SSE request on new send
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stable conversation ID — server constructs full ID as `${hotelId}_owner_chat`
  const conversationId = 'owner_chat';

  // ---------------------------------------------------------------------------
  // loadHistory — fetches conversation turns from GET /api/agent/stream
  // Called once on mount to hydrate messages from persisted turns.
  // ---------------------------------------------------------------------------
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/agent/stream?conversationId=${conversationId}`,
        { cache: 'no-store' },
      );

      if (!res.ok) return;

      const data = await res.json();

      if (!Array.isArray(data)) return;

      const history: ChatMessage[] = data.map(
        (row: { id: string; role: string; content: string; created_at: string }) => ({
          id: row.id,
          role: row.role as 'user' | 'assistant',
          content: row.content,
          created_at: row.created_at,
        }),
      );

      setMessages(history);
    } catch {
      // History load failure is non-fatal — start with empty messages
    }
  }, [conversationId]);

  // Load history on mount
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // ---------------------------------------------------------------------------
  // sendMessage — optimistic update + SSE stream consumption
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;

      // Abort any in-flight request from a previous send
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Optimistic: add user message immediately
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
        created_at: new Date().toISOString(),
      };

      // Placeholder assistant message (content fills as tokens arrive)
      const assistantMessageId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      setError(null);

      // -----------------------------------------------------------------------
      // SSE consumption via fetch + ReadableStream reader
      // -----------------------------------------------------------------------
      void (async () => {
        try {
          const res = await fetch('/api/agent/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text.trim(), conversationId }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorBody}`);
          }

          if (!res.body) {
            throw new Error('Response body is null');
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode the chunk and append to buffer
            buffer += decoder.decode(value, { stream: true });

            // Split on double-newline (SSE message delimiter)
            const parts = buffer.split('\n\n');

            // The last part may be incomplete — keep it in buffer
            buffer = parts.pop() ?? '';

            for (const part of parts) {
              const trimmed = part.trim();
              if (!trimmed) continue;

              // Skip heartbeat ping events: "event: ping\ndata: keep-alive"
              if (trimmed.startsWith('event: ping')) continue;

              // Extract data line — SSE format: "data: {...}"
              const dataLine = trimmed
                .split('\n')
                .find((line) => line.startsWith('data: '));

              if (!dataLine) continue;

              const jsonStr = dataLine.slice('data: '.length);

              let parsed: { type: string; token?: string; message?: string };
              try {
                parsed = JSON.parse(jsonStr);
              } catch {
                // Malformed SSE frame — skip
                continue;
              }

              if (parsed.type === 'token' && typeof parsed.token === 'string') {
                // Append token to the assistant message in progress
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: msg.content + parsed.token }
                      : msg,
                  ),
                );
              } else if (parsed.type === 'done') {
                setIsStreaming(false);
              } else if (parsed.type === 'error') {
                setError(parsed.message ?? 'Unknown error from agent');
                setIsStreaming(false);
              }
            }
          }
        } catch (err) {
          // Ignore AbortError (user cancelled / new message sent)
          if (err instanceof Error && err.name === 'AbortError') return;

          const msg = err instanceof Error ? err.message : 'Streaming failed';
          setError(msg);
          setIsStreaming(false);
        }
      })();
    },
    [isStreaming, conversationId],
  );

  return { messages, isStreaming, error, sendMessage };
}
