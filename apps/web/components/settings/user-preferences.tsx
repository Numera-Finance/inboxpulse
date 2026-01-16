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
import { getUserClient, getNotificationsClient } from "@/lib/api/clients"
import type { NotificationPreference, BatchInterval } from "@crm/clients"
import { Loader2 } from "lucide-react"

type EscalationFrequency = 'none' | 'daily' | 'every_4_hours' | 'every_8_hours'

interface UserPreferencesData {
  timezone: string | null
  notifyTaskAssigned: boolean
  escalationSummaryFrequency: EscalationFrequency
}

// Helper to convert notification preference to UI frequency
function preferenceToFrequency(pref: NotificationPreference): EscalationFrequency {
  if (!pref.enabled) return 'none'
  if (pref.batchInterval?.type === 'daily') return 'daily'
  if (pref.batchInterval?.type === 'hours') {
    if (pref.batchInterval.value === 4) return 'every_4_hours'
    if (pref.batchInterval.value === 8) return 'every_8_hours'
  }
  return 'daily' // default
}

// Helper to convert UI frequency to notification preference
function frequencyToPreference(freq: EscalationFrequency): { enabled: boolean; frequency?: 'immediate' | 'batched'; batchInterval?: BatchInterval | null } {
  switch (freq) {
    case 'none':
      return { enabled: false }
    case 'daily':
      return { enabled: true, frequency: 'batched', batchInterval: { type: 'daily', time: '08:00' } }
    case 'every_4_hours':
      return { enabled: true, frequency: 'batched', batchInterval: { type: 'hours', value: 4 } }
    case 'every_8_hours':
      return { enabled: true, frequency: 'batched', batchInterval: { type: 'hours', value: 8 } }
  }
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
        // Fetch user profile for timezone
        const userClient = getUserClient()
        const userData = await userClient.getMe()

        if (userData) {
          setPreferences(prev => ({
            ...prev,
            timezone: userData.timezone || 'Asia/Kolkata',
          }))
        }

        // Fetch notification preferences from notifications service (optional - service may not be running)
        try {
          const notificationsClient = getNotificationsClient()

          // Fetch task.assigned preference
          const taskPref = await notificationsClient.getPreference('task.assigned')

          // Fetch escalation.summary preference
          const escalationPref = await notificationsClient.getPreference('escalation.summary')

          setPreferences(prev => ({
            ...prev,
            notifyTaskAssigned: taskPref.enabled,
            escalationSummaryFrequency: preferenceToFrequency(escalationPref),
          }))
        } catch (notifError) {
          // Notifications service may not be running - show warning
          console.warn('Notifications service unavailable, using default preferences')
          toast({
            title: "Warning",
            description: "Notifications service unavailable. Notification preferences may not be accurate.",
            variant: "destructive",
          })
        }
      } catch (error) {
        console.error('Failed to fetch preferences:', error)
        toast({
          title: "Error",
          description: "Failed to load preferences.",
          variant: "destructive",
        })
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
      // Save timezone to user profile
      const userClient = getUserClient()
      await userClient.updateMyPreferences({
        timezone: preferences.timezone || undefined,
      })

      // Save notification preferences to notifications service (optional - service may not be running)
      try {
        const notificationsClient = getNotificationsClient()

        // Update task.assigned preference
        await notificationsClient.updatePreference('task.assigned', {
          enabled: preferences.notifyTaskAssigned,
        })

        // Update escalation.summary preference
        const escalationPref = frequencyToPreference(preferences.escalationSummaryFrequency)
        await notificationsClient.updatePreference('escalation.summary', escalationPref)
      } catch (notifError) {
        // Notifications service may not be running - show warning but continue
        console.warn('Notifications service unavailable, notification preferences not saved')
        toast({
          title: "Partial save",
          description: "Timezone saved, but notification preferences could not be saved (service unavailable).",
          variant: "destructive",
        })
        return
      }

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
