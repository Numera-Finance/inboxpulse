import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import type { SearchRequest, UserResponse, CreateUserRequest, UpdateUserRequest } from '@/lib/api';

// Query keys for cache management
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: SearchRequest) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  byCustomer: (customerId: string) => [...userKeys.all, 'by-customer', customerId] as const,
};

/**
 * Hook to search/list users with pagination and filtering
 */
export function useUsers(request: SearchRequest) {
  return useQuery({
    queryKey: userKeys.list(request),
    queryFn: () => api.searchUsers(request),
  });
}

/**
 * Hook to get a single user by ID
 */
export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => api.getUser(id),
    enabled: !!id,
  });
}

/**
 * Hook to get users assigned to a customer
 */
export function useUsersByCustomer(customerId: string) {
  return useQuery({
    queryKey: userKeys.byCustomer(customerId),
    queryFn: () => api.getUsersByCustomer(customerId),
    enabled: !!customerId,
  });
}

/**
 * Hook to create a new user
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserRequest) => api.createUser(data),
    onSuccess: () => {
      // Invalidate all user lists to refetch
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/**
 * Hook to update a user
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserRequest }) =>
      api.updateUser(id, data),
    onSuccess: (user) => {
      // Update the cache for this specific user
      queryClient.setQueryData(userKeys.detail(user.id), user);
      // Invalidate lists to refetch
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/**
 * Hook to activate a user (rowStatus = active)
 */
export function useActivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.activateUser(id),
    onSuccess: (user) => {
      queryClient.setQueryData(userKeys.detail(user.id), user);
      queryClient.invalidateQueries({ queryKey: userKeys.all, refetchType: 'active' });
    },
  });
}

/**
 * Hook to deactivate a user (rowStatus = inactive)
 */
export function useDeactivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deactivateUser(id),
    onSuccess: (user) => {
      queryClient.setQueryData(userKeys.detail(user.id), user);
      queryClient.invalidateQueries({ queryKey: userKeys.all, refetchType: 'active' });
    },
  });
}

/**
 * Hook to add a manager to a user
 */
export function useAddManager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, managerEmail }: { userId: string; managerEmail: string }) =>
      api.addManager(userId, { managerEmail }),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
    },
  });
}

/**
 * Hook to remove a manager from a user
 */
export function useRemoveManager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, managerId }: { userId: string; managerId: string }) =>
      api.removeManager(userId, managerId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
    },
  });
}

/**
 * Hook to add a customer to a user
 */
export function useAddCustomerToUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      customerDomain,
      roleId,
    }: {
      userId: string;
      customerDomain: string;
      roleId?: string;
    }) => api.addCustomerToUser(userId, { customerDomain, roleId }),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
    },
  });
}

/**
 * Hook to remove a customer from a user
 */
export function useRemoveCustomerFromUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, customerId }: { userId: string; customerId: string }) =>
      api.removeCustomerFromUser(userId, customerId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
    },
  });
}

/**
 * Hook to set all customer assignments for a user
 */
export function useSetUserCustomerAssignments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      assignments,
    }: {
      userId: string;
      assignments: Array<{ customerId: string; roleId?: string }>;
    }) => api.setUserCustomerAssignments(userId, assignments),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/**
 * Hook to import users from a file
 */
export function useImportUsers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => api.importUsers(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

/**
 * Hook to export users to CSV file
 */
export function useExportUsers() {
  return useMutation({
    mutationFn: () => api.exportUsers(),
  });
}

/**
 * Hook to transfer a user's responsibilities to another user
 */
export function useTransferUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sourceUserId, targetUserId }: { sourceUserId: string; targetUserId: string }) =>
      api.transferUser(sourceUserId, targetUserId),
    onSuccess: (_, { sourceUserId, targetUserId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(sourceUserId) });
      queryClient.invalidateQueries({ queryKey: userKeys.detail(targetUserId) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}
