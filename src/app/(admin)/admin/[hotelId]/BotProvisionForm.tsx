'use client'

/**
 * BotProvisionForm — Client Component for bot provisioning.
 *
 * Renders 4 text inputs (one per role) and calls the provisionAllBots Server Action
 * on submit. Displays per-role results: green checkmark + @username on success,
 * red error on failure. Tokens are cleared after submission.
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-02-PLAN.md
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { provisionAllBots } from '@/lib/admin/provisionBots'

type BotStatus = {
  role: string
  bot_username: string | null
}

type ProvisionResult =
  | { success: true; botUsername: string }
  | { error: string }

const ROLES: { key: string; label: string }[] = [
  { key: 'front_desk', label: 'Front Desk Token' },
  { key: 'booking_ai', label: 'Booking AI Token' },
  { key: 'guest_experience', label: 'Guest Experience Token' },
  { key: 'housekeeping_coordinator', label: 'Housekeeping Token' },
]

export function BotProvisionForm({
  hotelId,
  existingBots,
}: {
  hotelId: string
  existingBots: BotStatus[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Token inputs — one per role
  const [tokens, setTokens] = useState<Record<string, string>>({
    front_desk: '',
    booking_ai: '',
    guest_experience: '',
    housekeeping_coordinator: '',
  })

  // Per-role provisioning results
  const [results, setResults] = useState<Record<string, ProvisionResult>>({})

  // Overall form error
  const [formError, setFormError] = useState<string | null>(null)

  function getExistingBot(role: string): BotStatus | undefined {
    return existingBots.find((b) => b.role === role)
  }

  function handleTokenChange(role: string, value: string) {
    setTokens((prev) => ({ ...prev, [role]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setResults({})

    // Only submit non-empty tokens
    const nonEmptyTokens = Object.fromEntries(
      Object.entries(tokens).filter(([, v]) => v.trim().length > 0),
    )

    if (Object.keys(nonEmptyTokens).length === 0) {
      setFormError('Paste at least one BotFather token to provision.')
      return
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin

    startTransition(async () => {
      try {
        const response = await provisionAllBots({
          hotelId,
          tokens: nonEmptyTokens,
          appUrl,
        })

        setResults(response.results)

        // Clear token inputs — NEVER redisplay bot tokens after save
        setTokens({
          front_desk: '',
          booking_ai: '',
          guest_experience: '',
          housekeeping_coordinator: '',
        })

        // Refresh server-rendered bot status table
        router.refresh()
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Provisioning failed'
        setFormError(message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {formError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      {ROLES.map(({ key, label }) => {
        const existing = getExistingBot(key)
        const result = results[key]

        return (
          <div key={key}>
            <label className="block text-sm font-medium mb-1">{label}</label>

            {existing?.bot_username && (
              <p className="text-xs text-muted-foreground mb-1">
                Currently:{' '}
                <span className="font-mono">@{existing.bot_username}</span>
              </p>
            )}

            <input
              type="text"
              value={tokens[key]}
              onChange={(e) => handleTokenChange(key, e.target.value)}
              placeholder="Paste BotFather token to (re)provision"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              disabled={isPending}
            />

            {/* Per-role result */}
            {result && (
              <p
                className={`text-xs mt-1 ${
                  'success' in result ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {'success' in result ? (
                  <>
                    <span className="mr-1">&#10003;</span>@{result.botUsername}
                  </>
                ) : (
                  result.error
                )}
              </p>
            )}
          </div>
        )
      })}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? 'Provisioning...' : 'Provision Bots'}
      </button>
    </form>
  )
}
