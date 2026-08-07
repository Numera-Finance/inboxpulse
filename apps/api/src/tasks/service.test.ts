import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { InvalidInputError, NotFoundError, type RequestHeader } from '@crm/shared';
import { TaskService } from './service';

// The real logger resolves env on first use, which is unavailable under test.
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Covers who gets told when an escalation changes hands, and what the server
 * accepts as an assignment target. Both are easy to get subtly wrong: the
 * outgoing assignee is only knowable from the write itself, and the route
 * validates nothing about the target beyond it being a UUID.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ID = '33333333-3333-3333-3333-333333333333';
const THIRD_ID = '44444444-4444-4444-4444-444444444444';
const TASK_ID = '55555555-5555-5555-5555-555555555555';

const header: RequestHeader = { tenantId: TENANT_ID, userId: ACTOR_ID, permissions: [] };

interface Sent {
  assigned: Array<{ actorName?: string }>;
  unassigned: Array<{
    previousAssigneeId: string;
    actorName?: string;
    reassignedToName?: string | null;
  }>;
}

function makeService(options: {
  previousAssigneeId: string | null;
  /** Users the tenant lookup resolves, by id. */
  users?: Record<string, { firstName: string; lastName: string; email: string; rowStatus: number }>;
}): { service: TaskService; sent: Sent; writes: Array<string | null> } {
  const sent: Sent = { assigned: [], unassigned: [] };
  const writes: Array<string | null> = [];

  const users = options.users ?? {
    [ACTOR_ID]: { firstName: 'Actor', lastName: 'One', email: 'actor@example.com', rowStatus: 0 },
    [OTHER_ID]: { firstName: 'Other', lastName: 'Two', email: 'other@example.com', rowStatus: 0 },
    [THIRD_ID]: { firstName: 'Third', lastName: 'Three', email: 'third@example.com', rowStatus: 0 },
  };

  const taskRepository = {
    reassign: async (_h: RequestHeader, id: string, assignedToId: string | null) => {
      writes.push(assignedToId);
      return { id, previousAssigneeId: options.previousAssigneeId };
    },
    findByIdWithRelations: async () => ({
      id: TASK_ID,
      tenantId: TENANT_ID,
      title: 'Re: something urgent',
      customerName: 'Acme',
      // Read after the write, so this is whoever holds it now.
      assignedToName: 'Third Three',
      createdAt: new Date('2026-08-06T00:00:00Z'),
    }),
  };

  const userRepository = {
    findById: async (id: string) => {
      const u = users[id];
      return u ? { id, ...u } : undefined;
    },
  };

  const service = new TaskService(
    {} as never,
    taskRepository as never,
    userRepository as never,
    {} as never
  );

  // Intercept the outbound calls rather than the HTTP they perform.
  service.sendTaskAssignedNotification = async (_task, actorName) => {
    sent.assigned.push({ actorName });
    return true;
  };
  service.sendTaskUnassignedNotification = async (
    _task,
    previousAssigneeId,
    actorName,
    reassignedToName
  ) => {
    sent.unassigned.push({ previousAssigneeId, actorName, reassignedToName });
    return true;
  };

  return { service, sent, writes };
}

/** The notifications are fire-and-forget; let the microtask queue drain. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('TaskService.reassign notifications', () => {
  it('notifies the new assignee when handing an escalation on', async () => {
    const { service, sent } = makeService({ previousAssigneeId: null });

    await service.reassign(header, TASK_ID, OTHER_ID);
    await flush();

    expect(sent.assigned).toHaveLength(1);
    expect(sent.assigned[0].actorName).toBe('Actor One');
    expect(sent.unassigned).toHaveLength(0);
  });

  it('notifies the outgoing assignee when the assignment is removed', async () => {
    const { service, sent } = makeService({ previousAssigneeId: OTHER_ID });

    await service.reassign(header, TASK_ID, null);
    await flush();

    expect(sent.unassigned).toEqual([
      { previousAssigneeId: OTHER_ID, actorName: 'Actor One', reassignedToName: null },
    ]);
    expect(sent.assigned).toHaveLength(0);
  });

  it('notifies both ends when an escalation is handed from one user to another', async () => {
    // The outgoing holder loses access exactly as they would on removal.
    const { service, sent } = makeService({ previousAssigneeId: OTHER_ID });

    await service.reassign(header, TASK_ID, THIRD_ID);
    await flush();

    expect(sent.assigned).toHaveLength(1);
    expect(sent.unassigned).toHaveLength(1);
    expect(sent.unassigned[0].previousAssigneeId).toBe(OTHER_ID);
    // Names who holds it now, so the outgoing holder knows where it went.
    expect(sent.unassigned[0].reassignedToName).toBe('Third Three');
  });

  it('passes no new-holder name when the escalation is merely cleared', async () => {
    const { service, sent } = makeService({ previousAssigneeId: OTHER_ID });

    await service.reassign(header, TASK_ID, null);
    await flush();

    expect(sent.unassigned[0].reassignedToName).toBeNull();
  });

  it('does not tell the outgoing holder when they are the one reassigning', async () => {
    const { service, sent } = makeService({ previousAssigneeId: ACTOR_ID });

    await service.reassign(header, TASK_ID, THIRD_ID);
    await flush();

    expect(sent.assigned).toHaveLength(1);
    expect(sent.unassigned).toHaveLength(0);
  });

  it('sends nothing when the assignee is unchanged', async () => {
    const { service, sent } = makeService({ previousAssigneeId: OTHER_ID });

    await service.reassign(header, TASK_ID, OTHER_ID);
    await flush();

    expect(sent.assigned).toHaveLength(0);
    expect(sent.unassigned).toHaveLength(0);
  });

  it('takes the outgoing assignee from the write, not from a prior read', async () => {
    // The repository reports who actually held the task at the moment it was
    // cleared. A separate SELECT could disagree under concurrent reassignment.
    const { service, sent } = makeService({ previousAssigneeId: THIRD_ID });

    await service.reassign(header, TASK_ID, null);
    await flush();

    expect(sent.unassigned[0].previousAssigneeId).toBe(THIRD_ID);
  });

  it('stays silent when you assign an escalation to yourself', async () => {
    const { service, sent } = makeService({ previousAssigneeId: null });

    await service.reassign(header, TASK_ID, ACTOR_ID);
    await flush();

    expect(sent.assigned).toHaveLength(0);
    expect(sent.unassigned).toHaveLength(0);
  });

  it('stays silent when you drop an escalation you were holding', async () => {
    const { service, sent } = makeService({ previousAssigneeId: ACTOR_ID });

    await service.reassign(header, TASK_ID, null);
    await flush();

    expect(sent.unassigned).toHaveLength(0);
    expect(sent.assigned).toHaveLength(0);
  });

  it('sends nothing when clearing an already-unassigned escalation', async () => {
    const { service, sent } = makeService({ previousAssigneeId: null });

    await service.reassign(header, TASK_ID, null);
    await flush();

    expect(sent.assigned).toHaveLength(0);
    expect(sent.unassigned).toHaveLength(0);
  });
});

describe('TaskService.reassign target validation', () => {
  it('rejects a user the tenant lookup cannot resolve, without writing', async () => {
    const { service, writes } = makeService({ previousAssigneeId: null, users: {} });

    await expect(service.reassign(header, TASK_ID, OTHER_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(writes).toHaveLength(0);
  });

  it('rejects a deactivated user, without writing', async () => {
    const { service, writes } = makeService({
      previousAssigneeId: null,
      users: {
        [ACTOR_ID]: { firstName: 'Actor', lastName: 'One', email: 'a@example.com', rowStatus: 0 },
        [OTHER_ID]: { firstName: 'Gone', lastName: 'Away', email: 'gone@example.com', rowStatus: 1 },
      },
    });
    await expect(service.reassign(header, TASK_ID, OTHER_ID)).rejects.toBeInstanceOf(InvalidInputError);
    expect(writes).toHaveLength(0);
  });

  it('allows clearing the assignment without any user lookup', async () => {
    const { service, writes } = makeService({ previousAssigneeId: OTHER_ID, users: {} });

    await expect(service.reassign(header, TASK_ID, null)).resolves.toBeDefined();
    expect(writes).toEqual([null]);
  });
});
