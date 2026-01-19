import type { ApiResponse } from '@crm/shared';

export interface RequestOptions extends RequestInit {
  signal?: AbortSignal;
}

/**
 * Custom HTTP error with status code
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * 404 Not Found error
 */
export class NotFoundError extends HttpError {
  constructor(message: string = 'Not Found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

// Check if running in browser environment
const isBrowser = typeof globalThis !== 'undefined' && 'window' in globalThis;

/**
 * Parse error response body into a message
 */
function parseErrorMessage(
  errorBody: { message?: string; error?: string | { message?: string; code?: string } },
  statusText: string
): string {
  if (typeof errorBody.error === 'object' && errorBody.error?.message) {
    return errorBody.error.message;
  } else if (typeof errorBody.error === 'string') {
    return errorBody.error;
  } else if (errorBody.message) {
    return errorBody.message;
  }
  return `Request failed: ${statusText}`;
}

/**
 * Context for internal service calls that require explicit tenant/user headers
 */
export interface ServiceContext {
  tenantId: string;
  userId: string;
}

// =============================================================================
// AuthBaseClient - For main API calls with cookie/session-based authentication
// =============================================================================

/**
 * Base HTTP client for main API calls with session token management.
 * Supports both browser (cookies) and API clients (Authorization header).
 * Handles 401 errors by redirecting to login in browser.
 */
export class AuthBaseClient {
  protected baseUrl: string;

  private sessionToken: string | null = null;
  private internalApiKey: string | null = null;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl || (isBrowser ? '' : 'http://localhost:4001');

    // Auto-set internal API key from environment (for service-to-service calls)
    if (!isBrowser && typeof process !== 'undefined' && process.env?.INTERNAL_API_KEY) {
      this.internalApiKey = process.env.INTERNAL_API_KEY;
    }
  }

  /**
   * Set session token (for API clients)
   * Browser clients use cookies automatically
   */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  /**
   * Get current session token
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * Set internal API key (for service-to-service calls)
   */
  setInternalApiKey(key: string): void {
    this.internalApiKey = key;
  }

  /**
   * Make HTTP request with session token management
   */
  protected async request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionToken && { Authorization: `Bearer ${this.sessionToken}` }),
        ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
        ...options.headers,
      },
      credentials: 'include', // Include cookies for browser clients
      signal: options.signal,
    });

    // Check if session was refreshed (sliding window)
    const refreshedToken = response.headers.get('X-Session-Refreshed');
    if (refreshedToken && this.sessionToken) {
      this.sessionToken = refreshedToken;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { message?: string; error?: string | { message?: string; code?: string } };
      const message = parseErrorMessage(errorBody, response.statusText);

      if (response.status === 404) {
        throw new NotFoundError(message);
      }

      // Handle 401 Unauthorized - redirect to login in browser
      if (response.status === 401 && isBrowser) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = globalThis as any;
        if (win.location?.pathname !== '/login') {
          win.location.href = '/login';
          return new Promise(() => {}) as T;
        }
      }

      throw new HttpError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET request
   */
  protected async get<T>(url: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, { method: 'GET', signal });
  }

  /**
   * POST request
   */
  protected async post<T>(url: string, data?: any, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    });
  }

  /**
   * PATCH request
   */
  protected async patch<T>(url: string, data?: any, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, {
      method: 'PATCH',
      body: JSON.stringify(data),
      signal,
    });
  }

  /**
   * PUT request
   */
  protected async put<T>(url: string, data?: any, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, {
      method: 'PUT',
      body: JSON.stringify(data),
      signal,
    });
  }

  /**
   * DELETE request
   */
  protected async delete<T>(url: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, { method: 'DELETE', signal });
  }

  /**
   * POST request with FormData (for file uploads)
   */
  protected async postFormData<T>(url: string, formData: FormData, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      method: 'POST',
      body: formData,
      headers: {
        ...(this.sessionToken && { Authorization: `Bearer ${this.sessionToken}` }),
        ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
      },
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { message?: string; error?: string | { message?: string; code?: string } };
      const message = parseErrorMessage(errorBody, response.statusText);

      if (response.status === 404) {
        throw new NotFoundError(message);
      }

      throw new HttpError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET request that returns a Blob (for file downloads)
   */
  protected async getBlob(url: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      method: 'GET',
      headers: {
        ...(this.sessionToken && { Authorization: `Bearer ${this.sessionToken}` }),
        ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
      },
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { message?: string; error?: string };
      const message = errorBody.message || errorBody.error || `Request failed: ${response.statusText}`;

      if (response.status === 404) {
        throw new NotFoundError(message);
      }

      throw new HttpError(message, response.status);
    }

    return response.blob();
  }
}

// =============================================================================
// InternalBaseClient - For internal service calls requiring explicit context
// =============================================================================

/**
 * Base HTTP client for internal service calls that require explicit tenant/user context.
 * Used for services like notifications that don't share session validation with main API.
 * All requests require a ServiceContext with tenantId and userId.
 */
export class InternalBaseClient {
  protected baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Build context headers from ServiceContext
   */
  private buildContextHeaders(ctx: ServiceContext): Record<string, string> {
    return {
      'x-tenant-id': ctx.tenantId,
      'x-user-id': ctx.userId,
    };
  }

  /**
   * Make HTTP request with context headers
   */
  protected async request<T>(url: string, ctx: ServiceContext, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.buildContextHeaders(ctx),
        ...options.headers,
      },
      credentials: 'include',
      signal: options.signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { message?: string; error?: string | { message?: string; code?: string } };
      const message = parseErrorMessage(errorBody, response.statusText);

      if (response.status === 404) {
        throw new NotFoundError(message);
      }

      throw new HttpError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * GET request with context
   */
  protected async get<T>(url: string, ctx: ServiceContext, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, ctx, { method: 'GET', signal });
  }

  /**
   * POST request with context
   */
  protected async post<T>(url: string, ctx: ServiceContext, data?: any, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, ctx, {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    });
  }

  /**
   * PUT request with context
   */
  protected async put<T>(url: string, ctx: ServiceContext, data?: any, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, ctx, {
      method: 'PUT',
      body: JSON.stringify(data),
      signal,
    });
  }

  /**
   * DELETE request with context
   */
  protected async delete<T>(url: string, ctx: ServiceContext, signal?: AbortSignal): Promise<T> {
    return this.request<T>(url, ctx, { method: 'DELETE', signal });
  }
}

// =============================================================================
// Backwards compatibility alias
// =============================================================================

/**
 * @deprecated Use AuthBaseClient instead
 */
export const BaseClient = AuthBaseClient;
