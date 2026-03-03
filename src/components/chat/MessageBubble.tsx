'use client';

/**
 * MessageBubble — Individual message display in the chat UI.
 *
 * Renders user messages (right-aligned, primary bg) and assistant messages
 * (left-aligned, muted bg) with distinct visual styling.
 *
 * Streaming indicators:
 *   - Empty content + isStreaming: pulsing dots (AI is thinking/tool calling)
 *   - Non-empty content + isStreaming: blinking cursor at end (tokens arriving)
 *
 * No markdown rendering in Phase 2 — plain text only.
 * Markdown + code highlighting planned for a later phase.
 *
 * Source: .planning/phases/02-agent-core/02-04-PLAN.md
 */

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function MessageBubble({ role, content, isStreaming = false }: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        }`}
      >
        {/* Streaming: empty content = pulsing dots (thinking / tool calling) */}
        {isStreaming && content === '' ? (
          <div className="flex items-center gap-1 py-0.5">
            <span
              className="w-2 h-2 rounded-full bg-current animate-pulse"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-current animate-pulse"
              style={{ animationDelay: '200ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-current animate-pulse"
              style={{ animationDelay: '400ms' }}
            />
          </div>
        ) : (
          /* Content with optional blinking cursor while streaming */
          <span>
            {content}
            {isStreaming && content !== '' && (
              <span className="inline-block w-0.5 h-4 bg-current ml-0.5 align-text-bottom animate-pulse" />
            )}
          </span>
        )}
      </div>
    </div>
  );
}
