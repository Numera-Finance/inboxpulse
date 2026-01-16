"use client"

import * as React from "react"
import { X, Plus, Trash2, Loader2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIntegrationCredentials, useUpdateIntegrationParameters } from "@/lib/hooks/use-integrations"
import type { Integration } from "@/lib/api"

interface GmailSettingsDrawerProps {
  integration: Integration
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GmailSettingsDrawer({
  integration,
  tenantId,
  open,
  onOpenChange,
}: GmailSettingsDrawerProps) {
  const [newEmail, setNewEmail] = React.useState("")
  const [localBlacklist, setLocalBlacklist] = React.useState<string[]>([])
  const [hasChanges, setHasChanges] = React.useState(false)

  // Fetch current credentials to get blacklist
  const { data: credentials, isLoading: isLoadingCredentials } = useIntegrationCredentials(
    tenantId,
    'gmail'
  )

  // Mutation to update parameters
  const updateParameters = useUpdateIntegrationParameters()

  // Initialize local blacklist when credentials load
  React.useEffect(() => {
    if (credentials?.blacklistEmails) {
      setLocalBlacklist(credentials.blacklistEmails)
      setHasChanges(false)
    }
  }, [credentials?.blacklistEmails])

  // Reset state when drawer closes
  React.useEffect(() => {
    if (!open) {
      setNewEmail("")
      if (credentials?.blacklistEmails) {
        setLocalBlacklist(credentials.blacklistEmails)
      }
      setHasChanges(false)
    }
  }, [open, credentials?.blacklistEmails])

  const handleAddEmail = () => {
    const email = newEmail.trim().toLowerCase()
    if (!email) return

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return
    }

    // Don't add duplicates
    if (localBlacklist.includes(email)) {
      setNewEmail("")
      return
    }

    setLocalBlacklist([...localBlacklist, email])
    setNewEmail("")
    setHasChanges(true)
  }

  const handleRemoveEmail = (email: string) => {
    setLocalBlacklist(localBlacklist.filter((e) => e !== email))
    setHasChanges(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAddEmail()
    }
  }

  const handleSave = async () => {
    await updateParameters.mutateAsync({
      integrationId: integration.id,
      tenantId,
      source: 'gmail',
      parameters: {
        blacklistEmails: localBlacklist,
      },
    })
    setHasChanges(false)
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="h-full w-full sm:max-w-md">
        <DrawerHeader className="border-b">
          <DrawerTitle>Gmail Settings</DrawerTitle>
          <DrawerDescription>
            Configure settings for your Gmail integration
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          {/* Email Blacklist Section */}
          <div className="space-y-4">
            <div>
              <Label className="text-base font-medium">Email Blacklist</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Emails from these addresses will be skipped during sync and won't be analyzed.
              </p>
            </div>

            {/* Add new email */}
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleAddEmail}
                disabled={!newEmail.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Blacklist items */}
            {isLoadingCredentials ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : localBlacklist.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <Mail className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  No blacklisted emails yet
                </p>
                <p className="text-xs text-muted-foreground">
                  Add email addresses above to skip them during sync
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {localBlacklist.map((email) => (
                  <div
                    key={email}
                    className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{email}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleRemoveEmail(email)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DrawerFooter className="border-t">
          <div className="flex gap-2">
            <DrawerClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </DrawerClose>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={!hasChanges || updateParameters.isPending}
            >
              {updateParameters.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
