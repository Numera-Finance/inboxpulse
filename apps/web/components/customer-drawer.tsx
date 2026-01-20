"use client"

import * as React from "react"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import { X, Plus, Search, Pencil, Trash2, Mail, Phone, Building2, Globe, Check, Loader2, ArrowUpDown, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { EmailDrawer } from "@/components/email-drawer"
import {
  InboxView,
  apiEmailToInboxItem,
  apiEmailToInboxContent,
  type InboxItem,
  type InboxFilter,
  type InboxPagination,
  type InboxPage,
  type InboxItemContent,
  type ApiEmailResponse,
} from "@/components/inbox"
import type { Customer, ContactDisplay, Email } from "@/lib/types"
import { predefinedLabels, mapApiContactToContact } from "@/lib/types"
import { useEmailsByCustomer, useContactsByCustomer, useUsersByCustomer, useAddCustomerToUser, useRemoveCustomerFromUser, userKeys, useUpdateCustomer, customerKeys } from "@/lib/hooks"
import { authService } from "@/lib/auth/auth-service"
import { getCustomerRoleName } from "@crm/shared"
import { UserAutocomplete } from "@/components/ui/user-autocomplete"
import { RoleSelect } from "@/components/ui/role-select"
import { useQueryClient } from "@tanstack/react-query"

interface CustomerDrawerProps {
  customer: Customer | null
  open: boolean
  onClose: () => void
  activeTab?: "emails" | "contacts" | "team"
  onTabChange?: (tab: string) => void
  isLoading?: boolean
  selectedEmailId?: string
  onEmailSelect?: (emailId: string | null) => void
}

export function CustomerDrawer({ customer, open, onClose, activeTab = "emails", onTabChange, isLoading = false, selectedEmailId, onEmailSelect }: CustomerDrawerProps) {
  // Track visibility separately from open to allow exit animation
  const [isVisible, setIsVisible] = React.useState(open)
  const [shouldRender, setShouldRender] = React.useState(open)

  // Handle open/close transitions
  React.useEffect(() => {
    if (open) {
      // Opening: render immediately, then animate in
      setShouldRender(true)
      // Small delay to ensure DOM is ready before animation
      requestAnimationFrame(() => {
        setIsVisible(true)
      })
    } else {
      // Closing: animate out, then stop rendering
      setIsVisible(false)
      const timer = setTimeout(() => {
        setShouldRender(false)
      }, 300) // Match animation duration
      return () => clearTimeout(timer)
    }
  }, [open])

  const [contactSearch, setContactSearch] = React.useState("")
  const [editingContact, setEditingContact] = React.useState<string | null>(null)
  const [addingContact, setAddingContact] = React.useState(false)
  const [editForm, setEditForm] = React.useState<ContactDisplay | null>(null)
  const [newContact, setNewContact] = React.useState<{ name: string; email: string; phone: string; title: string }>({
    name: "",
    email: "",
    phone: "",
    title: "",
  })
  const [selectedEmail, setSelectedEmail] = React.useState<Email | null>(null)
  const [emailDrawerOpen, setEmailDrawerOpen] = React.useState(false)
  const [isEditingLabels, setIsEditingLabels] = React.useState(false)
  const [labels, setLabels] = React.useState<string[]>([])
  const [labelPopoverOpen, setLabelPopoverOpen] = React.useState(false)
  const [newLabelInput, setNewLabelInput] = React.useState("")
  const [contactSorting, setContactSorting] = React.useState<SortingState>([])

  // Team tab state
  const [addingTeamMember, setAddingTeamMember] = React.useState(false)
  const [newTeamMember, setNewTeamMember] = React.useState<{
    userId: string | null
    userName: string
    userEmail: string
    roleId: string | null
  }>({ userId: null, userName: '', userEmail: '', roleId: null })
  const [editingTeamMember, setEditingTeamMember] = React.useState<string | null>(null)
  const [editingRoleId, setEditingRoleId] = React.useState<string | null>(null)

  // Email filter state - lifted from InboxView to enable server-side filtering
  const [emailSentimentFilter, setEmailSentimentFilter] = React.useState<'positive' | 'negative' | 'neutral' | 'upsell' | 'churn' | 'tat' | 'all'>('all')

  // Get tenantId from auth service
  const tenantId = authService.getTenantId() || ""
  const queryClient = useQueryClient()

  // Build email query options based on filter
  const emailQueryOptions = React.useMemo(() => {
    const options: {
      limit: number;
      sentiment?: 'positive' | 'negative' | 'neutral';
      signal?: 'upsell' | 'churn';
      tatViolation?: boolean;
    } = { limit: 10000 };

    if (emailSentimentFilter && emailSentimentFilter !== 'all') {
      // Map to appropriate filter field
      if (emailSentimentFilter === 'upsell' || emailSentimentFilter === 'churn') {
        options.signal = emailSentimentFilter;
      } else if (emailSentimentFilter === 'tat') {
        options.tatViolation = true;
      } else {
        options.sentiment = emailSentimentFilter;
      }
    }

    return options;
  }, [emailSentimentFilter])

  // Fetch emails for customer from API with filter
  const {
    data: emailsData,
    isLoading: isLoadingEmails,
    error: emailsError,
  } = useEmailsByCustomer(tenantId, customer?.id || "", emailQueryOptions)

  // Fetch contacts for customer from API
  const {
    data: contactsData,
    isLoading: isLoadingContacts,
  } = useContactsByCustomer(customer?.id || "")

  // Fetch team members (users assigned to this customer)
  const {
    data: teamMembers,
    isLoading: isLoadingTeam,
  } = useUsersByCustomer(customer?.id || "")

  // Mutations for adding/removing team members
  const addCustomerToUser = useAddCustomerToUser()
  const removeCustomerFromUser = useRemoveCustomerFromUser()

  // Mutation for updating customer labels
  const updateCustomer = useUpdateCustomer()

  // Map API contacts to frontend ContactDisplay type (already sorted by API)
  const contacts: ContactDisplay[] = React.useMemo(() => {
    if (!contactsData) return []
    return contactsData.map(mapApiContactToContact)
  }, [contactsData])

  // Reset state when drawer closes
  React.useEffect(() => {
    if (!open) {
      setEditingContact(null)
      setAddingContact(false)
      setEditForm(null)
      setNewContact({ name: "", email: "", phone: "", title: "" })
      setSelectedEmail(null)
      setEmailDrawerOpen(false)
      setIsEditingLabels(false)
      setLabelPopoverOpen(false)
      setNewLabelInput("")
      setAddingTeamMember(false)
      setNewTeamMember({ userId: null, userName: '', userEmail: '', roleId: null })
      setEditingTeamMember(null)
      setEditingRoleId(null)
    }
  }, [open])

  // Close drawer on Escape key
  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Don't close if email drawer is open (let it handle its own escape)
        if (emailDrawerOpen) return
        // Don't close if user is in an input field (let them cancel editing)
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return
        }
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, emailDrawerOpen, onClose])

  // Reset filters and customer-specific state when customer changes
  React.useEffect(() => {
    if (customer) {
      setLabels(customer.labels)
    }
    // Always reset filters when customer ID changes (including to undefined)
    setEmailSentimentFilter('all')
    setContactSearch('')
    setContactSorting([])
  }, [customer?.id])

  // Get IDs of users already on the team
  const existingTeamUserIds = React.useMemo(() => {
    return new Set(teamMembers?.map(m => m.id) || [])
  }, [teamMembers])

  // Get emails from API response
  const emails: ApiEmailResponse[] = emailsData?.emails || []

  // Email inbox callbacks for InboxView
  const emailCallbacks = React.useMemo(() => {
    if (!customer) return null

    return {
      onFetchItems: async (
        filter: InboxFilter,
        pagination: InboxPagination
      ): Promise<InboxPage<InboxItem>> => {
        // Filter emails by search query and sentiment (client-side for now)
        let filteredEmails = [...emails]

        if (filter.query) {
          const query = filter.query.toLowerCase()
          filteredEmails = filteredEmails.filter(
            (email) =>
              email.fromEmail.toLowerCase().includes(query) ||
              (email.fromName?.toLowerCase().includes(query) ?? false) ||
              email.subject.toLowerCase().includes(query) ||
              (email.body?.toLowerCase().includes(query) ?? false)
          )
        }

        // Note: Sentiment filtering is done server-side via emailQueryOptions
        // No client-side filtering needed here

        // Paginate
        const start = (pagination.page - 1) * pagination.limit
        const paginatedEmails = filteredEmails.slice(start, start + pagination.limit)

        return {
          items: paginatedEmails.map(apiEmailToInboxItem),
          total: filteredEmails.length,
          page: pagination.page,
          limit: pagination.limit,
          hasMore: start + pagination.limit < filteredEmails.length,
        }
      },
      onFetchContent: async (itemId: string): Promise<InboxItemContent> => {
        const email = emails.find((e) => e.id === itemId)
        if (!email) {
          throw new Error(`Email not found: ${itemId}`)
        }
        return apiEmailToInboxContent(email)
      },
      onSelect: (item: InboxItem) => {
        // Update URL when email is selected
        onEmailSelect?.(item.id)
      },
      onReply: (item: InboxItem) => {
        // Convert API email to frontend Email type for the drawer
        const apiEmail = emails.find((e) => e.id === item.id)
        if (apiEmail) {
          const email: Email = {
            id: apiEmail.id,
            from: apiEmail.fromEmail,
            to: apiEmail.tos?.[0]?.email || "",
            subject: apiEmail.subject,
            body: apiEmail.body || "",
            date: apiEmail.receivedAt,
          }
          setSelectedEmail(email)
          setEmailDrawerOpen(true)
        }
      },
      onForward: (item: InboxItem) => {
        // Convert API email to frontend Email type for the drawer
        const apiEmail = emails.find((e) => e.id === item.id)
        if (apiEmail) {
          const email: Email = {
            id: apiEmail.id,
            from: apiEmail.fromEmail,
            to: apiEmail.tos?.[0]?.email || "",
            subject: apiEmail.subject,
            body: apiEmail.body || "",
            date: apiEmail.receivedAt,
          }
          setSelectedEmail(email)
          setEmailDrawerOpen(true)
        }
      },
    }
  }, [customer, emails, onEmailSelect])

  // Contact handlers - must be before contactColumns useMemo
  const handleStartEdit = (contact: ContactDisplay) => {
    setEditingContact(contact.id)
    setEditForm({ ...contact })
    setAddingContact(false)
  }

  const handleDelete = (contactId: string) => {
    console.log("Deleting contact:", contactId)
  }

  // Filter contacts by search - must be before any early returns
  const filteredContacts = React.useMemo(() => {
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
        contact.email.toLowerCase().includes(contactSearch.toLowerCase()) ||
        contact.title?.toLowerCase().includes(contactSearch.toLowerCase()),
    )
  }, [contacts, contactSearch])

  // Contact table columns with sorting - must be before any early returns
  const contactColumns: ColumnDef<ContactDisplay>[] = React.useMemo(() => [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="font-medium">{row.getValue("name")}</span>,
    },
    {
      accessorKey: "title",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Title
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
    },
    {
      accessorKey: "email",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Contact
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const contact = row.original
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-sm">
              <Mail className="h-3 w-3 text-muted-foreground" />
              {contact.email}
            </div>
            {contact.mobile && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Phone className="h-3 w-3" />
                {contact.mobile}
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const contact = row.original
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleStartEdit(contact)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => handleDelete(contact.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ], [handleStartEdit, handleDelete])

  const contactTable = useReactTable({
    data: filteredContacts,
    columns: contactColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setContactSorting,
    state: {
      sorting: contactSorting,
    },
  })

  // Show loading state or return null if no customer and not loading
  // This must come AFTER all hooks are called
  if (!customer) {
    if (!shouldRender) return null

    // Show loading state when drawer is open but customer is still loading
    return (
      <>
        {/* Overlay */}
        <div
          className={`fixed inset-0 bg-background/80 backdrop-blur-sm z-40 transition-opacity duration-300 ease-out ${
            isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={onClose}
        />
        {/* Drawer with loading state */}
        <div className={`fixed right-0 top-0 z-50 h-full w-full transform bg-background border-l border-border shadow-xl transition-transform duration-300 ease-out ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}>
          <div className="flex h-full flex-col items-center justify-center">
            {isLoading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Loading customer...</p>
              </>
            ) : (
              <>
                <p className="text-muted-foreground mb-4">Customer not found</p>
                <Button variant="outline" onClick={onClose}>Close</Button>
              </>
            )}
          </div>
        </div>
      </>
    )
  }

  const handleCancelEdit = () => {
    setEditingContact(null)
    setEditForm(null)
  }

  const handleSaveEdit = () => {
    console.log("Saving contact:", editForm)
    setEditingContact(null)
    setEditForm(null)
  }

  const handleStartAdd = () => {
    setAddingContact(true)
    setEditingContact(null)
    setEditForm(null)
  }

  const handleCancelAdd = () => {
    setAddingContact(false)
    setNewContact({ name: "", email: "", phone: "", title: "" })
  }

  const handleSaveAdd = () => {
    console.log("Adding contact:", newContact)
    setAddingContact(false)
    setNewContact({ name: "", email: "", phone: "", title: "" })
  }

  const handleAddLabel = (label: string) => {
    if (!labels.includes(label)) {
      setLabels([...labels, label])
    }
    setLabelPopoverOpen(false)
    setNewLabelInput("")
  }

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label))
  }

  const handleSaveLabels = async () => {
    if (!customer) return

    try {
      await updateCustomer.mutateAsync({
        id: customer.id,
        data: { labels },
      })
      // Invalidate customer queries to refresh data
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(customer.id) })
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() })
      setIsEditingLabels(false)
    } catch (error) {
      console.error("Failed to save labels:", error)
    }
  }

  // Team member handlers
  const handleStartAddTeamMember = () => {
    setAddingTeamMember(true)
  }

  const handleCancelAddTeamMember = () => {
    setAddingTeamMember(false)
    setNewTeamMember({ userId: null, userName: '', userEmail: '', roleId: null })
  }

  const handleSaveTeamMember = async () => {
    if (!customer || !newTeamMember.userId) return

    try {
      // The API needs domain, not customerId - get domain from customer
      const domain = customer.domains[0]
      if (!domain) {
        console.error("Customer has no domain")
        return
      }

      await addCustomerToUser.mutateAsync({
        userId: newTeamMember.userId,
        customerDomain: domain,
        roleId: newTeamMember.roleId || undefined,
      })

      // Invalidate team members query to refetch
      queryClient.invalidateQueries({ queryKey: userKeys.byCustomer(customer.id) })

      setAddingTeamMember(false)
      setNewTeamMember({ userId: null, userName: '', userEmail: '', roleId: null })
    } catch (error) {
      console.error("Failed to add team member:", error)
    }
  }

  const handleRemoveTeamMember = async (userId: string) => {
    if (!customer) return

    try {
      await removeCustomerFromUser.mutateAsync({
        userId,
        customerId: customer.id,
      })

      // Invalidate team members query to refetch
      queryClient.invalidateQueries({ queryKey: userKeys.byCustomer(customer.id) })
    } catch (error) {
      console.error("Failed to remove team member:", error)
    }
  }

  const handleStartEditTeamMember = (userId: string, currentRoleId: string | null) => {
    setEditingTeamMember(userId)
    setEditingRoleId(currentRoleId)
  }

  const handleCancelEditTeamMember = () => {
    setEditingTeamMember(null)
    setEditingRoleId(null)
  }

  const handleSaveEditTeamMember = async () => {
    if (!customer || !editingTeamMember) return

    try {
      const domain = customer.domains[0]
      if (!domain) {
        console.error("Customer has no domain")
        return
      }

      // Re-add with new role (API upserts)
      await addCustomerToUser.mutateAsync({
        userId: editingTeamMember,
        customerDomain: domain,
        roleId: editingRoleId || undefined,
      })

      // Invalidate team members query to refetch
      queryClient.invalidateQueries({ queryKey: userKeys.byCustomer(customer.id) })

      setEditingTeamMember(null)
      setEditingRoleId(null)
    } catch (error) {
      console.error("Failed to update team member role:", error)
    }
  }

  const availableLabels = predefinedLabels.filter(
    (label) => !labels.includes(label) && label.toLowerCase().includes(newLabelInput.toLowerCase()),
  )

  // Don't render if not visible and animation complete
  if (!shouldRender) return null

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-background/80 backdrop-blur-sm z-40 transition-opacity duration-300 ease-out ${
          isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer - Always full width */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full transform bg-background border-l border-border shadow-xl transition-transform duration-300 ease-out ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{customer.name}</h2>
                  {/* Labels inline with customer name */}
                  {!isEditingLabels ? (
                    <>
                      {labels.map((label) => (
                        <Badge key={label} variant="outline" className="text-xs">
                          {label}
                        </Badge>
                      ))}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setIsEditingLabels(true)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <>
                      {labels.map((label) => (
                        <Badge key={label} variant="outline" className="text-xs">
                          {label}
                          <button className="ml-1 hover:text-destructive" onClick={() => handleRemoveLabel(label)}>
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-6 text-xs bg-transparent">
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[200px] p-0" align="start">
                          <Command>
                            <CommandInput
                              placeholder="Search or add..."
                              value={newLabelInput}
                              onValueChange={setNewLabelInput}
                            />
                            <CommandList>
                              <CommandEmpty>
                                {newLabelInput && (
                                  <button
                                    className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent"
                                    onClick={() => handleAddLabel(newLabelInput)}
                                  >
                                    Create "{newLabelInput}"
                                  </button>
                                )}
                              </CommandEmpty>
                              <CommandGroup>
                                {availableLabels.map((label) => (
                                  <CommandItem key={label} value={label} onSelect={() => handleAddLabel(label)}>
                                    {label}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => {
                          setLabels(customer.labels)
                          setIsEditingLabels(false)
                        }}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" className="h-6 text-xs" onClick={handleSaveLabels} disabled={updateCustomer.isPending}>
                        {updateCustomer.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3 mr-1" />
                        )}
                        Save
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  {customer.domains.join(", ")}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <Tabs
              value={activeTab}
              onValueChange={(v) => onTabChange?.(v)}
              className="h-full flex flex-col"
            >
              <TabsList className="mx-6 mt-6 mb-0 flex-shrink-0">
                <TabsTrigger value="emails">
                  Emails {isLoadingEmails ? <Loader2 className="ml-1 h-3 w-3 animate-spin" /> : `(${emailsData?.total ?? 0})`}
                </TabsTrigger>
                <TabsTrigger value="contacts">
                  Contacts {isLoadingContacts ? <Loader2 className="ml-1 h-3 w-3 animate-spin" /> : `(${contacts.length})`}
                </TabsTrigger>
                <TabsTrigger value="team">
                  Team {isLoadingTeam ? <Loader2 className="ml-1 h-3 w-3 animate-spin" /> : `(${teamMembers?.length ?? 0})`}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="flex-1 flex flex-col overflow-hidden mt-0">
                {/* Toolbar - matches InboxView toolbar structure */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search contacts..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="pl-9 h-8"
                    />
                  </div>
                  <Button size="sm" className="h-8" onClick={handleStartAdd} disabled={addingContact}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Contact
                  </Button>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                  {/* Add Contact Form */}
                  {addingContact && (
                    <div className="rounded-lg border border-primary bg-primary/5 p-4 space-y-4">
                      <h4 className="font-medium">New Contact</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="new-name">Name</Label>
                          <Input
                            id="new-name"
                            value={newContact.name}
                            onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                            placeholder="Full name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-title">Title</Label>
                          <Input
                            id="new-title"
                            value={newContact.title}
                            onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                            placeholder="Job title"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-email">Email</Label>
                          <Input
                            id="new-email"
                            type="email"
                            value={newContact.email}
                            onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                            placeholder="email@company.com"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-phone">Phone</Label>
                          <Input
                            id="new-phone"
                            value={newContact.phone}
                            onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                            placeholder="+1 555-0000"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={handleCancelAdd}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveAdd}>
                          <Check className="mr-2 h-4 w-4" />
                          Save Contact
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      {contactTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id} className={header.id === "actions" ? "w-[100px]" : ""}>
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {contactTable.getRowModel().rows?.length ? (
                        contactTable.getRowModel().rows.map((row) => {
                          const contact = row.original
                          return (
                            <React.Fragment key={row.id}>
                              {editingContact === contact.id && editForm ? (
                                <TableRow className="bg-primary/5">
                                  <TableCell colSpan={4} className="p-4">
                                    <div className="space-y-4">
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <Label htmlFor={`edit-name-${contact.id}`}>Name</Label>
                                          <Input
                                            id={`edit-name-${contact.id}`}
                                            value={editForm.name}
                                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor={`edit-title-${contact.id}`}>Title</Label>
                                          <Input
                                            id={`edit-title-${contact.id}`}
                                            value={editForm.title ?? ""}
                                            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor={`edit-email-${contact.id}`}>Email</Label>
                                          <Input
                                            id={`edit-email-${contact.id}`}
                                            type="email"
                                            value={editForm.email}
                                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor={`edit-mobile-${contact.id}`}>Mobile</Label>
                                          <Input
                                            id={`edit-mobile-${contact.id}`}
                                            value={editForm.mobile ?? ""}
                                            onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
                                          />
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2">
                                        <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                                          Cancel
                                        </Button>
                                        <Button size="sm" onClick={handleSaveEdit}>
                                          <Check className="mr-2 h-4 w-4" />
                                          Save Changes
                                        </Button>
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ) : (
                                <TableRow>
                                  {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              )}
                            </React.Fragment>
                          )
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} className="h-24 text-center">
                            No contacts found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="emails" className="flex-1 h-0 min-h-0 overflow-hidden mt-0">
                {isLoadingEmails ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : emailCallbacks && (
                  <InboxView
                    key={`inbox-${customer.id}`}
                    className="h-full"
                    config={{
                      itemType: "email",
                      showSearch: true,
                      showThreadCount: true,
                      showSentimentFilter: true,
                      searchPlaceholder: "Search emails...",
                      emptyMessage: "No emails found",
                      listPanelWidth: "350px",
                      embedded: true,
                    }}
                    callbacks={emailCallbacks}
                    initialSelectedId={selectedEmailId}
                    sentimentFilter={emailSentimentFilter}
                    onSentimentFilterChange={setEmailSentimentFilter}
                  />
                )}
              </TabsContent>

              <TabsContent value="team" className="flex-1 flex flex-col overflow-hidden mt-0">
                {/* Toolbar */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>Team members assigned to this customer</span>
                  </div>
                  <div className="flex-1" />
                  <Button size="sm" className="h-8" onClick={handleStartAddTeamMember} disabled={addingTeamMember}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Team Member
                  </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                  {/* Team Members Table */}
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead className="w-[100px]">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* Add new team member row */}
                        {addingTeamMember && (
                          <TableRow className="bg-primary/5">
                            <TableCell>
                              <UserAutocomplete
                                value={newTeamMember.userId}
                                onChange={(userId, userName, userEmail) => {
                                  setNewTeamMember({
                                    ...newTeamMember,
                                    userId,
                                    userName: userName || '',
                                    userEmail: userEmail || '',
                                  })
                                }}
                                excludeIds={existingTeamUserIds}
                                placeholder="Select user..."
                                onlyLoginable
                              />
                            </TableCell>
                            <TableCell>
                              <RoleSelect
                                value={newTeamMember.roleId}
                                onChange={(roleId) => setNewTeamMember({ ...newTeamMember, roleId })}
                                placeholder="Select role..."
                                className="w-40"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={handleCancelAddTeamMember}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-green-600 hover:text-green-600"
                                  onClick={handleSaveTeamMember}
                                  disabled={!newTeamMember.userId || addCustomerToUser.isPending}
                                >
                                  {addCustomerToUser.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        {teamMembers && teamMembers.length > 0 ? (
                          teamMembers.map((member) => {
                            const isEditing = editingTeamMember === member.id
                            return (
                              <TableRow key={member.id}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      {member.firstName} {member.lastName}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                      {member.email}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <RoleSelect
                                      value={editingRoleId}
                                      onChange={setEditingRoleId}
                                      placeholder="Select role..."
                                      className="w-40"
                                    />
                                  ) : (
                                    <Badge variant="secondary">
                                      {getCustomerRoleName(member.roleId) || 'No role'}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8"
                                          onClick={handleCancelEditTeamMember}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-green-600 hover:text-green-600"
                                          onClick={handleSaveEditTeamMember}
                                          disabled={addCustomerToUser.isPending}
                                        >
                                          {addCustomerToUser.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Check className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8"
                                          onClick={() => handleStartEditTeamMember(member.id, member.roleId)}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-destructive hover:text-destructive"
                                          onClick={() => handleRemoveTeamMember(member.id)}
                                          disabled={removeCustomerFromUser.isPending}
                                        >
                                          {removeCustomerFromUser.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Trash2 className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        ) : !addingTeamMember ? (
                          <TableRow>
                            <TableCell colSpan={3} className="h-24 text-center">
                              No team members assigned.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <EmailDrawer
        email={selectedEmail}
        customerName={customer.name}
        open={emailDrawerOpen}
        onClose={() => setEmailDrawerOpen(false)}
      />
    </>
  )
}
