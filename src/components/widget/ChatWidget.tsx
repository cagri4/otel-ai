'use client';

/**
 * ChatWidget — Client component for the embeddable hotel chat widget.
 *
 * This component:
 * 1. On mount, calls /api/widget/session to resolve hotel from widget_token
 *    and obtain a conversationId + Supabase Realtime channel name
 * 2. Subscribes to the Supabase Realtime Broadcast channel to receive AI responses
 * 3. Sends guest messages to /api/widget/message (hotelId NOT sent — server parses from conversationId)
 * 4. Displays hotel branding (name, primary color, welcome message) from widgetConfig
 *
 * Security:
 * - hotelId is NEVER sent from this component (server parses from conversationId)
 * - No authentication required — this is a public guest-facing component
 *
 * Real-time pattern:
 * - Guest sends message → /api/widget/message invokes agent → response broadcast to channel
 * - This component listens for broadcast events and appends them to the message list
 *
 * Source: .planning/phases/04-guest-facing-layer/04-03-PLAN.md
 */

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { WidgetConfig } from '@/types/database';

// =============================================================================
// Types
// =============================================================================

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
};

type SessionData = {
  conversationId: string;
  hotelId: string;
  hotelName: string;
  widgetConfig: WidgetConfig;
  channel: string;
};

// =============================================================================
// Props
// =============================================================================

interface ChatWidgetProps {
  token: string;
}

// =============================================================================
// Component
// =============================================================================

export function ChatWidget({ token }: ChatWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Auto-scroll to latest message
  // ---------------------------------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ---------------------------------------------------------------------------
  // Init: resolve hotel session + subscribe to Realtime
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    async function init() {
      // Step 1: Resolve hotel session from widget token
      let sessionData: SessionData;
      try {
        const res = await fetch('/api/widget/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setInitError(data.error ?? 'Invalid widget token. Please contact the hotel.');
          return;
        }

        sessionData = await res.json();
        setSession(sessionData);
      } catch {
        setInitError('Could not connect to the chat service. Please try again later.');
        return;
      }

      // Step 2: Subscribe to Supabase Realtime Broadcast channel for AI responses
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );

      const channel = supabase
        .channel(sessionData.channel)
        .on('broadcast', { event: 'message' }, ({ payload }) => {
          setMessages((prev) => [
            ...prev,
            {
              role: payload.role as 'user' | 'assistant',
              content: payload.content as string,
              created_at: payload.created_at as string | undefined,
              id: crypto.randomUUID(),
            },
          ]);
          setIsLoading(false);
        })
        .subscribe();

      cleanup = () => {
        supabase.removeChannel(channel);
      };
    }

    init();

    return () => {
      cleanup?.();
    };
  }, [token]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  async function handleSend() {
    if (!input.trim() || !session || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: userMessage,
        created_at: new Date().toISOString(),
      },
    ]);
    setIsLoading(true);
    setError(null);

    try {
      // NOTE: hotelId is NOT sent — the server parses it from conversationId
      const res = await fetch('/api/widget/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationId: session.conversationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to send message. Please try again.');
        setIsLoading(false);
      }
      // On success, the AI response will arrive via Realtime broadcast
    } catch {
      setError('Connection error. Please check your connection and try again.');
      setIsLoading(false);
    }
  }

  // Handle Enter key
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ---------------------------------------------------------------------------
  // Branding helpers
  // ---------------------------------------------------------------------------
  const primaryColor = session?.widgetConfig?.primary_color ?? '#1a73e8';
  const welcomeMessage =
    session?.widgetConfig?.welcome_message ??
    'Hello! How can I help you today?';

  // ---------------------------------------------------------------------------
  // Init error state
  // ---------------------------------------------------------------------------
  if (initError) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-6">
        <div className="text-center">
          <p className="text-red-600 text-sm">{initError}</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading state (session not yet resolved)
  // ---------------------------------------------------------------------------
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main chat UI
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 shadow-sm flex-shrink-0"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{session.hotelName}</p>
          <p className="text-white/80 text-xs">Virtual Assistant</p>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Welcome message shown when no messages yet */}
        {messages.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-gray-100 px-4 py-2.5">
              <p className="text-sm text-gray-800">{welcomeMessage}</p>
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'rounded-tr-none text-white'
                  : 'rounded-tl-none bg-gray-100 text-gray-800'
              }`}
              style={
                msg.role === 'user' ? { backgroundColor: primaryColor } : undefined
              }
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* Loading indicator — pulsing dots in assistant bubble */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-none bg-gray-100 px-4 py-3">
              <div className="flex gap-1 items-center">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" />
              </div>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 pb-1">
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 flex-shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isLoading}
          className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-300 focus:bg-white disabled:opacity-50 transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="flex-shrink-0 rounded-full p-2 text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: primaryColor }}
          aria-label="Send message"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
