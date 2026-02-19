// User hooks
export {
  useUsers,
  useUser,
  useUsersByCustomer,
  useCreateUser,
  useUpdateUser,
  useMarkUserActive,
  useMarkUserInactive,
  useAddManager,
  useRemoveManager,
  useAddCustomerToUser,
  useRemoveCustomerFromUser,
  useSetUserCustomerAssignments,
  useImportUsers,
  useTransferUser,
  userKeys,
} from './use-users';

// Customer hooks
export {
  useCustomers,
  useCustomersByTenant,
  useCustomer,
  useCustomerByDomain,
  useUpsertCustomer,
  useUpdateCustomer,
  useImportCustomers,
  useExportCustomers,
  useImportTemplate,
  customerKeys,
} from './use-customers';

// Integration hooks
export { useGmailIntegration, useDisconnectIntegration, integrationKeys } from './use-integrations';

// Email hooks
export { useEmailsByCustomer, emailKeys } from './use-emails';

// Contact hooks
export {
  useContactsByCustomer,
  useContactsByTenant,
  useUpsertContact,
  useUpdateContact,
  contactKeys,
} from './use-contacts';

// Role hooks
export { useRoles, roleKeys } from './use-roles';

// Task hooks
export {
  useTasks,
  useTask,
  useTaskComments,
  useAssignableUsers,
  useCreateTask,
  useMarkTaskDone,
  useReopenTask,
  useReassignTask,
  useAddTaskComment,
  taskKeys,
} from './use-tasks';

// Dashboard hooks
export {
  useDashboardCustomers,
  useDashboardEmails,
  useDashboardEscalations,
  useDashboardEscalationsTable,
  useDashboardOpportunities,
  useDashboardSentiment,
  useDashboardSentimentTrend,
  useDashboardEmailVolumeTrend,
  useDashboardTATMetrics,
  dashboardKeys,
} from './use-dashboard';

// Keyword hooks
export { useKeywords, useSaveKeywords, keywordKeys } from './use-keywords';
