import { injectable, inject } from 'tsyringe';
import { RunRepository } from './repository';
import type { NewRun, UpdateRun } from './schema';
import type { CreateRunRequest, UpdateRunRequest } from '@crm/clients';

@injectable()
export class RunService {
  constructor(@inject(RunRepository) private runRepo: RunRepository) {}

  /**
   * Create a new run
   * Accepts CreateRunRequest (from client Zod schema) and converts to NewRun (DB type)
   */
  async create(data: CreateRunRequest): Promise<NewRun> {
    // CreateRunRequest has Date objects (from Zod coercion), NewRun also expects Date objects
    // Drizzle will handle the conversion to database timestamp format
    return this.runRepo.create(data as NewRun);
  }

  /**
   * Update a run
   * Accepts UpdateRunRequest (from client Zod schema) which matches UpdateRun (DB type)
   */
  async update(id: string, data: UpdateRunRequest) {
    // UpdateRunRequest has Date objects (from Zod coercion), UpdateRun also expects Date objects
    return this.runRepo.update(id, data as UpdateRun);
  }

  /**
   * Get run by ID
   */
  async findById(id: string) {
    return this.runRepo.findById(id);
  }

  /**
   * Get runs for a tenant
   */
  async findByTenant(tenantId: string, options?: { limit?: number }) {
    return this.runRepo.findByTenant(tenantId, options);
  }

  /**
   * Get runs for an integration
   */
  async findByIntegration(integrationId: string, options?: { limit?: number }, tenantId?: string) {
    return this.runRepo.findByIntegration(integrationId, options, tenantId);
  }

  /**
   * Get running jobs for integration
   */
  async findRunningByIntegration(integrationId: string, tenantId?: string) {
    return this.runRepo.findRunningByIntegration(integrationId, tenantId);
  }

  /**
   * Get running jobs for tenant
   */
  async findRunningByTenant(tenantId: string) {
    return this.runRepo.findRunningByTenant(tenantId);
  }
}
