/**
 * Front Desk AI page — /desk
 *
 * Server Component shell that renders the ChatWindow client component.
 * The ChatWindow handles all state and SSE streaming internally.
 *
 * Layout: full viewport height minus header (8rem) to fill the screen,
 * with the chat interface contained in a rounded card.
 *
 * Source: .planning/phases/02-agent-core/02-04-PLAN.md
 */

import { ChatWindow } from '@/components/chat/ChatWindow';

export default function DeskPage() {
  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Front Desk AI</h1>
        <p className="text-muted-foreground text-sm">
          Chat with your virtual receptionist
        </p>
      </div>
      <div className="h-[calc(100%-4rem)] border rounded-lg overflow-hidden bg-card">
        <ChatWindow />
      </div>
    </div>
  );
}
