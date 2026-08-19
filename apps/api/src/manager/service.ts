import { injectable, inject } from 'tsyringe';
import type { RequestHeader } from '@crm/shared';
import { NotFoundError } from '@crm/shared';
import {
  ManagerRepository,
  type AnalyzedEmailRow,
  type AnalyzedSearchRequest,
  type ContactRow,
  type CustomerDetail,
  type CustomerListRequest,
  type CustomerListRow,
  type TeamMemberRow,
  type ThreadEmailRow,
  type UserDetail,
  type UserListRequest,
  type UserListRow,
  type UserPatch,
  type DashboardFilters,
  type ImportantEscalationRow,
  type MostEscalatedRow,
  type RecentEscalationRow,
  type SentimentTrendRow,
  type TatMetricRow,
  type TeamResponsivenessRow,
  type VolumeTrendRow,
} from './repository';

/**
 * Dashboard analytics for the Gmail sidebar's manager tabs.
 *
 * Thin by design: these are read-only aggregate queries with no business rules
 * beyond the scoping the repository already applies. The layer exists so routes
 * resolve a service like every other module here rather than reaching into a
 * repository directly.
 */
@injectable()
export class ManagerService {
  constructor(@inject(ManagerRepository) private managerRepo: ManagerRepository) {}

  async getSummary(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{
    customers: number;
    emails: number;
    activeEscalations: number;
    upsellOpportunities: number;
  }> {
    return this.managerRepo.getSummary(header, filters);
  }

  async getSentimentDistribution(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{ positive: number; neutral: number; negative: number }> {
    return this.managerRepo.getSentimentDistribution(header, filters);
  }

  async getSentimentTrend(header: RequestHeader): Promise<SentimentTrendRow[]> {
    return this.managerRepo.getSentimentTrend(header);
  }

  async getVolumeTrend(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<VolumeTrendRow[]> {
    return this.managerRepo.getVolumeTrend(header, filters);
  }

  async getTatMetrics(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<TatMetricRow[]> {
    return this.managerRepo.getTatMetrics(header, filters);
  }

  async getRecentEscalations(
    header: RequestHeader,
    filters: DashboardFilters,
    limit?: number
  ): Promise<RecentEscalationRow[]> {
    return this.managerRepo.getRecentEscalations(header, filters, limit);
  }

  async getImportantEscalations(
    header: RequestHeader,
    filters: DashboardFilters,
    limit?: number
  ): Promise<ImportantEscalationRow[]> {
    return this.managerRepo.getImportantEscalations(header, filters, limit);
  }

  async getMostEscalatedCustomers(
    header: RequestHeader,
    filters: DashboardFilters,
    limit?: number
  ): Promise<MostEscalatedRow[]> {
    return this.managerRepo.getMostEscalatedCustomers(header, filters, limit);
  }

  async getChurnLevels(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{ low: number; medium: number; high: number; critical: number }> {
    return this.managerRepo.getChurnLevels(header, filters);
  }

  async getTeamResponsiveness(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<TeamResponsivenessRow[]> {
    return this.managerRepo.getTeamResponsiveness(header, filters);
  }

  async getAvgResolutionTime(
    header: RequestHeader,
    filters: DashboardFilters
  ): Promise<{ averageHours: number | null; replied: number; unreplied: number }> {
    return this.managerRepo.getAvgResolutionTime(header, filters);
  }

  async getAnalyzedStats(
    header: RequestHeader,
    days: number
  ): Promise<{ total: number; positive: number; neutral: number; negative: number }> {
    return this.managerRepo.getAnalyzedStats(header, days);
  }

  async searchAnalyzedEmails(
    header: RequestHeader,
    request: AnalyzedSearchRequest
  ): Promise<{ items: AnalyzedEmailRow[]; total: number; limit: number; offset: number }> {
    return this.managerRepo.searchAnalyzedEmails(header, request);
  }

  async getAnalyzedEmailById(
    header: RequestHeader,
    emailId: string
  ): Promise<AnalyzedEmailRow> {
    const email = await this.managerRepo.getAnalyzedEmailById(header, emailId);
    if (!email) throw new NotFoundError('Email', emailId);
    return email;
  }

  async getThreadEmails(header: RequestHeader, threadId: string): Promise<ThreadEmailRow[]> {
    return this.managerRepo.getThreadEmails(header, threadId);
  }

  /**
   * Toggle a task Open/Done. A row the caller cannot reach comes back as null
   * from the repository and surfaces as a 404 — deliberately the same answer as
   * a task that does not exist, so this cannot be used to probe for the
   * existence of other tenants' tasks.
   */
  async updateTaskStatus(
    header: RequestHeader,
    taskId: string,
    status: 0 | 1
  ): Promise<{ id: string; status: number; completedAt: string | null }> {
    const updated = await this.managerRepo.updateTaskStatus(header, taskId, status);
    if (!updated) throw new NotFoundError('Task', taskId);
    return updated;
  }

  async getRoles(header: RequestHeader): Promise<Array<{ id: string; name: string }>> {
    return this.managerRepo.getRoles(header);
  }

  // -------------------------------------------------------------------------
  // Customers section
  // -------------------------------------------------------------------------

  async getCustomersList(
    header: RequestHeader,
    request: CustomerListRequest
  ): Promise<{ items: CustomerListRow[]; total: number; limit: number; offset: number }> {
    return this.managerRepo.getCustomersList(header, request);
  }

  /**
   * A customer outside the caller's scope answers 404, the same as one that
   * does not exist — so this cannot be used to probe which customers exist.
   */
  async getCustomerById(header: RequestHeader, customerId: string): Promise<CustomerDetail> {
    const customer = await this.managerRepo.getCustomerById(header, customerId);
    if (!customer) throw new NotFoundError('Customer', customerId);
    return customer;
  }

  async getCustomerContacts(header: RequestHeader, customerId: string): Promise<ContactRow[]> {
    return this.managerRepo.getCustomerContacts(header, customerId);
  }

  async getCustomerTeam(header: RequestHeader, customerId: string): Promise<TeamMemberRow[]> {
    return this.managerRepo.getCustomerTeam(header, customerId);
  }

  async addCustomerTeamMember(
    header: RequestHeader,
    customerId: string,
    userId: string,
    roleId: string | null
  ): Promise<TeamMemberRow[]> {
    return this.managerRepo.addCustomerTeamMember(header, customerId, userId, roleId);
  }

  getTeamRoles(): Array<{ id: string; name: string }> {
    return this.managerRepo.getTeamRoles();
  }

  // -------------------------------------------------------------------------
  // Users section
  // -------------------------------------------------------------------------

  async getUsersList(
    header: RequestHeader,
    request: UserListRequest
  ): Promise<{ items: UserListRow[]; total: number; limit: number; offset: number }> {
    return this.managerRepo.getUsersList(header, request);
  }

  async getUserById(header: RequestHeader, userId: string): Promise<UserDetail> {
    const user = await this.managerRepo.getUserById(header, userId);
    if (!user) throw new NotFoundError('User', userId);
    return user;
  }

  async updateUser(
    header: RequestHeader,
    userId: string,
    patch: UserPatch
  ): Promise<UserDetail> {
    const updated = await this.managerRepo.updateUser(header, userId, patch);
    if (!updated) throw new NotFoundError('User', userId);
    return updated;
  }
}
