'use client'

/**
 * RoomForm — Add/edit dialog for a hotel room with structured fields.
 *
 * Uses react-hook-form + zodResolver(roomSchema) for validation.
 * Create mode: calls addRoom(formData) Server Action.
 * Edit mode: calls updateRoom(room.id, formData) Server Action.
 * On success: closes dialog + router.refresh() to reload Server Component data.
 *
 * Note: amenities is a comma-separated string in the UI; the Server Action
 * splits it into a string[] for PostgreSQL storage.
 *
 * Source: 03-02-PLAN.md Task 2
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { roomSchema, type RoomInput } from '@/lib/validations/knowledge'
import { addRoom, updateRoom } from '@/lib/actions/knowledge'
import type { Room } from '@/types/database'

interface RoomFormProps {
  room?: Room
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RoomForm({ room, open, onOpenChange }: RoomFormProps) {
  const router = useRouter()
  const isEdit = !!room

  const form = useForm<RoomInput>({
    resolver: zodResolver(roomSchema),
    defaultValues: {
      name: room?.name ?? '',
      room_type: room?.room_type ?? '',
      bed_type: room?.bed_type ?? '',
      max_occupancy: room?.max_occupancy ?? undefined,
      description: room?.description ?? '',
      amenities: room?.amenities?.join(', ') ?? '',
      base_price_note: room?.base_price_note ?? '',
    },
  })

  // Reset form when room prop changes
  useEffect(() => {
    form.reset({
      name: room?.name ?? '',
      room_type: room?.room_type ?? '',
      bed_type: room?.bed_type ?? '',
      max_occupancy: room?.max_occupancy ?? undefined,
      description: room?.description ?? '',
      amenities: room?.amenities?.join(', ') ?? '',
      base_price_note: room?.base_price_note ?? '',
    })
  }, [room, form])

  async function onSubmit(values: RoomInput) {
    const formData = new FormData()
    formData.set('name', values.name)
    formData.set('room_type', values.room_type)
    if (values.bed_type) formData.set('bed_type', values.bed_type)
    if (values.max_occupancy !== undefined)
      formData.set('max_occupancy', String(values.max_occupancy))
    if (values.description) formData.set('description', values.description)
    if (values.amenities) formData.set('amenities', values.amenities)
    if (values.base_price_note) formData.set('base_price_note', values.base_price_note)

    const result = isEdit
      ? await updateRoom(room.id, formData)
      : await addRoom(formData)

    if (result.error) {
      form.setError('name', { message: result.error })
      return
    }

    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Room' : 'Add Room'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Room name <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Deluxe Ocean View" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Room type */}
            <FormField
              control={form.control}
              name="room_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Room type <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. standard, deluxe, suite" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Bed type */}
              <FormField
                control={form.control}
                name="bed_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bed type</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. king, twin" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Max occupancy */}
              <FormField
                control={form.control}
                name="max_occupancy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max occupancy</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        placeholder="e.g. 2"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === '' ? undefined : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the room..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Amenities */}
            <FormField
              control={form.control}
              name="amenities"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amenities</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. WiFi, minibar, balcony (comma-separated)"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Base price note */}
            <FormField
              control={form.control}
              name="base_price_note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price note</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. from $120/night" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? isEdit ? 'Saving...' : 'Adding...'
                  : isEdit ? 'Save Changes' : 'Add Room'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
