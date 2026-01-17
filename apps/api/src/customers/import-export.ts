/**
 * Customer Import/Export Utilities
 *
 * Format: Excel file with the following columns:
 * - Client ID: External identifier (maps to externalId)
 * - Client Name: Customer name
 * - Bookkeeper: Email address(es) of user(s) with Book Keeper role
 * - Accountant: Email address(es) of user(s) with Accountant role
 * - Controller: Email address(es) of user(s) with Controller role
 * - Sr. Controller: Email address(es) of user(s) with Sr Controller role
 * - Account manager: Email address(es) of user(s) with Account Manager role
 * - Sales rep: Email address(es) of user(s) with Sales Person role
 * - Domain: Customer domain(s), comma-separated
 * - Website: Customer website URL
 *
 * Multiple emails per role can be comma-separated.
 * During import, existing customers are matched by externalId.
 */

import * as XLSX from 'xlsx';
import { CUSTOMER_ROLES } from '@crm/shared';

/**
 * Column names in the spreadsheet (case-insensitive matching)
 */
export const IMPORT_COLUMNS = {
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  BOOKKEEPER: 'Bookkeeper',
  ACCOUNTANT: 'Accountant',
  CONTROLLER: 'Controller',
  SR_CONTROLLER: 'Sr. Controller',
  ACCOUNT_MANAGER: 'Account manager',
  SALES_REP: 'Sales rep',
  DOMAIN: 'Domain',
  WEBSITE: 'Website',
} as const;

/**
 * Mapping from spreadsheet column names to customer role IDs
 */
export const COLUMN_TO_ROLE_ID: Record<string, string> = {
  [IMPORT_COLUMNS.BOOKKEEPER.toLowerCase()]: CUSTOMER_ROLES.BOOK_KEEPER.id,
  [IMPORT_COLUMNS.ACCOUNTANT.toLowerCase()]: CUSTOMER_ROLES.ACCOUNTANT.id,
  [IMPORT_COLUMNS.CONTROLLER.toLowerCase()]: CUSTOMER_ROLES.CONTROLLER.id,
  [IMPORT_COLUMNS.SR_CONTROLLER.toLowerCase()]: CUSTOMER_ROLES.SR_CONTROLLER.id,
  [IMPORT_COLUMNS.ACCOUNT_MANAGER.toLowerCase()]: CUSTOMER_ROLES.ACCOUNT_MANAGER.id,
  [IMPORT_COLUMNS.SALES_REP.toLowerCase()]: CUSTOMER_ROLES.SALES_PERSON.id,
};

/**
 * Mapping from role IDs to spreadsheet column names
 */
export const ROLE_ID_TO_COLUMN: Record<string, string> = {
  [CUSTOMER_ROLES.BOOK_KEEPER.id]: IMPORT_COLUMNS.BOOKKEEPER,
  [CUSTOMER_ROLES.ACCOUNTANT.id]: IMPORT_COLUMNS.ACCOUNTANT,
  [CUSTOMER_ROLES.CONTROLLER.id]: IMPORT_COLUMNS.CONTROLLER,
  [CUSTOMER_ROLES.SR_CONTROLLER.id]: IMPORT_COLUMNS.SR_CONTROLLER,
  [CUSTOMER_ROLES.ACCOUNT_MANAGER.id]: IMPORT_COLUMNS.ACCOUNT_MANAGER,
  [CUSTOMER_ROLES.SALES_PERSON.id]: IMPORT_COLUMNS.SALES_REP,
};

/**
 * Role columns in the spreadsheet (for iteration)
 */
export const ROLE_COLUMNS = [
  IMPORT_COLUMNS.BOOKKEEPER,
  IMPORT_COLUMNS.ACCOUNTANT,
  IMPORT_COLUMNS.CONTROLLER,
  IMPORT_COLUMNS.SR_CONTROLLER,
  IMPORT_COLUMNS.ACCOUNT_MANAGER,
  IMPORT_COLUMNS.SALES_REP,
];

/**
 * Parsed row from import file
 */
export interface ImportRow {
  rowNumber: number;
  externalId: string;
  name: string;
  domains: string[];
  website: string;
  teamAssignments: Array<{
    email: string;
    roleId: string;
    columnName: string;
  }>;
}

/**
 * Import result for a single row
 */
export interface ImportRowResult {
  row: number;
  externalId: string;
  success: boolean;
  customerId?: string;
  error?: string;
  warnings: string[];
}

/**
 * Overall import result
 */
export interface CustomerImportResult {
  imported: number;
  updated: number;
  errors: Array<{
    row: number;
    externalId: string;
    error: string;
  }>;
  warnings: Array<{
    row: number;
    externalId: string;
    warning: string;
  }>;
}

/**
 * Parse Excel file buffer into import rows
 */
export function parseCustomerImport(buffer: Buffer): ImportRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Parse as array of objects with string values
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false, // Get string values
  });

  const importRows: ImportRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    const rowNumber = i + 2; // +2 because row 1 is header, array is 0-indexed

    // Normalize column names to handle case variations
    const normalizedRow: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawRow)) {
      normalizedRow[key.toLowerCase().trim()] = String(value ?? '').trim();
    }

    // Extract basic fields
    const externalId = normalizedRow[IMPORT_COLUMNS.CLIENT_ID.toLowerCase()] || '';
    const name = normalizedRow[IMPORT_COLUMNS.CLIENT_NAME.toLowerCase()] || '';
    const domainStr = normalizedRow[IMPORT_COLUMNS.DOMAIN.toLowerCase()] || '';
    const website = normalizedRow[IMPORT_COLUMNS.WEBSITE.toLowerCase()] || '';

    // Parse domains (comma-separated)
    const domains = domainStr
      .split(',')
      .map(d => d.trim().toLowerCase())
      .filter(d => d.length > 0);

    // Extract team assignments from role columns
    const teamAssignments: ImportRow['teamAssignments'] = [];
    for (const columnName of ROLE_COLUMNS) {
      const emailsStr = normalizedRow[columnName.toLowerCase()] || '';
      if (emailsStr) {
        const roleId = COLUMN_TO_ROLE_ID[columnName.toLowerCase()];
        if (roleId) {
          // Parse comma-separated emails
          const emails = emailsStr
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(e => e.length > 0 && e.includes('@'));

          for (const email of emails) {
            teamAssignments.push({ email, roleId, columnName });
          }
        }
      }
    }

    importRows.push({
      rowNumber,
      externalId,
      name,
      domains,
      website,
      teamAssignments,
    });
  }

  return importRows;
}

/**
 * Data structure for export
 */
export interface CustomerExportData {
  externalId: string | null;
  name: string | null;
  domains: string[];
  website: string | null;
  teamAssignments: Array<{
    email: string;
    roleId: string | null;
  }>;
}

/**
 * Generate Excel file buffer for export
 */
export function generateCustomerExport(customers: CustomerExportData[]): Buffer {
  // Build rows for export
  const rows: Record<string, string>[] = [];

  for (const customer of customers) {
    const row: Record<string, string> = {
      [IMPORT_COLUMNS.CLIENT_ID]: customer.externalId || '',
      [IMPORT_COLUMNS.CLIENT_NAME]: customer.name || '',
      [IMPORT_COLUMNS.DOMAIN]: customer.domains.join(', '),
      [IMPORT_COLUMNS.WEBSITE]: customer.website || '',
    };

    // Initialize all role columns to empty
    for (const columnName of ROLE_COLUMNS) {
      row[columnName] = '';
    }

    // Group team assignments by role
    const emailsByRole: Record<string, string[]> = {};
    for (const assignment of customer.teamAssignments) {
      if (assignment.roleId) {
        const columnName = ROLE_ID_TO_COLUMN[assignment.roleId];
        if (columnName) {
          if (!emailsByRole[columnName]) {
            emailsByRole[columnName] = [];
          }
          emailsByRole[columnName].push(assignment.email);
        }
      }
    }

    // Populate role columns with comma-separated emails
    for (const [columnName, emails] of Object.entries(emailsByRole)) {
      row[columnName] = emails.join(', ');
    }

    rows.push(row);
  }

  // Create workbook with proper column order
  const columnOrder = [
    IMPORT_COLUMNS.CLIENT_ID,
    IMPORT_COLUMNS.CLIENT_NAME,
    ...ROLE_COLUMNS,
    IMPORT_COLUMNS.DOMAIN,
    IMPORT_COLUMNS.WEBSITE,
  ];

  // Convert to array of arrays for better control
  const header = columnOrder;
  const dataRows = rows.map(row => columnOrder.map(col => row[col] || ''));

  const worksheet = XLSX.utils.aoa_to_sheet([header, ...dataRows]);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 15 }, // Client ID
    { wch: 30 }, // Client Name
    { wch: 30 }, // Bookkeeper
    { wch: 30 }, // Accountant
    { wch: 30 }, // Controller
    { wch: 30 }, // Sr. Controller
    { wch: 30 }, // Account manager
    { wch: 30 }, // Sales rep
    { wch: 40 }, // Domain
    { wch: 40 }, // Website
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');

  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}

/**
 * Generate template Excel file for download
 */
export function generateCustomerTemplate(): Buffer {
  const exampleRows: CustomerExportData[] = [
    {
      externalId: 'CLIENT-001',
      name: 'Acme Corporation',
      domains: ['acme.com', 'acme.io'],
      website: 'https://acme.com',
      teamAssignments: [
        { email: 'john@example.com', roleId: CUSTOMER_ROLES.ACCOUNT_MANAGER.id },
        { email: 'jane@example.com', roleId: CUSTOMER_ROLES.BOOK_KEEPER.id },
      ],
    },
    {
      externalId: 'CLIENT-002',
      name: 'TechStart Inc',
      domains: ['techstart.io'],
      website: 'https://techstart.io',
      teamAssignments: [
        { email: 'bob@example.com', roleId: CUSTOMER_ROLES.CONTROLLER.id },
        { email: 'alice@example.com', roleId: CUSTOMER_ROLES.SALES_PERSON.id },
      ],
    },
  ];

  return generateCustomerExport(exampleRows);
}
