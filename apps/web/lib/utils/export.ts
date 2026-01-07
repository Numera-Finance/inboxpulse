import * as XLSX from "xlsx"

export interface ExportColumn {
  key: string
  header: string
  width?: number
}

/**
 * Create an XLSX blob from data
 */
export function createXlsxBlob<T extends Record<string, unknown>>(
  data: T[],
  options?: {
    columns?: ExportColumn[]
    sheetName?: string
  }
): Blob {
  const sheetName = options?.sheetName || "Sheet1"

  // If columns are specified, transform data to use headers and maintain order
  let exportData: Record<string, unknown>[]
  let colWidths: { wch: number }[] | undefined

  if (options?.columns) {
    exportData = data.map(row => {
      const newRow: Record<string, unknown> = {}
      for (const col of options.columns!) {
        newRow[col.header] = row[col.key] ?? ""
      }
      return newRow
    })
    colWidths = options.columns.map(col => ({ wch: col.width || 20 }))
  } else {
    exportData = data as Record<string, unknown>[]
  }

  const worksheet = XLSX.utils.json_to_sheet(exportData)

  if (colWidths) {
    worksheet["!cols"] = colWidths
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

  const xlsxBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  return new Blob([xlsxBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

/**
 * Export data directly to XLSX file
 */
export function exportToXlsx<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  options?: {
    columns?: ExportColumn[]
    sheetName?: string
  }
): void {
  const blob = createXlsxBlob(data, options)
  downloadBlob(blob, filename)
}
