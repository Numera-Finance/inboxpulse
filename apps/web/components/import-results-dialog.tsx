"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, AlertTriangle, Download } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ImportError {
  row: number
  externalId?: string
  email?: string
  error: string
}

export interface ImportWarning {
  row: number
  externalId?: string
  email?: string
  warning: string
}

export interface ImportResults {
  imported: number
  updated?: number
  errors: ImportError[]
  warnings?: ImportWarning[]
}

interface ImportResultsDialogProps {
  open: boolean
  onClose: () => void
  results: ImportResults | null
  entityType: "customers" | "users"
}

function exportErrorsToCSV(errors: ImportError[], entityType: string): void {
  const headers = ["Row", "Identifier", "Error"]
  const rows = errors.map(e => [
    e.row.toString(),
    e.externalId || e.email || "",
    `"${e.error.replace(/"/g, '""')}"` // Escape quotes in CSV
  ])

  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n")
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${entityType}-import-errors.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportResultsDialog({ open, onClose, results, entityType }: ImportResultsDialogProps) {
  if (!results) return null

  const hasErrors = results.errors.length > 0
  const hasWarnings = results.warnings && results.warnings.length > 0
  const hasSuccess = results.imported > 0 || (results.updated && results.updated > 0)

  const totalProcessed = results.imported + (results.updated || 0)
  const totalFailed = results.errors.length

  // Determine overall status
  const status = hasErrors && !hasSuccess ? "error" : hasErrors ? "partial" : "success"

  const statusConfig = {
    success: {
      icon: CheckCircle2,
      iconColor: "text-green-600",
      bgColor: "bg-green-50",
      borderColor: "border-green-200",
      title: "Import Successful",
    },
    partial: {
      icon: AlertTriangle,
      iconColor: "text-yellow-600",
      bgColor: "bg-yellow-50",
      borderColor: "border-yellow-200",
      title: "Import Completed with Issues",
    },
    error: {
      icon: AlertCircle,
      iconColor: "text-red-600",
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      title: "Import Failed",
    },
  }

  const config = statusConfig[status]
  const StatusIcon = config.icon

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusIcon className={cn("h-5 w-5", config.iconColor)} />
            {config.title}
          </DialogTitle>
          <DialogDescription>
            {entityType === "customers" ? "Customer" : "User"} import results
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Summary */}
          <div className={cn("rounded-lg p-4 border", config.bgColor, config.borderColor)}>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {results.imported > 0 && (
                <div>
                  <span className="text-muted-foreground">Created:</span>
                  <span className="ml-2 font-medium text-green-700">{results.imported}</span>
                </div>
              )}
              {results.updated !== undefined && results.updated > 0 && (
                <div>
                  <span className="text-muted-foreground">Updated:</span>
                  <span className="ml-2 font-medium text-blue-700">{results.updated}</span>
                </div>
              )}
              {totalFailed > 0 && (
                <div>
                  <span className="text-muted-foreground">Failed:</span>
                  <span className="ml-2 font-medium text-red-700">{totalFailed}</span>
                </div>
              )}
              {hasWarnings && (
                <div>
                  <span className="text-muted-foreground">Warnings:</span>
                  <span className="ml-2 font-medium text-yellow-700">{results.warnings!.length}</span>
                </div>
              )}
            </div>
          </div>

          {/* Errors */}
          {hasErrors && (
            <div className="flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h4 className="text-sm font-medium text-red-700 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  Errors ({results.errors.length})
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => exportErrorsToCSV(results.errors, entityType)}
                  className="h-7 text-xs"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Export Errors
                </Button>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50/50 max-h-[250px] overflow-y-auto">
                <div className="p-3 space-y-2">
                  {results.errors.slice(0, 50).map((error, index) => (
                    <div
                      key={index}
                      className="text-sm p-2 rounded bg-white border border-red-100"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-red-600 font-mono text-xs bg-red-100 px-1.5 py-0.5 rounded">
                          Row {error.row}
                        </span>
                        {(error.externalId || error.email) && (
                          <span className="text-muted-foreground text-xs truncate max-w-[120px]">
                            {error.externalId || error.email}
                          </span>
                        )}
                      </div>
                      <p className="text-red-800 mt-1">{error.error}</p>
                    </div>
                  ))}
                  {results.errors.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Showing first 50 of {results.errors.length} errors. Export to see all.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div className="flex flex-col min-h-0">
              <h4 className="text-sm font-medium text-yellow-700 mb-2 flex items-center gap-1 flex-shrink-0">
                <AlertTriangle className="h-4 w-4" />
                Warnings ({results.warnings!.length})
              </h4>
              <div className="rounded-md border border-yellow-200 bg-yellow-50/50 max-h-[150px] overflow-y-auto">
                <div className="p-3 space-y-2">
                  {results.warnings!.slice(0, 20).map((warning, index) => (
                    <div
                      key={index}
                      className="text-sm p-2 rounded bg-white border border-yellow-100"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-yellow-600 font-mono text-xs bg-yellow-100 px-1.5 py-0.5 rounded">
                          Row {warning.row}
                        </span>
                        {(warning.externalId || warning.email) && (
                          <span className="text-muted-foreground text-xs truncate max-w-[120px]">
                            {warning.externalId || warning.email}
                          </span>
                        )}
                      </div>
                      <p className="text-yellow-800 mt-1">{warning.warning}</p>
                    </div>
                  ))}
                  {results.warnings!.length > 20 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Showing first 20 of {results.warnings!.length} warnings.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
