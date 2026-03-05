# Phase 3: Knowledge Base and Onboarding - Research

**Researched:** 2026-03-05
**Domain:** Knowledge base schema design, multi-language content, multi-step onboarding wizard, default data seeding, CRUD dashboard UI
**Confidence:** HIGH (architecture patterns verified against existing codebase; Supabase trigger pattern confirmed; Claude multilingual verified via official docs)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KNOW-01 | Hotel owner can add/edit hotel FAQs (check-in time, WiFi, parking, policies) | `hotel_facts` table already exists (Phase 2); category='faq' and 'policy' already defined; CRUD UI = Server Action + shadcn Form pattern established in Phase 1 |
| KNOW-02 | Hotel owner can add/edit room information (types, pricing, amenities, photos description) | New `rooms` table required; same category pattern as hotel_facts; or dedicated table with richer schema; CRUD UI pattern same |
| KNOW-03 | Hotel owner can add/edit local recommendations (restaurants, attractions, transport) | New `local_recommendations` table OR extend hotel_facts with category='recommendation'; CRUD UI same pattern |
| KNOW-04 | Knowledge base feeds all AI employees as shared hotel context | Already implemented in `assembleContext.ts` via `loadSemanticFacts()` — reads all `hotel_facts` for hotel_id; extending hotel_facts table is zero-change to agent layer |
| KNOW-05 | Knowledge base supports multi-language content (or auto-translation) | Two viable patterns: (a) JSONB `translations` column on each fact row; (b) Claude auto-translate at query time. Pattern (b) preferred for MVP — Claude performs at 96–98% of English performance in target languages; no schema change required |
| ONBR-01 | New hotel owner reaches first working AI response in under 5 minutes | Signup already works (Phase 1); default facts seeded by Postgres trigger on hotel INSERT; onboarding wizard collects hotel name + city + contact; AI chat at /desk already works (Phase 2); path is: signup → wizard (60s) → /desk (AI ready) |
| ONBR-02 | Onboarding wizard collects minimum info (hotel name, city, contact) then starts AI | Multi-step form: Step 1 hotel name (pre-filled from signup), Step 2 city+contact, Step 3 redirect to /desk; useState step management; each step is a Server Action |
| ONBR-03 | Progressive onboarding — AI employees ask for missing info during first "shift" | Behavioral instruction layer (Layer 4 of system prompt in assembleContext.ts) — add instruction that if key fields are missing, agent proactively asks and saves responses; tool needed: `update_hotel_info` |
| ONBR-04 | Pre-populated boutique hotel defaults (check-in 3pm, checkout 11am, standard policies) | Postgres trigger on `hotels` INSERT seeds default `hotel_facts` rows; same trigger pattern as `handle_new_user` in 0001_foundation.sql |
</phase_requirements>

---

## Summary

Phase 3 sits directly on top of the Phase 2 agent core. The good news: the foundational pieces are already in place. The `hotel_facts` table (semantic memory Tier 1) already exists, is already RLS-protected, and is already read by every agent invocation via `loadSemanticFacts()` in `assembleContext.ts`. This means KNOW-04 is essentially free — adding knowledge base content to that table automatically reaches all AI employees.

The work in this phase is threefold. First, the schema must be extended with a richer knowledge base structure: room information and local recommendations need dedicated tables (or structured categories) beyond the flat `hotel_facts` rows used for policies and FAQs. Second, a CRUD dashboard UI must be built so hotel owners can view, add, edit, and delete their knowledge base content. Third, an onboarding wizard must be built that routes new users from signup to their first working AI response in under 5 minutes by collecting minimal info, seeding defaults, and landing them at `/desk`.

Multi-language support (KNOW-05) is the one area with a non-trivial decision. The two viable patterns are: (a) store pre-translated content using a JSONB `translations` column on each row, or (b) rely on Claude's native multilingual capability to respond in the guest's detected language using English source content. Pattern (b) is strongly preferred for an MVP: Claude operates at 96–98% of English performance across all major European and Asian languages (verified via Anthropic official docs), requires zero schema change, and eliminates the translation authoring burden from the hotel owner. Pattern (a) should be deferred to a later phase when multilingual content editing becomes a user requirement.

**Primary recommendation:** Extend `hotel_facts` with structured categories for rooms and recommendations, seed defaults via Postgres trigger on hotel INSERT, build a per-category CRUD UI using the established Server Action + shadcn Form pattern, and implement the onboarding wizard as a 2-step in-memory React state machine that redirects to `/desk` on completion.

---

## Standard Stack

### Core (no new packages required)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.98.0 (installed) | CRUD operations on knowledge base tables via server client | Already in project; RLS enforced |
| `@supabase/ssr` | ^0.8.0 (installed) | Server client for Server Actions that modify knowledge base | Already in project |
| `react-hook-form` | ^7.71.2 (installed) | Form state management for knowledge base CRUD forms | Already in project; used in hotel settings |
| `zod` | ^4.3.6 (installed) | Schema validation for Server Actions | Already in project |
| `@hookform/resolvers` | ^5.2.2 (installed) | Bridges Zod to react-hook-form | Already in project |
| `shadcn/ui` | (installed) | Form, Card, Button, Input, Textarea, Select, Dialog, Tabs components | Already in project; Card/Form/Button/Input/Textarea already added |
| `lucide-react` | ^0.576.0 (installed) | Icons for CRUD actions (Plus, Pencil, Trash2, Check) | Already in project |
| `next` | ^16.1.6 (installed) | Server Actions for mutations, Server Components for data reads | Already in project |

### New shadcn components to add
| Component | Command | Purpose |
|-----------|---------|---------|
| `dialog` | `pnpm dlx shadcn@latest add dialog` | Modal for add/edit knowledge base items |
| `tabs` | `pnpm dlx shadcn@latest add tabs` | Knowledge base section tabs (FAQs / Rooms / Recommendations) |
| `badge` | `pnpm dlx shadcn@latest add badge` | Category labels on knowledge base items |
| `alert` | `pnpm dlx shadcn@latest add alert` | Onboarding completion prompt, empty state messages |
| `progress` | `pnpm dlx shadcn@latest add progress` | Onboarding wizard step indicator |
| `separator` | `pnpm dlx shadcn@latest add separator` | Visual dividers in knowledge base lists |

**Installation:**
```bash
pnpm dlx shadcn@latest add dialog tabs badge alert progress separator
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSONB `translations` column (Pattern a) | Claude auto-translate at agent query time (Pattern b) | Pattern a requires translation authoring UI, stores duplicate content, complex schema; Pattern b is zero schema change and Claude is 96-98% English performance in major languages |
| Separate `rooms` table | Extend `hotel_facts` with category='room_type' | Separate table gives richer schema (bed_count, max_occupancy, base_price_per_night); `hotel_facts` is simpler but less structured; research recommendation: separate `rooms` table for KNOW-02 |
| Separate `local_recommendations` table | Extend `hotel_facts` with category='recommendation' | For MVP, extending `hotel_facts` with category='recommendation' is sufficient; saves a table and CRUD screen; `hotel_facts` already loaded by all agents |
| `useSearchParams` for wizard step | `useState` in-memory | URL step state is only needed if users share/bookmark the wizard URL; onboarding wizard is one-time and ephemeral; `useState` is simpler, avoids Suspense boundary requirement |
| TanStack Table for knowledge base list | Simple `<ul>` or `<table>` | Hotel knowledge base will have tens of items max, not thousands; TanStack Table is overkill |

---

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)
```
src/
├── app/
│   └── (dashboard)/
│       ├── knowledge/
│       │   └── page.tsx              # Knowledge base dashboard — Server Component
│       ├── onboarding/
│       │   └── page.tsx              # Onboarding wizard — Client Component with useState steps
│       └── settings/
│           └── actions.ts            # Already exists — extend with knowledge base actions
│
├── components/
│   └── knowledge/
│       ├── KnowledgeBaseEditor.tsx   # Main tabbed editor — Client Component
│       ├── FactList.tsx              # Reusable list of hotel_facts for a category
│       ├── FactForm.tsx              # Add/edit form for a single fact (Dialog)
│       ├── RoomList.tsx              # List of rooms
│       ├── RoomForm.tsx              # Add/edit form for a room (Dialog)
│       └── OnboardingWizard.tsx      # 2-step wizard Client Component
│
└── lib/
    ├── actions/
    │   └── knowledge.ts              # Server Actions: addFact, updateFact, deleteFact, addRoom, updateRoom, deleteRoom
    └── validations/
        └── knowledge.ts              # Zod schemas for fact and room forms

supabase/
└── migrations/
    └── 0003_knowledge_base.sql       # rooms table + seed trigger + recommendations category
```

### Pattern 1: Knowledge Base Data Model

**What:** The `hotel_facts` table (Phase 2) already handles flat text facts grouped by category. Phase 3 extends this with a richer `rooms` table for structured room data (KNOW-02) and adds the `recommendation` category to `hotel_facts` (KNOW-03).

**Design rationale:** FAQs, policies, and local recommendations are unstructured text — the flat `hotel_facts` row with a `fact TEXT` column is perfect. Room information is structured data (room type, bed count, occupancy, pricing range, amenities) that benefits from typed columns rather than free text.

**Schema:**
```sql
-- 0003_knowledge_base.sql

-- Extended hotel_facts categories (no schema change — categories are TEXT):
-- 'policy'           existing — check-in, checkout, cancellation
-- 'faq'              existing — WiFi password, parking info, amenities
-- 'amenity'          existing — pool hours, gym, spa
-- 'pricing_note'     existing — seasonal rate notes
-- 'recommendation'   NEW — restaurants, attractions, transport
-- NOTE: hotel_facts category is TEXT NOT NULL — any string value is valid.
-- No migration needed to add 'recommendation' category.

-- Rooms table for structured room information (KNOW-02)
CREATE TABLE public.rooms (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID         NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,     -- e.g. "Deluxe Ocean View"
  room_type       TEXT         NOT NULL,     -- e.g. "standard" | "deluxe" | "suite"
  bed_type        TEXT,                      -- e.g. "king" | "twin" | "queen"
  max_occupancy   INTEGER,                   -- max guests
  description     TEXT,                      -- free text for agent context
  amenities       TEXT[],                    -- array of amenity strings
  base_price_note TEXT,                      -- "from $120/night" — text for agent, not booking engine
  sort_order      INTEGER      NOT NULL DEFAULT 0,  -- display ordering
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_hotel_id ON public.rooms(hotel_id);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- RLS: same pattern as hotel_facts
CREATE POLICY "Hotel staff see own rooms"
  ON public.rooms FOR SELECT TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff insert own rooms"
  ON public.rooms FOR INSERT TO authenticated
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff update own rooms"
  ON public.rooms FOR UPDATE TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE POLICY "Hotel staff delete own rooms"
  ON public.rooms FOR DELETE TO authenticated
  USING (hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE TRIGGER set_rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
```

### Pattern 2: Default Data Seeding via Postgres Trigger

**What:** A Postgres trigger on the `hotels` table seeds default `hotel_facts` rows (ONBR-04) and a default room skeleton when a new hotel is created. This ensures that even before the owner fills in their knowledge base, the AI has sensible boutique hotel defaults to work from.

**When to use:** Every new hotel registration — trigger fires automatically on INSERT.

**Trigger on `hotels` INSERT (not `auth.users`):**
The Phase 1 trigger (`handle_new_user`) runs on `auth.users` INSERT and creates the hotels record. The new Phase 3 trigger runs on `hotels` INSERT — it fires immediately after the hotel row exists. This keeps the seeding concern in the `hotels` domain, not the auth domain.

```sql
-- 0003_knowledge_base.sql (continued)

CREATE OR REPLACE FUNCTION public.seed_hotel_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Seed default hotel_facts (boutique hotel defaults per ONBR-04)
  INSERT INTO public.hotel_facts (hotel_id, category, fact) VALUES
    (NEW.id, 'policy', 'Check-in time is 3:00 PM. Early check-in is subject to availability and may incur an additional fee.'),
    (NEW.id, 'policy', 'Check-out time is 11:00 AM. Late check-out is subject to availability and may incur an additional fee.'),
    (NEW.id, 'policy', 'All rooms are non-smoking. Smoking is permitted in designated outdoor areas only.'),
    (NEW.id, 'policy', 'Cancellations made 48 hours or more before check-in receive a full refund. Cancellations within 48 hours forfeit the first night.'),
    (NEW.id, 'policy', 'Pets are not permitted unless prior written approval has been obtained.'),
    (NEW.id, 'faq',    'Wi-Fi is complimentary throughout the property. The network name and password are provided at check-in.'),
    (NEW.id, 'faq',    'The front desk is staffed 24 hours a day, 7 days a week.'),
    (NEW.id, 'faq',    'Breakfast is not included in the room rate unless stated otherwise at the time of booking.'),
    (NEW.id, 'amenity', 'The hotel offers a concierge service for local recommendations, transportation, and booking assistance.');

  -- Seed one default room skeleton so the agent has something to reference
  INSERT INTO public.rooms (hotel_id, name, room_type, description, sort_order) VALUES
    (NEW.id, 'Standard Room', 'standard', 'A comfortable standard room. Update this description with your room details.', 1);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_hotel_created_seed_defaults
  AFTER INSERT ON public.hotels
  FOR EACH ROW EXECUTE PROCEDURE public.seed_hotel_defaults();
```

**Warning:** The trigger uses `SECURITY DEFINER` because `hotel_facts` and `rooms` RLS policies require an authenticated JWT with `hotel_id` claim — but the trigger runs in the context of the `auth.users` INSERT chain where no user session exists yet. `SECURITY DEFINER` grants the function the privileges of the function owner (postgres role), bypassing RLS for the INSERT. This is safe because the function only inserts rows with the newly created `hotel_id`.

### Pattern 3: Knowledge Base CRUD with Server Actions

**What:** Server Actions handle all mutations (add/update/delete) to the knowledge base. Server Components read the data. Client Components manage form state for the add/edit dialog.

**When to use:** All knowledge base CRUD operations from the dashboard.

```typescript
// src/lib/actions/knowledge.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { factSchema, roomSchema } from '@/lib/validations/knowledge'

export async function addFact(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const parsed = factSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.format() }

  // RLS enforces hotel_id scoping — must include hotel_id in insert
  const hotelId = await getHotelId(supabase)

  // Cast pattern established in Phase 2 memory.ts
  const { error } = await (supabase as unknown as import('@supabase/supabase-js').SupabaseClient)
    .from('hotel_facts')
    .insert({
      hotel_id: hotelId,
      category: parsed.data.category,
      fact: parsed.data.fact,
    } as Record<string, unknown>)

  if (error) return { error: error.message }

  revalidatePath('/knowledge')  // Refresh the Server Component data
  return { success: true }
}

export async function updateFact(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const parsed = factSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.format() }

  // RLS USING clause enforces this only updates rows for the authenticated hotel
  const { error } = await supabase
    .from('hotel_facts')
    .update({ category: parsed.data.category, fact: parsed.data.fact })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/knowledge')
  return { success: true }
}

export async function deleteFact(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // RLS USING clause enforces tenant isolation on DELETE
  const { error } = await supabase
    .from('hotel_facts')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/knowledge')
  return { success: true }
}
```

```typescript
// src/lib/validations/knowledge.ts
import { z } from 'zod'

export const FACT_CATEGORIES = ['policy', 'faq', 'amenity', 'pricing_note', 'recommendation'] as const
export type FactCategory = typeof FACT_CATEGORIES[number]

export const factSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  fact: z.string().min(5, 'Fact must be at least 5 characters').max(500, 'Fact must be under 500 characters'),
})

export const roomSchema = z.object({
  name: z.string().min(2, 'Room name required').max(100),
  room_type: z.string().min(1, 'Room type required'),
  bed_type: z.string().optional(),
  max_occupancy: z.coerce.number().int().min(1).max(20).optional(),
  description: z.string().max(1000).optional(),
  base_price_note: z.string().max(100).optional(),
})
```

### Pattern 4: Knowledge Base Dashboard Page

**What:** A tabbed Server Component page at `/knowledge` that loads all knowledge base data and renders a Client Component for interactive CRUD.

**Structure:**
```tsx
// src/app/(dashboard)/knowledge/page.tsx (Server Component)
import { createClient } from '@/lib/supabase/server'
import { KnowledgeBaseEditor } from '@/components/knowledge/KnowledgeBaseEditor'
import type { HotelFact } from '@/types/database'

export default async function KnowledgePage() {
  const supabase = await createClient()

  const [factsResult, roomsResult] = await Promise.all([
    supabase.from('hotel_facts').select('*').order('category').returns<HotelFact[]>(),
    supabase.from('rooms').select('*').order('sort_order').returns<Room[]>(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-muted-foreground mt-1">
          This information is used by all AI employees to answer guest questions.
        </p>
      </div>
      <KnowledgeBaseEditor
        facts={factsResult.data ?? []}
        rooms={roomsResult.data ?? []}
      />
    </div>
  )
}
```

```tsx
// src/components/knowledge/KnowledgeBaseEditor.tsx (Client Component)
'use client'
// Renders Tabs (Policies / FAQs / Rooms / Recommendations / Amenities)
// Each tab has a FactList or RoomList + "Add" button that opens a Dialog with FactForm/RoomForm
// Mutations call Server Actions; revalidatePath refreshes Server Component data
```

### Pattern 5: Onboarding Wizard

**What:** A 2-step in-memory wizard Client Component that collects hotel name (pre-filled), city, and contact info, then redirects to `/desk` for first AI interaction. Minimal friction to achieve ONBR-01 (under 5 minutes).

**Step design:**
- Step 0 (Welcome): Explains what OtelAI does, shows hotel name (pre-filled from signup), asks to confirm or update
- Step 1 (Hotel Details): City, country, timezone, contact email/phone
- Step 2 (Done): "Your AI staff is ready" — redirect to `/desk`

**State management:** `useState` with a step index — no URL params needed (wizard is a one-time flow, not bookmarkable).

**Key insight from research:** The fastest path to first AI value is not exhaustive setup — it is getting the user to the chat interface with defaults in place. The AI can ask for missing info during the first conversation (ONBR-03).

```tsx
// src/app/(dashboard)/onboarding/page.tsx (Server Component shell)
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OnboardingWizard } from '@/components/knowledge/OnboardingWizard'
import type { Hotel } from '@/types/database'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Check if onboarding already completed — redirect if so
  const { data: hotel } = await supabase
    .from('hotels')
    .select('*')
    .single<Hotel>()

  // Consider onboarding complete if city is set
  if (hotel?.city) redirect('/')

  return <OnboardingWizard hotel={hotel} />
}
```

```tsx
// src/components/knowledge/OnboardingWizard.tsx (Client Component)
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
// Step 0: hotel name confirm (1 field)
// Step 1: city, country, timezone, contact (4 fields + timezone picker)
// Each step calls a Server Action on submit, then increments step
// Step 2: auto-redirect to /desk

export function OnboardingWizard({ hotel }: { hotel: Hotel | null }) {
  const [step, setStep] = useState(0)
  const router = useRouter()

  const totalSteps = 2  // 0-indexed; step 2 is the completion/redirect

  // Progress indicator: (step / totalSteps) * 100
  // ...
}
```

### Pattern 6: Progressive Onboarding — Agent Asks for Missing Info (ONBR-03)

**What:** A behavioral instruction added to the Front Desk agent's Layer 4 (instructions) in `agentFactory.ts`. If hotel data is sparse (city is empty, rooms have placeholder descriptions), the agent proactively asks the owner to provide that information during their first "shift."

**Implementation:** The `assembleContext.ts` already injects hotel data (Layer 2) and semantic facts (Layer 3). The agent can detect sparse data from the system prompt and ask follow-up questions. A new tool `update_hotel_info` allows the agent to persist owner-provided info back to the DB.

```typescript
// Added to agentFactory.ts FRONT_DESK config promptTemplate.behavioral:
const PROGRESSIVE_ONBOARDING_INSTRUCTION = `
If the hotel's city or country is not set in your context, ask the owner for this information.
If no room information is available, ask what room types the hotel offers.
When the owner provides hotel information in conversation, use the update_hotel_info tool
to save it immediately so it is available in future sessions.
Do not repeat these questions if you have already asked them in this conversation.
`
```

**Tool for persisting info:**
```typescript
// src/lib/agents/tools/registry.ts — add update_hotel_info tool
{
  name: 'update_hotel_info',
  description: 'Save hotel information provided by the owner during conversation. Use this when the owner tells you their city, contact details, or other hotel facts.',
  input_schema: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        enum: ['city', 'country', 'contact_email', 'contact_phone', 'address'],
        description: 'Which field to update'
      },
      value: {
        type: 'string',
        description: 'The new value for the field'
      }
    },
    required: ['field', 'value']
  }
}
```

### Pattern 7: Multi-Language Support via Claude Native Multilingual (KNOW-05)

**What:** Rather than storing translated content, rely on Claude's native multilingual capability. When a guest interacts in a non-English language, Claude automatically responds in that language using the English source content in the knowledge base as context.

**Why this works:** Claude official docs confirm performance relative to English:
- Spanish: 98.1%, French: 97.9%, German: 97.7%, Arabic: 97.1%, Chinese: 97.1%, Japanese: 96.9%, Korean: 96.6%

**System prompt instruction (Layer 4 of assembleContext.ts):**
```typescript
const MULTILINGUAL_INSTRUCTION = `
Detect the language of the guest's message and respond in the same language.
Use the knowledge base information (written in English) to construct your response,
but communicate that information naturally in the guest's language.
Do not state that you are translating — simply respond naturally.
If you are uncertain about the language, respond in English.
`
```

**When to degrade to Pattern (a) — JSONB translations:**
Only if the hotel owner explicitly needs to author content in multiple languages (e.g., they want to provide Turkish-specific custom policies vs English-specific ones). That use case is DEFERRED — it is not in the Phase 3 requirements.

### Anti-Patterns to Avoid

- **Using `hotel_facts` `fact TEXT` for structured room data:** Room information (bed count, occupancy, pricing) benefits from typed columns so the dashboard can render proper form fields and the agent can cite structured data. Use the `rooms` table for KNOW-02.
- **Storing translations in JSONB for MVP:** Adds schema complexity, requires translation authoring UI, and doubles content management burden — Claude's native multilingual handles this without any schema change.
- **Using `useSearchParams` for onboarding wizard steps:** Dashboard routes are dynamically rendered (they require auth), so `useSearchParams` requires a `Suspense` boundary. `useState` is simpler and sufficient for a one-time, non-bookmarkable flow.
- **Seeding defaults in a Server Action at signup time:** A race condition exists between the signup response and the redirect — the user may land on the dashboard before the Server Action has completed. Use a Postgres trigger on `hotels` INSERT which is atomic with the `handle_new_user` trigger.
- **Calling `revalidatePath` inside a Server Action and expecting immediate UI update without router.refresh():** `revalidatePath` marks the cache as stale. The Server Component re-renders on the next navigation. If a Client Component needs to see the update immediately, call `router.refresh()` after the Server Action resolves.
- **Editing `hotel_facts` directly from the agent via tool without RLS bypass:** Agent runs from a Route Handler with the user's session cookie — RLS is enforced via the anon key + JWT. The `update_hotel_info` tool uses the server client (same as memory.ts helpers) and is safe. Do NOT use service_role client in tools.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-language translation UI | Custom language picker + content duplication UI | Claude native multilingual (Pattern 7) | Claude 96-98% English performance in major languages; zero schema change; owner never needs to author in multiple languages |
| CRUD list with sort/filter/pagination | TanStack Table | Simple `<ul>` with map() | Hotel knowledge base has tens of items max; TanStack Table complexity is not justified |
| Step wizard with URL state | `useSearchParams` + router.push | `useState` step index | One-time flow; URL state adds Suspense boundary complexity with no user benefit |
| Form dialog with Portal | Raw `<dialog>` HTML element | `shadcn/ui Dialog` | Handles focus trap, outside-click dismissal, keyboard Escape, accessibility — all edge cases |
| Default hotel data | Seed file run manually | Postgres trigger on `hotels` INSERT | Trigger is atomic, automatic, and correctly scoped to the new hotel's UUID; manual seed would require service_role API call post-signup |
| Knowledge base → Agent context pipe | Custom mapping layer | Extend `loadSemanticFacts()` to also load rooms | `assembleContext.ts` already calls `loadSemanticFacts()` — rooms can be formatted as facts and injected at Layer 3 |

**Key insight:** The most valuable existing asset is `loadSemanticFacts()` in `memory.ts`. Rooms and recommendations should be formatted and injected through this same pipeline — the agent context assembly does not need to change. Only the data loading needs to be extended.

---

## Common Pitfalls

### Pitfall 1: Seed Trigger Fires Before Phase 2 Tables Exist
**What goes wrong:** The `seed_hotel_defaults()` trigger inserts into `hotel_facts` and `rooms`. If migration `0003_knowledge_base.sql` runs but `hotel_facts` (from `0002_agent_core.sql`) has not been applied, the trigger function will error on the first signup.
**Why it happens:** Migration order matters; trigger functions reference tables by name and fail at runtime if the table doesn't exist.
**How to avoid:** Verify migrations are applied in numeric order (0001 → 0002 → 0003) in a local Supabase environment before deploying. Add a comment in `0003_knowledge_base.sql` noting the dependency on `0002_agent_core.sql`.
**Warning signs:** New user signup fails with `relation "hotel_facts" does not exist` in Supabase function logs.

### Pitfall 2: `revalidatePath` Not Refreshing Data in Client Component
**What goes wrong:** After a Server Action deletes or adds a fact, the UI still shows the old data. The Server Component re-renders on next full navigation, not immediately.
**Why it happens:** `revalidatePath` invalidates the Next.js cache, but the current page render is complete. A Client Component that received data as props will not automatically re-fetch.
**How to avoid:** After calling a Server Action in a Client Component, call `router.refresh()` to trigger a re-render of the Server Component tree. The `useRouter` hook from `next/navigation` provides `refresh()`.
**Warning signs:** Deleted item still appears in list after successful Server Action; page refresh fixes it.

### Pitfall 3: Onboarding Wizard Shown to Returning Users
**What goes wrong:** A returning hotel owner who has already completed onboarding is redirected to `/onboarding` on every login.
**Why it happens:** The onboarding completion check is too strict — if the check fails (e.g., network error, RLS issue), the user is stuck.
**How to avoid:** Use a simple, unlikely-to-be-null field as the completion gate (city is a good choice — users must set it in Step 1). Ensure the redirect logic has a fallback: if the hotel query itself errors, redirect to dashboard (not onboarding) to prevent lock-out. Also add a "Skip for now" link in the wizard.
**Warning signs:** Users report being redirected to onboarding after already completing setup.

### Pitfall 4: Rooms Not Included in Agent Context
**What goes wrong:** The agent does not know about room types and cannot answer "What rooms do you have?" correctly.
**Why it happens:** `loadSemanticFacts()` only queries `hotel_facts`. The new `rooms` table is not read anywhere in the agent pipeline.
**How to avoid:** Extend `loadSemanticFacts()` (or create a parallel `loadRoomContext()` called alongside it in `assembleContext.ts`) to format rooms as text and include them in the `<memory>` layer. Rooms should be formatted as descriptive facts: `"ROOM: Deluxe Ocean View — King bed, 2 guests max, from $180/night. Ocean-facing balcony, rainfall shower, minibar."`.
**Warning signs:** Agent says "I don't have information about room types" when rooms table has data.

### Pitfall 5: Insert Into `hotel_facts` Without `hotel_id` When Using RLS
**What goes wrong:** Server Action inserts a fact but the RLS `WITH CHECK` policy rejects the insert because `hotel_id` in the inserted row does not match the JWT claim.
**Why it happens:** The insert payload omits `hotel_id` or uses a hardcoded/incorrect value. RLS `WITH CHECK` verifies `hotel_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid`.
**How to avoid:** Always fetch `hotel_id` from the Supabase session in the Server Action and include it explicitly in the insert payload. Do not rely on a default value — the `hotel_facts` table has no default for `hotel_id`.
**Warning signs:** `new row violates row-level security policy` error in Server Action response.

### Pitfall 6: Tabs State Lost on Server Action Completion
**What goes wrong:** User is on the "Rooms" tab, adds a room, Server Action completes + `router.refresh()` is called, and the page re-renders on the default "Policies" tab.
**Why it happens:** `router.refresh()` re-renders Server Components but does not preserve Client Component state. The `KnowledgeBaseEditor` component remounts on the "Policies" tab (default tab index 0).
**How to avoid:** Store the active tab in URL search params (`?tab=rooms`) — when `router.refresh()` re-renders the page, `useSearchParams` restores the tab. Since the `/knowledge` page is dynamic (requires auth), `useSearchParams` does not require a Suspense boundary (see Next.js docs: static rendering is the only case requiring Suspense).
**Warning signs:** Tab selection resets to "Policies" after every add/delete action.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Rooms Data Formatted for Agent Context
```typescript
// Extension to src/lib/agents/memory.ts

export async function loadRoomContext(hotelId: string): Promise<string> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('sort_order')
    .returns<Room[]>()

  if (error || !data || data.length === 0) return ''

  const lines = data.map((room) => {
    const parts = [`ROOM: ${room.name} (${room.room_type})`]
    if (room.bed_type) parts.push(`${room.bed_type} bed`)
    if (room.max_occupancy) parts.push(`max ${room.max_occupancy} guests`)
    if (room.base_price_note) parts.push(room.base_price_note)
    const header = parts.join(' — ')
    const details = [room.description, room.amenities?.join(', ')].filter(Boolean).join('. ')
    return details ? `${header}. ${details}` : header
  })

  return lines.join('\n')
}
```

Then in `assembleContext.ts`, extend the parallel fetch:
```typescript
// Replace loadSemanticFacts call with both:
const [hotel, semanticFacts, roomContext, episodicHistory] = await Promise.all([
  fetchHotel(hotelId),
  loadSemanticFacts(hotelId),
  loadRoomContext(hotelId),  // NEW
  loadEpisodicHistory(hotelId, config.memoryScope),
])

// In the memory layer:
if (roomContext.trim()) {
  memoryParts.push(`Room Information:\n${roomContext}`)
}
```

### CRUD Server Action with `revalidatePath` + Client `router.refresh()`
```typescript
// Server Action (src/lib/actions/knowledge.ts)
'use server'
export async function deleteFact(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await supabase.from('hotel_facts').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/knowledge')
  return { success: true }
}

// Client Component usage
'use client'
import { useRouter } from 'next/navigation'
import { deleteFact } from '@/lib/actions/knowledge'

function DeleteButton({ factId }: { factId: string }) {
  const router = useRouter()

  async function handleDelete() {
    const result = await deleteFact(factId)
    if (result.success) {
      router.refresh()  // Triggers Server Component re-render with fresh data
    }
  }

  return <button onClick={handleDelete}>Delete</button>
}
```

### Onboarding Wizard Step Management
```typescript
// Source: makerkit.dev multi-step form pattern + Next.js official docs
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const WIZARD_STEPS = ['welcome', 'details', 'complete'] as const
type WizardStep = typeof WIZARD_STEPS[number]

export function OnboardingWizard({ hotel }: { hotel: Hotel | null }) {
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  const progress = Math.round((currentStep / (WIZARD_STEPS.length - 1)) * 100)

  async function handleStepSubmit(formData: FormData) {
    setIsSubmitting(true)
    const result = await updateHotelSettings(formData)  // Existing Server Action
    setIsSubmitting(false)

    if (result.success) {
      if (currentStep < WIZARD_STEPS.length - 2) {
        setCurrentStep(prev => prev + 1)
      } else {
        router.push('/desk')  // Final step — go to AI chat
      }
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Progress indicator */}
      <Progress value={progress} className="h-2" />
      <p className="text-sm text-muted-foreground">
        Step {currentStep + 1} of {WIZARD_STEPS.length - 1}
      </p>

      {/* Step content */}
      {currentStep === 0 && <WelcomeStep hotel={hotel} onNext={() => setCurrentStep(1)} />}
      {currentStep === 1 && <DetailsStep hotel={hotel} onSubmit={handleStepSubmit} isSubmitting={isSubmitting} />}
    </div>
  )
}
```

### Tabs with URL State for Active Tab Persistence
```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/use-search-params
// Preserves tab selection across router.refresh() calls

'use client'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export function KnowledgeBaseEditor({ facts, rooms }: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeTab = searchParams.get('tab') ?? 'policies'

  function handleTabChange(tab: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.push(pathname + '?' + params.toString())
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="policies">Policies</TabsTrigger>
        <TabsTrigger value="faqs">FAQs</TabsTrigger>
        <TabsTrigger value="rooms">Rooms</TabsTrigger>
        <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        <TabsTrigger value="amenities">Amenities</TabsTrigger>
      </TabsList>
      {/* Tab content... */}
    </Tabs>
  )
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate translation tables (Globalize pattern) | JSONB `translations` column OR LLM auto-translate | 2024-2025 with LLM maturity | For AI applications, LLM auto-translate is zero-overhead and equal quality |
| Multi-step form with React Router route-per-step | Single-component useState step management | 2023+ (React 18, Next.js App Router) | Simpler state, no route changes, form data preserved in memory |
| Manual seed data via SQL script | Postgres trigger on INSERT | Long-standing pattern; codified by Supabase patterns | Seed is atomic, automatic, scoped to the tenant — no manual steps |
| Page-level knowledge base (single textarea) | Structured categories with typed schema | SaaS industry norm 2022+ | Structured data enables smarter agent queries and clearer owner UX |
| `router.push()` for all updates | `router.refresh()` for data refresh without navigation | Next.js App Router since v13 | Refreshes Server Components without changing URL or scroll position |

**Deprecated/outdated:**
- Separate translation tables (Globalize3 pattern): Unnecessary complexity when the AI handles language detection and response natively
- `next/router` from Pages Router: This project uses App Router; always import from `next/navigation`
- Server Actions called from `useEffect`: Server Actions must be called from event handlers or form actions, not effects

---

## Open Questions

1. **Onboarding redirect detection: should it use `city` or a dedicated `onboarding_completed_at` column?**
   - What we know: Using `city IS NULL` as the gate is simple but could accidentally re-trigger onboarding if the user clears their city
   - What's unclear: Whether a dedicated `onboarding_completed_at TIMESTAMPTZ` column on `hotels` is cleaner
   - Recommendation: Use `onboarding_completed_at` column — clearer semantics, immune to data edge cases, easy to add in `0003_knowledge_base.sql` and set in the wizard completion Server Action

2. **Should room context be formatted as `hotel_facts` text or passed as a structured JSON block in the system prompt?**
   - What we know: Current `<memory>` layer uses plain text; XML-tagged sections are recommended by Anthropic
   - What's unclear: Whether structured JSON room data inside the memory XML block would improve agent tool calls that reference rooms
   - Recommendation: Use plain formatted text for Phase 3 (matching the existing pattern); add a dedicated `<rooms>` XML tag within the memory layer for clarity; migrate to JSON later if agent room queries prove unreliable

3. **Should `update_hotel_info` tool use the service_role client or user session?**
   - What we know: The decision from Phase 2 is "No service_role client in memory helpers — all queries respect RLS via anon key + session cookie"; the tool runs from a Route Handler that has the user's session
   - What's unclear: Nothing — the tool should follow the established pattern and use `createClient()` (server client with cookie). RLS `WITH CHECK` will enforce hotel scoping.
   - Recommendation: Use `createClient()` — same as all other agent tools. This is consistent with the established constraint.

4. **What is the onboarding entry point — auto-redirect from dashboard or a link?**
   - What we know: The Phase 1 signup creates a hotel with only `name` and `timezone = 'UTC'`; city is NULL after signup
   - What's unclear: Whether the dashboard layout should auto-redirect to `/onboarding` if `city IS NULL`, or whether onboarding is opt-in via a banner
   - Recommendation: Auto-redirect in the dashboard layout check is cleanest for new users; add a `Skip` button and never redirect again once skipped (set `onboarding_completed_at`)

---

## Sources

### Primary (HIGH confidence)
- Anthropic Multilingual Support Docs — `https://platform.claude.com/docs/en/build-with-claude/multilingual-support` — verified Claude language performance percentages; best practices for multilingual prompting
- Next.js `useSearchParams` official docs — `https://nextjs.org/docs/app/api-reference/functions/use-search-params` (version 16.1.6, updated 2026-02-27) — Suspense boundary requirements, URL params update pattern, static vs dynamic rendering behavior
- Existing codebase: `src/lib/agents/memory.ts`, `src/lib/agents/assembleContext.ts` — verified how hotel_facts are loaded and injected into agent system prompt (directly applicable to KNOW-04)
- Existing codebase: `supabase/migrations/0001_foundation.sql` — verified `handle_new_user` trigger pattern for seeding on INSERT; `SECURITY DEFINER` usage
- Existing codebase: `supabase/migrations/0002_agent_core.sql` — verified `hotel_facts` schema, RLS policy pattern, `set_updated_at()` trigger reuse
- Existing codebase: `src/app/(dashboard)/settings/actions.ts` — verified Server Action pattern with `revalidatePath` for hotel mutations
- Supabase Postgres Triggers official docs — trigger creation syntax, `AFTER INSERT`, `for each row`, `language plpgsql` pattern

### Secondary (MEDIUM confidence)
- Makerkit multi-step form guide (updated February 2026) — `https://makerkit.dev/blog/tutorials/multi-step-forms-reactjs` — confirmed React Context + useState step management pattern; no URL approach
- Makerkit Next.js + Supabase kit multi-step form docs — `https://makerkit.dev/docs/next-supabase-turbo/components/multi-step-forms` — confirmed `nextStep()` / `prevStep()` / `currentStepIndex` context hook pattern
- ClarityDev multi-step form with React Hook Form — `https://claritydev.net/blog/build-a-multistep-form-with-react-hook-form` — confirmed per-step validation pattern with `mode: "onSubmit"`
- PostgreSQL JSONB i18n pattern — multiple sources (GitHub: olegantonyan/translateable, json_translate, walczak.it) — confirmed JSONB `{"en": "...", "fr": "..."}` pattern as viable alternative (deferred)

### Tertiary (LOW confidence — flag for validation)
- SaaS onboarding "under 5 minutes" benchmark — `https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist`, `https://formbricks.com/blog/user-onboarding-best-practices` — industry pattern confirming minimal setup + pre-populated defaults as the path to fast time-to-value; specific metrics are industry guidance not scientific measures

---

## Metadata

**Confidence breakdown:**
- Schema design (KNOW-01, KNOW-02, KNOW-03, KNOW-04): HIGH — `hotel_facts` verified in codebase; `rooms` table design follows established RLS + trigger pattern
- Default data seeding (ONBR-04): HIGH — Postgres trigger pattern verified in codebase (`handle_new_user`); same SECURITY DEFINER pattern applies
- Multi-language via Claude (KNOW-05): HIGH — performance percentages from official Anthropic docs; confirmed Claude auto-translates in guest language with English source
- Onboarding wizard UI (ONBR-01, ONBR-02): HIGH — useState step pattern confirmed by multiple sources; Next.js searchParams pattern confirmed by official docs
- Progressive onboarding via agent behavioral instruction (ONBR-03): MEDIUM — pattern is sound but the `update_hotel_info` tool is a new tool not yet implemented; tool executor extension is straightforward

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (30 days; Supabase RLS and Next.js App Router patterns are stable; Anthropic multilingual performance data may update with new models)
