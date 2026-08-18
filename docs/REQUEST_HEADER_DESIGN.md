# RequestHeader Design

## Overview

RequestHeader contains authentication and authorization context that every API needs:
- `tenantId`: Which tenant/organization the request is for
- `userId`: Which user is making the request

## Design Decision: JWT Token Only

**Extract RequestHeader from JWT token claims** (not separate headers)

### Why JWT Token Only?

1. **Single source of truth** - All auth context in one place
2. **Security** - Can't spoof headers, token is cryptographically signed
3. **Standard pattern** - Industry standard for API authentication
4. **Stateless** - No need to look up user/tenant on every request
5. **Works with API keys** - Can encode API key metadata in JWT too

## JWT Token Structure

```typescript
// JWT Payload (claims)
{
  // Required claims
  userId: string;        // UUID of the user
  tenantId: string;      // UUID of the tenant/organization
  
  // Standard JWT claims
  sub: string;           // Subject (usually userId)
  iat: number;           // Issued at
  exp: number;           // Expiration
  
  // Optional claims
  email?: string;        // User email (for convenience)
  roles?: string[];      // User roles/permissions
  apiKeyId?: string;     // If authenticated via API key
}
```

## Middleware Flow

```
1. Extract Authorization header
   ↓
2. Validate JWT token (signature, expiration)
   ↓
3. Extract claims (userId, tenantId)
   ↓
4. Create RequestHeader object
   ↓
5. Attach to Hono context
   ↓
6. Continue to route handler
```

## Implementation

### Middleware (`apps/api/src/middleware/requestHeader.ts`)

```typescript
import { Context, Next } from 'hono';
import { UnauthorizedError } from '@crm/shared';
import type { RequestHeader } from '@crm/shared';
import { verifyJWT, extractClaims } from '../utils/auth';

export async function requestHeaderMiddleware(c: Context, next: Next) {
  // 1. Extract Authorization header
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header');
  }
  
  const token = authHeader.substring(7); // Remove "Bearer "
  
  // 2. Verify JWT token
  let claims;
  try {
    claims = await verifyJWT(token);
  } catch (error) {
    throw new UnauthorizedError('Invalid or expired token');
  }
  
  // 3. Extract RequestHeader from claims
  const requestHeader: RequestHeader = {
    userId: claims.userId || claims.sub, // Fallback to 'sub' claim
    tenantId: claims.tenantId,
  };
  
  // Validate required fields
  if (!requestHeader.userId || !requestHeader.tenantId) {
    throw new UnauthorizedError('Token missing required claims (userId, tenantId)');
  }
  
  // 4. Attach to context
  c.set('requestHeader', requestHeader);
  
  // 5. Optionally attach full claims for advanced use cases
  c.set('claims', claims);
  
  await next();
}
```

### Auth Utility (`apps/api/src/utils/auth.ts`)

```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_ISSUER = process.env.JWT_ISSUER || 'crm-api';

export interface JWTPayload {
  userId: string;
  tenantId: string;
  email?: string;
  roles?: string[];
  apiKeyId?: string;
  sub?: string;
  iat?: number;
  exp?: number;
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    }) as JWTPayload;
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

export function extractClaims(token: string): JWTPayload {
  const decoded = jwt.decode(token) as JWTPayload;
  return decoded;
}
```

## Client Usage

### Web Client (Browser)

```typescript
// Store token in localStorage or httpOnly cookie
const token = localStorage.getItem('authToken');

// Include in requests
fetch('/api/customers', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ... }),
});
```

### API Client Package

```typescript
// packages/clients/src/base-client.ts
export class BaseClient {
  constructor(private token: string) {}
  
  protected async request<T>(url: string, options: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    // Handle response...
  }
}
```

## Development/Testing

### Development Mode

For local development without auth:

```typescript
export async function requestHeaderMiddleware(c: Context, next: Next) {
  // Development mode: use hardcoded values
  if (process.env.NODE_ENV === 'development' && !c.req.header('Authorization')) {
    const requestHeader: RequestHeader = {
      tenantId: process.env.DEV_TENANT_ID || '00000000-0000-0000-0000-000000000000',
      userId: process.env.DEV_USER_ID || '00000000-0000-0000-0000-000000000000',
    };
    c.set('requestHeader', requestHeader);
    await next();
    return;
  }
  
  // Production: validate JWT
  // ... JWT validation code ...
}
```

### Testing

```typescript
// In tests, mock the middleware or set test tokens
const testToken = createTestJWT({
  userId: 'test-user-id',
  tenantId: 'test-tenant-id',
});

const response = await app.request('/api/customers', {
  headers: {
    'Authorization': `Bearer ${testToken}`,
  },
});
```

## Token Invalidation

**Important:** JWTs are stateless by default, which means once issued, they're valid until expiration. To invalidate tokens (e.g., on logout, password change, or security breach), you need a strategy.

JWT tokens were never implemented; sessions live in `better_auth_session` and
revocation is a row delete. See ADR-028 in `docs/decisions.md`. The approaches
that document considered:
- **Token Version** (recommended): Store a version number in user record, include in JWT, increment to invalidate all tokens
- **Token Blacklist**: Store invalidated tokens in database, check on every request
- **Hybrid**: Combine both approaches for maximum flexibility

**Quick Summary:**
- ✅ **Without Redis**: Use token version approach (one integer per user)
- ✅ **Invalidate user tokens**: Increment `users.token_version`
- ✅ **Invalidate tenant tokens**: Increment all users' `token_version` for that tenant
- ⚠️ **Performance**: Cache user token version (1-5 minutes) to avoid DB lookup on every request

## Security Considerations

1. **Token expiration**: Set reasonable expiration (e.g., 1 hour)
2. **Refresh tokens**: Use refresh tokens for longer sessions
3. **Token rotation**: Rotate JWT secret periodically
4. **HTTPS only**: Always use HTTPS in production
5. **Token storage**: 
   - Web: httpOnly cookies (preferred) or localStorage
   - Mobile: Secure storage (Keychain/Keystore)
6. **Rate limiting**: Rate limit by userId/tenantId
7. **Token invalidation**: Implement token version or blacklist (see above)

## Migration Path

1. **Phase 1**: Keep hardcoded values, add JWT validation alongside
2. **Phase 2**: Make JWT required, remove hardcoded fallback
3. **Phase 3**: Add refresh token support
4. **Phase 4**: Add API key support (encode in JWT)

## Alternative: API Keys

For server-to-server or programmatic access:

```typescript
// API Key format: ak_<key-id>_<secret>
// Middleware checks if token starts with "ak_"
// Looks up API key in database
// Creates JWT-like claims:
{
  userId: null,           // API keys don't have users
  tenantId: apiKey.tenantId,
  apiKeyId: apiKey.id,
  permissions: apiKey.permissions,
}
```
