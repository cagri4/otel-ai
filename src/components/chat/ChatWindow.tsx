'use client';

/**
 * ChatWindow — Main chat container for the Front Desk AI.
 *
 * This is the root client component for the /desk page.
 *
 * Layout:
 *   - Flex column, full height
 *   - Scrollable message list (flex-1, overflow-y-auto)
 *   - Input bar pinned at bottom
 *
 * Features:
 *   - Renders MessageBubble for each message in history
 *   - Auto-scrolls to bottom when new messages or tokens arrive
 *   - Shows streaming indicator on the last assistant message while isStreaming
 *   - Displays error banner if error is set
 *   - Passes disabled={isStreaming} to ChatInput to prevent double-sends
 *
 * Source: .planning/phases/02-agent-core/02-04-PLAN.md
 */

import { useEffect, useRef } from 'react';
import { useChatStream } from '@/hooks/useChatStream';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

export function ChatWindow() {
  const { messages, isStreaming, error, sendMessage } = useChatStream();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever messages change or tokens arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          Error: {error}
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Start a conversation with your Front Desk AI
          </div>
        )}

        {messages.map((msg, index) => {
          // Show streaming indicator only on the last assistant message
          const isLastAssistant =
            msg.role === 'assistant' && index === messages.length - 1 && isStreaming;

          return (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              isStreaming={isLastAssistant}
            />
          );
        })}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t p-4">
        <ChatInput onSend={sendMessage} disabled={isStreaming} />
      </div>
    </div>
  );
}
