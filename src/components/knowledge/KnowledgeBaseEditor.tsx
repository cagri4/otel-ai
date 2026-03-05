'use client'

/**
 * KnowledgeBaseEditor — Main tabbed editor for the knowledge base.
 *
 * Client Component that receives facts and rooms as props from the
 * /knowledge Server Component page.
 *
 * Tab state is persisted in the URL via ?tab= search param so that
 * active tab is preserved after CRUD operations trigger router.refresh().
 * (research Pitfall 6 fix — see 03-RESEARCH.md)
 *
 * Tabs:
 * - policies: policy facts
 * - faqs: faq facts
 * - rooms: structured room inventory
 * - recommendations: recommendation facts
 * - amenities: amenity facts
 *
 * Source: 03-02-PLAN.md Task 2
 */

import { useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FactList } from '@/components/knowledge/FactList'
import { FactForm } from '@/components/knowledge/FactForm'
import { RoomList } from '@/components/knowledge/RoomList'
import { RoomForm } from '@/components/knowledge/RoomForm'
import type { HotelFact, Room } from '@/types/database'
import type { HotelFactCategory } from '@/types/database'

interface KnowledgeBaseEditorProps {
  facts: HotelFact[]
  rooms: Room[]
}

type FactTabKey = 'policies' | 'faqs' | 'recommendations' | 'amenities'

const FACT_TAB_CONFIG: Record<FactTabKey, { label: string; category: HotelFactCategory }> = {
  policies: { label: 'Policies', category: 'policy' },
  faqs: { label: 'FAQs', category: 'faq' },
  recommendations: { label: 'Local Tips', category: 'recommendation' },
  amenities: { label: 'Amenities', category: 'amenity' },
}

export function KnowledgeBaseEditor({ facts, rooms }: KnowledgeBaseEditorProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // URL-persisted tab — survives router.refresh() calls
  const activeTab = searchParams.get('tab') ?? 'policies'

  // Dialog state for add forms
  const [factFormOpen, setFactFormOpen] = useState(false)
  const [roomFormOpen, setRoomFormOpen] = useState(false)

  function handleTabChange(tab: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.push(pathname + '?' + params.toString())
  }

  function openAddForm() {
    if (activeTab === 'rooms') {
      setRoomFormOpen(true)
    } else {
      setFactFormOpen(true)
    }
  }

  // Determine the active fact category (only used for fact tabs)
  const activeFact = activeTab !== 'rooms'
    ? FACT_TAB_CONFIG[activeTab as FactTabKey]
    : null

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <div className="flex items-center justify-between mb-4">
        <TabsList>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="faqs">FAQs</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="recommendations">Local Tips</TabsTrigger>
          <TabsTrigger value="amenities">Amenities</TabsTrigger>
        </TabsList>
        <Button size="sm" onClick={openAddForm}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      {/* Fact tabs */}
      {(Object.keys(FACT_TAB_CONFIG) as FactTabKey[]).map((tabKey) => {
        const { category } = FACT_TAB_CONFIG[tabKey]
        return (
          <TabsContent key={tabKey} value={tabKey}>
            <FactList
              facts={facts.filter((f) => f.category === category)}
              category={category}
            />
          </TabsContent>
        )
      })}

      {/* Rooms tab */}
      <TabsContent value="rooms">
        <RoomList rooms={rooms} />
      </TabsContent>

      {/* Add fact dialog — opens for any fact tab */}
      {activeFact && (
        <FactForm
          category={activeFact.category}
          open={factFormOpen}
          onOpenChange={setFactFormOpen}
        />
      )}

      {/* Add room dialog */}
      <RoomForm
        open={roomFormOpen}
        onOpenChange={setRoomFormOpen}
      />
    </Tabs>
  )
}
