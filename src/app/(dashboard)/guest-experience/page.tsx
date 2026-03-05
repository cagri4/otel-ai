/**
 * Guest Experience AI page — /guest-experience
 *
 * Server Component shell that renders the ChatWindow client component
 * configured for the GUEST_EXPERIENCE agent role.
 *
 * Pattern mirrors /desk/page.tsx (Front Desk AI) but with:
 * - Page title: "Guest Experience"
 * - Role parameter: "guest_experience" (maps to AgentRole.GUEST_EXPERIENCE)
 * - Conversation ID suffix: "guest_experience_chat"
 *   (server will form full ID as `${hotelId}_guest_experience_chat`)
 *
 * The Guest Experience AI handles milestone messaging (pre-arrival, checkout,
 * review request), guest communication strategies, and template configuration.
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-04-PLAN.md
 */

import { ChatWindow } from '@/components/chat/ChatWindow';

export default function GuestExperiencePage() {
  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Guest Experience AI</h1>
        <p className="text-muted-foreground text-sm">
          Chat with your Guest Experience AI to configure milestone messages, test templates, or
          discuss guest communication strategies.
        </p>
      </div>
      <div className="h-[calc(100%-4rem)] border rounded-lg overflow-hidden bg-card">
        <ChatWindow
          streamOptions={{
            conversationId: 'guest_experience_chat',
            role: 'guest_experience',
          }}
          emptyStateText="Start a conversation with your Guest Experience AI"
        />
      </div>
    </div>
  );
}
