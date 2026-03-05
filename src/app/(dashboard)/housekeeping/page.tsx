/**
 * Housekeeping Coordinator page — /housekeeping
 *
 * Server Component shell that renders the ChatWindow and StatusBoard
 * side-by-side. The left panel provides the chat interface with the
 * HOUSEKEEPING_COORDINATOR agent. The right panel shows a live-updating
 * status board of all room cleaning statuses.
 *
 * Pattern mirrors /guest-experience/page.tsx but with an additional
 * StatusBoard component in a split layout.
 *
 * Source: .planning/phases/08-housekeeping-coordinator/08-01-PLAN.md
 */

import { ChatWindow } from '@/components/chat/ChatWindow';
import { StatusBoard } from '@/components/housekeeping/StatusBoard';

export default function HousekeepingPage() {
  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-bold">Housekeeping Coordinator</h1>
        <p className="text-muted-foreground text-sm">
          Manage room cleaning statuses and coordinate housekeeping tasks through conversation
        </p>
      </div>
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Chat panel — left side */}
        <div className="flex-1 border rounded-lg overflow-hidden bg-card">
          <ChatWindow
            streamOptions={{ conversationId: 'housekeeping_chat', role: 'housekeeping_coordinator' }}
            emptyStateText="Tell the Housekeeping Coordinator about a room status change, e.g. 'Room 12 is clean'"
          />
        </div>
        {/* Status board — right side */}
        <div className="w-80 border rounded-lg overflow-auto bg-card p-4">
          <StatusBoard />
        </div>
      </div>
    </div>
  );
}
