#!/usr/bin/env node
/**
 * Merge Allocations with Employee Emails
 *
 * This script merges employee names in an allocations spreadsheet with their
 * email addresses from a separate employee email list.
 *
 * REQUIRED INPUTS:
 * ================
 * 1. allocations.xlsx - Customer allocations file with columns:
 *    - Client ID
 *    - Client Name
 *    - Bookkeeper (employee name)
 *    - Accountant (employee name)
 *    - Controler (employee name)
 *    - Sr. Controller (employee name)
 *    - Account manager (employee name)
 *    - Sales rep (employee name)
 *
 * 2. emails.xlsx - Employee email list with Sheet2 containing:
 *    - Name (employee full name, e.g., "Riya P" or "Riya Pasahan")
 *    - Email (employee email address)
 *
 * OUTPUT FILES:
 * =============
 * 1. allocations_with_emails.csv - Merged file with names replaced by emails
 * 2. merge_issues.csv - Log of all matches and issues for review
 *
 * MATCHING LOGIC:
 * ===============
 * 1. EXACT - Direct name match (e.g., "Riya P" matches "Riya P")
 * 2. PARTIAL - First name + last initial match (e.g., "Riya P" matches "Riya Pasahan")
 * 3. FIRST_NAME_ONLY - Unique first name match (e.g., "Riya" if only one Riya exists)
 * 4. NO_MATCH - No match found, cell left empty
 *
 * USAGE:
 * ======
 * node scripts/merge-allocations-emails.js <allocations-file> <emails-file> <output-dir>
 *
 * Example:
 *   node scripts/merge-allocations-emails.js ./allocations.xlsx ./emails.xlsx ./output
 *
 * If no arguments provided, uses default paths in Downloads folder.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Parse command line arguments or use defaults
const args = process.argv.slice(2);
const allocationsFile = args[0] || '/Users/manishbalsara/Downloads/allocations.xlsx';
const emailsFile = args[1] || '/Users/manishbalsara/Downloads/emails.xlsx';
const outputDir = args[2] || '/Users/manishbalsara/Downloads';

// Validate inputs
if (!fs.existsSync(allocationsFile)) {
  console.error(`Error: Allocations file not found: ${allocationsFile}`);
  console.error('\nUsage: node merge-allocations-emails.js <allocations-file> <emails-file> <output-dir>');
  process.exit(1);
}
if (!fs.existsSync(emailsFile)) {
  console.error(`Error: Emails file not found: ${emailsFile}`);
  console.error('\nUsage: node merge-allocations-emails.js <allocations-file> <emails-file> <output-dir>');
  process.exit(1);
}
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('=== MERGE ALLOCATIONS WITH EMAILS ===');
console.log(`Allocations file: ${allocationsFile}`);
console.log(`Emails file: ${emailsFile}`);
console.log(`Output directory: ${outputDir}\n`);

// Read both files
const allocWb = XLSX.readFile(allocationsFile);
const emailWb = XLSX.readFile(emailsFile);

const allocWs = allocWb.Sheets[allocWb.SheetNames[0]];
const emailWs = emailWb.Sheets['Sheet2'] || emailWb.Sheets[emailWb.SheetNames[0]];

const allocData = XLSX.utils.sheet_to_json(allocWs);
const emailData = XLSX.utils.sheet_to_json(emailWs);

// Build multiple lookup maps for fuzzy matching
const nameToEmail = {};          // Exact: "Riya P" -> email
const firstLastInitial = {};     // "riya p" -> [{name, email}]
const firstNameOnly = {};        // "riya" -> [{name, email}]
const duplicateNames = new Set();
const duplicateFirstLastInitial = new Set();

emailData.forEach(row => {
  const name = row.Name?.trim();
  const email = row.Email?.trim();
  if (!name || !email) return;

  // Exact match lookup
  if (nameToEmail[name]) {
    duplicateNames.add(name);
    console.log(`DUPLICATE EXACT NAME: "${name}" -> ${nameToEmail[name]} AND ${email}`);
  } else {
    nameToEmail[name] = email;
  }

  // Parse name parts
  const parts = name.split(/\s+/);
  const firstName = parts[0]?.toLowerCase();
  const lastName = parts[parts.length - 1];
  const lastInitial = lastName?.charAt(0)?.toLowerCase();

  // First name + last initial lookup (e.g., "riya p")
  if (firstName && lastInitial) {
    const key = `${firstName} ${lastInitial}`;
    if (!firstLastInitial[key]) {
      firstLastInitial[key] = [];
    }
    firstLastInitial[key].push({ name, email });
    if (firstLastInitial[key].length > 1) {
      duplicateFirstLastInitial.add(key);
    }
  }

  // First name only lookup
  if (firstName) {
    if (!firstNameOnly[firstName]) {
      firstNameOnly[firstName] = [];
    }
    firstNameOnly[firstName].push({ name, email });
  }
});

console.log(`Loaded ${Object.keys(nameToEmail).length} unique exact names`);
console.log(`Loaded ${Object.keys(firstLastInitial).length} first+lastInitial patterns`);
console.log(`Found ${duplicateNames.size} duplicate exact names`);
console.log(`Found ${duplicateFirstLastInitial.size} duplicate first+lastInitial patterns\n`);

// Function to find email with fuzzy matching
function findEmail(searchName) {
  // 1. Try exact match first
  if (nameToEmail[searchName]) {
    return { email: nameToEmail[searchName], matchType: 'EXACT' };
  }
  if (duplicateNames.has(searchName)) {
    return { email: null, matchType: 'DUPLICATE_EXACT' };
  }

  // 2. Try first name + last initial match
  const parts = searchName.split(/\s+/);
  const firstName = parts[0]?.toLowerCase();
  const lastName = parts[parts.length - 1];
  const lastInitial = lastName?.charAt(0)?.toLowerCase();

  if (firstName && lastInitial) {
    const key = `${firstName} ${lastInitial}`;
    if (duplicateFirstLastInitial.has(key)) {
      return { email: null, matchType: 'DUPLICATE_PARTIAL', candidates: firstLastInitial[key] };
    }
    if (firstLastInitial[key]?.length === 1) {
      return { email: firstLastInitial[key][0].email, matchType: 'PARTIAL', matchedName: firstLastInitial[key][0].name };
    }
  }

  // 3. Try first name only if unique
  if (firstName && firstNameOnly[firstName]?.length === 1) {
    return { email: firstNameOnly[firstName][0].email, matchType: 'FIRST_NAME_ONLY', matchedName: firstNameOnly[firstName][0].name };
  }

  return { email: null, matchType: 'NO_MATCH' };
}

// Columns to process
const targetColumns = ['Bookkeeper', 'Accountant', 'Controler', 'Sr. Controller', 'Account manager', 'Sales rep'];

// Track issues and matches
const issues = [];
const matchStats = { EXACT: 0, PARTIAL: 0, FIRST_NAME_ONLY: 0, NO_MATCH: 0, DUPLICATE_EXACT: 0, DUPLICATE_PARTIAL: 0 };

// Process allocations
allocData.forEach((row, rowIndex) => {
  const clientName = row['Client Name'] || '';

  targetColumns.forEach(col => {
    const cellValue = row[col];
    if (!cellValue || cellValue === 'None' || cellValue === 'NA') {
      row[col] = ''; // Clear None/NA values
      return;
    }

    // Handle multiple names separated by " / "
    const names = cellValue.split(' / ').map(n => n.trim());
    const emails = [];

    names.forEach(name => {
      const result = findEmail(name);
      matchStats[result.matchType] = (matchStats[result.matchType] || 0) + 1;

      if (result.email) {
        emails.push(result.email);
        if (result.matchType !== 'EXACT') {
          // Log fuzzy matches for review
          issues.push({
            row: rowIndex + 2,
            column: col,
            customer: clientName,
            name,
            reason: result.matchType,
            matchedTo: result.matchedName,
            email: result.email
          });
        }
      } else {
        // Don't add anything if no match - leave empty
        issues.push({
          row: rowIndex + 2,
          column: col,
          customer: clientName,
          name,
          reason: result.matchType,
          candidates: result.candidates?.map(c => `${c.name}:${c.email}`).join('; ')
        });
      }
    });

    // Update the cell - join multiple emails with comma, empty if no matches
    row[col] = emails.filter(e => e).join(', ');
  });
});

console.log('=== MATCH STATISTICS ===');
console.log(JSON.stringify(matchStats, null, 2));

// Log issues summary
const noMatchCount = issues.filter(i => i.reason === 'NO_MATCH').length;
const partialCount = issues.filter(i => i.reason === 'PARTIAL').length;
const firstNameCount = issues.filter(i => i.reason === 'FIRST_NAME_ONLY').length;
console.log(`\nIssues: ${noMatchCount} NO_MATCH, ${partialCount} PARTIAL, ${firstNameCount} FIRST_NAME_ONLY`);
console.log(`Total issues logged: ${issues.length}`);

// Write output as CSV
const outputFile = path.join(outputDir, 'allocations_with_emails.csv');
const newWs = XLSX.utils.json_to_sheet(allocData);
const csvContent = XLSX.utils.sheet_to_csv(newWs);
fs.writeFileSync(outputFile, csvContent);

// Write issues log as CSV
const issuesFile = path.join(outputDir, 'merge_issues.csv');
const issuesCsv = 'Row,Column,Customer,Name,Reason,MatchedTo,Email,Candidates\n' + issues.map(i =>
  `${i.row},"${i.column}","${i.customer}","${i.name}",${i.reason},"${i.matchedTo || ''}","${i.email || ''}","${i.candidates || ''}"`
).join('\n');
fs.writeFileSync(issuesFile, issuesCsv);

console.log('\n=== OUTPUT ===');
console.log(`Merged data saved to: ${outputFile}`);
console.log(`Issues log saved to: ${issuesFile}`);
