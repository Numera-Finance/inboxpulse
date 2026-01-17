/**
 * Frontend-specific types that map to/from API types
 * These types are used by the UI components
 */

import { formatDistanceToNow } from 'date-fns';
import type { UserResponse, Customer as ApiCustomer, Contact } from '@crm/clients';

// Re-export Contact type from clients package
export type { Contact } from '@crm/clients';
import { getCustomerRoleName } from '@crm/shared';

/**
 * Customer assignment with role
 */
export interface CustomerAssignment {
  customerId: string;
  roleId: string | null;
  roleName: string;
}

/**
 * User type for UI components
 * Maps from UserResponse
 */
export interface User {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  roleId?: string | null; // RBAC system role ID
  role?: string;
  department?: string;
  avatar?: string;
  reportsTo: string[]; // Array of user IDs (managers)
  assignedCustomers: string[]; // Array of customer IDs (deprecated, use customerAssignments)
  customerAssignments: CustomerAssignment[]; // Customer assignments with roles
  status: 'Active' | 'Inactive' | 'On Leave';
  canLogin: boolean; // Whether user can login to the application
  lastLoginAt?: string | null; // Last login timestamp
  joinedDate?: string;
  tenantId: string;
}

/**
 * Map UserResponse to User
 */
export function mapUserToUser(user: UserResponse): User {
  // Map rowStatus to status string
  // 0=active, 1=inactive, 2=archived
  const statusMap: Record<number, User['status']> = {
    0: 'Active',
    1: 'Inactive',
    2: 'Inactive', // archived treated as inactive
  };

  // Map customer assignments from API response
  const customerAssignments: CustomerAssignment[] = (user.customerAssignments || []).map(a => ({
    customerId: a.customerId,
    roleId: a.roleId ?? null,
    roleName: a.roleId ? getCustomerRoleName(a.roleId) : '',
  }));

  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    roleId: user.roleId ?? null, // RBAC system role
    role: user.role?.name, // RBAC role name from nested role object
    department: undefined, // TODO: Add department field to user API
    avatar: undefined,
    reportsTo: [], // TODO: Load from user relations
    assignedCustomers: customerAssignments.map(a => a.customerId),
    customerAssignments,
    status: statusMap[user.rowStatus] || 'Inactive',
    canLogin: user.canLogin ?? true, // Default to true if not set
    lastLoginAt: user.lastLoginAt ? (typeof user.lastLoginAt === 'string' ? user.lastLoginAt : user.lastLoginAt.toISOString()) : null,
    joinedDate: typeof user.createdAt === 'string' ? user.createdAt : user.createdAt.toISOString(),
    tenantId: user.tenantId,
  };
}

/**
 * @deprecated Use User and mapUserToUser instead
 * Kept for backwards compatibility during migration
 */
export type Employee = User;
export const mapUserToEmployee = mapUserToUser;

/**
 * Customer type for UI components
 * Extended from ApiCustomer with additional computed fields
 */
export interface Customer {
  id: string;
  name: string;
  domains: string[];
  tier: 'Premier' | 'Standard' | 'Basic';
  labels: string[];
  totalEmails: number;
  avgTAT: string;
  escalations: number;
  upsellCount: number; // Number of upsell opportunities detected
  churnCount: number; // Number of churn signals detected
  positiveCount: number; // Number of positive sentiment emails
  lastContact: string;
  sentiment: 'Positive' | 'Negative' | 'Neutral';
  sentimentConfidence?: number; // 0-1 confidence score
  churnRisk: 'Low' | 'Medium' | 'High';
  engagement: 'Retainer' | 'Time & Material' | 'Project';
  contacts: Contact[];
  emails: Email[];
  tenantId: string;
  website?: string;
  industry?: string;
  metadata?: Record<string, any>;
}

/**
 * Format a date as a relative time string (e.g., "2 days ago", "about 1 month ago")
 */
function formatRelativeDate(date: Date | undefined): string {
  if (!date) return '—';
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}


/**
 * Capitalize sentiment value from API
 */
function capitalizeSentiment(value?: string): Customer['sentiment'] {
  if (!value) return 'Neutral';
  const lower = value.toLowerCase();
  if (lower === 'positive') return 'Positive';
  if (lower === 'negative') return 'Negative';
  return 'Neutral';
}

/**
 * Format TAT (Turn Around Time) in hours to a human-readable string
 * Examples: "2.5h", "1d 4h", "3d"
 */
function formatTat(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';

  if (hours < 24) {
    // Less than a day - show hours
    return `${hours.toFixed(1)}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);

  if (remainingHours === 0) {
    return `${days}d`;
  }

  return `${days}d ${remainingHours}h`;
}

/**
 * Map ApiCustomer to Customer
 */
export function mapApiCustomerToCustomer(customer: ApiCustomer): Customer {
  return {
    id: customer.id,
    name: customer.name || customer.domains[0] || 'Unknown',
    domains: customer.domains,
    tier: 'Standard', // TODO: Add tier to customer API
    labels: customer.labels || [],
    totalEmails: customer.emailCount ?? 0,
    avgTAT: formatTat(customer.averageTat),
    escalations: customer.escalationCount ?? 0,
    upsellCount: customer.upsellCount ?? 0,
    churnCount: customer.churnCount ?? 0,
    positiveCount: customer.positiveCount ?? 0,
    lastContact: formatRelativeDate(customer.lastContactDate),
    sentiment: capitalizeSentiment(customer.sentiment?.value),
    sentimentConfidence: customer.sentiment?.confidence,
    churnRisk: 'Low',
    engagement: 'Project',
    contacts: [],
    emails: [],
    tenantId: customer.tenantId,
    website: customer.website || undefined,
    industry: customer.industry || undefined,
    metadata: customer.metadata || undefined,
  };
}


/**
 * Contact display type - Contact from API with guaranteed display name
 */
export interface ContactDisplay extends Omit<Contact, 'name'> {
  name: string; // Always has a value for display
}

/**
 * Map Contact to ContactDisplay with display-friendly defaults
 */
export function mapApiContactToContact(contact: Contact): ContactDisplay {
  return {
    ...contact,
    name: contact.name || contact.email.split('@')[0],
  };
}

/**
 * Email type for UI components
 */
export interface Email {
  id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  body: string;
}

/**
 * Predefined labels for customers
 */
export const predefinedLabels = [
  "Premier",
  "Subscription",
  "PAYG",
  "Enterprise",
  "Startup",
  "Partner",
  "VIP",
  "Trial",
  "Government",
  "Non-Profit",
];
