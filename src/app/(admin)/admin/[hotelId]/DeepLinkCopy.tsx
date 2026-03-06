'use client'

/**
 * DeepLinkCopy — Client Component for copying the Setup Wizard deep link.
 *
 * Displays the full deep link URL and a "Copy" button that uses
 * navigator.clipboard.writeText().
 *
 * Source: .planning/phases/10-super-admin-panel-and-employee-bots/10-02-PLAN.md
 */

import { useState } from 'react'

export function DeepLinkCopy({ deepLink }: { deepLink: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(deepLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text manually
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        readOnly
        value={deepLink}
        className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted font-mono text-muted-foreground"
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
