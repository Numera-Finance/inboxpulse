import { Hono } from 'hono';
import { container } from 'tsyringe';
import { NotFoundError } from '@crm/shared';
import { TaskService } from './service';
import type { ApiResponse, RequestHeader } from '@crm/shared';
import { handleApiRequest, handleGetRequest, handleGetRequestWithParams, handleApiRequestWithParams } from '../utils/api-handler';
import { z } from 'zod';

// Schema for searching tasks
const taskSearchSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  assignedToId: z.string().optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// Schema for creating a task
const createTaskSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().min(1).max(500),
  emailId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
});

// Schema for reassigning a task
const reassignTaskSchema = z.object({
  assignedToId: z.string().uuid().nullable(),
});

// Schema for adding a comment
const addCommentSchema = z.object({
  content: z.string().min(1).max(5000),
});

export const taskRoutes = new Hono();

/**
 * POST /api/tasks/search - Search tasks with filters
 */
taskRoutes.post('/search', async (c) => {
  return handleApiRequest(
    c,
    taskSearchSchema,
    async (requestHeader: RequestHeader, searchRequest) => {
      const service = container.resolve(TaskService);
      return await service.search(requestHeader, searchRequest);
    }
  );
});

/**
 * POST /api/tasks - Create a new task
 */
taskRoutes.post('/', async (c) => {
  return handleApiRequest(
    c,
    createTaskSchema,
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
 */
taskRoutes.post('/:id/done', async (c) => {
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
 */
taskRoutes.post('/:id/reopen', async (c) => {
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
 */
taskRoutes.put('/:id/assign', async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    reassignTaskSchema,
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
 */
taskRoutes.post('/:id/comments', async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    addCommentSchema,
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
