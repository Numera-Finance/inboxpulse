/**
 * Role-Based Access Control (RBAC) Types
 *
 * Permissions are stored as an array of integers on the roles table.
 * At login, the user's role permissions are loaded and cached in RequestHeader.
 */

/**
 * Permission constants - stored as integers in roles.permissions array
 */
export const Permission = {
  USER_ADD: 1,
  USER_EDIT: 2,
  USER_DEL: 3,
  CUSTOMER_ADD: 4,
  CUSTOMER_EDIT: 5,
  CUSTOMER_DEL: 6,
  USER_CUSTOMER_MANAGE: 7,
  ADMIN: 8, // Full admin access, bypasses scoped queries
  TASK_ADD: 9,
  TASK_EDIT: 10,
} as const;

export type PermissionType = (typeof Permission)[keyof typeof Permission];

/**
 * Human-readable labels for each permission
 */
export const PERMISSION_LABELS: Record<PermissionType, string> = {
  [Permission.USER_ADD]: 'Add Users',
  [Permission.USER_EDIT]: 'Edit Users',
  [Permission.USER_DEL]: 'Delete Users',
  [Permission.CUSTOMER_ADD]: 'Add Customers',
  [Permission.CUSTOMER_EDIT]: 'Edit Customers',
  [Permission.CUSTOMER_DEL]: 'Delete Customers',
  [Permission.USER_CUSTOMER_MANAGE]: 'Manage User-Customer Assignments',
  [Permission.ADMIN]: 'Full Admin Access',
  [Permission.TASK_ADD]: 'Create Tasks',
  [Permission.TASK_EDIT]: 'Edit Tasks',
};

/**
 * All available permissions as an array (useful for UI checkboxes)
 */
export const ALL_PERMISSIONS: PermissionType[] = Object.values(Permission) as PermissionType[];

/**
 * Check if a permissions array includes a specific permission
 */
export function hasPermission(permissions: number[], permission: PermissionType): boolean {
  return permissions.includes(permission);
}

/**
 * Check if user has admin permission (bypasses scoped queries)
 */
export function isAdmin(permissions: number[]): boolean {
  return permissions.includes(Permission.ADMIN);
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(permissions: number[], required: PermissionType[]): boolean {
  return required.some((perm) => permissions.includes(perm));
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(permissions: number[], required: PermissionType[]): boolean {
  return required.every((perm) => permissions.includes(perm));
}

/**
 * Default role definitions (used for seeding)
 */
export const DEFAULT_ROLES = {
  USER: {
    name: 'User',
    description: 'Basic view access',
    permissions: [
      Permission.TASK_EDIT,
    ] as number[],
  },
  MANAGER: {
    name: 'Manager',
    description: 'Full management within scope',
    permissions: [
      Permission.USER_ADD,
      Permission.USER_EDIT,
      Permission.USER_DEL,
      Permission.CUSTOMER_ADD,
      Permission.CUSTOMER_EDIT,
      Permission.CUSTOMER_DEL,
      Permission.USER_CUSTOMER_MANAGE,
      Permission.TASK_ADD,
      Permission.TASK_EDIT,
    ],
  },
  ADMINISTRATOR: {
    name: 'Administrator',
    description: 'Full admin access',
    permissions: [
      Permission.USER_ADD,
      Permission.USER_EDIT,
      Permission.USER_DEL,
      Permission.CUSTOMER_ADD,
      Permission.CUSTOMER_EDIT,
      Permission.CUSTOMER_DEL,
      Permission.USER_CUSTOMER_MANAGE,
      Permission.ADMIN,
      Permission.TASK_ADD,
      Permission.TASK_EDIT,
    ],
  },
} as const;
