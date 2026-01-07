"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { downloadBlob } from "@/lib/utils/export"

interface ExportButtonProps {
  /** Function that returns the blob to download */
  onExport: () => Promise<Blob>
  /** Filename for the downloaded file */
  filename?: string
  /** Button variant */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  /** Additional CSS classes */
  className?: string
  /** Button content (defaults to "Export") */
  children?: React.ReactNode
  /** Disable the button */
  disabled?: boolean
}

export function ExportButton({
  onExport,
  filename,
  variant = "outline",
  className = "",
  children,
  disabled,
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = React.useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const blob = await onExport()

      if (blob.size === 0) {
        toast.info("No data to export")
        return
      }

      const defaultFilename = `export-${new Date().toISOString().split("T")[0]}.xlsx`
      downloadBlob(blob, filename || defaultFilename)

      toast.success("Export successful")
    } catch (error) {
      console.error("Failed to export:", error)
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button
      variant={variant}
      onClick={handleExport}
      disabled={disabled || isExporting}
      className={className}
    >
      {isExporting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {isExporting ? "Exporting..." : children || "Export"}
    </Button>
  )
}
