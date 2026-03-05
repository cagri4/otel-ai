'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'

/**
 * LocaleSwitcher — toggles between EN and TR by setting the NEXT_LOCALE cookie.
 *
 * Implementation notes:
 * - Uses cookie-based locale (NEXT_LOCALE) without URL routing
 * - router.refresh() causes Server Components to re-render with new locale
 * - Cookie max-age: 1 year (31536000 seconds)
 */
export function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()

  const nextLocale = locale === 'en' ? 'tr' : 'en'
  const label = locale === 'en' ? 'TR' : 'EN'

  const handleSwitch = () => {
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`
    router.refresh()
  }

  return (
    <button
      onClick={handleSwitch}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      title={`Switch to ${nextLocale === 'en' ? 'English' : 'Turkish'}`}
      aria-label={`Switch language to ${nextLocale === 'en' ? 'English' : 'Turkish'}`}
    >
      <Globe className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
