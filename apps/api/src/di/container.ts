import { container } from 'tsyringe';
import { createDatabase, type Database } from '@crm/database';
// Import schemas from API modules (co-located with their code)
import { users, userManagers, userCustomers, userAccessibleCustomers, loginHistory, tenants, integrations, emailThreads, emails, emailAnalyses, threadAnalyses, runs, customers, contacts, roles, tasks, taskComments, userSubordinates, dashboards, holidayCalendars, analysisKeywords } from '../schemas';
// Notification schemas removed - notifications is now a standalone app
// Import better-auth schemas
import { betterAuthUser, betterAuthSession, betterAuthAccount, betterAuthVerification } from '../auth/better-auth-schema';

// Feature imports
import { UserRepository } from '../users/repository';
import { UserService } from '../users/service';
import { LoginHistoryRepository } from '../users/login-history-repository';
import { LoginHistoryService } from '../users/login-history-service';
import { IntegrationRepository } from '../integrations/repository';
import { IntegrationService } from '../integrations/service';
import { TenantRepository } from '../tenants/repository';
import { TenantService } from '../tenants/service';
import { EmailRepository } from '../emails/repository';
import { ManagerRepository } from '../manager/repository';
import { EmailThreadRepository } from '../emails/thread-repository';
import { EmailAnalysisRepository } from '../emails/analysis-repository';
import { ThreadAnalysisRepository } from '../emails/thread-analysis-repository';
import { ThreadAnalysisService } from '../emails/thread-analysis-service';
import { EmailAnalysisService } from '../emails/analysis-service';
import { EmailService } from '../emails/service';
import { ManagerService } from '../manager/service';
import { AnalysisClient } from '@crm/clients';
import { RunRepository } from '../runs/repository';
import { RunService } from '../runs/service';
import { CustomerRepository } from '../customers/repository';
import { CustomerService } from '../customers/service';
import { ContactRepository } from '../contacts/repository';
import { ContactService } from '../contacts/service';
import { RoleRepository } from '../roles/repository';
import { TaskRepository } from '../tasks/repository';
import { TaskService } from '../tasks/service';
import { DashboardRepository } from '../dashboards/repository';
import { DashboardService } from '../dashboards/service';
import { HolidayRepository } from '../holidays/repository';
import { HolidayService } from '../holidays/service';
import { KeywordRepository } from '../keywords/repository';
import { KeywordService } from '../keywords/service';
import { BetterAuthUserService } from '../auth/better-auth-user-service';

export function setupContainer() {
  // Initialize database with schemas from API modules (including better-auth schemas)
  // This keeps database package independent (no dependency on API)
  const db = createDatabase({
    users,
    userManagers,
    userCustomers,
    userAccessibleCustomers,
    loginHistory,
    tenants,
    integrations,
    emailThreads,
    emails,
    emailAnalyses,
    threadAnalyses,
    runs,
    customers,
    contacts,
    roles,
    tasks,
    taskComments,
    userSubordinates,
    dashboards,
    holidayCalendars,
    analysisKeywords,
    // Better-auth schemas
    betterAuthUser,
    betterAuthSession,
    betterAuthAccount,
    betterAuthVerification,
  });

  // Register database
  container.register<Database>('Database', { useValue: db });

  // Register clients
  container.register(AnalysisClient, { useClass: AnalysisClient });

  // Register repositories (order matters for dependency injection)
  container.register(UserRepository, { useClass: UserRepository });
  container.register(LoginHistoryRepository, { useClass: LoginHistoryRepository });
  container.register(IntegrationRepository, { useClass: IntegrationRepository });
  container.register(TenantRepository, { useClass: TenantRepository });
  container.register(EmailRepository, { useClass: EmailRepository });
  container.register(ManagerRepository, { useClass: ManagerRepository });
  container.register(EmailThreadRepository, { useClass: EmailThreadRepository });
  container.register(EmailAnalysisRepository, { useClass: EmailAnalysisRepository });
  container.register(ThreadAnalysisRepository, { useClass: ThreadAnalysisRepository });
  container.register(RunRepository, { useClass: RunRepository });
  container.register(CustomerRepository, { useClass: CustomerRepository });
  container.register(ContactRepository, { useClass: ContactRepository });
  container.register(RoleRepository, { useClass: RoleRepository });
  container.register(TaskRepository, { useClass: TaskRepository });
  container.register(DashboardRepository, { useClass: DashboardRepository });
  container.register(HolidayRepository, { useClass: HolidayRepository });
  container.register(KeywordRepository, { useClass: KeywordRepository });

  // Register services (order matters - dependencies must be registered first)
  container.register(UserService, { useClass: UserService });
  container.register(LoginHistoryService, { useClass: LoginHistoryService });
  container.register(IntegrationService, { useClass: IntegrationService });
  container.register(TenantService, { useClass: TenantService });
  container.register(RunService, { useClass: RunService });
  container.register(CustomerService, { useClass: CustomerService });
  container.register(ContactService, { useClass: ContactService });
  container.register(TaskService, { useClass: TaskService });
  container.register(DashboardService, { useClass: DashboardService });
  container.register(HolidayService, { useClass: HolidayService });
  container.register(KeywordService, { useClass: KeywordService });

  // Register services with more dependencies (after their dependencies)
  container.register(ThreadAnalysisService, { useClass: ThreadAnalysisService });
  container.register(EmailAnalysisService, { useClass: EmailAnalysisService });
  container.register(EmailService, { useClass: EmailService });
  container.register(ManagerService, { useClass: ManagerService });

  // Register better-auth services
  container.register(BetterAuthUserService, { useClass: BetterAuthUserService });

  // Hooks are now configured directly in better-auth.ts using databaseHooks
  // No need to call setupBetterAuthHooks() anymore
}
