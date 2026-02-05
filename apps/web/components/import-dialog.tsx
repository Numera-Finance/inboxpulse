"use client"

import * as React from "react"
import { Upload, FileText, X, Download, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import * as XLSX from "xlsx"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onImport?: (data: Record<string, string>[]) => void
  onImportFile?: (file: File) => Promise<void>
  entityType: "customers" | "users" | "employees" // "employees" kept for backwards compatibility
  isLoading?: boolean
}

const templateColumns = {
  customers: ["Client ID", "Client Name", "Bookkeeper", "Accountant", "Controller", "Sr. Controller", "Account manager", "Sales rep", "Domain", "Website"],
  users: ["name", "email", "role", "department"],
  employees: ["name", "email", "role", "department"], // Deprecated, use "users"
}

const templateExamples = {
  customers: [
    { "Client ID": "CLIENT-001", "Client Name": "Acme Corporation", "Bookkeeper": "john@example.com", "Accountant": "", "Controller": "", "Sr. Controller": "", "Account manager": "alice@example.com", "Sales rep": "", "Domain": "acme.com, acme.io", "Website": "https://acme.com" },
    { "Client ID": "CLIENT-002", "Client Name": "TechStart Inc", "Bookkeeper": "", "Accountant": "", "Controller": "bob@example.com", "Sr. Controller": "", "Account manager": "", "Sales rep": "carol@example.com", "Domain": "techstart.io", "Website": "https://techstart.io" },
  ],
  users: [
    { name: "John Doe", email: "john@company.com", role: "Account Manager", department: "Sales" },
    { name: "Jane Smith", email: "jane@company.com", role: "Support Lead", department: "Support" },
  ],
  employees: [
    { name: "John Doe", email: "john@company.com", role: "Account Manager", department: "Sales" },
    { name: "Jane Smith", email: "jane@company.com", role: "Support Lead", department: "Support" },
  ],
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n")
  if (lines.length < 2) return []

  const headers = parseCSVLine(lines[0])
  const records: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header.trim()] = values[index]?.trim() || ""
    })
    records.push(record)
  }

  return records
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function generateTemplateXLSX(entityType: "customers" | "users" | "employees"): Blob {
  // Normalize "employees" to "users"
  const normalizedType = entityType === "employees" ? "users" : entityType
  const columns = templateColumns[normalizedType as keyof typeof templateColumns] || templateColumns.users
  const examples = templateExamples[normalizedType as keyof typeof templateExamples] || templateExamples.users

  // For customers, examples already have proper column names
  // For other types, convert examples to array of objects with proper column names
  let data: Record<string, string>[]
  if (normalizedType === "customers") {
    data = examples as Record<string, string>[]
  } else {
    data = examples.map((ex) => {
      const row: Record<string, string> = {}
      columns.forEach((col) => {
        row[col] = (ex as Record<string, string>)[col] || ""
      })
      return row
    })
  }

  // Create worksheet with proper column order
  const header = columns
  const dataRows = data.map(row => columns.map(col => row[col] || ""))
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...dataRows])

  // Set column widths for customers
  if (normalizedType === "customers") {
    worksheet["!cols"] = [
      { wch: 15 }, // Client ID
      { wch: 30 }, // Client Name
      { wch: 25 }, // Bookkeeper
      { wch: 25 }, // Accountant
      { wch: 25 }, // Controller
      { wch: 25 }, // Sr. Controller
      { wch: 25 }, // Account manager
      { wch: 25 }, // Sales rep
      { wch: 35 }, // Domain
      { wch: 35 }, // Website
    ]
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template")

  const xlsxBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  return new Blob([xlsxBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

function parseXLSX(buffer: ArrayBuffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "array" })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  return XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, { defval: "" })
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImportDialog({ open, onClose, onImport, onImportFile, entityType, isLoading }: ImportDialogProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [parsedData, setParsedData] = React.useState<Record<string, string>[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Determine if we should parse the file (only for legacy onImport mode)
  const shouldParseFile = !onImportFile && onImport

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      processFile(droppedFile)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      processFile(selectedFile)
    }
  }

  const processFile = async (selectedFile: File) => {
    setError(null)

    const isCSV = selectedFile.name.endsWith(".csv")
    const isXLS = selectedFile.name.endsWith(".xls") || selectedFile.name.endsWith(".xlsx")

    if (!isCSV && !isXLS) {
      setError("Please upload a CSV or Excel file")
      return
    }

    // For file upload mode, just set the file without parsing
    if (onImportFile) {
      setFile(selectedFile)
      setParsedData([])
      return
    }

    // For legacy mode, parse the file
    try {
      let data: Record<string, string>[]

      if (isCSV) {
        const text = await selectedFile.text()
        data = parseCSV(text)
      } else {
        const buffer = await selectedFile.arrayBuffer()
        data = parseXLSX(buffer)
      }

      if (data.length === 0) {
        setError("No valid records found in the file")
        return
      }

      setFile(selectedFile)
      setParsedData(data)
    } catch (err) {
      setError("Failed to parse the file")
    }
  }

  const handleDownloadTemplate = () => {
    const blob = generateTemplateXLSX(entityType)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const normalizedType = entityType === "employees" ? "users" : entityType
    a.download = `${normalizedType}-template.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    if (onImportFile && file) {
      await onImportFile(file)
    } else if (onImport) {
      onImport(parsedData)
    }
    handleClose()
  }

  const handleClose = () => {
    setFile(null)
    setParsedData([])
    setError(null)
    onClose()
  }

  const handleRemoveFile = () => {
    setFile(null)
    setParsedData([])
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import {entityType === "customers" ? "Customers" : "Users"}</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file to import {entityType === "customers" ? "customers" : "users"}. Download the template to see the required format.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download Template
          </Button>

          {!file ? (
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-medium">Drag and drop your file here</p>
              <p className="text-xs text-muted-foreground mt-1">CSV or Excel (.xlsx, .xls)</p>
              <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleFileSelect} />
            </div>
          ) : (
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {shouldParseFile
                        ? `${parsedData.length} record${parsedData.length !== 1 ? "s" : ""} found`
                        : formatFileSize(file.size)
                      }
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={handleRemoveFile} disabled={isLoading}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>Ready to import</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!file || (shouldParseFile && parsedData.length === 0) || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
