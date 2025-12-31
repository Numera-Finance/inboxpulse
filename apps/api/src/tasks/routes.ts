import { Hono } from 'hono';
import { container } from 'tsyringe';
import { z } from 'zod';
import { NotFoundError, Permission } from '@crm/shared';
import {
  TaskService,
  taskSearchRequestSchema,
  createTaskRequestSchema,
  reassignTaskRequestSchema,
  addCommentRequestSchema,
} from './service';
import type { RequestHeader } from '@crm/shared';
import { handleApiRequest, handleGetRequest, handleGetRequestWithParams, handleApiRequestWithParams } from '../utils/api-handler';
import { requirePermission } from '../middleware/require-permission';

export const taskRoutes = new Hono();

/**
 * POST /api/tasks/search - Search tasks with filters
 */
taskRoutes.post('/search', async (c) => {
  return handleApiRequest(
    c,
    taskSearchRequestSchema,
    async (requestHeader: RequestHeader, searchRequest) => {
      const service = container.resolve(TaskService);
      return await service.search(requestHeader, searchRequest);
    }
  );
});

/**
 * POST /api/tasks - Create a new task
 * Requires TASK_ADD permission
 */
taskRoutes.post('/', requirePermission(Permission.TASK_ADD), async (c) => {
  return handleApiRequest(
    c,
    createTaskRequestSchema,
    async (requestHeader: RequestHeader, createRequest) => {
      const service = container.resolve(TaskService);
      return await service.create(requestHeader, createRequest);
    }
  );
});

/**
 * GET /api/tasks/assignable-users - Get users that can be assigned tasks
 */
taskRoutes.get('/assignable-users', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(TaskService);
    return await service.getAssignableUsers(requestHeader);
  });
});

/**
 * GET /api/tasks/:id - Get task by ID with relations
 */
taskRoutes.get('/:id', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(TaskService);
      const task = await service.getById(requestHeader, params.id);
      if (!task) {
        throw new NotFoundError('Task', params.id);
      }
      return task;
    }
  );
});

/**
 * POST /api/tasks/:id/done - Mark task as done
 * Requires TASK_EDIT permission
 */
taskRoutes.post('/:id/done', requirePermission(Permission.TASK_EDIT), async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(TaskService);
      const task = await service.markDone(requestHeader, params.id);
      if (!task) {
        throw new NotFoundError('Task', params.id);
      }
      return task;
    }
  );
});

/**
 * POST /api/tasks/:id/reopen - Reopen a done task
 * Requires TASK_EDIT permission
 */
taskRoutes.post('/:id/reopen', requirePermission(Permission.TASK_EDIT), async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(TaskService);
      const task = await service.reopen(requestHeader, params.id);
      if (!task) {
        throw new NotFoundError('Task', params.id);
      }
      return task;
    }
  );
});

/**
 * PUT /api/tasks/:id/assign - Reassign task
 * Requires TASK_EDIT permission
 */
taskRoutes.put('/:id/assign', requirePermission(Permission.TASK_EDIT), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    reassignTaskRequestSchema,
    async (requestHeader: RequestHeader, params, body) => {
      const service = container.resolve(TaskService);
      const task = await service.reassign(requestHeader, params.id, body.assignedToId);
      if (!task) {
        throw new NotFoundError('Task', params.id);
      }
      return task;
    }
  );
});

/**
 * GET /api/tasks/:id/comments - Get comments for a task
 */
taskRoutes.get('/:id/comments', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(TaskService);
      return await service.getComments(requestHeader, params.id);
    }
  );
});

/**
 * POST /api/tasks/:id/comments - Add comment to task
 * Requires TASK_EDIT permission
 */
taskRoutes.post('/:id/comments', requirePermission(Permission.TASK_EDIT), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    addCommentRequestSchema,
    async (requestHeader: RequestHeader, params, body) => {
      const service = container.resolve(TaskService);
      const comment = await service.addComment(requestHeader, params.id, body.content);
      if (!comment) {
        throw new NotFoundError('Task', params.id);
      }
      return comment;
    }
  );
});
