---
phase: 02-agent-core
plan: 04
subsystem: ui
tags: [sse, streaming, react, tailwind, next.js, supabase, claude]

# Dependency graph
requires:
  - phase: 02-agent-core/02-02
    provides: invokeAgent() orchestrator with tool execution loop
  - phase: 02-agent-core/02-01
    provides: loadConversationTurns() memory helper for message persistence
  - phase: 01-foundation/01-02
    provides: Supabase server client with cookie auth and dashboard layout
provides:
  - SSE streaming endpoint at /api/agent/stream (POST + GET)
  - React hook useChatStream for SSE consumption with optimistic updates
  - ChatWindow, MessageBubble, ChatInput components
  - Front Desk AI chat page at /desk in dashboard
  - Dashboard nav link to Front Desk
affects: [03-guest-comms, 04-whatsapp, 06-booking-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ReadableStream with TextEncoder for SSE in Next.js Route Handler
    - Fire-and-forget invokeAgent() call to prevent SSE buffering
    - 15s heartbeat interval to prevent proxy timeout
    - Chunked SSE buffer in client hook to handle partial ReadableStream chunks
    - Optimistic UI update (user message added before server response)
    - AbortController ref pattern for cancelling in-flight SSE requests
    - Node.js runtime (not Edge) for supabase/ssr cookie compatibility

key-files:
  created:
    - src/app/api/agent/stream/route.ts
    - src/hooks/useChatStream.ts
    - src/components/chat/ChatWindow.tsx
    - src/components/chat/MessageBubble.tsx
    - src/components/chat/ChatInput.tsx
    - src/app/(dashboard)/desk/page.tsx
  modified:
    - src/app/(dashboard)/layout.tsx

key-decisions:
  - "Node.js runtime (not Edge) on /api/agent/stream — supabase/ssr cookie auth breaks in Edge runtime"
  - "Fire-and-forget invokeAgent() inside ReadableStream start() — awaiting would buffer entire response before sending first byte"
  - "Default conversationId is hotelId_owner_chat — one persistent conversation per hotel owner per research recommendation"
  - "select('*') pattern on hotels query — avoids postgrest-js v12 partial-select type narrowing issue"
  - "Client-side chunked SSE buffer — ReadableStream reader may return partial lines; buffer ensures complete data: ... messages"

patterns-established:
  - "SSE Pattern: ReadableStream + TextEncoder in Route Handler with fire-and-forget async callback"
  - "Streaming UI Pattern: empty assistant message added optimistically, tokens appended via state update"
  - "Heartbeat Pattern: 15s ping events sent to prevent nginx/proxy buffering timeout"

requirements-completed: [AGENT-06, DESK-01]

# Metrics
duration: ~15min
completed: 2026-03-03
---

# Phase 2 Plan 04: Front Desk AI Chat UI Summary

**SSE streaming endpoint + React chat UI delivering token-by-token Claude responses at /desk with message persistence via conversation_turns**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-03T14:33:56Z
- **Completed:** 2026-03-03T14:37:24Z (implementation) + human-verify approved
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 7

## Accomplishments
- SSE streaming Route Handler at /api/agent/stream handles POST (streaming chat) and GET (conversation history hydration) using Node.js runtime to preserve supabase/ssr cookie auth
- Six React components/hooks built from scratch: useChatStream, ChatWindow, MessageBubble, ChatInput, DeskPage, and dashboard nav link — all compiling with zero errors
- Human verification passed: token-by-token streaming visible in UI, tool-first policy enforced (AI calls get_room_availability/get_room_pricing tools), messages persist across page refresh

## Task Commits

Each task was committed atomically:

1. **Task 1: SSE streaming Route Handler** - `8d99b2d` (feat)
2. **Task 2: Chat UI components and Front Desk page** - `8f9fd95` (feat)
3. **Task 3: Human verification checkpoint** - approved (no commit — checkpoint only)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/app/api/agent/stream/route.ts` - SSE endpoint: POST streams Claude via invokeAgent(), GET returns conversation history; Node.js runtime, 15s heartbeat, fire-and-forget pattern
- `src/hooks/useChatStream.ts` - Client hook managing messages/isStreaming/error state; chunked SSE buffer for partial ReadableStream chunks; AbortController ref for request cleanup
- `src/components/chat/ChatWindow.tsx` - Main chat container with flex-column layout, auto-scroll via useRef, loads history on mount
- `src/components/chat/MessageBubble.tsx` - User (right-aligned primary) and assistant (left-aligned muted) bubbles; pulsing dots when streaming empty, blinking cursor when streaming content
- `src/components/chat/ChatInput.tsx` - shadcn Input+Button; Enter-to-send; disabled during streaming; auto-focus after send
- `src/app/(dashboard)/desk/page.tsx` - Server Component shell mounting ChatWindow in a bordered card with 100vh-based height
- `src/app/(dashboard)/layout.tsx` - Added "Front Desk" nav link between Dashboard and Settings

## Decisions Made
- Node.js runtime (not Edge) on the stream route — Edge runtime breaks `@supabase/ssr` cookie-based auth (confirmed from Phase 2 research pitfall 4)
- Fire-and-forget `invokeAgent()` inside `ReadableStream.start()` — if awaited, SSE would buffer the full response before flushing the first byte to the client
- Default `conversationId` is `${hotelId}_owner_chat` — one persistent conversation per hotel owner, recommended by Phase 2 research
- `select('*')` pattern on the hotels query — avoids postgrest-js v12 partial-select TypeScript type narrowing issue (same workaround as Plan 01)
- Client-side chunked SSE buffer in useChatStream — `ReadableStream.getReader()` returns arbitrary byte chunks; partial `data:` lines must be buffered until `\n\n` delimiter arrives

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - both tasks compiled on first attempt and the build verified cleanly.

## User Setup Required
External services were required for human verification (applied before Task 3):
- `ANTHROPIC_API_KEY` added to `.env.local` (from https://console.anthropic.com/)
- SQL migration `supabase/migrations/0002_agent_core.sql` applied in Supabase Dashboard SQL Editor

These are pre-existing requirements from Plans 01-03, not new dependencies introduced by this plan.

## Next Phase Readiness
- Phase 2 (Agent Core) is now complete — all 4 plans shipped
- Hotel owner can have a full conversation with the Front Desk AI at /desk
- SSE streaming infrastructure is reusable for future agent UIs (WhatsApp preview, booking agent)
- Phase 3 (Guest Communications) can begin: email/SMS delivery, guest-facing interfaces, and inbound message routing

---
*Phase: 02-agent-core*
*Completed: 2026-03-03*
