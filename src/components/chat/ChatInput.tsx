'use client';

/**
 * ChatInput — Message input form for the Front Desk AI chat.
 *
 * Features:
 *   - Text input (shadcn Input) with auto-focus on mount and after send
 *   - Send button (shadcn Button) disabled when streaming or input is empty
 *   - Submit on Enter key (Shift+Enter not supported — simple input, not textarea)
 *   - Input cleared after submit
 *   - Full width flex row layout
 *
 * Source: .planning/phases/02-agent-core/02-04-PLAN.md
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus after streaming completes (disabled transitions to false)
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'AI is responding...' : 'Type a message...'}
        disabled={disabled}
        className="flex-1"
      />
      <Button
        onClick={handleSubmit}
        disabled={disabled || value.trim() === ''}
        size="default"
      >
        Send
      </Button>
    </div>
  );
}
