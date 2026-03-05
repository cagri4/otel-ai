/**
 * Knowledge Base page — Server Component.
 *
 * Fetches hotel_facts and rooms in parallel from Supabase, then renders
 * the KnowledgeBaseEditor client component with data as props.
 *
 * RLS ensures only the authenticated user's hotel data is returned.
 * The .returns<T>() call is required for postgrest-js v12 type inference
 * (see STATE.md decision: ".returns<T>() required for Supabase SELECT").
 *
 * Source: 03-02-PLAN.md Task 1
 */
import { createClient } from '@/lib/supabase/server'
import { KnowledgeBaseEditor } from '@/components/knowledge/KnowledgeBaseEditor'
import type { HotelFact, Room } from '@/types/database'

export default async function KnowledgePage() {
  const supabase = await createClient()

  const [factsResult, roomsResult] = await Promise.all([
    supabase
      .from('hotel_facts')
      .select('*')
      .order('category')
      .returns<HotelFact[]>(),
    supabase
      .from('rooms')
      .select('*')
      .order('sort_order')
      .returns<Room[]>(),
  ])

  const facts = factsResult.data ?? []
  const rooms = roomsResult.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This information is used by all AI employees to answer guest questions.
        </p>
      </div>
      <KnowledgeBaseEditor facts={facts} rooms={rooms} />
    </div>
  )
}
