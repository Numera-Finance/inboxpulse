import {
  UserClient,
  CustomerClient,
  ContactClient,
  TaskClient,
} from '@crm/clients';

// Build-time configurable so the extension works against both a local dev
// stack and the Cloud Run deployment. Set WXT_API_URL / WXT_WEB_URL at build
// time (see .env.example); falls back to localhost for `wxt dev`.
export const API_BASE_URL = import.meta.env.WXT_API_URL || 'http://localhost:4001';
export const WEB_URL = import.meta.env.WXT_WEB_URL || 'http://localhost:4000';

let userClient: UserClient | null = null;
let customerClient: CustomerClient | null = null;
let contactClient: ContactClient | null = null;
let taskClient: TaskClient | null = null;

export function getUserClient(): UserClient {
  if (!userClient) {
    userClient = new UserClient(API_BASE_URL);
  }
  return userClient;
}

export function getCustomerClient(): CustomerClient {
  if (!customerClient) {
    customerClient = new CustomerClient(API_BASE_URL);
  }
  return customerClient;
}

export function getContactClient(): ContactClient {
  if (!contactClient) {
    contactClient = new ContactClient(API_BASE_URL);
  }
  return contactClient;
}

export function getTaskClient(): TaskClient {
  if (!taskClient) {
    taskClient = new TaskClient(API_BASE_URL);
  }
  return taskClient;
}

export function clearClients(): void {
  userClient = null;
  customerClient = null;
  contactClient = null;
  taskClient = null;
}
