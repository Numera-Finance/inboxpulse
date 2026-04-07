"use client"

import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface ColumnConfig {
  width?: string
  headerWidth?: string
  cellWidth?: string
}

interface TableSkeletonProps {
  columns: number | ColumnConfig[]
  rows?: number
}

export function TableSkeleton({
  columns,
  rows = 5,
}: TableSkeletonProps) {
  // Handle both simple number of columns or detailed config
  const columnConfigs: ColumnConfig[] = typeof columns === 'number'
    ? Array(columns).fill({})
    : columns
  const columnCount = columnConfigs.length

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {columnConfigs.map((config, i) => (
              <TableHead key={i} style={config.width ? { width: config.width } : undefined}>
                <Skeleton className={`h-4 ${config.headerWidth || 'w-16'}`} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(rows)].map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {columnConfigs.map((config, colIndex) => (
                <TableCell key={colIndex}>
                  <Skeleton className={`h-4 ${config.cellWidth || 'w-full max-w-[120px]'}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// Pre-configured skeletons for common table types
export function UserTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <TableSkeleton
      rows={rows}
      columns={[
        { headerWidth: 'w-12', cellWidth: 'w-40' },      // Name (with avatar)
        { headerWidth: 'w-10', cellWidth: 'w-24' },      // Role
        { headerWidth: 'w-20', cellWidth: 'w-20' },      // Department
        { headerWidth: 'w-16', cellWidth: 'w-16' },      // Reports To
        { headerWidth: 'w-16', cellWidth: 'w-16' },      // Customers
        { headerWidth: 'w-12', cellWidth: 'w-14' },      // Status
        { headerWidth: 'w-8', cellWidth: 'w-20' },       // Actions
      ]}
    />
  )
}

export function CustomerTableSkeleton({ rows = 15 }: { rows?: number }) {
  return (
    <TableSkeleton
      rows={rows}
      columns={[
        { width: '22%', headerWidth: 'w-20', cellWidth: 'w-36' },  // Customer
        { headerWidth: 'w-12', cellWidth: 'w-8' },                  // Emails
        { headerWidth: 'w-14', cellWidth: 'w-8' },                  // Avg TAT
        { headerWidth: 'w-12', cellWidth: 'w-8' },                  // Upsell
        { headerWidth: 'w-12', cellWidth: 'w-8' },                  // Churn
        { headerWidth: 'w-14', cellWidth: 'w-8' },                  // Negative
        { headerWidth: 'w-14', cellWidth: 'w-8' },                  // Positive
        { headerWidth: 'w-20', cellWidth: 'w-20' },                 // Last Email
      ]}
    />
  )
}
