/**
 * Hotel detail page for the admin panel.
 *
 * Server Component — loads hotel data and existing bot status server-side.
 * Renders:
 *   1. Back link + hotel info header
 *   2. Existing bot status table (role, username, active, created)
 *   3. BotProvisionForm (Client Component) — 4-field form calling provisionAllBots
 *   4. Setup Wizard deep link with copy button (when SETUP_WIZARD_BOT_USERNAME is set)
 *
 * Bot tokens are NEVER redisplayed — only bot_username shown as confirmation.
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-02-PLAN.md
 */
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BotProvisionForm } from './BotProvisionForm'
import { DeepLinkCopy } from './DeepLinkCopy'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type HotelDetail = {
  id: string
  name: string
  city: string | null
  country: string | null
  created_at: string
  onboarding_completed_at: string | null
}

type BotRow = {
  id: string
  role: string
  bot_username: string | null
  is_active: boolean
  created_at: string
}

const ROLE_LABELS: Record<string, string> = {
  front_desk: 'Front Desk',
  booking_ai: 'Booking AI',
  guest_experience: 'Guest Experience',
  housekeeping_coordinator: 'Housekeeping',
}

const ALL_ROLES = [
  'front_desk',
  'booking_ai',
  'guest_experience',
  'housekeeping_coordinator',
]

// ─────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────

export default async function HotelDetailPage({
  params,
}: {
  params: Promise<{ hotelId: string }>
}) {
  const { hotelId } = await params
  const supabase = createServiceClient()

  // Load hotel by ID — service client bypasses RLS
  const { data: hotel } = await (supabase as unknown as SupabaseClient)
    .from('hotels')
    .select('id, name, city, country, created_at, onboarding_completed_at')
    .eq('id', hotelId)
    .single()

  if (!hotel) {
    notFound()
  }

  const typedHotel = hotel as HotelDetail

  // Load existing bots for this hotel
  const { data: bots } = await (supabase as unknown as SupabaseClient)
    .from('hotel_bots')
    .select('id, role, bot_username, is_active, created_at')
    .eq('hotel_id', hotelId)

  const existingBots = (bots as BotRow[] | null) ?? []

  // Setup Wizard deep link
  const setupWizardUsername = process.env.SETUP_WIZARD_BOT_USERNAME
  const deepLink = setupWizardUsername
    ? `https://t.me/${setupWizardUsername}?start=${hotelId}`
    : null

  const createdAt = new Date(typedHotel.created_at).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="space-y-8">
      {/* Back link */}
      <div>
        <a
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to all hotels
        </a>
      </div>

      {/* Hotel info header */}
      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-2xl font-bold">{typedHotel.name}</h1>
        <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Location: </span>
            {typedHotel.city && typedHotel.country
              ? `${typedHotel.city}, ${typedHotel.country}`
              : typedHotel.city || typedHotel.country || 'Not set'}
          </div>
          <div>
            <span className="text-muted-foreground">Created: </span>
            {createdAt}
          </div>
          <div>
            <span className="text-muted-foreground">Hotel ID: </span>
            <span className="font-mono text-xs">{typedHotel.id}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Onboarding: </span>
            {typedHotel.onboarding_completed_at ? (
              <span className="text-green-600">Complete</span>
            ) : (
              <span className="text-yellow-600">Pending</span>
            )}
          </div>
        </div>
      </div>

      {/* Bot status table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Bot Status</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {existingBots.length} of {ALL_ROLES.length} bots provisioned
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Role
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Bot Username
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Provisioned
              </th>
            </tr>
          </thead>
          <tbody>
            {ALL_ROLES.map((role) => {
              const bot = existingBots.find((b) => b.role === role)
              return (
                <tr key={role} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {ROLE_LABELS[role] ?? role}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">
                    {bot?.bot_username ? (
                      <span className="text-foreground">
                        @{bot.bot_username}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {bot ? (
                      bot.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          Inactive
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        Not provisioned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {bot?.created_at
                      ? new Date(bot.created_at).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Bot provisioning form */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">Provision Bots</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Paste BotFather tokens to provision or re-provision bots. Leave a
          field empty to skip that role. Tokens are never stored in plain text
          after save.
        </p>
        <BotProvisionForm
          hotelId={typedHotel.id}
          existingBots={existingBots.map((b) => ({
            role: b.role,
            bot_username: b.bot_username,
          }))}
        />
      </div>

      {/* Setup Wizard deep link */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">Setup Wizard Deep Link</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Share this link with the hotel owner to start the Telegram onboarding
          wizard.
        </p>
        {deepLink ? (
          <DeepLinkCopy deepLink={deepLink} />
        ) : (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
            Set the{' '}
            <code className="font-mono text-xs bg-yellow-100 px-1 rounded">
              SETUP_WIZARD_BOT_USERNAME
            </code>{' '}
            environment variable to enable deep link generation.
          </div>
        )}
      </div>
    </div>
  )
}
