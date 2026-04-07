/**
 * User Import/Export Utilities
 *
 * Format: Separate rows (one row per user-customer combination)
 *
 * Import Format:
 * firstName,lastName,email,managerEmails,customerDomain,role,active
 * John,Doe,john@example.com,"mgr1@example.com,mgr2@example.com",acme.com,Account Manager,0
 * John,Doe,john@example.com,"mgr1@example.com,mgr2@example.com",techcorp.com,Controller,0
 *
 * Export Format:
 * id,firstName,lastName,email,managerEmails,customerDomain,role,active
 * user-1,John,Doe,john@example.com,"mgr1@example.com,mgr2@example.com",acme.com,Account Manager,0
 */

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
 * Generate CSV content for export
 * Simple CSV generator - escapes fields with quotes if needed
 */
export function generateCSV(
  userData: Array<{
    user: User;
    managers: Array<{ email: string }>;
    customers: Array<{ domain: string; roleName: string }>;
  }>
): string {
  const rows: string[][] = [];

  // Header
  rows.push([
    'id',
    'firstName',
    'lastName',
    'email',
    'canLogin',
    'managerEmails',
    'customerDomain',
    'role',
    'active',
  ]);

  // Data rows (one per user-customer combination)
  for (const item of userData) {
    const managerEmails = item.managers.map((m) => m.email).join(',');
    const active = item.user.rowStatus === 0 ? '0' : '1';

    // One row per customer
    if (item.customers.length === 0) {
      // User with no customers - still export one row
      rows.push([
        item.user.id,
        item.user.firstName,
        item.user.lastName,
        item.user.email,
        item.user.canLogin ? 'true' : 'false',
        managerEmails,
        '', // No customer
        '', // No role
        active,
      ]);
    } else {
      // One row per customer
      for (const customer of item.customers) {
        rows.push([
          item.user.id,
          item.user.firstName,
          item.user.lastName,
          item.user.email,
          item.user.canLogin ? 'true' : 'false',
          managerEmails,
          customer.domain,
          customer.roleName,
          active,
        ]);
      }
    }
  }

  // Convert rows to CSV string
  return rows.map((row) =>
    row.map((field) => {
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      const escaped = field.replace(/"/g, '""');
      if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
        return `"${escaped}"`;
      }
      return escaped;
    }).join(',')
  ).join('\n');
}
