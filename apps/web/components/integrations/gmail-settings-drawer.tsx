"use client"

import * as React from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ValidationResult {
  valid: string[]
  invalid: string[]
}

function validateEmails(input: string): ValidationResult {
  const emails = input
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)

  const valid: string[] = []
  const invalid: string[] = []

  for (const email of emails) {
    if (EMAIL_REGEX.test(email)) {
      // Avoid duplicates in valid list
      if (!valid.includes(email)) {
        valid.push(email)
      }
    } else {
      invalid.push(email)
    }
  }

  return { valid, invalid }
}

/**
 * Safely get blacklist emails as an array
 * Handles case where it might be stored as non-array
 */
function getBlacklistArray(credentials: Record<string, any> | null): string[] {
  if (!credentials?.blacklistEmails) return []
  if (Array.isArray(credentials.blacklistEmails)) {
    return credentials.blacklistEmails
  }
  // If it's a string, split by comma
  if (typeof credentials.blacklistEmails === 'string') {
    return credentials.blacklistEmails.split(',').map((e: string) => e.trim()).filter(Boolean)
  }
  return []
}

export function GmailSettingsDrawer({
  integration,
  tenantId,
  open,
  onOpenChange,
}: GmailSettingsDrawerProps) {
  const [emailText, setEmailText] = React.useState("")
  const [validationErrors, setValidationErrors] = React.useState<string[]>([])
  const [hasChanges, setHasChanges] = React.useState(false)

  // Fetch current credentials to get blacklist
  const { data: credentials, isLoading: isLoadingCredentials } = useIntegrationCredentials(
    tenantId,
    'gmail'
  )

  // Mutation to update parameters
  const updateParameters = useUpdateIntegrationParameters()

  // Initialize email text when credentials load
  React.useEffect(() => {
    const blacklist = getBlacklistArray(credentials)
    if (blacklist.length > 0) {
      setEmailText(blacklist.join(", "))
      setValidationErrors([])
      setHasChanges(false)
    }
  }, [credentials])

  // Reset state when drawer closes
  React.useEffect(() => {
    if (!open) {
      const blacklist = getBlacklistArray(credentials)
      setEmailText(blacklist.length > 0 ? blacklist.join(", ") : "")
      setValidationErrors([])
      setHasChanges(false)
    }
  }, [open, credentials])

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEmailText(e.target.value)
    setHasChanges(true)
    // Clear validation errors while typing
    if (validationErrors.length > 0) {
      setValidationErrors([])
    }
  }

  const handleSave = async () => {
    // Validate before saving
    const { valid, invalid } = validateEmails(emailText)

    if (invalid.length > 0) {
      setValidationErrors(invalid)
      return
    }

    await updateParameters.mutateAsync({
      integrationId: integration.id,
      tenantId,
      source: 'gmail',
      parameters: {
        blacklistEmails: valid,
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
                Enter email addresses separated by commas.
              </p>
            </div>

            {isLoadingCredentials ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Textarea
                  placeholder="email1@example.com, email2@example.com"
                  value={emailText}
                  onChange={handleTextChange}
                  className={validationErrors.length > 0 ? "border-destructive min-h-[240px]" : "min-h-[240px]"}
                />

                {validationErrors.length > 0 && (
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-destructive">
                          Invalid email addresses
                        </p>
                        <p className="text-xs text-destructive/80 mt-1">
                          {validationErrors.join(", ")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {emailText.trim() === ""
                    ? "No emails blacklisted"
                    : `${validateEmails(emailText).valid.length} valid email(s)`}
                </p>
              </>
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
