"use client"

import * as React from "react"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type SortingState,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { type User } from "@/lib/types"
import { TablePagination } from "@/components/ui/table-pagination"

interface UserTableProps {
  users: User[]
  onSelect: (user: User) => void
  pagination?: { pageIndex: number; pageSize: number }
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void
  totalCount?: number
}

export function UserTable({ users, onSelect, pagination, onPaginationChange, totalCount }: UserTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([])

  // Use server-side pagination if props are provided
  const isServerSide = pagination !== undefined && onPaginationChange !== undefined

  const statusStyles: Record<string, string> = {
    Active: "bg-green-500/10 text-green-600 dark:text-green-400",
    Inactive: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
    "On Leave": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  }

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="px-0 hover:bg-transparent justify-start"
        >
          Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const user = row.original
        const initials = user.name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2)
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
        )
      },
      size: 250,
    },
    {
      accessorKey: "role",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="px-0 hover:bg-transparent justify-start"
        >
          Role
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      size: 150,
    },
    {
      accessorKey: "reportsTo",
      header: () => <span className="w-full text-center block">Reports To</span>,
      cell: ({ row }) => {
        const managerIds = row.original.reportsTo
        if (managerIds.length === 0) return <span className="text-muted-foreground w-full text-center block">—</span>
        return (
          <div className="flex flex-wrap gap-1 justify-center">
            <Badge variant="outline" className="text-xs">
              {managerIds.length} manager{managerIds.length > 1 ? 's' : ''}
            </Badge>
          </div>
        )
      },
      size: 120,
    },
    {
      accessorKey: "assignedCustomers",
      header: () => <span className="w-full text-center block">Customers</span>,
      cell: ({ row }) => {
        const customerIds = row.original.assignedCustomers
        return (
          <div className="flex items-center gap-1 justify-center">
            <span className="text-sm">{customerIds.length}</span>
            <span className="text-xs text-muted-foreground">
              {customerIds.length === 1 ? 'customer' : 'customers'}
            </span>
          </div>
        )
      },
      size: 110,
    },
    {
      accessorKey: "lastLoginAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="px-0 hover:bg-transparent justify-start"
        >
          Last Login
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const lastLoginAt = row.original.lastLoginAt
        if (!lastLoginAt) {
          return <span className="text-muted-foreground">Never</span>
        }
        const date = new Date(lastLoginAt)

        return (
          <span className="text-sm" title={date.toLocaleString()}>
            {formatDistanceToNow(date, { addSuffix: true })}
          </span>
        )
      },
      size: 110,
    },
    {
      accessorKey: "status",
      header: () => <span className="w-full text-center block">Status</span>,
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <div className="flex justify-center">
            <Badge variant="secondary" className={cn(statusStyles[status])}>
              {status}
            </Badge>
          </div>
        )
      },
      size: 100,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const user = row.original
        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation()
                onSelect(user)
              }}
            >
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelect(user)}>View Details</DropdownMenuItem>
                <DropdownMenuItem>Send Message</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">Deactivate</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      size: 120,
    },
  ]

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    ...(isServerSide
      ? {
          manualPagination: true,
          pageCount: Math.ceil((totalCount ?? 0) / (pagination?.pageSize ?? 50)),
          state: {
            sorting,
            pagination: pagination ?? { pageIndex: 0, pageSize: 50 },
          },
          onPaginationChange: (updater) => {
            if (onPaginationChange) {
              const newPagination = typeof updater === 'function'
                ? updater(pagination ?? { pageIndex: 0, pageSize: 50 })
                : updater
              onPaginationChange(newPagination)
            }
          },
        }
      : {
          state: { sorting },
          initialState: {
            pagination: {
              pageSize: 50,
            },
          },
        }),
  })

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.column.getSize() }}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onSelect(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <TablePagination table={table} />
    </div>
  )
}
