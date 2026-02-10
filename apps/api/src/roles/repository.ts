import { eq, and } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { DEFAULT_ROLES } from '@crm/shared';
import { roles, type Role, type NewRole } from './schema';
import { logger } from '../utils/logger';

@injectable()
export class RoleRepository {
  constructor(@inject('Database') private db: Database) {}

  // ===========================================================================
  // Role CRUD
  // ===========================================================================

  async findById(id: string): Promise<Role | undefined> {
    const result = await this.db.select().from(roles).where(eq(roles.id, id));
    return result[0];
  }

  async findByTenantId(tenantId: string): Promise<Role[]> {
    return this.db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(roles.name);
  }

  async findByName(tenantId: string, name: string): Promise<Role | undefined> {
    const result = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.name, name)));
    return result[0];
  }

  async create(data: NewRole): Promise<Role> {
    const result = await this.db.insert(roles).values(data).returning();
    const role = result[0];

    logger.info(
      { roleId: role.id, tenantId: data.tenantId, name: data.name },
      'Created role'
    );

    return role;
  }

  async update(
    id: string,
    data: Partial<Omit<NewRole, 'id' | 'tenantId' | 'createdAt'>>
  ): Promise<Role | undefined> {
    const result = await this.db
      .update(roles)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id))
      .returning();

    const role = result[0];
    if (role) {
      logger.info(
        { roleId: id, updates: Object.keys(data) },
        'Updated role'
      );
    }

    return role;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(roles)
      .where(and(eq(roles.id, id), eq(roles.isSystem, false)))
      .returning({ id: roles.id });

    if (result.length > 0) {
      logger.info({ roleId: id }, 'Deleted role');
      return true;
    }

    return false;
  }

  // ===========================================================================
  // Seed Default Roles
  // ===========================================================================

  /**
   * Seed default system roles for a tenant
   * Called when a new tenant is created
   */
  async seedDefaultRoles(tenantId: string): Promise<Role[]> {
    const defaultRoles: NewRole[] = Object.values(DEFAULT_ROLES).map((role) => ({
      tenantId,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
      isSystem: true,
    }));

    const createdRoles: Role[] = [];

    for (const roleData of defaultRoles) {
      try {
        // Check if role already exists
        const existing = await this.findByName(tenantId, roleData.name);
        if (existing) {
          createdRoles.push(existing);
          continue;
        }

        const role = await this.create(roleData);
        createdRoles.push(role);
      } catch (error: any) {
        // Handle unique constraint violation (race condition)
        if (error.code === '23505') {
          const existing = await this.findByName(tenantId, roleData.name);
          if (existing) {
            createdRoles.push(existing);
          }
        } else {
          throw error;
        }
      }
    }

    logger.info(
      { tenantId, rolesCreated: createdRoles.length },
      'Seeded default roles for tenant'
    );

    return createdRoles;
  }

  /**
   * Get the default User role for a tenant
   * Used when creating new users
   */
  async getDefaultUserRole(tenantId: string): Promise<Role | undefined> {
    return this.findByName(tenantId, 'User');
  }

  /**
   * Get the Administrator role for a tenant
   * Used for the first user in a tenant
   */
  async getAdminRole(tenantId: string): Promise<Role | undefined> {
    return this.findByName(tenantId, 'Administrator');
  }
}
