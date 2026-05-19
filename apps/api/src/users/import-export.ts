/**
 * User Import/Export Utilities
 *
 * One row per user-customer assignment for both directions.
 *
 * Import (CSV):
 * firstName,lastName,email,managerEmails,customerDomain,role,active
 * John,Doe,john@example.com,"mgr1@example.com,mgr2@example.com",acme.com,Account Manager,0
 * John,Doe,john@example.com,"mgr1@example.com,mgr2@example.com",techcorp.com,Controller,0
 *
 * Export (xlsx): same columns as import, plus a `canLogin` flag.
 */

import * as XLSX from 'xlsx';
import type { User, UserCustomer } from './schema';

export interface ImportRow {
  firstName: string;
  lastName: string;
  email: string;
  managerEmails: string; // Comma-separated
  customerDomain: string;
  role: string; // Role name (e.g., "Account Manager")
  active: string; // "0" or "1"
}

export interface ImportResult {
  imported: number;
  errors: Array<{
    row: number;
    email: string;
    error: string;
  }>;
}

/**
 * Parse CSV file content
 * Simple CSV parser - handles quoted fields and comma-separated values
 */
export function parseCSV(content: string): ImportRow[] {
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return [];
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const headerMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    headerMap[h.trim().toLowerCase()] = i;
  });

  // Parse data rows
  const records: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const record: any = {};
    for (const [key, index] of Object.entries(headerMap)) {
      record[key] = values[index] || '';
    }
    records.push(record as ImportRow);
  }

  return records;
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add last field
  result.push(current.trim());

  return result;
}

/**
 * Parse manager emails from comma-separated string
 */
export function parseManagerEmails(emails: string): string[] {
  if (!emails || emails.trim() === '') {
    return [];
  }
  // Remove quotes if present and split by comma
  return emails
    .replace(/^["']|["']$/g, '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

/**
 * Group import rows by user email
 */
export function groupImportRows(rows: ImportRow[]): Map<string, ImportRow[]> {
  const grouped = new Map<string, ImportRow[]>();

  for (const row of rows) {
    const email = row.email.toLowerCase().trim();
    if (!grouped.has(email)) {
      grouped.set(email, []);
    }
    grouped.get(email)!.push(row);
  }

  return grouped;
}

/**
 * Generate Excel workbook for user export.
 * One row per user-customer assignment (matches the import format).
 */
export function generateUserExport(
  userData: Array<{
    user: User;
    managers: Array<{ email: string }>;
    customers: Array<{ domain: string; roleName: string }>;
  }>
): Buffer {
  const header = [
    'firstName',
    'lastName',
    'email',
    'canLogin',
    'managerEmails',
    'customerDomain',
    'role',
    'active',
  ];

  const dataRows: string[][] = [];
  for (const item of userData) {
    const managerEmails = item.managers.map((m) => m.email).join(',');
    const active = item.user.rowStatus === 0 ? '0' : '1';
    const canLogin = item.user.canLogin ? 'true' : 'false';

    if (item.customers.length === 0) {
      dataRows.push([
        item.user.firstName,
        item.user.lastName,
        item.user.email,
        canLogin,
        managerEmails,
        '',
        '',
        active,
      ]);
    } else {
      for (const customer of item.customers) {
        dataRows.push([
          item.user.firstName,
          item.user.lastName,
          item.user.email,
          canLogin,
          managerEmails,
          customer.domain,
          customer.roleName,
          active,
        ]);
      }
    }
  }

  const worksheet = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  worksheet['!cols'] = [
    { wch: 18 }, // firstName
    { wch: 18 }, // lastName
    { wch: 32 }, // email
    { wch: 10 }, // canLogin
    { wch: 40 }, // managerEmails
    { wch: 28 }, // customerDomain
    { wch: 24 }, // role
    { wch: 8 },  // active
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');

  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}
