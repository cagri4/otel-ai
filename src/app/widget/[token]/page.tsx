/**
 * /widget/[token] — Embeddable chat widget page.
 *
 * This is the iframe target that hotels embed on their websites:
 *   <iframe src="https://app.otelai.com/widget/YOUR_TOKEN" />
 *
 * Design:
 * - Public, unauthenticated page (no auth check, no login redirect)
 * - NOT inside (dashboard) route group — no dashboard nav/layout
 * - Inherits only the root layout (src/app/layout.tsx) which is minimal
 * - Full-height, full-width to fill the iframe
 *
 * The [token] param is the hotel's widget_token (UUID) stored in the hotels table.
 * The ChatWidget component resolves the hotel on mount via /api/widget/session.
 *
 * Source: .planning/phases/04-guest-facing-layer/04-03-PLAN.md
 */

import type { Metadata } from 'next';
import { ChatWidget } from '@/components/widget/ChatWidget';

// =============================================================================
// Metadata
// =============================================================================

export const metadata: Metadata = {
  title: 'Chat with us',
  description: 'Chat with our virtual assistant',
};

// =============================================================================
// Page
// =============================================================================

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function WidgetPage({ params }: PageProps) {
  const { token } = await params;

  return (
    <div className="h-screen w-full">
      <ChatWidget token={token} />
    </div>
  );
}
