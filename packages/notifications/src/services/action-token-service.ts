/**
 * Action Token Service
 *
 * Generates and validates JWT tokens for notification actions
 * Enables one-click actions (approve/reject) from emails without login
 */

import { createHmac, randomBytes } from 'crypto';

export interface ActionTokenPayload {
  /** Unique token ID for one-time use tracking */
  jti: string;
  /** Notification ID */
  nid: string;
  /** Tenant ID */
  tid: string;
  /** User ID */
  uid: string;
  /** Action type (e.g., 'approve', 'reject') */
  act: string;
  /** Expiration timestamp (Unix seconds) */
  exp: number;
  /** Issued at timestamp (Unix seconds) */
  iat: number;
}

export interface GenerateTokenParams {
  notificationId: string;
  tenantId: string;
  userId: string;
  actionType: string;
  expiresInSeconds?: number;
}

export interface ValidateTokenResult {
  valid: boolean;
  payload?: ActionTokenPayload;
  error?: 'expired' | 'invalid_signature' | 'malformed' | 'already_used';
}

export interface ActionTokenServiceConfig {
  secret: string;
  defaultExpirySeconds?: number;
  /** Callback to check if token has been used */
  isTokenUsed?: (jti: string) => Promise<boolean>;
  /** Callback to mark token as used */
  markTokenUsed?: (jti: string, notificationId: string) => Promise<void>;
}

export class ActionTokenService {
  private readonly secret: string;
  private readonly defaultExpirySeconds: number;
  private readonly isTokenUsed?: (jti: string) => Promise<boolean>;
  private readonly markTokenUsed?: (jti: string, notificationId: string) => Promise<void>;

  constructor(config: ActionTokenServiceConfig) {
    if (!config.secret || config.secret.length < 32) {
      throw new Error('Action token secret must be at least 32 characters');
    }
    this.secret = config.secret;
    this.defaultExpirySeconds = config.defaultExpirySeconds || 7 * 24 * 60 * 60; // 7 days
    this.isTokenUsed = config.isTokenUsed;
    this.markTokenUsed = config.markTokenUsed;
  }

  /**
   * Generate an action token
   */
  generate(params: GenerateTokenParams): { token: string; expiresAt: Date } {
    const now = Math.floor(Date.now() / 1000);
    const expiresInSeconds = params.expiresInSeconds || this.defaultExpirySeconds;
    const exp = now + expiresInSeconds;

    const payload: ActionTokenPayload = {
      jti: this.generateJti(),
      nid: params.notificationId,
      tid: params.tenantId,
      uid: params.userId,
      act: params.actionType,
      exp,
      iat: now,
    };

    const token = this.encodeToken(payload);

    return {
      token,
      expiresAt: new Date(exp * 1000),
    };
  }

  /**
   * Validate an action token
   */
  async validate(token: string): Promise<ValidateTokenResult> {
    try {
      // Decode and verify signature
      const payload = this.decodeToken(token);
      if (!payload) {
        return { valid: false, error: 'malformed' };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        return { valid: false, error: 'expired' };
      }

      // Check if token has been used (one-time use)
      if (this.isTokenUsed) {
        const used = await this.isTokenUsed(payload.jti);
        if (used) {
          return { valid: false, error: 'already_used' };
        }
      }

      return { valid: true, payload };
    } catch (error) {
      return { valid: false, error: 'malformed' };
    }
  }

  /**
   * Mark a token as used after action is executed
   */
  async consumeToken(jti: string, notificationId: string): Promise<void> {
    if (this.markTokenUsed) {
      await this.markTokenUsed(jti, notificationId);
    }
  }

  /**
   * Generate unique token ID
   */
  private generateJti(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Encode payload into token string
   * Format: base64url(payload).signature
   */
  private encodeToken(payload: ActionTokenPayload): string {
    const payloadStr = JSON.stringify(payload);
    const payloadBase64 = this.base64UrlEncode(payloadStr);
    const signature = this.sign(payloadBase64);
    return `${payloadBase64}.${signature}`;
  }

  /**
   * Decode and verify token
   */
  private decodeToken(token: string): ActionTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadBase64, signature] = parts;

    // Verify signature
    const expectedSignature = this.sign(payloadBase64);
    if (!this.timingSafeEqual(signature, expectedSignature)) {
      return null;
    }

    // Decode payload
    try {
      const payloadStr = this.base64UrlDecode(payloadBase64);
      return JSON.parse(payloadStr) as ActionTokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Create HMAC signature
   */
  private sign(data: string): string {
    const hmac = createHmac('sha256', this.secret);
    hmac.update(data);
    return this.base64UrlEncode(hmac.digest());
  }

  /**
   * Base64url encode
   */
  private base64UrlEncode(data: string | Buffer): string {
    const base64 = Buffer.from(data).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Base64url decode
   */
  private base64UrlDecode(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  /**
   * Timing-safe string comparison
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}

/**
 * Build action URL with token
 */
export function buildActionUrl(
  baseUrl: string,
  token: string,
  actionType: string
): string {
  return `${baseUrl}/actions/${actionType}?token=${encodeURIComponent(token)}`;
}
