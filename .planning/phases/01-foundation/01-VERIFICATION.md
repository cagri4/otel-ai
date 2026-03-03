---
phase: 01-foundation
verified: 2026-03-03T08:30:00Z
status: human_needed
score: 4/4 must-haves verified
re_verification: false
human_verification:
  - test: "Sign up with email, password, and hotel name at /signup"
    expected: "Redirects to dashboard showing the new hotel name; Supabase auth.users, public.hotels, and public.profiles records all exist"
    why_human: "Cannot verify DB trigger execution or JWT hotel_id injection programmatically without a live Supabase connection"
  - test: "Open /settings, change timezone to a non-UTC IANA value (e.g. Europe/Istanbul), save, and hard-refresh"
    expected: "Form re-loads with the saved timezone pre-selected; 'Last updated' timestamp on dashboard shows time in the new timezone, not UTC"
    why_human: "Timezone persistence and display correctness require a running app with real DB state"
  - test: "Create two separate accounts with different hotel names, each in an incognito window"
    expected: "Each session sees only its own hotel name and data; neither can see the other's hotel row"
    why_human: "RLS isolation requires live Supabase with the migration and Custom Access Token Hook applied; cannot be verified statically"
  - test: "While logged out, navigate directly to / and to /settings"
    expected: "Both redirect to /login immediately"
    why_human: "Middleware redirect behavior requires a running Next.js server"
---

# Phase 1: Foundation Verification Report

**Phase Goal:** A hotel owner can sign up, create a hotel account, and configure their hotel — and the platform correctly isolates their data from all other hotels
**Verified:** 2026-03-03T08:30:00Z
**Status:** human_needed — all automated checks passed; 4 items require live-app testing
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A new hotel owner can sign up with email and password and land on their hotel dashboard | VERIFIED | `signup-form.tsx`: calls `supabase.auth.signUp` with `hotel_name` in metadata, then `refreshSession()`, then `router.push('/')`. Dashboard layout validates session server-side via `getUser()` and loads hotel via RLS-scoped `.single()`. |
| 2 | Hotel owner can set hotel name, address, timezone, and contact information and save changes | VERIFIED | `hotel-settings-form.tsx` renders all 7 fields including `TimezoneSelect`. `actions.ts` Server Action validates with Zod, updates via `supabase.from('hotels').update(...)`, calls `revalidatePath`. |
| 3 | Two separate hotels cannot see each other's data under any operation (RLS enforced at DB layer) | VERIFIED | `0001_foundation.sql`: RLS enabled on both tables; hotels policy `USING (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)`; Custom Access Token Hook injects `hotel_id` as top-level JWT claim; signup trigger atomically creates hotel and writes `hotel_id` to `app_metadata`. |
| 4 | All timestamps display in the hotel's configured local timezone, not UTC | VERIFIED | `formatInHotelTz` in `src/lib/timezone.ts` uses `@date-fns/tz TZDate` for DST-aware conversion. Dashboard page imports and calls it: `formatInHotelTz(hotel.updated_at, hotel.timezone)`. Timezone stored as IANA string; `TimezoneSelect` extracts `.value` only (`field.onChange(tz.value)`). |

**Score:** 4/4 truths verified

---

### Required Artifacts

#### Plan 01-01 Artifacts (FOUND-01, FOUND-03)

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/0001_foundation.sql` | VERIFIED | 201 lines. Contains: `CREATE TABLE public.hotels`, `CREATE TABLE public.profiles`, `ENABLE ROW LEVEL SECURITY` (x2), `CREATE POLICY` (x4), `CREATE TRIGGER on_auth_user_created`, `custom_access_token_hook` function, `idx_profiles_hotel_id` index, `set_updated_at` trigger. All columns use `TIMESTAMPTZ`. |
| `src/lib/supabase/client.ts` | VERIFIED | Exports `createClient()` using `createBrowserClient` from `@supabase/ssr`. Typed with `Database`. |
| `src/lib/supabase/server.ts` | VERIFIED | Exports `async createClient()` using `createServerClient` with `await cookies()` (Next.js 15+ pattern). `setAll` has try/catch for Server Components. |
| `src/lib/supabase/middleware.ts` | VERIFIED | Exports `updateSession()`. Uses `getUser()` (not `getSession()`). Bidirectional redirect: unauth to `/login`, auth away from `/login`/`/signup`. |
| `src/middleware.ts` | VERIFIED | Imports and calls `updateSession`. Matcher excludes static assets. |
| `src/lib/timezone.ts` | VERIFIED | Exports `formatInHotelTz(utcTimestamp, hotelTimezone, formatStr?)`. Uses `new TZDate` from `@date-fns/tz`. Default format `'dd MMM yyyy HH:mm'`. |
| `src/types/database.ts` | VERIFIED | Exports `Hotel` interface (all columns including `timezone: string`), `Profile` interface, and `Database` wrapper type for Supabase client typing. |

#### Plan 01-02 Artifacts (FOUND-02)

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/validations/auth.ts` | VERIFIED | Exports `signupSchema` (email, password, hotelName, optional fullName), `loginSchema` (email, password), `SignupInput`, `LoginInput`. |
| `src/components/forms/signup-form.tsx` | VERIFIED | Client component. Calls `supabase.auth.signUp` with `hotel_name` in `options.data`. Calls `refreshSession()` after success. Redirects to `/`. Uses shadcn Form + Input + Button. |
| `src/components/forms/login-form.tsx` | VERIFIED | Client component. Calls `supabase.auth.signInWithPassword`. On success: `router.refresh()` + `router.push('/')`. |
| `src/app/(auth)/layout.tsx` | VERIFIED | Centered auth layout. |
| `src/app/(auth)/signup/page.tsx` | VERIFIED | Renders `SignupForm`. Title: "Create your hotel account". |
| `src/app/(auth)/login/page.tsx` | VERIFIED | Renders `LoginForm`. Title: "Welcome back". |
| `src/app/(dashboard)/layout.tsx` | VERIFIED | Server Component. `getUser()` check, hotel load via `supabase.from('hotels').select('*').single()` (RLS scoped). Error state if hotel missing. Header with hotel name + Settings nav link + `SignOutButton`. |
| `src/app/(dashboard)/page.tsx` | VERIFIED | Server Component. Loads hotel via server client. Displays hotel name, timezone, `formatInHotelTz(hotel.updated_at, hotel.timezone)` timestamp. |
| `src/components/dashboard/sign-out-button.tsx` | VERIFIED | Client component. Calls `signOut()` + `router.push('/login')`. |

#### Plan 01-03 Artifacts (FOUND-03, FOUND-04)

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/validations/hotel.ts` | VERIFIED | Exports `hotelSettingsSchema` with IANA timezone validation via `Intl.DateTimeFormat` try/catch. Exports `HotelSettingsInput`. All 7 fields present. |
| `src/components/forms/hotel-settings-form.tsx` | VERIFIED | Client component. `useActionState` wired to `updateHotelSettings`. All 7 fields rendered. `TimezoneSelect` with `onChange={(tz) => field.onChange(tz.value)}` (extracts IANA string only). Success and error states displayed. |
| `src/app/(dashboard)/settings/page.tsx` | VERIFIED | Server Component. Loads hotel via RLS `.single()`. Renders `HotelSettingsForm` with hotel prop. |
| `src/app/(dashboard)/settings/actions.ts` | VERIFIED | `'use server'`. Auth check via `getUser()`. Hotel id fetch via RLS `.single()`. `hotelSettingsSchema.safeParse`. `supabase.from('hotels').update(...)`. `revalidatePath('/settings')` and `revalidatePath('/')`. Returns `{ success: true }` or `{ error }`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `0001_foundation.sql` | `auth.users` | `handle_new_user` trigger on INSERT | WIRED | Line 150: `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users` |
| `0001_foundation.sql` | JWT claims | `custom_access_token_hook` function | WIRED | Line 167: `CREATE OR REPLACE FUNCTION public.custom_access_token_hook`. Reads `hotel_id` from `app_metadata`, injects as top-level JWT claim via `jsonb_set`. Grants only to `supabase_auth_admin`. |
| `src/lib/timezone.ts` | `@date-fns/tz` | `TZDate` constructor | WIRED | Lines 44+46: `new TZDate(utcTimestamp, hotelTimezone)` in both string and Date branches. |
| `signup-form.tsx` | `supabase.auth.signUp` | Supabase browser client | WIRED | Line 58: `supabase.auth.signUp({ email, password, options: { data: { hotel_name, full_name } } })` |
| `signup-form.tsx` | `supabase.auth.refreshSession` | Force JWT refresh after signup | WIRED | Line 77: `await supabase.auth.refreshSession()` called after successful signUp before redirect |
| `(dashboard)/layout.tsx` | `supabase.auth.getUser` | Server-side session validation | WIRED | Line 32: `await supabase.auth.getUser()` with redirect to `/login` if no user |
| `hotel-settings-form.tsx` | `updateHotelSettings` | Server Action via `useActionState` | WIRED | Line 43-46: `useActionState(updateHotelSettings, null)`. Line 82: `formAction(formData)` called on submit. |
| `settings/actions.ts` | `supabase.from('hotels').update` | Supabase server client with RLS | WIRED | Line 68-80: `.from('hotels').update({ name, address, city, country, timezone, contact_email, contact_phone, updated_at }).eq('id', hotel.id)` |
| `hotel-settings-form.tsx` | `react-timezone-select` | `TimezoneSelect` with `.value` extraction | WIRED | Line 179: `<TimezoneSelect ... onChange={(tz: ITimezoneOption) => field.onChange(tz.value)} />` |
| `(dashboard)/page.tsx` | `formatInHotelTz` | Timestamp display with hotel timezone | WIRED | Lines 13+57: imported and called as `formatInHotelTz(hotel.updated_at, hotel.timezone)` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FOUND-01 | 01-01-PLAN.md | Multi-tenant Supabase schema with RLS — every table has `hotel_id` and row-level security policy | SATISFIED | `0001_foundation.sql`: `hotels` + `profiles` tables, RLS enabled on both, 4 policies using `((SELECT auth.jwt()) ->> 'hotel_id')::uuid` |
| FOUND-02 | 01-02-PLAN.md | User can sign up and create a hotel account with email/password via Supabase Auth | SATISFIED | `signup-form.tsx` calls `signUp` with `hotel_name` in metadata; DB trigger atomically creates hotel + profile; `refreshSession()` embeds `hotel_id` in JWT |
| FOUND-03 | 01-01-PLAN.md, 01-03-PLAN.md | All timestamps stored as UTC (`timestamptz`), displayed in hotel-local timezone | SATISFIED | All columns are `TIMESTAMPTZ`; `formatInHotelTz` uses `@date-fns/tz TZDate`; called on dashboard with `hotel.timezone` |
| FOUND-04 | 01-03-PLAN.md | Hotel owner can configure hotel basic info (name, address, timezone, contact) | SATISFIED | `hotel-settings-form.tsx` has all 7 fields; `actions.ts` updates DB; settings persist; timezone stored as IANA string |

No orphaned requirements found. All 4 Phase 1 requirements are claimed by plans and have implementation evidence.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/timezone.ts` | 43-47 | Identical `if/else` branches — both call `new TZDate(utcTimestamp, hotelTimezone)` despite different type guards | Info | The TypeScript narrowing works and the function is correct at runtime. The `string` and `Date` overloads of `TZDate` happen to have the same call signature here. No functional impact. |
| `src/components/ui/form.tsx` | 143 | `return null` | Info | shadcn/ui internal — conditional render when `FormMessage` has no error text. Not an implementation stub. |

No blocker or warning anti-patterns found.

---

### Human Verification Required

#### 1. Signup flow with DB trigger verification

**Test:** Navigate to `/signup`. Enter email, password (8+ chars), and a hotel name. Submit.
**Expected:** Redirected to `/` dashboard displaying the hotel name. In Supabase Dashboard, verify `auth.users`, `public.hotels`, and `public.profiles` each have one new row, and `hotels.name` matches what was entered.
**Why human:** The DB trigger (`handle_new_user`) and Custom Access Token Hook (`custom_access_token_hook`) must be applied to the live Supabase project. Cannot verify trigger execution or JWT claim injection without a live DB connection.

#### 2. Hotel settings persistence and timezone display

**Test:** Sign in, navigate to `/settings`, change the timezone from UTC to `Europe/Istanbul`, add an address and contact email, click Save. Hard-refresh the page.
**Expected:** Form reloads with `Europe/Istanbul` selected. On the dashboard (`/`), the "Last updated" timestamp shows a time 3 hours ahead of UTC (e.g. if UTC is 09:00, displayed time is 12:00).
**Why human:** Requires running app with real DB writes and a re-render to confirm both persistence and timezone display correctness.

#### 3. RLS isolation between two hotels

**Test:** Open a second incognito window. Sign up a second account with a different hotel name. In both windows, open the dashboard simultaneously.
**Expected:** Each window shows only its own hotel name. Neither user can see the other's hotel data at any point.
**Why human:** Row-level security enforcement requires live Supabase with the migration applied. The SQL policies are correctly written but can only be confirmed by actual cross-tenant query attempts.

#### 4. Route protection (unauthenticated redirect)

**Test:** Sign out. In an incognito window, navigate directly to `http://localhost:3000/` and then to `http://localhost:3000/settings`.
**Expected:** Both requests immediately redirect to `/login`. When logged in, navigating to `/login` redirects to `/`.
**Why human:** Middleware redirect behavior requires a running Next.js server process.

---

### Gaps Summary

No gaps found. All 4 success criteria are supported by substantive, wired implementation code. The 4 human verification items are confirmation steps for live-environment behavior that cannot be verified statically — they are not suspected failures.

**Noteworthy:** ROADMAP.md `Progress` table still marks Plan 03 as `[ ]` (incomplete) but `01-03-SUMMARY.md` exists dated 2026-03-03, all Plan 03 artifacts are present and wired, and `requirements-completed: [FOUND-03, FOUND-04]` is declared. The ROADMAP progress table was not updated after Plan 03 completed — this is a documentation sync issue, not an implementation gap.

---

_Verified: 2026-03-03T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
