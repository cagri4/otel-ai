'use client'

/**
 * Hotel settings form component.
 *
 * Allows hotel owners to edit: name, address, city, country, timezone,
 * contact email, and contact phone.
 *
 * Key patterns:
 * - react-hook-form + zodResolver for client-side validation
 * - useActionState (React 19) to connect to the Server Action
 * - TimezoneSelect: MUST extract `.value` from the onChange callback object
 *   react-timezone-select returns { value: "Europe/Istanbul", label: "...", ... }
 *   Passing the whole object would store "[object Object]" in the database.
 *
 * See: Pitfall 3 in .planning/phases/01-foundation/01-RESEARCH.md
 */

import { useEffect, useActionState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import TimezoneSelect from 'react-timezone-select'
import type { ITimezoneOption } from 'react-timezone-select'
import { hotelSettingsSchema, type HotelSettingsInput } from '@/lib/validations/hotel'
import { updateHotelSettings, type UpdateHotelSettingsState } from '@/app/(dashboard)/settings/actions'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Hotel } from '@/types/database'

interface HotelSettingsFormProps {
  hotel: Hotel
}

export function HotelSettingsForm({ hotel }: HotelSettingsFormProps) {
  const [actionState, formAction, isPending] = useActionState<
    UpdateHotelSettingsState | null,
    FormData
  >(updateHotelSettings, null)

  const form = useForm<HotelSettingsInput>({
    resolver: zodResolver(hotelSettingsSchema),
    defaultValues: {
      name: hotel.name ?? '',
      address: hotel.address ?? '',
      city: hotel.city ?? '',
      country: hotel.country ?? '',
      timezone: hotel.timezone ?? 'UTC',
      contactEmail: hotel.contact_email ?? '',
      contactPhone: hotel.contact_phone ?? '',
    },
  })

  // Sync server-side field errors into react-hook-form's error state
  useEffect(() => {
    if (actionState?.fieldErrors) {
      Object.entries(actionState.fieldErrors).forEach(([field, messages]) => {
        if (messages?.length) {
          form.setError(field as keyof HotelSettingsInput, {
            type: 'server',
            message: messages[0],
          })
        }
      })
    }
  }, [actionState, form])

  function handleSubmit(values: HotelSettingsInput) {
    const formData = new FormData()
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.set(key, String(value))
      }
    })
    formAction(formData)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Hotel Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hotel Name <span className="text-destructive">*</span></FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder="Grand Hotel Istanbul"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Address */}
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder="123 Main Street"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* City + Country row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="Istanbul"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="Turkey"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Timezone */}
        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <FormControl>
                {/*
                  CRITICAL: extract .value from the ITimezoneOption object.
                  react-timezone-select onChange passes { value: "Europe/Istanbul", label: "...", ... }
                  We store only the IANA string (the .value), never the whole object.
                  Storing the object would produce "[object Object]" in the database.
                */}
                <TimezoneSelect
                  value={field.value}
                  onChange={(tz: ITimezoneOption) => field.onChange(tz.value)}
                  styles={{
                    control: (base) => ({
                      ...base,
                      minHeight: '40px',
                      borderRadius: '6px',
                      borderColor: 'hsl(var(--input))',
                      backgroundColor: 'transparent',
                      boxShadow: 'none',
                      '&:hover': {
                        borderColor: 'hsl(var(--input))',
                      },
                    }),
                    menu: (base) => ({
                      ...base,
                      zIndex: 50,
                    }),
                    option: (base, state) => ({
                      ...base,
                      backgroundColor: state.isFocused
                        ? 'hsl(var(--accent))'
                        : 'transparent',
                      color: 'hsl(var(--foreground))',
                      cursor: 'pointer',
                    }),
                    singleValue: (base) => ({
                      ...base,
                      color: 'hsl(var(--foreground))',
                    }),
                    input: (base) => ({
                      ...base,
                      color: 'hsl(var(--foreground))',
                    }),
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Contact Email + Phone row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="contactEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="info@yourhotel.com"
                    autoComplete="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Phone</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    placeholder="+90 212 555 0100"
                    autoComplete="tel"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Server error message */}
        {actionState?.error && !actionState.fieldErrors && (
          <p className="text-sm font-medium text-destructive">
            {actionState.error}
          </p>
        )}

        {/* Success message */}
        {actionState?.success && (
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            Settings saved successfully.
          </p>
        )}

        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save Settings'}
        </Button>
      </form>
    </Form>
  )
}
