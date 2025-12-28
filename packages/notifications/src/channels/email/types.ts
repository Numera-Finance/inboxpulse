/**
 * Email channel types
 */

export interface EmailSendParams {
  to: string | string[];
  from: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  tags?: string[];
  metadata?: Record<string, string>;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  provider: string;
}

export interface EmailProviderConfig {
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
}

/**
 * Email provider interface
 * Implement this to add a new email provider (SES, Postmark, SendGrid, etc.)
 */
export interface EmailProvider {
  readonly name: string;

  /**
   * Send an email
   */
  send(params: EmailSendParams): Promise<EmailSendResult>;

  /**
   * Validate provider configuration
   */
  validateConfig(): Promise<boolean>;

  /**
   * Get provider health status
   */
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
}

/**
 * Unsubscribe configuration for CAN-SPAM compliance
 */
export interface UnsubscribeConfig {
  /** URL for one-click unsubscribe */
  unsubscribeUrl: string;
  /** Email for List-Unsubscribe header */
  unsubscribeEmail?: string;
  /** Whether to include List-Unsubscribe-Post header for one-click */
  oneClickUnsubscribe?: boolean;
}

/**
 * Email content with unsubscribe info
 */
export interface EmailContent {
  subject: string;
  html?: string;
  text?: string;
  unsubscribe?: UnsubscribeConfig;
}
