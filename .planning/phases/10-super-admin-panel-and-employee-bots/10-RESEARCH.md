# Phase 10: Super Admin Panel and Employee Bots - Research

**Researched:** 2026-03-06
**Domain:** Next.js admin route protection, Supabase Auth Admin API, Telegram Bot setWebhook, multi-bot provisioning
**Confidence:** HIGH (all critical claims verified against existing codebase patterns and official API docs)

## Summary

Phase 10 wires together two distinct concerns that share a common trigger: (1) a super admin UI that creates hotels and provisions bots, and (2) each provisioned employee bot responding as the correct AI role when a hotel owner sends it a message.

The employee bot response concern (EBOT-01 through EBOT-04) is already 90% solved. Phase 9 built the complete pipeline: `hotel_bots` table, Vault-encrypted tokens, `resolveBot()`, `invokeAgent()`, `sendTelegramReply()`, and MarkdownV2 escaping. The only remaining work is ensuring all four roles (`front_desk`, `booking_ai`, `guest_experience`, `housekeeping_coordinator`) are provisioned with rows in `hotel_bots` and their webhooks registered. The webhook handler already routes by `hotel_bots.role`, so the correct AI employee responds automatically once provisioned.

The super admin UI concern (SADM-01 through SADM-04) is where all the interesting design work lives. The project has no existing super admin concept — all auth is hotel-scoped via JWT `hotel_id` claims. The cleanest approach is an environment-variable-guarded route group (`/admin`) that checks `SUPER_ADMIN_EMAIL` against the authenticated user's email in a Server Component layout. No DB schema change is needed for auth: the existing service role client already bypasses RLS for admin operations. Creating a new hotel requires calling `supabase.auth.admin.createUser()` (Supabase Admin API) which fires the `handle_new_user` DB trigger — the same trigger used by normal signup — atomically creating the hotel and profile rows.

Webhook registration (SADM-03) must call `setWebhook` via the Telegram Bot API using the bot's plaintext token. The call pattern is already documented in Phase 9 research and the same `get_bot_token` Vault RPC used in the webhook handler applies here. The webhook URL format must use the `webhook_path_slug` UUID (not the bot token in the URL path), consistent with the Phase 9 security decision. The `webhook_secret` (a random string stored in `hotel_bots.webhook_secret`) is passed as `secret_token` to `setWebhook` so Telegram sends it on every update.

The Setup Wizard deep link (SADM-04) is a trivial string operation: `https://t.me/{setupWizardBotUsername}?start={hotelId}`. The setup wizard bot is a Phase 11 concern, but the deep link can be generated in Phase 10 as long as `SETUP_WIZARD_BOT_USERNAME` is available as an env var.

**Primary recommendation:** Guard `/admin` with env-var email check in Server Component layout, use `supabase.auth.admin.createUser()` for hotel creation (fires existing DB trigger), use the established Vault + `setWebhook` pattern from Phase 9 for webhook registration, generate deep links from env var. No new DB migration needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` admin API | `^2.98.0` (already installed) | `supabase.auth.admin.createUser()` for programmatic user+hotel creation | Same client already used throughout project; admin methods require `SUPABASE_SERVICE_ROLE_KEY` |
| `createServiceClient()` | Existing (`@/lib/supabase/service`) | Bypass RLS for hotel list, bot provisioning, webhook registration | Already used by webhook handler, billing, WhatsApp routes |
| Native `fetch` | Runtime built-in | Call Telegram `setWebhook` API | Same pattern as `sendTelegramReply` — single POST, no SDK needed |
| Next.js Server Actions | Framework built-in | Form submissions for hotel creation and bot provisioning | Same pattern as `settings/actions.ts`, `employees/actions.ts` |
| `crypto.randomUUID()` | Node.js built-in | Generate `webhook_path_slug` and `webhook_secret` | Already used in Phase 9; no extra dep |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `Card`, `Button`, `Input`, `Badge` | Already installed | Admin UI components | Same components used across all dashboard pages |
| `zod` | `^4.3.6` (already installed) | Validate bot token format before calling Telegram API | Validates that token matches `\d{8,10}:[A-Za-z0-9_-]{35}` pattern |
| `sonner` | `^2.0.7` (already installed) | Toast feedback for provisioning actions | Already used in dashboard layout Toaster |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Env-var email check in layout | DB `is_super_admin` boolean column on profiles | Env var avoids any DB migration; exactly one super admin is the stated constraint. DB column is overkill and adds migration complexity. |
| `supabase.auth.admin.createUser()` | Calling the normal `/signup` endpoint programmatically | Admin API is the correct server-to-server pattern. The normal signup requires browser session flow. Admin API works in a Server Action context. |
| Generating deep link from env var | Fetching bot info from Telegram `getMe` API | `getMe` requires a roundtrip per hotel click; env var is zero-cost and sufficient since the wizard bot username doesn't change per hotel. |

**Installation (no new packages needed):**
```bash
# All required packages already installed in project.
# @supabase/supabase-js already provides admin auth methods via service key.
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   └── (admin)/                    # Route group — parentheses mean no URL prefix change
│       ├── layout.tsx              # Super admin guard: env email check, redirect if not admin
│       └── admin/                  # Route: /admin
│           └── page.tsx            # Hotel list with status badges
├── lib/
│   └── admin/
│       ├── createHotel.ts          # Server Action: admin.createUser() + set onboarding_completed
│       └── provisionBots.ts        # Server Action: vault insert + setWebhook for all 4 roles
```

**Note on route group naming:** Using `(admin)` as the route group means the actual URL is `/admin`. The layout at `(admin)/layout.tsx` applies only to routes inside that group.

### Pattern 1: Super Admin Route Guard

**What:** Server Component layout checks `SUPER_ADMIN_EMAIL` env var against authenticated user's email. Redirects to `/login` if not admin. No DB query needed.

**When to use:** Any page inside `src/app/(admin)/`.

```typescript
// Source: Established pattern — same shape as (dashboard)/layout.tsx
// src/app/(admin)/layout.tsx

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const adminEmail = process.env.SUPER_ADMIN_EMAIL
  if (!adminEmail || user.email !== adminEmail) {
    redirect('/')  // Redirect non-admins to dashboard, not a 403 page
  }

  return <>{children}</>
}
```

**ENV var needed:** `SUPER_ADMIN_EMAIL=your@email.com` — added to `.env.local` and Vercel project settings.

### Pattern 2: Hotel List with Subscription Status

**What:** Server Component queries all hotels + joins subscriptions table using service role client (bypasses RLS to see all hotels, not just the admin's own).

```typescript
// src/app/(admin)/admin/page.tsx (Server Component)

import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabase = createServiceClient()

// Fetch all hotels with subscription status — service role bypasses hotel_id RLS
const { data: hotels } = await (supabase as unknown as SupabaseClient)
  .from('hotels')
  .select(`
    id,
    name,
    city,
    country,
    created_at,
    onboarding_completed_at,
    subscriptions (
      plan_name,
      status,
      trial_ends_at
    )
  `)
  .order('created_at', { ascending: false })
```

**Note on SupabaseClient cast:** Same `(supabase as unknown as SupabaseClient)` pattern used throughout the project for manually-typed tables. `subscriptions` is not in the auto-generated types, so the cast is required.

### Pattern 3: Programmatic Hotel Creation via Admin API

**What:** Server Action calls `supabase.auth.admin.createUser()` which fires the existing `handle_new_user` DB trigger, atomically creating hotel + profile + hotel_id in app_metadata.

**Critical:** The `data` field in `createUser` must include `hotel_name` to match what the DB trigger reads from `raw_user_meta_data`. The trigger reads: `COALESCE(NEW.raw_user_meta_data ->> 'hotel_name', 'My Hotel')`.

```typescript
// Source: https://supabase.com/docs/reference/javascript/auth-admin-createuser
// src/lib/admin/createHotel.ts

import { createServiceClient } from '@/lib/supabase/service'

export async function adminCreateHotel(params: {
  hotelName: string
  ownerEmail: string
  ownerPassword: string  // Temp password — owner should change on first login
}): Promise<{ hotelId: string; userId: string } | { error: string }> {
  const supabase = createServiceClient()

  // admin.createUser fires handle_new_user trigger:
  // → creates hotels row
  // → creates profiles row
  // → sets app_metadata.hotel_id
  const { data, error } = await supabase.auth.admin.createUser({
    email: params.ownerEmail,
    password: params.ownerPassword,
    email_confirm: true,        // Skip email confirmation for admin-created accounts
    user_metadata: {
      hotel_name: params.hotelName,
      full_name: '',
    },
  })

  if (error) {
    return { error: error.message }
  }

  // hotel_id is written to app_metadata by the trigger
  // Retrieve hotel_id from app_metadata
  const hotelId = data.user.app_metadata?.hotel_id as string | undefined

  if (!hotelId) {
    return { error: 'Hotel creation trigger did not set hotel_id in app_metadata' }
  }

  // Mark onboarding complete immediately — admin-created hotels skip wizard
  // (Setup Wizard via Telegram handles the hotel owner's onboarding in Phase 11)
  await supabase
    .from('hotels')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', hotelId)

  return { hotelId, userId: data.user.id }
}
```

**Important:** `email_confirm: true` bypasses email verification. This is appropriate for admin-created accounts where the admin controls the credentials and the hotel owner will be onboarded via Telegram (not email).

### Pattern 4: Bot Provisioning — Vault + setWebhook

**What:** For each of the 4 roles, the admin provides a bot token (pasted from BotFather). The Server Action:
1. Validates the token format with Telegram's `getMe` API (live validation)
2. Stores the token in Vault via `create_bot_token_secret` RPC
3. Generates a random `webhook_path_slug` (UUID) and `webhook_secret`
4. Calls Telegram's `setWebhook` with the slug-based URL and secret
5. Inserts a row in `hotel_bots`

```typescript
// src/lib/admin/provisionBots.ts

import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'

const ROLES = ['front_desk', 'booking_ai', 'guest_experience', 'housekeeping_coordinator'] as const

export async function provisionBotForRole(params: {
  hotelId: string
  role: typeof ROLES[number]
  botToken: string             // Plaintext — from BotFather, pasted by admin
  appUrl: string               // e.g. https://otelai.vercel.app (from env)
}): Promise<{ success: true; botUsername: string } | { error: string }> {
  const supabase = createServiceClient()

  // Step 1: Validate token and get bot username via getMe
  const getMeRes = await fetch(
    `https://api.telegram.org/bot${params.botToken}/getMe`
  )
  const getMeBody = await getMeRes.json() as { ok: boolean; result?: { username: string } }
  if (!getMeBody.ok || !getMeBody.result?.username) {
    return { error: 'Invalid bot token — getMe failed' }
  }
  const botUsername = getMeBody.result.username

  // Step 2: Store token in Vault — returns vault_secret_id UUID
  const { data: vaultId, error: vaultError } = await (supabase as unknown as SupabaseClient)
    .rpc('create_bot_token_secret', {
      p_token: params.botToken,
      p_name: `hotel_bot_${params.hotelId}_${params.role}_${Date.now()}`,
    })

  if (vaultError || !vaultId) {
    return { error: `Vault storage failed: ${vaultError?.message ?? 'unknown'}` }
  }

  // Step 3: Generate routing credentials
  const webhookPathSlug = crypto.randomUUID()
  const webhookSecret = crypto.randomUUID().replace(/-/g, '')  // 32 hex chars, no dashes

  // Step 4: Register webhook with Telegram
  const webhookUrl = `${params.appUrl}/api/telegram/${webhookPathSlug}`
  const setWebhookRes = await fetch(
    `https://api.telegram.org/bot${params.botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        drop_pending_updates: true,
        allowed_updates: ['message'],
      }),
    }
  )
  const setWebhookBody = await setWebhookRes.json() as { ok: boolean; description?: string }
  if (!setWebhookBody.ok) {
    return { error: `setWebhook failed: ${setWebhookBody.description ?? 'unknown'}` }
  }

  // Step 5: Insert hotel_bots row
  const { error: insertError } = await (supabase as unknown as SupabaseClient)
    .from('hotel_bots')
    .insert({
      hotel_id: params.hotelId,
      role: params.role,
      vault_secret_id: vaultId,
      bot_username: botUsername,
      webhook_secret: webhookSecret,
      webhook_path_slug: webhookPathSlug,
      is_active: true,
    })

  if (insertError) {
    return { error: `DB insert failed: ${insertError.message}` }
  }

  return { success: true, botUsername }
}
```

### Pattern 5: Deep Link Generation

**What:** One-click button generates `t.me/{setupWizardBotUsername}?start={hotelId}`.

```typescript
// Source: https://core.telegram.org/bots/features#deep-linking
// SETUP_WIZARD_BOT_USERNAME is the @username of the Phase 11 wizard bot

// In Server Component or Server Action:
const wizardUsername = process.env.SETUP_WIZARD_BOT_USERNAME ?? ''
const deepLink = `https://t.me/${wizardUsername}?start=${hotelId}`
```

**ENV var needed:** `SETUP_WIZARD_BOT_USERNAME=OtelAISetupBot` — added when the wizard bot is created in BotFather (Phase 11 creates the bot; Phase 10 just generates the link format).

**Design note:** The deep link can be displayed in the admin panel even before Phase 11 is implemented, as a copyable string. Hotel owners won't be able to use it until Phase 11 activates the wizard bot.

### Pattern 6: Employee Bot Response Routing

**What:** No new code needed. The existing `/api/telegram/[slug]/route.ts` handler from Phase 9 already:
- Looks up `hotel_bots` by `webhook_path_slug` → gets `role`
- Maps `role` string to `AgentRole` enum via `roleMap`
- Calls `invokeAgent({ role, hotelId, ... })`

All four roles are already in the `roleMap`:
```typescript
// Already in /src/app/api/telegram/[slug]/route.ts
const roleMap: Record<string, AgentRole> = {
  front_desk: AgentRole.FRONT_DESK,
  guest_experience: AgentRole.GUEST_EXPERIENCE,
  booking_ai: AgentRole.BOOKING_AI,
  housekeeping_coordinator: AgentRole.HOUSEKEEPING_COORDINATOR,
}
```

EBOT-01 through EBOT-04 are satisfied as soon as the `hotel_bots` rows exist with valid webhook registrations. The handler routes to the correct AI role automatically.

### Anti-Patterns to Avoid

- **Storing bot token in a URL query param for the admin UI:** Never pass `?token=xxx` in URLs — it ends up in server logs. All token handling must go through Server Actions and POST bodies.
- **Calling `setWebhook` before storing in Vault:** If Vault insert fails after a successful `setWebhook`, the webhook is registered but no row exists to route it. Always store in Vault first; if Vault fails, bail before calling Telegram.
- **Using a hardcoded temporary password for hotel owner accounts:** Generate a random temporary password (`crypto.randomBytes(16).toString('hex')`) rather than using a fixed string. Better: Use Supabase's magic link or password reset flow to let the owner set their own password.
- **Running all 4 bot provisioning calls sequentially:** The 4 roles are independent — run `Promise.all([provisionBotForRole(...role1), ...role4])` for faster provisioning.
- **Showing bot token values in the admin UI after save:** Once stored in Vault, the token should not be redisplayed. Show only `bot_username` and the webhook slug as confirmation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hotel + user creation | Custom SQL to insert into hotels + profiles | `supabase.auth.admin.createUser()` | The `handle_new_user` trigger handles all cascading logic atomically. Custom SQL would need to duplicate and maintain that trigger logic. |
| Bot token format validation | Regex check only | `getMe` API call + regex | Token format check (`\d{8,10}:[A-Za-z0-9_-]{35}`) catches syntax errors but not revoked/invalid tokens. `getMe` validates against Telegram's actual records and returns `bot_username` you need anyway. |
| Admin auth | Custom admin table + separate auth flow | Env var guard on Server Component layout | One super admin, no DB needed, no separate auth flow. Env var check in layout is zero-maintenance. |

**Key insight:** The entire employee bot routing infrastructure was built in Phase 9. Phase 10 only needs to populate `hotel_bots` rows — the rest is already operational.

---

## Common Pitfalls

### Pitfall 1: `handle_new_user` Trigger Timing with `app_metadata.hotel_id`

**What goes wrong:** After calling `admin.createUser()`, the returned `user.app_metadata.hotel_id` may be `undefined` because the trigger runs asynchronously in some configurations, or the `UPDATE auth.users` inside the trigger may not have committed before the `createUser` call returns.

**Why it happens:** The trigger writes `hotel_id` back to `auth.users.raw_app_meta_data`, but the Supabase admin API returns the user object from the initial insert, before the trigger's UPDATE runs.

**How to avoid:** After `admin.createUser()` returns, do a separate `admin.getUserById(userId)` to fetch the refreshed user with the trigger-written `app_metadata`. If still missing (trigger didn't run yet), query the `profiles` table using the service client: `SELECT hotel_id FROM profiles WHERE id = userId`.

**Fallback pattern:**
```typescript
// If app_metadata.hotel_id is missing after createUser:
const { data: profile } = await (supabase as unknown as SupabaseClient)
  .from('profiles')
  .select('hotel_id')
  .eq('id', userId)
  .single()
const hotelId = profile?.hotel_id
```

### Pitfall 2: Vault Cleanup on Failed Provisioning

**What goes wrong:** If `create_bot_token_secret` succeeds but `hotel_bots` INSERT fails (e.g., duplicate `(hotel_id, role)` UNIQUE constraint), a Vault secret is created with no corresponding row. Over time these orphaned secrets accumulate.

**Why it happens:** There is no transaction wrapping the Vault RPC + DB INSERT — they are separate operations.

**How to avoid:** On any failure after a successful Vault insert, call `vault.delete_secret(vaultId)` via an RPC or direct SQL. The Phase 9 migration added a `trg_delete_bot_vault_secret` trigger that cleans up when a `hotel_bots` row is deleted, but it does not cover the case where the row was never inserted.

**Recovery pattern in Server Action:**
```typescript
if (insertError) {
  // Attempt Vault cleanup — fire and forget, log if fails
  await (supabase as unknown as SupabaseClient)
    .rpc('delete_bot_vault_secret_by_id', { p_vault_secret_id: vaultId })
    .catch((e) => console.error('[provisionBots] Vault cleanup failed:', e))
  return { error: `DB insert failed: ${insertError.message}` }
}
```

**Note:** A `delete_bot_vault_secret_by_id` SQL function does not exist yet — it needs to be created in migration `0010_admin.sql` or the admin Server Action must call `vault.delete_secret()` directly (if exposed via a SECURITY DEFINER wrapper).

### Pitfall 3: `setWebhook` Called with Wrong URL Protocol

**What goes wrong:** `setWebhook` requires HTTPS. If `NEXT_PUBLIC_APP_URL` is set to `http://localhost:3000` in development, Telegram will reject the webhook registration.

**Why it happens:** Developers copy the local env var to production Vercel config without updating.

**How to avoid:** In development, use ngrok or a similar tunneling tool to get an HTTPS URL. In the admin UI, display a warning if `NEXT_PUBLIC_APP_URL` starts with `http://`. In the Server Action, validate that the URL starts with `https://` before calling `setWebhook`.

```typescript
if (!params.appUrl.startsWith('https://')) {
  return { error: 'App URL must be HTTPS for Telegram webhook registration. Use ngrok in development.' }
}
```

### Pitfall 4: Bot Already Has a Webhook Registered

**What goes wrong:** If the admin re-provisions a bot (updating its token or re-registering), the old `setWebhook` on the previous registration persists. The new registration overwrites it, which is fine — but if the hotel_bots row still has the old slug, the old webhook URL returns 200 silently for any remaining traffic.

**Why it happens:** Telegram allows overwriting an existing webhook with a new `setWebhook` call. This is correct behavior — the new call wins.

**How to avoid:** On re-provisioning, check if a `hotel_bots` row already exists for the `(hotel_id, role)` pair. If it does, update it (changing `webhook_path_slug`, `webhook_secret`, `vault_secret_id`) rather than inserting a new row. The UNIQUE constraint `(hotel_id, role)` will reject a duplicate insert anyway.

**Use upsert:**
```typescript
await supabase.from('hotel_bots').upsert({
  hotel_id: params.hotelId,
  role: params.role,
  // ... other fields
}, { onConflict: 'hotel_id,role' })
```

### Pitfall 5: Admin Panel Visible to Authenticated Hotel Owners

**What goes wrong:** A hotel owner who guesses `/admin` sees the admin panel.

**Why it happens:** The route guard checks env var email, but if the env var `SUPER_ADMIN_EMAIL` is not set in production, the check `if (!adminEmail || ...)` falls into the `redirect('/')` path for everyone — which is the correct fallback behavior. However, if the env var IS set and the owner's email happens to match... this is intentional.

**How to avoid:** This is not a real pitfall with the recommended design (env var check redirects non-admins). Just ensure `SUPER_ADMIN_EMAIL` is set correctly in Vercel environment settings and not exposed as `NEXT_PUBLIC_`.

---

## Code Examples

### Supabase Auth Admin API — createUser

```typescript
// Source: https://supabase.com/docs/reference/javascript/auth-admin-createuser
// Uses the service role client (SUPABASE_SERVICE_ROLE_KEY)
// NOTE: supabase.auth.admin methods are available directly on the service client

const { data, error } = await supabase.auth.admin.createUser({
  email: 'owner@hotel.com',
  password: 'temp-random-password',
  email_confirm: true,      // Skip email verification for admin-provisioned accounts
  user_metadata: {
    hotel_name: 'Grand Hotel',
    full_name: 'Owner Name',
  },
})
// data.user.app_metadata.hotel_id — set by handle_new_user trigger (may need re-fetch)
// data.user.id — UUID for the created auth user
```

### Telegram getMe — Bot Token Validation

```typescript
// Source: https://core.telegram.org/bots/api#getme
// Simple GET request — validates token and returns bot info including username

const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
const body = await res.json()
// body.ok === true if token valid
// body.result.username — the bot's @username (without @)
// body.result.id — bot's numeric Telegram ID
```

### Telegram setWebhook — Registration

```typescript
// Source: https://core.telegram.org/bots/api#setwebhook
// Must use HTTPS URL. secret_token must be 1-256 chars, A-Z a-z 0-9 _ -

const res = await fetch(`https://api.telegram.org/bot${plaintextToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `https://your-app.vercel.app/api/telegram/${webhookPathSlug}`,
    secret_token: webhookSecret,      // Stored in hotel_bots.webhook_secret
    drop_pending_updates: true,       // Discard any queue that built up
    allowed_updates: ['message'],     // Only text messages
  }),
})
const result = await res.json()
// result.ok === true if webhook registered successfully
// result.description on failure (e.g. "Invalid URL host specified")
```

### Telegram Deep Link Format

```typescript
// Source: https://core.telegram.org/bots/features#deep-linking
// start= parameter is passed to the bot as /start {payload}

const deepLink = `https://t.me/${botUsername}?start=${hotelId}`
// hotelId is the UUID — valid as deep link payload (alphanumeric + dashes)
// Max payload length: 64 chars. UUID (36 chars) fits comfortably.
```

### Hotel List Query — All Hotels with Subscription Status

```typescript
// Service role client bypasses RLS — admin sees all hotels
const { data: hotels } = await (supabase as unknown as SupabaseClient)
  .from('hotels')
  .select(`
    id, name, city, country, created_at, onboarding_completed_at,
    subscriptions ( plan_name, status, trial_ends_at )
  `)
  .order('created_at', { ascending: false })

// Each hotel has subscriptions as array (one-to-one in practice)
// Trial expired: status === 'trialing' && new Date(trial_ends_at) < new Date()
```

---

## Phase 10 Migration Needs

Phase 9 already created the `hotel_bots` table with all required columns. **No new table is needed for Phase 10.** However, one new migration is needed to add a helper function for Vault cleanup on failed provisioning:

```sql
-- supabase/migrations/0010_admin.sql

-- Helper function: delete a Vault secret by ID
-- Called by admin provisioning Server Action when bot row insert fails
-- after Vault insert succeeded (prevents orphaned secrets)
CREATE OR REPLACE FUNCTION public.delete_vault_secret(
  p_vault_secret_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_vault_secret_id;
END;
$$;

-- Restrict to service_role only
REVOKE EXECUTE ON FUNCTION public.delete_vault_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_vault_secret(UUID) TO service_role;
```

**ENV vars to add:**
- `SUPER_ADMIN_EMAIL` — email of the single super admin user
- `SETUP_WIZARD_BOT_USERNAME` — @username of the Phase 11 Setup Wizard bot (can be a placeholder until Phase 11 creates the bot)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Calling `supabase.auth.admin.*` required separate admin SDK | Admin methods available on standard `@supabase/supabase-js` client when initialized with service role key | Supabase JS v2 | No extra SDK needed; `createServiceClient()` already configured correctly |
| Route protection via middleware | Route protection in Server Component layout | Next.js App Router | More explicit, co-located with the route, easier to reason about for one-off admin routes |

**Deprecated/outdated:**
- `supabase.auth.api.*` methods (v1 pattern): Replaced by `supabase.auth.admin.*` in supabase-js v2. All v1 patterns are deprecated.

---

## Open Questions

1. **Temporary password strategy for admin-created hotel owners**
   - What we know: `admin.createUser()` requires a password. The hotel owner receives a Telegram deep link, not an email with credentials.
   - What's unclear: Should the admin paste a password into the form, or should the system generate one? If generated, how does the owner reset it?
   - Recommendation: Admin pastes a temporary password (shown once on the create form). The hotel owner will primarily use Telegram (Phase 11+), not the web dashboard. Password reset via Supabase's built-in reset flow if they need web dashboard access.

2. **Re-provisioning an existing bot (token rotation)**
   - What we know: UNIQUE constraint on `(hotel_id, role)` prevents duplicate rows. `setWebhook` overwrites previous registration.
   - What's unclear: Whether the admin UI should support replacing an existing bot token (e.g., if BotFather token is regenerated).
   - Recommendation: Use upsert on `hotel_bots` with `onConflict: 'hotel_id,role'`. Delete the old Vault secret before inserting the new one. Show a warning in the UI: "Replacing this bot token will update the webhook registration."

3. **`SETUP_WIZARD_BOT_USERNAME` before Phase 11 exists**
   - What we know: Phase 10 generates deep links. Phase 11 creates the actual wizard bot.
   - What's unclear: Should the admin panel show deep links if the wizard bot doesn't exist yet?
   - Recommendation: Generate and display the deep link format regardless. If `SETUP_WIZARD_BOT_USERNAME` is not set, show a placeholder: "Set SETUP_WIZARD_BOT_USERNAME env var to enable deep link generation." This lets Phase 10 ship without blocking on Phase 11.

4. **Admin page rendering performance with many hotels**
   - What we know: The admin hotel list fetches all hotels + subscriptions in one query. Initially few hotels (admin creates them one at a time).
   - What's unclear: At what hotel count does this need pagination?
   - Recommendation: No pagination needed for Phase 10. Add `limit(100)` as a safety cap. Revisit if hotel count grows.

---

## Sources

### Primary (HIGH confidence)

- [Supabase Docs — Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser) — `createUser`, `email_confirm`, `user_metadata` fields
- [Telegram Bot API — setWebhook](https://core.telegram.org/bots/api#setwebhook) — `secret_token`, `drop_pending_updates`, `allowed_updates`, HTTPS requirement
- [Telegram Bot API — getMe](https://core.telegram.org/bots/api#getme) — token validation, username retrieval
- [Telegram Bots — Deep Linking](https://core.telegram.org/bots/features#deep-linking) — `t.me/botname?start=payload` format, 64 char payload limit
- Existing codebase — `supabase/migrations/0001_foundation.sql` — `handle_new_user` trigger reads `raw_user_meta_data ->> 'hotel_name'`; creates hotel + profile + sets `app_metadata.hotel_id`
- Existing codebase — `supabase/migrations/0009_telegram.sql` — `hotel_bots` schema, `create_bot_token_secret` RPC, `get_bot_token` RPC, vault cleanup trigger
- Existing codebase — `/src/app/api/telegram/[slug]/route.ts` — roleMap for all 4 AgentRoles, confirmed all roles routable
- Existing codebase — `(dashboard)/layout.tsx` — Server Component layout pattern for auth guard

### Secondary (MEDIUM confidence)

- [Supabase Docs — Vault](https://supabase.com/docs/guides/database/vault) — `vault.delete_secret()` function existence (used by the existing cleanup trigger in `0009_telegram.sql`)

### Tertiary (LOW confidence)

- `admin.createUser()` trigger timing: The timing of `handle_new_user` trigger relative to the returned `user` object is not explicitly documented. The fallback pattern (query `profiles` table) is a defensive measure based on project experience with the signup flow.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SADM-01 | Super admin panel — hotel list with status, create new hotel | Pattern 1 (env var route guard) + Pattern 2 (hotel list query with subscription join). No DB migration needed. Service role client sees all hotels. |
| SADM-02 | Bot token entry per hotel (pasted from BotFather) | Pattern 4 (provisionBots). Admin UI form with 4 token inputs (one per role). Token validated via `getMe` before storage. |
| SADM-03 | Automatic `setWebhook` registration when bot token is saved | Pattern 4 step 4 — `setWebhook` called in the same Server Action as Vault insert and `hotel_bots` INSERT. Must use HTTPS URL from `NEXT_PUBLIC_APP_URL`. |
| SADM-04 | Telegram deep link generation (`t.me/SetupWizardBot?start={hotelId}`) | Pattern 5 — one-liner string construction from `SETUP_WIZARD_BOT_USERNAME` env var and `hotelId`. Button on hotel detail view copies to clipboard. |
| EBOT-01 | Front Desk AI as separate Telegram bot for hotel owner | Satisfied when `hotel_bots` row with `role = 'front_desk'` exists and webhook registered. Handler routes to `AgentRole.FRONT_DESK` via existing roleMap. |
| EBOT-02 | Booking AI as separate Telegram bot for hotel owner | Satisfied when `hotel_bots` row with `role = 'booking_ai'` exists and webhook registered. Handler routes to `AgentRole.BOOKING_AI` via existing roleMap. |
| EBOT-03 | Housekeeping Coordinator as separate Telegram bot for hotel owner | Satisfied when `hotel_bots` row with `role = 'housekeeping_coordinator'` exists and webhook registered. Handler routes to `AgentRole.HOUSEKEEPING_COORDINATOR` via existing roleMap. |
| EBOT-04 | Guest Experience AI as separate Telegram bot for hotel owner | Satisfied when `hotel_bots` row with `role = 'guest_experience'` exists and webhook registered. Handler routes to `AgentRole.GUEST_EXPERIENCE` via existing roleMap. |
</phase_requirements>

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in project; Supabase Admin API and Telegram Bot API verified via official docs
- Architecture: HIGH — patterns follow established codebase conventions (service client cast, Server Component layout guard, Server Actions for mutations)
- Pitfalls: HIGH — Vault orphan cleanup verified by examining migration 0009; trigger timing issue is defensive based on existing signup flow analysis; setWebhook HTTPS requirement is in official docs

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (Supabase Admin API and Telegram Bot API are stable; Next.js App Router patterns are current)
