"use client"

import { useState } from "react"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown, Clock, Mail, AlertTriangle, TrendingUp, TrendingDown, ThumbsUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Customer } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TablePagination } from "@/components/ui/table-pagination"

interface CustomerTableProps {
  customers: Customer[]
  onSelect: (customer: Customer) => void
  onSignalClick?: (customer: Customer, signal: string) => void
  pagination?: { pageIndex: number; pageSize: number }
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  totalCount?: number
}

export function CustomerTable({ customers, onSelect, onSignalClick, pagination, onPaginationChange, sorting: controlledSorting, onSortingChange, totalCount }: CustomerTableProps) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const sorting = controlledSorting ?? internalSorting
  const setSorting = onSortingChange ?? setInternalSorting

  // Use server-side pagination if props are provided
  const isServerSide = pagination !== undefined && onPaginationChange !== undefined

  const columns: ColumnDef<Customer>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent justify-start"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Customer
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const customer = row.original
        return (
          <div>
            <div className="font-medium">{customer.name}</div>
            <span className="text-xs text-muted-foreground">@{customer.domains[0]}</span>
          </div>
        )
      },
      size: 200,
    },
    {
      accessorKey: "totalEmails",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent w-full justify-center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <Mail className="mr-1 h-3 w-3" />
          Emails
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="font-medium w-full text-center block">{row.getValue("totalEmails")}</span>,
      size: 100,
    },
    {
      accessorKey: "avgTAT",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent w-full justify-center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <Clock className="mr-1 h-3 w-3" />
          Avg TAT
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="w-full text-center block">{row.getValue("avgTAT") || "—"}</span>,
      size: 110,
    },
    {
      accessorKey: "upsellCount",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent w-full justify-center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <TrendingUp className="mr-1 h-3 w-3" />
          Upsell
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const count = row.getValue("upsellCount") as number
        return (
          <span
            className={cn("font-medium w-full text-center block", count > 0 && "text-green-500 cursor-pointer hover:underline")}
            onClick={count > 0 ? (e) => { e.stopPropagation(); onSignalClick?.(row.original, 'upsell') } : undefined}
          >{count}</span>
        )
      },
      size: 90,
    },
    {
      accessorKey: "churnCount",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent w-full justify-center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <TrendingDown className="mr-1 h-3 w-3" />
          Churn
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const count = row.getValue("churnCount") as number
        return (
          <span
            className={cn("font-medium w-full text-center block", count > 0 && "text-orange-500 cursor-pointer hover:underline")}
            onClick={count > 0 ? (e) => { e.stopPropagation(); onSignalClick?.(row.original, 'churn') } : undefined}
          >{count}</span>
        )
      },
      size: 90,
    },
    {
      accessorKey: "escalations",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent w-full justify-center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <AlertTriangle className="mr-1 h-3 w-3" />
          Negative
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const escalations = row.getValue("escalations") as number
        return (
          <span
            className={cn("font-medium w-full text-center block", escalations > 0 && "text-red-500 cursor-pointer hover:underline")}
            onClick={escalations > 0 ? (e) => { e.stopPropagation(); onSignalClick?.(row.original, 'negative') } : undefined}
          >{escalations}</span>
        )
      },
      size: 110,
    },
    {
      accessorKey: "positiveCount",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent w-full justify-center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          <ThumbsUp className="mr-1 h-3 w-3" />
          Positive
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const count = row.getValue("positiveCount") as number
        return (
          <span
            className={cn("font-medium w-full text-center block", count > 0 && "text-blue-500 cursor-pointer hover:underline")}
            onClick={count > 0 ? (e) => { e.stopPropagation(); onSignalClick?.(row.original, 'positive') } : undefined}
          >{count}</span>
        )
      },
      size: 90,
    },
    {
      accessorKey: "lastContact",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="p-0 hover:bg-transparent justify-start"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Last Email
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.getValue("lastContact")}</span>,
      size: 130,
    },
  ]

  const table = useReactTable({
    data: customers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(!isServerSide && { getSortedRowModel: getSortedRowModel() }),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: (updater) => {
      const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(newSorting);
    },
    ...(isServerSide
      ? {
          manualPagination: true,
          manualSorting: true,
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
      <div className="rounded-lg border border-border overflow-hidden">
        <Table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <col
                key={header.id}
                style={header.column.id === 'name' ? undefined : { width: header.column.getSize() }}
              />
            ))}
          </colgroup>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-muted/50 cursor-pointer"
                  onClick={() => onSelect(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="overflow-hidden text-ellipsis whitespace-nowrap"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
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
