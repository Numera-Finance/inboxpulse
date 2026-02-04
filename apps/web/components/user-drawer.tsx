"use client"

import * as React from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { type User } from "@/lib/types"
import { UserForm, type UserFormData } from "@/components/users/user-form"

interface UserDrawerProps {
  user: User | null
  open: boolean
  onClose: () => void
  onSave?: (id: string, data: UserFormData) => void
  isLoading?: boolean
}

export function UserDrawer({
  user,
  open,
  onClose,
  onSave,
  isLoading,
}: UserDrawerProps) {
  if (!user) return null

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()

  const handleSave = (data: UserFormData) => {
    if (onSave) {
      onSave(user.id, data)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <SheetTitle className="text-xl">Edit User</SheetTitle>
          </div>
        </SheetHeader>
        <UserForm
          initialData={{
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            roleId: user.roleId,
            role: user.role,
            department: user.department,
            canLogin: user.canLogin,
            reportsTo: user.reportsTo,
            customerAssignments: user.customerAssignments.map((a, i) => ({
              id: `existing-${i}`,
              customerId: a.customerId,
              customerName: '',
              customerDomain: '',
              roleId: a.roleId,
            })),
          }}
          onSave={handleSave}
          onCancel={onClose}
          isLoading={isLoading}
          mode="edit"
        />
      </SheetContent>
    </Sheet>
  )
}
