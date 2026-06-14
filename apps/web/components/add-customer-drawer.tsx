"use client"

import * as React from "react"
import { X, Plus, Building2, Globe } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface AddCustomerDrawerProps {
  open: boolean
  onClose: () => void
  onSave: (data: CustomerFormData) => void
  isLoading?: boolean
}

export interface CustomerFormData {
  name: string
  domains: string[]
  website?: string
  industry?: string
}

const industries = [
  "Technology",
  "Healthcare",
  "Finance",
  "Manufacturing",
  "Retail",
  "Education",
  "Consulting",
  "Real Estate",
  "Other",
]

export function AddCustomerDrawer({ open, onClose, onSave, isLoading }: AddCustomerDrawerProps) {
  const [name, setName] = React.useState("")
  const [domains, setDomains] = React.useState<string[]>([])
  const [newDomain, setNewDomain] = React.useState("")
  const [website, setWebsite] = React.useState("")
  const [industry, setIndustry] = React.useState("")

  const resetForm = () => {
    setName("")
    setDomains([])
    setNewDomain("")
    setWebsite("")
    setIndustry("")
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSave = () => {
    onSave({
      name,
      domains,
      website: website || undefined,
      industry: industry || undefined,
    })
  }

  const addDomain = () => {
    const domain = newDomain.trim().toLowerCase()
    if (domain && !domains.includes(domain)) {
      setDomains((prev) => [...prev, domain])
      setNewDomain("")
    }
  }

  const removeDomain = (domain: string) => {
    setDomains((prev) => prev.filter((d) => d !== domain))
  }

  const isFormValid = name.trim() && domains.length > 0

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle>Add New Customer</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corporation"
              />
            </div>

            <div className="space-y-2">
              <Label>Domains *</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Enter domain (e.g., acme.com)..."
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addDomain()}
                />
                <Button variant="outline" size="sm" onClick={addDomain}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {domains.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground">
                  <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No domains added</p>
                  <p className="text-xs">Add at least one domain to identify this company</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {domains.map((domain) => (
                    <Badge key={domain} variant="secondary" className="text-sm">
                      {domain}
                      <button
                        className="ml-2 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDomain(domain)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://www.acme.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger>
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </ScrollArea>

        <div className="p-6 pt-4 border-t border-border flex gap-2">
          <Button variant="outline" className="flex-1 bg-transparent" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSave} disabled={!isFormValid || isLoading}>
            {isLoading ? "Adding..." : "Add Customer"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
