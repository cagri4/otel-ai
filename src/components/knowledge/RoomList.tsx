'use client'

/**
 * RoomList — List of hotel rooms with edit and delete actions.
 *
 * Renders each room as a card showing key structured fields.
 * Delete calls the deleteRoom Server Action then router.refresh().
 * Edit opens the RoomForm dialog in edit mode.
 *
 * Source: 03-02-PLAN.md Task 2
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RoomForm } from '@/components/knowledge/RoomForm'
import { deleteRoom } from '@/lib/actions/knowledge'
import type { Room } from '@/types/database'

interface RoomListProps {
  rooms: Room[]
}

export function RoomList({ rooms }: RoomListProps) {
  const router = useRouter()
  const [editRoom, setEditRoom] = useState<Room | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(room: Room) {
    const confirmed = window.confirm(
      `Delete "${room.name}"? This cannot be undone.`,
    )
    if (!confirmed) return

    setDeletingId(room.id)
    try {
      const result = await deleteRoom(room.id)
      if (result.error) {
        alert(`Failed to delete: ${result.error}`)
      } else {
        router.refresh()
      }
    } finally {
      setDeletingId(null)
    }
  }

  if (rooms.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No rooms configured yet. Use the Add button to create your first room type.
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {rooms.map((room) => (
          <Card key={room.id}>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base font-semibold">
                    {room.name}
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {room.room_type}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditRoom(room)}
                    aria-label="Edit room"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(room)}
                    disabled={deletingId === room.id}
                    aria-label="Delete room"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {/* Key details row */}
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {room.bed_type && (
                  <span>Bed: {room.bed_type}</span>
                )}
                {room.max_occupancy && (
                  <span>Max occupancy: {room.max_occupancy}</span>
                )}
                {room.base_price_note && (
                  <span>{room.base_price_note}</span>
                )}
              </div>

              {/* Description */}
              {room.description && (
                <p className="text-sm line-clamp-2">{room.description}</p>
              )}

              {/* Amenities */}
              {room.amenities && room.amenities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {room.amenities.map((amenity) => (
                    <Badge key={amenity} variant="outline" className="text-xs">
                      {amenity}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit dialog */}
      {editRoom && (
        <RoomForm
          room={editRoom}
          open={!!editRoom}
          onOpenChange={(open) => {
            if (!open) setEditRoom(null)
          }}
        />
      )}
    </>
  )
}
