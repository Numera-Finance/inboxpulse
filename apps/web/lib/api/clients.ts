import { UserClient, CustomerClient, ContactClient, IntegrationClient, EmailClient, RoleClient, TaskClient, NotificationsClient, DashboardClient } from '@crm/clients';

// Extend Window interface for runtime config
declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      API_URL?: string;
    };
  }
}

// API base URL - prefer runtime config, fall back to build-time env var, then localhost
const API_BASE_URL =
  window.__RUNTIME_CONFIG__?.API_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4001';

// Export for use in integrations page
export { API_BASE_URL };

// Notifications service URL
const NOTIFICATIONS_BASE_URL =
  window.__RUNTIME_CONFIG__?.API_URL?.replace(':4001', ':4004') ||
  import.meta.env.VITE_NOTIFICATIONS_URL ||
  'http://localhost:4004';

// Singleton client instances
let userClient: UserClient | null = null;
let customerClient: CustomerClient | null = null;
let contactClient: ContactClient | null = null;
let integrationClient: IntegrationClient | null = null;
let emailClient: EmailClient | null = null;
let roleClient: RoleClient | null = null;
let taskClient: TaskClient | null = null;
let notificationsClient: NotificationsClient | null = null;
let dashboardClient: DashboardClient | null = null;

/**
 * Get the User client instance
 * Note: Auth is handled via cookies (credentials: 'include' in base client)
 */
export function getUserClient(): UserClient {
  if (!userClient) {
    userClient = new UserClient(API_BASE_URL);
  }
  return userClient;
}

/**
 * Get the Customer client instance
 */
export function getCustomerClient(): CustomerClient {
  if (!customerClient) {
    customerClient = new CustomerClient(API_BASE_URL);
  }
  return customerClient;
}

/**
 * Get the Contact client instance
 */
export function getContactClient(): ContactClient {
  if (!contactClient) {
    contactClient = new ContactClient(API_BASE_URL);
  }
  return contactClient;
}

/**
 * Get the Integration client instance
 */
export function getIntegrationClient(): IntegrationClient {
  if (!integrationClient) {
    integrationClient = new IntegrationClient(API_BASE_URL);
  }
  return integrationClient;
}

/**
 * Get the Email client instance
 */
export function getEmailClient(): EmailClient {
  if (!emailClient) {
    emailClient = new EmailClient(API_BASE_URL);
  }
  return emailClient;
}

/**
 * Get the Role client instance
 */
export function getRoleClient(): RoleClient {
  if (!roleClient) {
    roleClient = new RoleClient(API_BASE_URL);
  }
  return roleClient;
}

/**
 * Get the Task client instance
 */
export function getTaskClient(): TaskClient {
  if (!taskClient) {
    taskClient = new TaskClient(API_BASE_URL);
  }
  return taskClient;
}

/**
 * Get the Notifications client instance
 * Note: Connects to notifications service (port 4004)
 */
export function getNotificationsClient(): NotificationsClient {
  if (!notificationsClient) {
    notificationsClient = new NotificationsClient(NOTIFICATIONS_BASE_URL);
  }
  return notificationsClient;
}

/**
 * Get the Dashboard client instance
 */
export function getDashboardClient(): DashboardClient {
  if (!dashboardClient) {
    dashboardClient = new DashboardClient(API_BASE_URL);
  }
  return dashboardClient;
}

/**
 * Clear all client instances (useful for logout)
 */
export function clearClients(): void {
  userClient = null;
  customerClient = null;
  contactClient = null;
  integrationClient = null;
  emailClient = null;
  roleClient = null;
  taskClient = null;
  notificationsClient = null;
  dashboardClient = null;
}
