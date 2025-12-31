"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/src/contexts/AuthContext"
import { useToast } from "@/components/ui/use-toast"
import { getSupportedTimezones } from "@/lib/constants/timezones"
import { Loader2 } from "lucide-react"

interface UserPreferencesData {
  timezone: string | null
  notifyTaskAssigned: boolean
  escalationSummaryFrequency: 'none' | 'daily' | 'every_4_hours' | 'every_8_hours'
}

const ESCALATION_FREQUENCY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Once a day (8:00 AM local time)' },
  { value: 'every_4_hours', label: 'Every 4 hours' },
  { value: 'every_8_hours', label: 'Every 8 hours' },
] as const

export function UserPreferences() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState<UserPreferencesData>({
    timezone: 'Asia/Kolkata',
    notifyTaskAssigned: true,
    escalationSummaryFrequency: 'daily',
  })

  // Get all supported timezones from browser's Intl API
  const timezones = useMemo(() => getSupportedTimezones(), [])

  // Fetch current user preferences on mount
  useEffect(() => {
    async function fetchPreferences() {
      try {
        // Fetch user profile for timezone (uses cookie-based auth)
        const response = await fetch('/api/users/me', {
          credentials: 'include',
        })

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            setPreferences(prev => ({
              ...prev,
              timezone: data.data.timezone || 'Asia/Kolkata',
            }))
          }
        }

        // TODO: Fetch notification preferences from notifications service
        // For now, use defaults
      } catch (error) {
        console.error('Failed to fetch preferences:', error)
      } finally {
        setLoading(false)
      }
    }

    if (user) {
      fetchPreferences()
    }
  }, [user])

  const handleSave = async () => {
    setSaving(true)
    try {
      // Save timezone to user profile (uses cookie-based auth)
      const response = await fetch('/api/users/me/preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timezone: preferences.timezone,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      // TODO: Save notification preferences to notifications service
      // This will be implemented when we add the notification preferences API

      toast({
        title: "Preferences saved",
        description: "Your preferences have been updated successfully.",
      })
    } catch (error) {
      console.error('Failed to save preferences:', error)
      toast({
        title: "Error",
        description: "Failed to save preferences. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">User Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Manage your personal account settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1">
            <Label className="text-muted-foreground">Name</Label>
            <p className="text-sm font-medium">{user?.name || 'Not set'}</p>
          </div>
          <Separator />
          <div className="grid gap-1">
            <Label className="text-muted-foreground">Email</Label>
            <p className="text-sm font-medium">{user?.email}</p>
          </div>
          <Separator />
          <div className="grid gap-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              value={preferences.timezone || 'Asia/Kolkata'}
              onValueChange={(value) => setPreferences(prev => ({ ...prev, timezone: value }))}
            >
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label} ({tz.offset})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used for scheduling email notifications at the right time for you
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Notifications</CardTitle>
          <CardDescription>Configure when you receive email notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Notify when task is assigned</Label>
              <p className="text-sm text-muted-foreground">
                Receive an email when a task is assigned to you
              </p>
            </div>
            <Switch
              checked={preferences.notifyTaskAssigned}
              onCheckedChange={(checked) =>
                setPreferences(prev => ({ ...prev, notifyTaskAssigned: checked }))
              }
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="escalation-frequency">Escalation summary emails</Label>
            <p className="text-sm text-muted-foreground">
              Receive periodic summary of open escalations for your team
            </p>
            <Select
              value={preferences.escalationSummaryFrequency}
              onValueChange={(value: typeof preferences.escalationSummaryFrequency) =>
                setPreferences(prev => ({ ...prev, escalationSummaryFrequency: value }))
              }
            >
              <SelectTrigger id="escalation-frequency" className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESCALATION_FREQUENCY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
