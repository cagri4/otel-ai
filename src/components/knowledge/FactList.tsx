'use client'

/**
 * FactList — Reusable list of hotel facts for a given category.
 *
 * Renders each fact as a card with edit and delete buttons.
 * Delete calls the deleteFact Server Action then router.refresh().
 * Edit opens the FactForm dialog in edit mode.
 *
 * Source: 03-02-PLAN.md Task 2
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FactForm } from '@/components/knowledge/FactForm'
import { deleteFact } from '@/lib/actions/knowledge'
import type { HotelFact, HotelFactCategory } from '@/types/database'

interface FactListProps {
  facts: HotelFact[]
  category: HotelFactCategory
}

const CATEGORY_LABELS: Record<HotelFactCategory, string> = {
  policy: 'policy',
  faq: 'FAQ',
  amenity: 'amenity',
  pricing_note: 'pricing note',
  recommendation: 'local tip',
}

export function FactList({ facts, category }: FactListProps) {
  const router = useRouter()
  const [editFact, setEditFact] = useState<HotelFact | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(fact: HotelFact) {
    const confirmed = window.confirm(
      `Delete this ${CATEGORY_LABELS[category]}? This cannot be undone.`,
    )
    if (!confirmed) return

    setDeletingId(fact.id)
    try {
      const result = await deleteFact(fact.id)
      if (result.error) {
        alert(`Failed to delete: ${result.error}`)
      } else {
        router.refresh()
      }
    } finally {
      setDeletingId(null)
    }
  }

  if (facts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No {CATEGORY_LABELS[category]} entries yet. Use the Add button to create your first one.
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {facts.map((fact) => (
          <Card key={fact.id}>
            <CardContent className="py-4 px-4 flex items-start justify-between gap-3">
              <p className="text-sm flex-1">{fact.fact}</p>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setEditFact(fact)}
                  aria-label="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(fact)}
                  disabled={deletingId === fact.id}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit dialog */}
      {editFact && (
        <FactForm
          category={category}
          fact={editFact}
          open={!!editFact}
          onOpenChange={(open) => {
            if (!open) setEditFact(null)
          }}
        />
      )}
    </>
  )
}
