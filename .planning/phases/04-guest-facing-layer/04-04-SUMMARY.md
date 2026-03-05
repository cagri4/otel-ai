---
phase: 04-guest-facing-layer
plan: 04
subsystem: ui
tags: [next-intl, i18n, internationalization, turkish, cookie-locale, react]

# Dependency graph
requires:
  - phase: 03-knowledge-base-and-onboarding
    provides: Dashboard layout and route group structure used as integration point

provides:
  - next-intl v4.8.3 configured with cookie-based locale (no URL routing)
  - src/i18n/request.ts: reads NEXT_LOCALE cookie, defaults to en
  - messages/en.json and messages/tr.json with full dashboard translation coverage
  - NextIntlClientProvider wrapping root layout
  - LocaleSwitcher component toggling EN/TR via NEXT_LOCALE cookie + router.refresh()
  - getTranslations() / useTranslations() available for all future dashboard pages

affects:
  - 04-05 (future plans using translations in pages)
  - All dashboard components that will consume useTranslations()

# Tech tracking
tech-stack:
  added: [next-intl@4.8.3]
  patterns:
    - Cookie-based locale resolution without URL routing
    - NextIntlClientProvider at root layout (server-side message loading)
    - force-dynamic export for auth-gated server components

key-files:
  created:
    - src/i18n/request.ts
    - messages/en.json
    - messages/tr.json
    - src/components/LocaleSwitcher.tsx
  modified:
    - next.config.ts
    - src/app/layout.tsx
    - src/app/(dashboard)/layout.tsx

key-decisions:
  - "Cookie-based locale (NEXT_LOCALE) without URL routing — no [locale] segment or createMiddleware needed"
  - "export const dynamic = force-dynamic added to dashboard layout — pre-existing prerender error caused by Supabase auth.getUser() at build time"
  - "LocaleSwitcher sets 1-year cookie + router.refresh() — re-renders Server Components with new locale without full page reload"
  - "Message files cover all dashboard sections upfront — gradual adoption by future plans replacing hardcoded strings"

patterns-established:
  - "Cookie locale pattern: NEXT_LOCALE cookie read in src/i18n/request.ts, set in client components"
  - "force-dynamic required for any layout/page that calls Supabase auth server-side"

requirements-completed: [I18N-01, I18N-02, I18N-03, I18N-04]

# Metrics
duration: 23min
completed: 2026-03-05
---

# Phase 04 Plan 04: i18n Infrastructure Summary

**next-intl v4.8.3 with cookie-based locale (NEXT_LOCALE), EN/TR message files covering all dashboard sections, NextIntlClientProvider at root, and LocaleSwitcher in dashboard header**

## Performance

- **Duration:** 23 min
- **Started:** 2026-03-05T10:43:18Z
- **Completed:** 2026-03-05T11:06:58Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- next-intl configured without URL routing — reads NEXT_LOCALE cookie, defaults to en
- EN and TR message files created with full coverage of all dashboard sections (Nav, Dashboard, FrontDesk, Knowledge, Settings, Onboarding, Common)
- Root layout wrapped with NextIntlClientProvider; getTranslations()/useTranslations() now available everywhere
- LocaleSwitcher component added to dashboard header — hotel owners can toggle EN/TR instantly
- Fixed pre-existing build failure: dashboard layout needed force-dynamic due to Supabase auth calls at prerender time

## Task Commits

Each task was committed atomically:

1. **Task 1: Install next-intl, configure i18n, message files, layout wrap** - `8f6fccb` (feat)
2. **Task 2: LocaleSwitcher component and dashboard layout integration** - `d5a641c` (feat)

**Plan metadata:** (committed with this summary)

## Files Created/Modified
- `src/i18n/request.ts` - Locale resolution: reads NEXT_LOCALE cookie, defaults to 'en', validates against ['en', 'tr']
- `messages/en.json` - English translations: Nav, Dashboard, FrontDesk, Knowledge, Settings, Onboarding, Common
- `messages/tr.json` - Turkish translations: same key structure as en.json
- `src/components/LocaleSwitcher.tsx` - Globe icon + locale code toggle; sets cookie + router.refresh()
- `next.config.ts` - Wrapped with createNextIntlPlugin('./src/i18n/request.ts')
- `src/app/layout.tsx` - Now async; loads locale + messages server-side; wraps with NextIntlClientProvider
- `src/app/(dashboard)/layout.tsx` - Added LocaleSwitcher to header; added force-dynamic export

## Decisions Made
- Cookie-based locale (NEXT_LOCALE) without URL routing — consistent with existing app structure, no [locale] segment needed
- export const dynamic = 'force-dynamic' added to dashboard layout — Supabase auth.getUser() requires real request context (no prerendering)
- LocaleSwitcher sets 1-year NEXT_LOCALE cookie + calls router.refresh() — re-renders Server Components with new locale
- Message files created with full coverage upfront — future plans can adopt translations incrementally using useTranslations() / getTranslations()

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing prerender failure in dashboard layout**
- **Found during:** Task 1 (build verification)
- **Issue:** DashboardLayout calls supabase.auth.getUser() which requires real request cookie context. Next.js Turbopack tried to prerender dashboard routes at build time, producing Server Components render errors (digest 3464247318)
- **Fix:** Added `export const dynamic = 'force-dynamic'` to src/app/(dashboard)/layout.tsx — forces all dashboard routes to be server-rendered on demand
- **Files modified:** src/app/(dashboard)/layout.tsx
- **Verification:** pnpm build succeeds; all dashboard routes show as ƒ (Dynamic) in build output
- **Committed in:** 8f6fccb (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - pre-existing bug)
**Impact on plan:** Essential correctness fix. The app was unbuildable without it. No scope creep.

## Issues Encountered
- Turbopack ENOENT race condition on first build attempts (intermittent filesystem error with _buildManifest.js.tmp files). Resolved by using NEXT_TURBOPACK_USE_WORKER=0 env var during build. Pre-existing issue unrelated to this plan's changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- next-intl infrastructure is complete. All dashboard pages can now call `getTranslations('SectionName')` (Server Components) or `useTranslations('SectionName')` (Client Components) to access translations
- I18N-02 (AI language detection) confirmed already implemented in agentFactory.ts system prompts
- I18N-04 (knowledge base translation) confirmed as no-schema-change (Claude translates at query time)
- Phase 04 Plan 05 can proceed

---
*Phase: 04-guest-facing-layer*
*Completed: 2026-03-05*
