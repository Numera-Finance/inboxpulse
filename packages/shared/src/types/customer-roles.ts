/**
 * Customer Role - represents a role a user can have for a customer assignment
 */
export interface CustomerRole {
  id: string;
  name: string;
}

/**
 * Predefined customer roles with hardcoded UUIDs
 * These can be migrated to a database table later if needed
 */
export const CUSTOMER_ROLES: Record<string, CustomerRole> = {
  ACCOUNT_MANAGER: {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Account Manager',
  },
  CONTROLLER: {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'Controller',
  },
  BOOK_KEEPER: {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'Book Keeper',
  },
  ACCOUNTANT: {
    id: '550e8400-e29b-41d4-a716-446655440004',
    name: 'Accountant',
  },
  SR_CONTROLLER: {
    id: '550e8400-e29b-41d4-a716-446655440005',
    name: 'Sr Controller',
  },
  SALES_PERSON: {
    id: '550e8400-e29b-41d4-a716-446655440006',
    name: 'Sales Person',
  },
} as const;

/**
 * List of all customer roles for iteration
 */
export const CUSTOMER_ROLES_LIST: CustomerRole[] = Object.values(CUSTOMER_ROLES);

/**
 * Get a customer role by its ID
 */
export function getCustomerRoleById(id: string): CustomerRole | undefined {
  return CUSTOMER_ROLES_LIST.find((r) => r.id === id);
}

/**
 * Get the display name for a customer role ID
 * Returns 'Unknown' if the role ID is not found
 */
export function getCustomerRoleName(id: string | null | undefined): string {
  if (!id) return '';
  return getCustomerRoleById(id)?.name ?? 'Unknown';
}

/**
 * Get a customer role by its name (case-insensitive)
 */
export function getCustomerRoleByName(name: string): CustomerRole | undefined {
  const lowerName = name.toLowerCase().trim();
  return CUSTOMER_ROLES_LIST.find((r) => r.name.toLowerCase() === lowerName);
}
