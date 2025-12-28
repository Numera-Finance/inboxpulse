/**
 * User resolver implementation for notifications
 * Uses API calls to the main API service instead of direct database access
 */

import { injectable, inject } from 'tsyringe';
import { UserClient } from '@crm/clients';
import type {
  UserResolver,
  NotificationUser,
  UserNotificationPreferences,
  ChannelAddress as ChannelAddressInterface,
  SubscriptionConditions,
  NotificationDataContext,
  NotificationChannel,
} from '@crm/notifications';

@injectable()
export class CrmUserResolver implements UserResolver {
  private userClient: UserClient;

  constructor(@inject('ApiBaseUrl') apiBaseUrl: string) {
    this.userClient = new UserClient(apiBaseUrl);

    // Set internal API key for service-to-service calls
    const internalApiKey = process.env.INTERNAL_API_KEY;
    if (internalApiKey) {
      this.userClient.setInternalApiKey(internalApiKey);
    }
  }

  async getUser(userId: string, tenantId: string): Promise<NotificationUser | null> {
    try {
      const user = await this.userClient.getById(userId);
      if (!user) return null;

      return {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email || undefined,
        name: `${user.firstName} ${user.lastName}`.trim() || undefined,
        firstName: user.firstName,
        lastName: user.lastName,
        timezone: undefined, // TODO: Add timezone support to API
        locale: undefined, // TODO: Add locale support to API
        isActive: user.rowStatus === 0 && (user.canLogin ?? true),
      };
    } catch (error) {
      return null;
    }
  }

  async getUserChannelAddress(
    userId: string,
    channel: NotificationChannel
  ): Promise<ChannelAddressInterface | null> {
    // For now, get user email address as the default channel address
    // In the future, this could be extended to support other channels
    try {
      const user = await this.userClient.getById(userId);
      if (!user?.email) return null;

      if (channel === 'email') {
        return {
          id: userId,
          tenantId: user.tenantId,
          userId: userId,
          channel: 'email',
          address: user.email,
          isVerified: true, // Assume verified for now
          isDisabled: false,
          bounceCount: 0,
          complaintCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getUserPreferences(
    userId: string,
    typeId: string
  ): Promise<UserNotificationPreferences | null> {
    // TODO: Add notification preferences endpoint to API
    // For now, return default preferences
    return {
      enabled: true,
      channels: ['email'],
      frequency: 'immediate',
      batchInterval: null,
      quietHours: null,
      timezone: null,
    };
  }

  async getSubscribers(tenantId: string, typeId: string): Promise<string[]> {
    // TODO: Add subscribers endpoint to API
    // For now, return empty array (handled by notification service)
    return [];
  }

  async getUserTimezone(userId: string): Promise<string | null> {
    // TODO: Add timezone support to API
    return null;
  }

  async getUserLocale(userId: string): Promise<string | null> {
    // TODO: Add locale support to API
    return null;
  }

  async userExists(userId: string, tenantId: string): Promise<boolean> {
    const user = await this.getUser(userId, tenantId);
    return user !== null;
  }

  async tenantActive(tenantId: string): Promise<boolean> {
    // TODO: Add tenant status endpoint to API
    return true;
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    try {
      const permissions = await this.userClient.getPermissions(userId);
      // Convert numeric permissions to string for compatibility
      return permissions.map(p => String(p));
    } catch (error) {
      return [];
    }
  }

  async userHasPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission);
  }

  async userMatchesConditions(
    userId: string,
    conditions: SubscriptionConditions
  ): Promise<boolean> {
    try {
      if (conditions.hasCustomers !== undefined) {
        const hasCustomers = await this.userClient.hasAnyCustomers(userId);
        if (conditions.hasCustomers !== hasCustomers) return false;
      }

      if (conditions.hasManager !== undefined) {
        const hasManager = await this.userClient.hasManager(userId);
        if (conditions.hasManager !== hasManager) return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  createDataAccessChecker(userId: string, tenantId: string) {
    return async (context: NotificationDataContext): Promise<boolean> => {
      const { data } = context;

      try {
        // Check customer access if notification references a customer
        if (data.customerId && typeof data.customerId === 'string') {
          const hasAccess = await this.userClient.hasCustomerAccess(userId, data.customerId);
          if (!hasAccess) {
            return false;
          }
        }

        // Check permission requirements
        if (data.requiredPermission && typeof data.requiredPermission === 'string') {
          const hasPermission = await this.userHasPermission(userId, data.requiredPermission);
          if (!hasPermission) {
            return false;
          }
        }

        return true;
      } catch (error) {
        // On API error, deny access for safety
        return false;
      }
    };
  }
}
