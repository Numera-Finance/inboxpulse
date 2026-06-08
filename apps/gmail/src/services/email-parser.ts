import { gmail_v1 } from 'googleapis';
import type { Email, EmailThread, EmailCollection, EmailProvider } from '@crm/shared';

export interface ParseOptions {
  /** List of email addresses to blacklist (filter out) */
  blacklistEmails?: string[];
}

export class EmailParserService {
  /**
   * Parse Gmail messages to provider-agnostic format
   * Groups messages by thread and returns thread + emails
   */
  parseMessages(
    messages: gmail_v1.Schema$Message[],
    provider: EmailProvider = 'gmail',
    options: ParseOptions = {}
  ): EmailCollection[] {
    const { blacklistEmails = [] } = options;

    // Normalize blacklist emails to lowercase for case-insensitive matching
    const normalizedBlacklist = new Set(blacklistEmails.map(email => email.toLowerCase()));

    // Group messages by thread
    const threadMap = new Map<string, gmail_v1.Schema$Message[]>();

    for (const message of messages) {
      const threadId = message.threadId!;
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId)!.push(message);
    }

    // Process each thread
    const results: EmailCollection[] = [];
    
    for (const [threadId, threadMessages] of threadMap.entries()) {
      // Sort messages by received date
      const sortedMessages = threadMessages.sort((a, b) => {
        const dateA = this.getMessageDate(a);
        const dateB = this.getMessageDate(b);
        return dateA.getTime() - dateB.getTime();
      });

      const emails = sortedMessages
        .map(msg => this.parseMessage(msg, provider))
        .filter(email => {
          // Filter out emails with no recipients
          if (!email.tos || email.tos.length === 0) {
            return false;
          }

          // Filter out drafts and spam
          const labels = email.labels || [];
          if (labels.includes('DRAFT') || labels.includes('SPAM')) {
            return false;
          }

          // Filter out blacklisted senders
          if (normalizedBlacklist.size > 0 && email.from?.email) {
            const fromEmail = email.from.email.toLowerCase();
            if (normalizedBlacklist.has(fromEmail)) {
              return false;
            }
          }

          return true;
        });

      // Skip threads with no valid emails
      if (emails.length === 0) {
        continue;
      }

      // Create thread metadata
      const firstMessage = emails[0];
      const lastMessage = emails[emails.length - 1];
      
      const thread: EmailThread = {
        provider,
        threadId,
        subject: firstMessage.subject,
        firstMessageAt: firstMessage.receivedAt,
        lastMessageAt: lastMessage.receivedAt,
        metadata: {
          // Store Gmail-specific thread metadata (gmailThreadId is redundant - already in providerThreadId)
        },
      };

      results.push({
        thread,
        emails,
      });
    }

    return results;
  }

  /**
   * Parse a single Gmail message to provider-agnostic format
   */
  parseMessage(message: gmail_v1.Schema$Message, provider: EmailProvider = 'gmail'): Email {
    const headers = this.getHeaders(message);
    const parsed = this.parseHeaders(headers);

    return {
      provider,
      messageId: message.id!,
      threadId: message.threadId!,
      subject: parsed.subject,
      body: this.extractBody(message),
      from: {
        email: parsed.fromEmail,
        name: parsed.fromName,
      },
      tos: parsed.tos,
      ccs: parsed.ccs,
      bccs: parsed.bccs,
      priority: parsed.priority as 'high' | 'normal' | 'low',
      labels: message.labelIds || [],
      receivedAt: parsed.receivedAt,
      metadata: {
        // Store Gmail-specific metadata (gmailMessageId and gmailThreadId are redundant - already in messageId and threadId)
        labelIds: message.labelIds || [],
        snippet: message.snippet,
        sizeEstimate: message.sizeEstimate,
        // RFC 2822 headers for deduplication
        rfcMessageId: headers.get('message-id') || undefined,
        references: headers.get('references') || undefined,
        inReplyTo: headers.get('in-reply-to') || undefined,
      },
    };
  }

  /**
   * Parse a single Gmail message (legacy method for backward compatibility)
   * @deprecated Use parseMessage instead
   */
  parseMessageLegacy(message: gmail_v1.Schema$Message, tenantId: string): any {
    const email = this.parseMessage(message, 'gmail');
    // Convert to old format for backward compatibility
    return {
      tenantId,
      gmailMessageId: email.messageId,
      gmailThreadId: email.threadId,
      subject: email.subject,
      fromEmail: email.from.email,
      fromName: email.from.name,
      tos: email.tos,
      ccs: email.ccs || [],
      bccs: email.bccs || [],
      body: email.body,
      priority: email.priority,
      labels: email.labels || [],
      receivedAt: email.receivedAt,
    };
  }

  /**
   * Get message date from headers
   */
  private getMessageDate(message: gmail_v1.Schema$Message): Date {
    const headers = this.getHeaders(message);
    const dateStr = headers.get('date');
    return dateStr ? new Date(dateStr) : new Date();
  }

  private getHeaders(message: gmail_v1.Schema$Message): Map<string, string> {
    const headers = new Map<string, string>();

    if (message.payload?.headers) {
      for (const header of message.payload.headers) {
        if (header.name && header.value) {
          headers.set(header.name.toLowerCase(), header.value);
        }
      }
    }

    return headers;
  }

  private parseHeaders(headers: Map<string, string>) {
    const subject = headers.get('subject') || '(No Subject)';
    const from = this.parseAddress(headers.get('from') || '');
    const tos = this.parseAddressList(headers.get('to') || '');
    const ccs = this.parseAddressList(headers.get('cc') || '');
    const bccs = this.parseAddressList(headers.get('bcc') || '');
    const date = headers.get('date');
    const priority = this.parsePriority(headers);

    return {
      subject,
      fromEmail: from.email,
      fromName: from.name,
      tos,
      ccs,
      bccs,
      body: '', // Will be filled by extractBody
      priority,
      receivedAt: date ? new Date(date) : new Date(),
      labels: [],
    };
  }

  private parseAddress(address: string): { email: string; name?: string } {
    // Format can be: "Name <email@example.com>" or just "email@example.com"
    const match = address.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);

    if (match) {
      const name = match[1]?.trim();
      const email = match[2]?.trim();
      return { email, name: name || undefined };
    }

    return { email: address.trim() };
  }

  private parseAddressList(addresses: string): Array<{ email: string; name?: string }> {
    if (!addresses) return [];

    // Split by comma, but not commas within quotes
    const parts = addresses.match(/(?:[^,"]|"(?:\\.|[^"])*")+/g) || [];

    return parts
      .map((part) => this.parseAddress(part.trim()))
      .filter((addr) => {
        // Must have an email containing '@' to be valid
        // Filters out things like "undisclosed-recipients:;" or empty strings
        return addr.email && addr.email.includes('@');
      });
  }

  private parsePriority(headers: Map<string, string>): string {
    const priority = headers.get('x-priority') || headers.get('priority') || headers.get('importance');

    if (!priority) return 'normal';

    const priorityLower = priority.toLowerCase();

    if (priorityLower.includes('high') || priorityLower === '1' || priorityLower === '2') {
      return 'high';
    }

    if (priorityLower.includes('low') || priorityLower === '4' || priorityLower === '5') {
      return 'low';
    }

    return 'normal';
  }

  private extractBody(message: gmail_v1.Schema$Message): string {
    // Prefer HTML, fallback to plain text
    const htmlBody = this.extractBodyPart(message.payload, 'text/html');
    if (htmlBody) return htmlBody;

    const textBody = this.extractBodyPart(message.payload, 'text/plain');
    if (textBody) return textBody;

    return '';
  }

  private extractBodyPart(
    part: gmail_v1.Schema$MessagePart | undefined,
    mimeType: string
  ): string | null {
    if (!part) return null;

    // Check if this part matches the mimeType
    if (part.mimeType === mimeType && part.body?.data) {
      return this.decodeBase64(part.body.data);
    }

    // Recursively search in parts
    if (part.parts) {
      for (const subPart of part.parts) {
        const result = this.extractBodyPart(subPart, mimeType);
        if (result) return result;
      }
    }

    return null;
  }

  private decodeBase64(data: string): string {
    try {
      // Gmail uses URL-safe base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64, 'base64').toString('utf-8');
    } catch (error: any) {
      // Note: We don't have logger instance here, and this is a low-level parsing error
      // that shouldn't normally happen. Just log to console for now.
      console.error('Failed to decode base64:', {
        error: error.message,
        dataLength: data?.length,
      });
      return '';
    }
  }
}
