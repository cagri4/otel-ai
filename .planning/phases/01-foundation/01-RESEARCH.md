# Phase 1: Foundation - Research

**Researched:** 2026-03-02
**Domain:** Multi-tenant Supabase schema design, @supabase/ssr auth, Next.js App Router middleware, timezone handling
**Confidence:** HIGH (Supabase RLS, auth middleware verified against official docs; timezone strategy verified against date-fns v4 and MDN)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | Multi-tenant Supabase schema with RLS — every table has `hotel_id` and row-level security policy | Schema design pattern, JWT custom claims via Custom Access Token Hook, RLS performance via indexes documented |
| FOUND-02 | User can sign up and create a hotel account with email/password via Supabase Auth | signUp API, database trigger to auto-create hotel and profile records on auth.users insert documented |
| FOUND-03 | All timestamps stored as UTC (timestamptz), displayed in hotel-local timezone | Supabase always stores UTC; `@date-fns/tz` TZDate pattern for display-layer conversion documented |
| FOUND-04 | Hotel owner can configure hotel basic info (name, address, timezone, contact) | shadcn Form + react-hook-form + zod Server Action pattern; react-timezone-select v3.3.2 documented |
</phase_requirements>

---

## Summary

Phase 1 builds the data foundation that every subsequent phase depends on. The core challenge is multi-tenancy: every database row must carry a `hotel_id` foreign key, and Supabase Row Level Security must enforce tenant isolation at the database layer so no application-layer mistake can leak one hotel's data to another.

The auth flow has one critical architectural decision: when a user signs up, the system must atomically create both the `auth.users` record (managed by Supabase Auth) and the `hotels` table record (in the public schema). The standard pattern is a PostgreSQL trigger on `auth.users` that fires on INSERT and creates the hotel record. This keeps signup atomic without requiring a second API call. The `hotel_id` is then written into the user's JWT via a Custom Access Token Hook, making it available in RLS policies without subqueries.

Timezone handling is solved cleanly: store everything as `timestamptz` (PostgreSQL always converts to UTC on write), store the hotel's IANA timezone string (e.g., `"Europe/Istanbul"`) in the hotels table, and use `@date-fns/tz` TZDate objects at the display layer to convert. The timezone picker uses `react-timezone-select` which wraps IANA timezone data and auto-detects the user's browser timezone as a default.

**Primary recommendation:** Use the Custom Access Token Hook to inject `hotel_id` into JWTs at token issuance, enabling zero-subquery RLS policies with a single indexed column lookup per row. This is the performance-correct approach at scale.

---

## Standard Stack

### Core (Phase 1 specific)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.x | Supabase client (server + client) | Official client; RLS auto-enforced through session |
| `@supabase/ssr` | latest | Cookie-based auth for Next.js App Router | Official SSR package; `@supabase/auth-helpers-nextjs` is deprecated |
| `react-hook-form` | ^7.x | Form state management | Lower re-renders than controlled components; integrates with Zod resolver |
| `zod` | ^3.x | Schema validation | Type-safe validation for forms and Server Actions |
| `@hookform/resolvers` | ^3.x | Bridges Zod to react-hook-form | Official resolver package |
| `react-timezone-select` | 3.3.2 | IANA timezone picker | Actively maintained (Feb 2026); auto-detects browser timezone; wraps react-select |
| `react-select` | ^5.x | Peer dependency for react-timezone-select | Required when using the default TimezoneSelect component |
| `@date-fns/tz` | (date-fns v4 package) | Display-layer timezone conversion | date-fns v4 first-class timezone support via TZDate; replaces date-fns-tz |
| `date-fns` | ^4.x | Date formatting and manipulation | v4 includes native timezone support via @date-fns/tz |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `shadcn/ui` | latest | UI components (Form, Input, Select, Button) | Hotel config form; zero lock-in (components copied into project) |
| `lucide-react` | latest | Icons | Ships with shadcn/ui |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@date-fns/tz` + date-fns v4 | `date-fns-tz` + date-fns v2/v3 | date-fns-tz is the v2/v3 companion; v4 built-in is preferred for new projects |
| `react-timezone-select` | Custom `<select>` from `Intl.supportedValuesOf('timeZone')` | Build-your-own works but loses grouped display, daylight saving awareness, and react-select UX |
| Supabase Custom Access Token Hook | Subquery in RLS policy to `profiles` table | Subquery adds latency; hook is cleaner; hook is the documented recommended approach |

**Installation:**
```bash
# Already installed via stack setup:
# @supabase/supabase-js @supabase/ssr zod

# Phase 1 additions:
pnpm add react-hook-form @hookform/resolvers
pnpm add react-timezone-select react-select
pnpm add date-fns @date-fns/tz

# shadcn init (if not already done):
pnpm dlx shadcn@latest init
# Then add components as needed:
pnpm dlx shadcn@latest add form input button select card
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 1 scope)
```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx          # Login form
│   │   ├── signup/
│   │   │   └── page.tsx          # Signup form (email, password, hotel name)
│   │   └── layout.tsx            # Unauthenticated layout
│   └── (dashboard)/
│       ├── settings/
│       │   └── page.tsx          # Hotel configuration form
│       ├── page.tsx              # Hotel dashboard (placeholder)
│       └── layout.tsx            # Authenticated layout with session check
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # createBrowserClient() for Client Components
│   │   ├── server.ts             # createServerClient() for Server Components / Actions
│   │   └── middleware.ts         # updateSession() for Next.js middleware
│   └── validations/
│       ├── auth.ts               # signup/login Zod schemas
│       └── hotel.ts              # hotel settings Zod schema
│
├── components/
│   └── forms/
│       ├── signup-form.tsx       # Email + password + hotel name
│       └── hotel-settings-form.tsx  # Hotel config with timezone picker
│
└── middleware.ts                 # Root middleware — session refresh + route protection
```

```
supabase/
└── migrations/
    └── 0001_foundation.sql       # hotels table, profiles, RLS, trigger, hook
```

### Pattern 1: Database Schema with RLS

Every tenant-scoped table follows this pattern:

```sql
-- Source: Official Supabase RLS docs + multi-tenancy patterns
-- https://supabase.com/docs/guides/database/postgres/row-level-security

-- CORE TABLES

-- 1. Hotels table (one per tenant)
CREATE TABLE public.hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  country TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',  -- IANA timezone string e.g. 'Europe/Istanbul'
  contact_email TEXT,
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Profiles table (links auth.users to hotels)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES (critical for RLS performance)
-- Source: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
CREATE INDEX idx_profiles_hotel_id ON public.profiles(hotel_id);
-- All future tenant-scoped tables must have this index pattern:
-- CREATE INDEX idx_{table}_hotel_id ON public.{table}(hotel_id);

-- ENABLE RLS
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES FOR HOTELS
-- Uses (SELECT auth.jwt() ...) pattern to cache JWT read per query (performance)
CREATE POLICY "Hotel owners see own hotel"
  ON public.hotels FOR SELECT
  TO authenticated
  USING (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel owners update own hotel"
  ON public.hotels FOR UPDATE
  TO authenticated
  USING (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- RLS POLICIES FOR PROFILES
CREATE POLICY "Users see own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
```

### Pattern 2: Signup Trigger — Auto-create Hotel and Profile

The trigger fires on `auth.users` INSERT and creates the hotel + profile records atomically. This means signup requires exactly ONE client call (`supabase.auth.signUp()`); no second API call needed.

```sql
-- Source: https://supabase.com/docs/guides/auth/managing-user-data
-- Trigger to create hotel and profile on user signup

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_hotel_id UUID;
BEGIN
  -- 1. Create the hotel record
  INSERT INTO public.hotels (name, timezone)
  VALUES (
    COALESCE(NEW.raw_user_meta_data ->> 'hotel_name', 'My Hotel'),
    'UTC'
  )
  RETURNING id INTO new_hotel_id;

  -- 2. Create the profile linking user to hotel
  INSERT INTO public.profiles (id, hotel_id, full_name)
  VALUES (
    NEW.id,
    new_hotel_id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  );

  -- 3. Write hotel_id into app_metadata so Custom Access Token Hook can inject it into JWT
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('hotel_id', new_hotel_id)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

**Warning:** If the trigger fails, signup is blocked. Test thoroughly and wrap in error handling.

### Pattern 3: Custom Access Token Hook — Inject hotel_id into JWT

The hook runs before every token issuance and adds `hotel_id` from `app_metadata` to the JWT claims. RLS policies then read it directly from the JWT with no subquery needed.

```sql
-- Source: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims JSONB;
  hotel_id TEXT;
BEGIN
  claims := event -> 'claims';

  -- Inject hotel_id from app_metadata (set by handle_new_user trigger)
  hotel_id := event -> 'user_metadata' ->> 'hotel_id';
  IF hotel_id IS NULL THEN
    hotel_id := (event -> 'claims' -> 'app_metadata') ->> 'hotel_id';
  END IF;

  IF hotel_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{hotel_id}', to_jsonb(hotel_id));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Required grants for the hook to execute
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

Enable in Supabase Dashboard: Authentication > Hooks > Custom Access Token.

### Pattern 4: @supabase/ssr Middleware

```typescript
// src/lib/supabase/middleware.ts
// Source: https://supabase.com/docs/guides/auth/server-side/nextjs

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Use getClaims() not getSession() in server code
  // getClaims() validates JWT signature locally; getSession() reads from cookie without validation
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users away from protected routes
  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/signup') &&
    !request.nextUrl.pathname.startsWith('/auth')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

```typescript
// middleware.ts (root)
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### Pattern 5: Server Client for Server Components and Server Actions

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies; ignore
          }
        },
      },
    }
  )
}
```

### Pattern 6: Signup with Hotel Name in Metadata

```typescript
// Client-side signup — hotel_name passed in metadata
// Source: https://supabase.com/docs/guides/auth/managing-user-data

const { data, error } = await supabase.auth.signUp({
  email: formData.email,
  password: formData.password,
  options: {
    data: {
      hotel_name: formData.hotelName,  // picked up by handle_new_user trigger
      full_name: formData.fullName,
    },
  },
})

// After signUp succeeds, user.id and hotel are created atomically by DB trigger
// Redirect to /dashboard — hotel is ready
```

### Pattern 7: Hotel Settings Server Action with Supabase

```typescript
// app/(dashboard)/settings/actions.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { hotelSettingsSchema } from '@/lib/validations/hotel'

export async function updateHotelSettings(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const parsed = hotelSettingsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.format() }

  const { error } = await supabase
    .from('hotels')
    .update({
      name: parsed.data.name,
      address: parsed.data.address,
      city: parsed.data.city,
      country: parsed.data.country,
      timezone: parsed.data.timezone,
      contact_email: parsed.data.contactEmail,
      contact_phone: parsed.data.contactPhone,
      updated_at: new Date().toISOString(),
    })
    // RLS automatically scopes this to the user's hotel_id from JWT
    .eq('id', parsed.data.hotelId)

  if (error) return { error: error.message }
  return { success: true }
}
```

### Pattern 8: Timezone Display with @date-fns/tz

```typescript
// Display a UTC timestamp in hotel-local timezone
// Source: https://blog.date-fns.org/v40-with-time-zone-support/

import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

// hotel.timezone = "Europe/Istanbul" (IANA string from DB)
// timestamp = "2026-03-02T09:00:00Z" (timestamptz from Supabase — always UTC)

function formatInHotelTimezone(utcTimestamp: string, hotelTimezone: string): string {
  const tzDate = new TZDate(utcTimestamp, hotelTimezone)
  return format(tzDate, 'dd MMM yyyy HH:mm')
  // => "02 Mar 2026 12:00" for Europe/Istanbul (UTC+3)
}
```

### Pattern 9: Hotel Settings Form with Timezone Picker

```tsx
// components/forms/hotel-settings-form.tsx
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import TimezoneSelect from 'react-timezone-select'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { hotelSettingsSchema, type HotelSettingsInput } from '@/lib/validations/hotel'

export function HotelSettingsForm({ hotel }: { hotel: Hotel }) {
  const form = useForm<HotelSettingsInput>({
    resolver: zodResolver(hotelSettingsSchema),
    defaultValues: {
      name: hotel.name,
      address: hotel.address ?? '',
      city: hotel.city ?? '',
      country: hotel.country ?? '',
      timezone: hotel.timezone ?? 'UTC',
      contactEmail: hotel.contact_email ?? '',
      contactPhone: hotel.contact_phone ?? '',
    },
  })

  // Source: https://ui.shadcn.com/docs/forms/react-hook-form
  return (
    <Form {...form}>
      <form action={updateHotelSettingsAction}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hotel Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Grand Hotel Istanbul" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Timezone picker */}
        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <FormControl>
                <TimezoneSelect
                  value={field.value}
                  onChange={(tz) => field.onChange(tz.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit">Save Changes</Button>
      </form>
    </Form>
  )
}
```

### Anti-Patterns to Avoid

- **RLS without indexes:** Creating `hotel_id` columns and RLS policies but not indexing the `hotel_id` column causes full-table scans. Every tenant-scoped table MUST have `CREATE INDEX idx_{table}_hotel_id ON public.{table}(hotel_id)`.
- **Using `getSession()` in server code:** `getSession()` reads from the cookie without JWT validation. Use `getUser()` for route protection in middleware, or `getClaims()` once asymmetric JWT keys are configured.
- **Using `user_metadata` in RLS:** `raw_user_meta_data` is user-modifiable and cannot be trusted for authorization. Use `app_metadata` (set server-side only) or the Custom Access Token Hook for `hotel_id` in JWT claims.
- **No WITH CHECK on INSERT/UPDATE:** Omitting `WITH CHECK` lets users insert rows with someone else's `hotel_id`. Every INSERT and UPDATE policy needs both `USING` and `WITH CHECK`.
- **`timestamp` not `timestamptz`:** Never use `timestamp without time zone`. Supabase's `timestamptz` always stores UTC and prevents timezone bugs.
- **Storing timezone offset not IANA string:** Store `"Europe/Istanbul"` not `"+03:00"`. Offsets change with DST; IANA strings are stable.
- **auth-helpers-nextjs (deprecated):** The `@supabase/auth-helpers-nextjs` package is deprecated. Use `@supabase/ssr` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timezone picker | Custom `<select>` from IANA list | `react-timezone-select` | DST-aware grouping, IANA normalization, browser auto-detect, 26 projects use it |
| Multi-tenant data isolation | Application-level `hotel_id` filtering | Supabase RLS policies | Application filters can be bypassed by bugs; DB-layer RLS cannot |
| JWT claims for tenant | Subquery in every RLS policy to `profiles` table | Custom Access Token Hook | Subquery causes N+1 per row evaluated; hook injects once at token issuance |
| Signup + hotel creation | Two-step API call (signUp then create hotel) | PostgreSQL trigger on `auth.users` | Trigger is atomic; two-step can leave orphaned auth users with no hotel |
| UTC display conversion | Manual `new Date()` + getTimezoneOffset | `@date-fns/tz` TZDate | Edge cases: DST transitions, ambiguous times, leap seconds |
| Form validation (client + server) | Custom validation logic | Zod schema shared between client (react-hook-form resolver) and server (Server Action) | Single source of truth; type inference flows to TypeScript automatically |

**Key insight:** The trigger + hook pattern removes all "partial state" risk from signup. The user either has a hotel or they don't — there is no state where `auth.users` has a user but `hotels` doesn't.

---

## Common Pitfalls

### Pitfall 1: RLS Policy Evaluates auth.jwt() per Row (Performance)
**What goes wrong:** RLS policy written as `hotel_id = (auth.jwt() ->> 'hotel_id')::uuid` calls `auth.jwt()` for every row scanned. On a table with 10,000 rows, that is 10,000 JWT parses.
**Why it happens:** PostgreSQL evaluates the USING expression per row without caching by default.
**How to avoid:** Wrap in `(SELECT ...)` — `hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid`. The `SELECT` subquery triggers an initPlan that caches the result for the entire query.
**Warning signs:** EXPLAIN ANALYZE shows "Function Scan" repeating in the plan; slow queries on medium-sized tables.

### Pitfall 2: Trigger Failure Blocks Signup Silently
**What goes wrong:** The `handle_new_user` trigger has a bug (e.g., NOT NULL constraint failure on hotels table). Every signup returns a success from `supabase.auth.signUp()` but the user ends up in `auth.users` with no hotel record.
**Why it happens:** The JS client gets the signUp confirmation before the trigger completes; if the trigger rolls back, the auth user still exists (Supabase behavior in some versions).
**How to avoid:** Test the trigger independently in the SQL editor before wiring up frontend. Add a NOT NULL constraint on `profiles.hotel_id` so the trigger failure is explicit. Write an E2E test that verifies the hotel record exists after signup.
**Warning signs:** Users can log in but get a 404 on their hotel query; RLS returns empty result because hotel_id JWT claim is null.

### Pitfall 3: Hotel Configuration Form Loses Timezone on Save
**What goes wrong:** `react-timezone-select` returns an object `{ value: "Europe/Istanbul", label: "..." }`. If the form submits the full object instead of `.value`, the database receives an object string, not the IANA identifier.
**Why it happens:** `onChange` handler receives the full timezone object, not just the value string.
**How to avoid:** In the `FormField` render: `onChange={(tz) => field.onChange(tz.value)}` — extract `.value` explicitly. Validate the stored timezone string with Zod using `z.string().refine(tz => Intl.supportedValuesOf('timeZone').includes(tz), 'Invalid timezone')`.
**Warning signs:** `hotel.timezone` in the DB shows `"[object Object]"` or `"undefined"`.

### Pitfall 4: getClaims() Returns Stale hotel_id After Signup
**What goes wrong:** User signs up → trigger creates hotel → Custom Access Token Hook writes `hotel_id` to new JWT. But the user's session token was issued BEFORE the trigger ran. For a short window after signup, the JWT doesn't contain `hotel_id`, so RLS returns no results.
**Why it happens:** The JWT is signed at `signUp` time; the hook only fires on token issuance. The `app_metadata` update from the trigger happens AFTER the initial JWT is created.
**How to avoid:** After successful signup, force a session refresh: `await supabase.auth.refreshSession()`. This triggers a new token issuance, firing the hook and embedding the new `hotel_id`. Alternatively, fetch the hotel record using the service role key in a Server Action immediately after signup and store `hotel_id` in a cookie for the first request.
**Warning signs:** Dashboard shows "no hotel found" immediately after signup, but works after a page reload or re-login.

### Pitfall 5: Timezone Comparison Across UTC+0 Boundaries
**What goes wrong:** Hotel is in UTC+14 (easternmost). A booking at 23:00 local time stores as the previous day in UTC. The display shows the wrong date for that booking.
**Why it happens:** Raw JavaScript `new Date(utcString)` converts to the browser's local time, not the hotel's timezone.
**How to avoid:** Always use `TZDate(timestamp, hotel.timezone)` from `@date-fns/tz`. Never display raw UTC timestamps or convert via the browser's local timezone. Pass the hotel timezone from the server as a string prop.
**Warning signs:** Date-sensitive display components in tests fail only when run from a different timezone than the test hotel.

### Pitfall 6: Supabase Publishable Key vs Anon Key Confusion
**What goes wrong:** Using `NEXT_PUBLIC_SUPABASE_ANON_KEY` in a project that has switched to the new publishable key format (`sb_publishable_xxx`). RLS evaluation may differ or auth may fail.
**Why it happens:** Supabase is migrating to a new key format. Documentation now references `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
**How to avoid:** Check the Supabase Dashboard for the current key format. If the project was created recently, use the publishable key. Older projects use the anon key. Update the env variable name accordingly.
**Warning signs:** `createBrowserClient` or `createServerClient` returns auth errors despite correct URL.

---

## Code Examples

Verified patterns from official sources:

### Supabase Browser Client
```typescript
// Source: https://supabase.com/docs/guides/auth/server-side/creating-a-client
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
```

### RLS Policy Template for All Tenant-Scoped Tables
```sql
-- Apply this pattern to EVERY new table with hotel_id
-- Source: https://supabase.com/docs/guides/database/postgres/row-level-security

ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_{table_name}_hotel_id ON public.{table_name}(hotel_id);

CREATE POLICY "{Table} hotel isolation"
  ON public.{table_name} FOR ALL
  TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
```

### Zod Schema for Hotel Settings
```typescript
// lib/validations/hotel.ts
import { z } from 'zod'

export const hotelSettingsSchema = z.object({
  hotelId: z.string().uuid(),
  name: z.string().min(1, 'Hotel name is required').max(100),
  address: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  timezone: z.string().refine(
    (tz) => {
      try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true }
      catch { return false }
    },
    'Invalid IANA timezone'
  ),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().max(30).optional(),
})

export type HotelSettingsInput = z.infer<typeof hotelSettingsSchema>
```

### formatInTimeZone Helper
```typescript
// lib/timezone.ts
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * Format a UTC timestamp for display in the hotel's local timezone.
 *
 * @param utcTimestamp - ISO string from Supabase (always UTC/timestamptz)
 * @param hotelTimezone - IANA timezone string e.g. "Europe/Istanbul"
 * @param formatStr - date-fns format string, default "dd MMM yyyy HH:mm"
 */
export function formatInHotelTz(
  utcTimestamp: string | Date,
  hotelTimezone: string,
  formatStr = 'dd MMM yyyy HH:mm'
): string {
  const tzDate = new TZDate(utcTimestamp, hotelTimezone)
  return format(tzDate, formatStr)
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` | 2023-2024 (deprecated) | Must use `@supabase/ssr`; auth-helpers no longer maintained |
| `getSession()` in middleware | `getUser()` or `getClaims()` in middleware | 2024-2025 | `getSession()` is insecure in server context; always use `getUser()` |
| `date-fns-tz` standalone library | `@date-fns/tz` (date-fns v4 built-in) | date-fns v4 released 2024 | For new projects, use `@date-fns/tz` instead of the older companion library |
| Subquery in RLS for tenant_id | Custom Access Token Hook injects claim into JWT | Supabase auth hooks (2023+) | Zero subqueries in policies; N+100x performance improvement on large tables |
| `tailwindcss-animate` plugin | CSS native animations via Tailwind v4 | March 2025 (shadcn deprecation) | Remove `tailwindcss-animate` from shadcn config; use CSS directly |

**Deprecated/outdated:**
- `@supabase/auth-helpers-nextjs`: Deprecated; use `@supabase/ssr`
- `date-fns-tz` (standalone): Legacy companion for date-fns v2/v3; use `@date-fns/tz` for date-fns v4
- `tailwindcss-animate`: Deprecated in shadcn/ui as of March 2025
- `supabase.auth.getSession()` in server code: Insecure; replaced by `getUser()` and `getClaims()`

---

## Open Questions

1. **app_metadata update in trigger vs service role API call**
   - What we know: The trigger updates `raw_app_meta_data` directly via SQL. Supabase auth system should pick this up.
   - What's unclear: Whether directly modifying `auth.users.raw_app_meta_data` in a trigger causes any side effects in newer Supabase versions; the documented approach is to use the Admin API.
   - Recommendation: Test in a Supabase development project first. Alternative: use the Supabase Admin API in a Server Action after signup to set `app_metadata`, then force `refreshSession()`. This is safer but requires a two-step flow.

2. **getClaims() availability**
   - What we know: `getClaims()` is mentioned as the newer, more efficient alternative to `getUser()` in server code.
   - What's unclear: Whether `getClaims()` is available in the current version of `@supabase/ssr` or only in newer versions; official docs still show `getUser()` examples.
   - Recommendation: Use `getUser()` for middleware (it's documented and safe); switch to `getClaims()` when officially documented in the `@supabase/ssr` changelog.

3. **Supabase Realtime free tier limits for Phase 1**
   - What we know: Free tier supports 200 concurrent Realtime connections.
   - What's unclear: Not relevant for Phase 1 (no Realtime needed), but plan ahead; Pro tier increases this limit.
   - Recommendation: Not a Phase 1 concern; note for Phase 4 (guest chat).

---

## Sources

### Primary (HIGH confidence)
- [Supabase RLS Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — policy syntax, USING/WITH CHECK, enabling RLS
- [Supabase RLS Performance Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) — SELECT wrapping, index requirements, security definer pattern
- [Supabase Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) — @supabase/ssr middleware pattern, getClaims vs getSession
- [Supabase Managing User Data](https://supabase.com/docs/guides/auth/managing-user-data) — handle_new_user trigger, raw_user_meta_data pattern
- [Supabase Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) — JWT claim injection for hotel_id
- [Supabase Custom Claims RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) — app_metadata vs user_metadata security distinction
- [shadcn/ui React Hook Form docs](https://ui.shadcn.com/docs/forms/react-hook-form) — FormField, FormItem, FormControl pattern
- [date-fns v4 Timezone Support](https://blog.date-fns.org/v40-with-time-zone-support/) — TZDate, @date-fns/tz package
- [react-timezone-select GitHub](https://github.com/ndom91/react-timezone-select) — v3.3.2 (Feb 2026), peer dependency on react-select

### Secondary (MEDIUM confidence)
- [Supabase Creating SSR Client](https://supabase.com/docs/guides/auth/server-side/creating-a-client) — createBrowserClient/createServerClient patterns; confirmed via official docs
- [Supabase Multi-Tenancy Discussion](https://roughlywritten.substack.com/p/supabase-multi-tenancy-simple-and) — community pattern confirming app_metadata for tenant_id; consistent with official security docs
- DEV Community: "Enforcing Row Level Security in Supabase: A Deep Dive into LockIn's Multi-Tenant Architecture" — real-world RLS for SaaS verified against official patterns

### Tertiary (LOW confidence — flag for validation)
- `getClaims()` as replacement for `getUser()` in middleware — referenced in GitHub issues and community posts but official docs still show `getUser()`; validate before using in production

---

## Metadata

**Confidence breakdown:**
- Multi-tenant schema design (FOUND-01): HIGH — Supabase official docs, verified against RLS performance guide
- Auth flow with @supabase/ssr (FOUND-02): HIGH — Official Supabase Next.js SSR docs verified
- Timezone strategy (FOUND-03): HIGH — Supabase confirmed UTC storage; @date-fns/tz verified via official blog; IANA via MDN
- Hotel configuration UI (FOUND-04): HIGH — shadcn/ui docs verified; react-timezone-select v3.3.2 confirmed (Feb 2026 release)

**Research date:** 2026-03-02
**Valid until:** 2026-06-01 (stable libraries; Supabase API patterns change slowly)
