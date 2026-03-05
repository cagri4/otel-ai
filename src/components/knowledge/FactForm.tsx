'use client'

/**
 * FactForm — Add/edit dialog for a single hotel fact.
 *
 * Uses react-hook-form + zodResolver(factSchema) for validation.
 * Create mode: calls addFact(formData) Server Action.
 * Edit mode: calls updateFact(fact.id, formData) Server Action.
 * On success: closes dialog + router.refresh() to reload Server Component data.
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
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { factSchema, type FactInput } from '@/lib/validations/knowledge'
import { addFact, updateFact } from '@/lib/actions/knowledge'
import type { HotelFact, HotelFactCategory } from '@/types/database'

interface FactFormProps {
  category: HotelFactCategory
  fact?: HotelFact
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CATEGORY_LABELS: Record<HotelFactCategory, string> = {
  policy: 'Policy',
  faq: 'FAQ',
  amenity: 'Amenity',
  pricing_note: 'Pricing Note',
  recommendation: 'Local Tip',
}

export function FactForm({ category, fact, open, onOpenChange }: FactFormProps) {
  const router = useRouter()
  const isEdit = !!fact

  const form = useForm<FactInput>({
    resolver: zodResolver(factSchema),
    defaultValues: {
      category,
      fact: fact?.fact ?? '',
    },
  })

  // Reset form when fact prop changes (switching between edit targets)
  useEffect(() => {
    form.reset({
      category,
      fact: fact?.fact ?? '',
    })
  }, [fact, category, form])

  async function onSubmit(values: FactInput) {
    const formData = new FormData()
    formData.set('category', values.category)
    formData.set('fact', values.fact)

    const result = isEdit
      ? await updateFact(fact.id, formData)
      : await addFact(formData)

    if (result.error) {
      form.setError('fact', { message: result.error })
      return
    }

    onOpenChange(false)
    router.refresh()
  }

  const label = CATEGORY_LABELS[category]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${label}` : `Add ${label}`}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fact"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label} text</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={`Enter ${label.toLowerCase()} details...`}
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
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
                  : isEdit ? 'Save Changes' : `Add ${label}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
