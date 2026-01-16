"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2 } from "lucide-react"
import { API_BASE_URL } from "@/lib/api/clients"
import { format } from "date-fns"

// Holiday type
interface Holiday {
  id: string
  date: string
  timezone: string
  name: string
  createdAt: string
  updatedAt: string
}

// Common timezones for selection
const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
]

// API functions
async function fetchHolidays(timezone?: string): Promise<Holiday[]> {
  const params = new URLSearchParams()
  if (timezone) params.set("timezone", timezone)
  const queryString = params.toString()
  const url = queryString
    ? `${API_BASE_URL}/api/holidays?${queryString}`
    : `${API_BASE_URL}/api/holidays`

  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) throw new Error("Failed to fetch holidays")
  const data = await response.json()
  return data.data || []
}

async function fetchTimezones(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/api/holidays/timezones`, {
    credentials: "include",
  })
  if (!response.ok) throw new Error("Failed to fetch timezones")
  const data = await response.json()
  return data.data?.timezones || []
}

async function createHoliday(holiday: {
  date: string
  timezone: string
  name: string
}): Promise<Holiday> {
  const response = await fetch(`${API_BASE_URL}/api/holidays`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(holiday),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || "Failed to create holiday")
  }
  const data = await response.json()
  return data.data
}

async function deleteHoliday(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/holidays/${id}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!response.ok) throw new Error("Failed to delete holiday")
}

export function HolidaySettings() {
  const queryClient = useQueryClient()
  const [selectedTimezone, setSelectedTimezone] = React.useState<string>("")
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  const [newHoliday, setNewHoliday] = React.useState({
    date: "",
    timezone: "",
    name: "",
  })

  // Fetch existing timezones
  const { data: existingTimezones = [] } = useQuery({
    queryKey: ["holidays", "timezones"],
    queryFn: fetchTimezones,
  })

  // Fetch holidays for selected timezone
  const {
    data: holidays = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["holidays", selectedTimezone],
    queryFn: () => fetchHolidays(selectedTimezone || undefined),
  })

  // Create holiday mutation
  const createMutation = useMutation({
    mutationFn: createHoliday,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] })
      setIsAddDialogOpen(false)
      setNewHoliday({ date: "", timezone: "", name: "" })
    },
  })

  // Delete holiday mutation
  const deleteMutation = useMutation({
    mutationFn: deleteHoliday,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] })
    },
  })

  // Get all unique timezones (existing + common)
  const allTimezones = Array.from(
    new Set([...existingTimezones, ...COMMON_TIMEZONES])
  ).sort()

  const handleAddHoliday = () => {
    if (!newHoliday.date || !newHoliday.timezone || !newHoliday.name) return
    createMutation.mutate(newHoliday)
  }

  const handleDeleteHoliday = (id: string) => {
    if (confirm("Are you sure you want to delete this holiday?")) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Holiday Calendar</h2>
        <p className="text-sm text-muted-foreground">
          Manage holidays for TAT (Turn Around Time) calculations. Holidays are
          excluded from business day counts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Holidays</CardTitle>
              <CardDescription>
                Add holidays by timezone to exclude them from SLA calculations
              </CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Holiday
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Holiday</DialogTitle>
                  <DialogDescription>
                    Add a new holiday to exclude from business day calculations
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="holiday-name">Holiday Name</Label>
                    <Input
                      id="holiday-name"
                      placeholder="e.g., New Year's Day"
                      value={newHoliday.name}
                      onChange={(e) =>
                        setNewHoliday({ ...newHoliday, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="holiday-date">Date</Label>
                    <Input
                      id="holiday-date"
                      type="date"
                      value={newHoliday.date}
                      onChange={(e) =>
                        setNewHoliday({ ...newHoliday, date: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="holiday-timezone">Timezone</Label>
                    <Select
                      value={newHoliday.timezone}
                      onValueChange={(value) =>
                        setNewHoliday({ ...newHoliday, timezone: value })
                      }
                    >
                      <SelectTrigger id="holiday-timezone">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        {allTimezones.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddHoliday}
                    disabled={
                      createMutation.isPending ||
                      !newHoliday.date ||
                      !newHoliday.timezone ||
                      !newHoliday.name
                    }
                  >
                    {createMutation.isPending ? "Adding..." : "Add Holiday"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Timezone filter */}
          <div className="flex items-center gap-4">
            <Label htmlFor="filter-timezone" className="shrink-0">
              Filter by Timezone:
            </Label>
            <Select
              value={selectedTimezone}
              onValueChange={setSelectedTimezone}
            >
              <SelectTrigger id="filter-timezone" className="w-64">
                <SelectValue placeholder="All timezones" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All timezones</SelectItem>
                {allTimezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Holiday list */}
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center text-muted-foreground py-8">
              Failed to load holidays
            </div>
          ) : holidays.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No holidays configured
              {selectedTimezone && ` for ${selectedTimezone}`}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((holiday) => (
                  <TableRow key={holiday.id}>
                    <TableCell>
                      {format(new Date(holiday.date + "T00:00:00"), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>{holiday.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {holiday.timezone}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteHoliday(holiday.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
