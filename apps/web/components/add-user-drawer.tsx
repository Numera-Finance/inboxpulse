"use client"

import * as React from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { UserForm, type UserFormData } from "@/components/users/user-form"

// Re-export for backwards compatibility
export type { UserFormData } from "@/components/users/user-form"

interface AddUserDrawerProps {
  open: boolean
  onClose: () => void
  onSave: (data: UserFormData) => void
  isLoading?: boolean
}

export function AddUserDrawer({
  open,
  onClose,
  onSave,
  isLoading,
}: AddUserDrawerProps) {
  const [key, setKey] = React.useState(0)

  const handleClose = () => {
    // Reset the form by changing the key
    setKey((k) => k + 1)
    onClose()
  }

  const handleSave = (data: UserFormData) => {
    onSave(data)
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b border-border shrink-0">
          <SheetTitle>Add New User</SheetTitle>
        </SheetHeader>
        <UserForm
          key={key}
          onSave={handleSave}
          onCancel={handleClose}
          isLoading={isLoading}
          mode="add"
        />
      </SheetContent>
    </Sheet>
  )
}
