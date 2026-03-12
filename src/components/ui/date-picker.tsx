"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

interface DatePickerProps {
  value?: Date | null
  onChange?: (date: Date | null) => void
  /** Return true to disable a given day */
  disableDate?: (date: Date) => boolean
  placeholder?: string
  className?: string
  /** Format string for displaying the selected date (date-fns format) */
  displayFormat?: string
}

function DatePicker({
  value,
  onChange,
  disableDate,
  placeholder = "Pick a date",
  className,
  displayFormat = "MMM d, yyyy",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const isDesktop = useMediaQuery("(min-width: 640px)")

  const handleSelect = (date: Date | null) => {
    onChange?.(date)
    setOpen(false)
  }

  const trigger = (
    <Button
      variant="outline"
      className={cn(
        "justify-start text-left font-normal",
        !value && "text-muted-foreground",
        className
      )}
    >
      <CalendarIcon data-icon="inline-start" className="size-4" />
      {value ? format(value, displayFormat) : placeholder}
    </Button>
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar value={value} onChange={handleSelect} disableDate={disableDate} />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger render={trigger} />
      <DrawerContent>
        <DrawerTitle className="sr-only">Pick a date</DrawerTitle>
        <Calendar
          value={value}
          onChange={handleSelect}
          className="mx-auto pb-6"
        />
      </DrawerContent>
    </Drawer>
  )
}

export { DatePicker }
export type { DatePickerProps }
