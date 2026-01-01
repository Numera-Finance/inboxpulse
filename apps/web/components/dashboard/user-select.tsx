"use client"

import * as React from "react"
import { Check, ChevronsUpDown, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useAssignableUsers } from "@/lib/hooks"

interface UserSelectProps {
  value: string | null
  onChange: (userId: string | null) => void
  placeholder?: string
  className?: string
}

export function UserSelect({
  value,
  onChange,
  placeholder = "All Users",
  className,
}: UserSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const { data: users = [], isLoading } = useAssignableUsers()

  const filteredUsers = React.useMemo(() => {
    if (!search) return users
    const searchLower = search.toLowerCase()
    return users.filter((user) =>
      user.name.toLowerCase().includes(searchLower)
    )
  }, [users, search])

  const selectedUser = users.find((u) => u.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between min-w-[180px]", className)}
        >
          <div className="flex items-center gap-2 truncate">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selectedUser ? selectedUser.name : placeholder}
            </span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search users..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : "No users found."}
            </CommandEmpty>
            <CommandGroup>
              {/* All Users option */}
              <CommandItem
                value=""
                onSelect={() => {
                  onChange(null)
                  setOpen(false)
                  setSearch("")
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === null ? "opacity-100" : "opacity-0"
                  )}
                />
                All Users
              </CommandItem>
              {/* User list */}
              {filteredUsers.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.id}
                  onSelect={() => {
                    onChange(user.id)
                    setOpen(false)
                    setSearch("")
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === user.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {user.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
