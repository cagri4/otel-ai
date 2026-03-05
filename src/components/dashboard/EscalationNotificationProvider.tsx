'use client';

/**
 * EscalationNotificationProvider — Real-time escalation toast notifications.
 *
 * Subscribes to Supabase Realtime postgres_changes INSERT events on the
 * escalations table, filtered by hotel_id. When a new escalation is inserted
 * (triggered by detectAndInsertEscalation() in the agent), a sonner toast
 * appears with:
 *   - The guest's message preview (first 120 chars)
 *   - A "View" action linking to the conversation detail page
 *   - 15-second duration (important notifications linger)
 *
 * Usage:
 *   Wrap dashboard children with this provider and pass the hotel's ID.
 *   The provider renders its children unchanged — it only adds side effects.
 *
 * Important: The escalations table must be in the Supabase Realtime publication.
 * This is ensured by the Phase 5 Plan 1 migration:
 *   ALTER PUBLICATION supabase_realtime ADD TABLE public.escalations;
 *
 * Source: .planning/phases/05-guest-experience-ai-and-owner-dashboard/05-04-PLAN.md
 */

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface EscalationNotificationProviderProps {
  hotelId: string;
  children: React.ReactNode;
}

export function EscalationNotificationProvider({
  hotelId,
  children,
}: EscalationNotificationProviderProps) {
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`escalations-${hotelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'escalations',
          filter: `hotel_id=eq.${hotelId}`,
        },
        (payload) => {
          const escalation = payload.new as {
            guest_message?: string;
            channel?: string;
            conversation_id?: string;
          };

          toast.error('Guest needs assistance', {
            description:
              escalation.guest_message?.slice(0, 120) ||
              'A guest request requires your attention.',
            duration: 15000, // 15 seconds — important notifications should linger
            action: {
              label: 'View',
              onClick: () => {
                window.location.href = `/conversations/${escalation.conversation_id}`;
              },
            },
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hotelId]);

  return <>{children}</>;
}
