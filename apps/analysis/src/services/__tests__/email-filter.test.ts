import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailFilterService, type ClassificationResult, type EmailCategory } from '../email-filter';
import type { Email } from '@crm/shared';

/**
 * Test email factory to create consistent test emails
 */
function createTestEmail(overrides: Partial<Email> = {}): Email {
  return {
    provider: 'gmail',
    messageId: 'test-message-id',
    threadId: 'test-thread-id',
    subject: 'Test Subject',
    body: 'Test body content',
    from: {
      email: 'test@example.com',
      name: 'Test Sender',
    },
    tos: [{ email: 'recipient@example.com', name: 'Recipient' }],
    receivedAt: new Date(),
    labels: [],
    ...overrides,
  };
}

/**
 * Mock AIService for testing
 */
const mockAIService = {
  generateStructuredOutput: vi.fn(),
};

describe('EmailFilterService', () => {
  let filterService: EmailFilterService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create service with mocked AIService
    filterService = new EmailFilterService(mockAIService as any);
  });

  describe('Pattern Classification', () => {
    describe('Marketing Patterns', () => {
      it('should classify TriNet events roundup email as marketing', async () => {
        // Real-world test case: TriNet marketing email
        const trinetEmail = createTestEmail({
          messageId: 'trinet-events-email',
          subject: "Don't miss our first sessions in 2026",
          from: {
            email: 'Ensemble@mystartupcfo.com',
            name: "TriNet via Ensemble Team @myStartUpCFO",
          },
          body: `EVENTS ROUNDUP
Thank you for joining us for a wonderful year of events!

Check out our upcoming events and webinars for 2026. We have exciting sessions planned.

Virtual Event Replay Access
Watch our previous events on demand.

Join us for our kickoff event in January!`,
        });

        const result = await filterService.classify(trinetEmail, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('marketing');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
        expect(result.stage).toBe('pattern');
        expect(result.reasoning).toContain('marketing patterns');
      });

      it('should classify newsletter emails as marketing', async () => {
        const email = createTestEmail({
          subject: 'Weekly Newsletter - Updates and News',
          body: 'Here is your weekly newsletter. Don\'t miss our latest updates!',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('marketing');
        expect(result.stage).toBe('pattern');
      });

      it('should classify promotional emails as marketing', async () => {
        const email = createTestEmail({
          subject: 'Limited Time Offer - 50% Off!',
          body: 'Act now to get this exclusive deal before it expires!',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('marketing');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });

      it('should classify webinar invites as marketing', async () => {
        const email = createTestEmail({
          subject: 'Join our upcoming webinar on AI trends',
          body: 'Register now for our free webinar. Save your seat today!',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('marketing');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });

      it('should classify event roundup emails as marketing', async () => {
        const email = createTestEmail({
          subject: 'Events Roundup - December 2024',
          body: 'Here is a recap of all our events this month. Join us for our upcoming webinar!',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('marketing');
        expect(result.stage).toBe('pattern');
      });

      it('should classify discount code emails as marketing', async () => {
        const email = createTestEmail({
          subject: 'Your exclusive promo code inside',
          body: 'Use discount code SAVE20 at checkout.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('marketing');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    });

    describe('Spam Patterns', () => {
      it('should classify unsubscribe-heavy emails as spam', async () => {
        const email = createTestEmail({
          subject: 'Click here to stop receiving emails',
          body: 'Unsubscribe from our list. Opt-out anytime.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('spam');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });

      it('should classify preference management emails as spam', async () => {
        const email = createTestEmail({
          subject: 'Manage your email preferences',
          body: 'Click here to stop receiving these messages. No longer wish to receive updates?',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('spam');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    });

    describe('Transactional Patterns', () => {
      it('should classify order confirmation emails as transactional', async () => {
        const email = createTestEmail({
          subject: 'Order Confirmation - Order #12345',
          body: 'Your order has been confirmed. Here is your receipt for your purchase.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('transactional');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });

      it('should classify shipping updates as transactional', async () => {
        const email = createTestEmail({
          subject: 'Shipping Update - Your package is on the way',
          body: 'Your tracking number is 1Z999AA10123456784. Delivery update: estimated arrival tomorrow.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('transactional');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });

      it('should classify invoice emails as transactional', async () => {
        const email = createTestEmail({
          subject: 'Invoice #INV-2024-001',
          body: 'Payment received for Invoice #12345. Thank you for your purchase.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('transactional');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    });

    describe('Automated Patterns', () => {
      it('should classify auto-generated emails as automated via sender', async () => {
        // Automated patterns with medium confidence fall through to sender analysis
        // Using noreply sender ensures automated classification
        const email = createTestEmail({
          subject: 'Auto-generated notification',
          from: {
            email: 'noreply@system.com',
            name: 'System',
          },
          body: 'This is an automated message from the system.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('automated');
        expect(result.stage).toBe('sender');
      });

      it('should classify system notifications as automated via sender', async () => {
        const email = createTestEmail({
          subject: 'System Alert - Server Status',
          from: {
            email: 'notifications@system.com',
            name: 'System Alerts',
          },
          body: 'This is a system notification about your account.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('automated');
        expect(result.stage).toBe('sender');
      });
    });

    describe('Business (default)', () => {
      it('should classify regular business emails as business', async () => {
        const email = createTestEmail({
          subject: 'Meeting follow-up',
          body: 'Hi, thanks for meeting today. Let me know your thoughts on the proposal.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        // With no patterns matching and HF/LLM skipped, should default to business
        expect(result.category).toBe('business');
        expect(result.stage).toBe('default');
      });

      it('should classify client correspondence as business', async () => {
        const email = createTestEmail({
          subject: 'Re: Project timeline discussion',
          body: 'Looking forward to our call next week to discuss the project timeline.',
        });

        const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

        expect(result.category).toBe('business');
      });
    });
  });

  describe('Sender Classification', () => {
    it('should classify noreply senders as automated', async () => {
      const email = createTestEmail({
        subject: 'Your account update',
        from: {
          email: 'noreply@company.com',
          name: 'Company Notifications',
        },
        body: 'Your account settings have been updated.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('automated');
      expect(result.stage).toBe('sender');
    });

    it('should classify do-not-reply senders as automated', async () => {
      const email = createTestEmail({
        subject: 'Password reset request',
        from: {
          email: 'do-not-reply@service.com',
          name: 'Service Notifications',
        },
        body: 'Click here to reset your password.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('automated');
      expect(result.stage).toBe('sender');
    });

    it('should classify notifications@ senders as automated', async () => {
      const email = createTestEmail({
        subject: 'New login detected',
        from: {
          email: 'notifications@platform.com',
          name: 'Platform',
        },
        body: 'A new login was detected on your account.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('automated');
      expect(result.stage).toBe('sender');
    });

    it('should classify mailchimp.com senders as marketing', async () => {
      const email = createTestEmail({
        subject: 'Your weekly update',
        from: {
          email: 'newsletter@mail.mailchimp.com',
          name: 'Weekly Update',
        },
        body: 'Here is your weekly update.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('marketing');
      expect(result.stage).toBe('sender');
    });

    it('should classify sendgrid.net senders as marketing', async () => {
      const email = createTestEmail({
        subject: 'Message from company',
        from: {
          email: 'info@em123.sendgrid.net',
          name: 'Company',
        },
        body: 'Check out our latest products.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('marketing');
      expect(result.stage).toBe('sender');
    });
  });

  describe('shouldFilter', () => {
    it('should recommend filtering spam emails', async () => {
      const email = createTestEmail({
        subject: 'Click here to stop receiving',
        body: 'Unsubscribe from this list. Opt-out options below.',
      });

      const { filter, result } = await filterService.shouldFilter(email, { skipHuggingFace: true, skipLLM: true });

      expect(filter).toBe(true);
      expect(result.category).toBe('spam');
    });

    it('should recommend filtering marketing emails', async () => {
      const email = createTestEmail({
        subject: 'Limited time offer - Act now!',
        body: 'Get 50% off with this exclusive deal.',
      });

      const { filter, result } = await filterService.shouldFilter(email, { skipHuggingFace: true, skipLLM: true });

      expect(filter).toBe(true);
      expect(result.category).toBe('marketing');
    });

    it('should recommend filtering automated emails', async () => {
      const email = createTestEmail({
        subject: 'System notification',
        from: {
          email: 'noreply@system.com',
          name: 'System',
        },
        body: 'This is an automated system notification.',
      });

      const { filter, result } = await filterService.shouldFilter(email, { skipHuggingFace: true, skipLLM: true });

      expect(filter).toBe(true);
      expect(result.category).toBe('automated');
    });

    it('should NOT recommend filtering business emails', async () => {
      const email = createTestEmail({
        subject: 'Re: Project discussion',
        body: 'Thanks for the update. Let me review and get back to you.',
      });

      const { filter, result } = await filterService.shouldFilter(email, { skipHuggingFace: true, skipLLM: true });

      expect(filter).toBe(false);
      expect(result.category).toBe('business');
    });

    it('should NOT recommend filtering transactional emails', async () => {
      const email = createTestEmail({
        subject: 'Order confirmation #12345',
        body: 'Your order has been confirmed. Receipt for your purchase attached.',
      });

      const { filter, result } = await filterService.shouldFilter(email, { skipHuggingFace: true, skipLLM: true });

      expect(filter).toBe(false);
      expect(result.category).toBe('transactional');
    });
  });

  describe('Classification Cascade', () => {
    it('should prioritize pattern matching over sender analysis', async () => {
      // Email with both marketing patterns AND automated sender
      // Pattern should win because it's checked first and has high confidence
      const email = createTestEmail({
        subject: 'Limited time offer - 50% off!',
        from: {
          email: 'noreply@company.com',
          name: 'Company',
        },
        body: 'Act now to save big on this exclusive deal!',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      // Marketing patterns (limited time offer, act now, exclusive deal) should be detected first
      expect(result.category).toBe('marketing');
      expect(result.stage).toBe('pattern');
    });

    it('should fall back to sender when patterns do not match', async () => {
      const email = createTestEmail({
        subject: 'Important update',
        from: {
          email: 'noreply@company.com',
          name: 'Company',
        },
        body: 'Please review the attached document.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('automated');
      expect(result.stage).toBe('sender');
    });

    it('should fall back to default when no patterns or sender rules match', async () => {
      const email = createTestEmail({
        subject: 'Quick question',
        from: {
          email: 'john@clientcompany.com',
          name: 'John Smith',
        },
        body: 'Do you have time for a quick call tomorrow?',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('business');
      expect(result.stage).toBe('default');
    });
  });

  describe('Confidence Levels', () => {
    it('should return high confidence (0.9) for multiple pattern matches', async () => {
      const email = createTestEmail({
        subject: 'Register now for our webinar',
        body: 'Join us for this virtual event. Save your spot today!',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.confidence).toBe(0.9);
    });

    it('should return default confidence when single pattern match falls through', async () => {
      const email = createTestEmail({
        subject: 'Newsletter - December 2024',
        body: 'Here is our monthly update with no other marketing language.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      // Single pattern match has 0.75 confidence, which is below HIGH_CONFIDENCE_THRESHOLD (0.85)
      // So it falls through to default classification with 0.5 confidence
      expect(result.category).toBe('business');
      expect(result.confidence).toBe(0.5);
      expect(result.stage).toBe('default');
    });

    it('should return 0.5 confidence for default business classification', async () => {
      const email = createTestEmail({
        subject: 'Meeting tomorrow',
        body: 'Looking forward to our meeting.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('business');
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle emails with empty body', async () => {
      const email = createTestEmail({
        subject: 'Test',
        body: '',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result).toBeDefined();
      expect(['spam', 'marketing', 'transactional', 'automated', 'business']).toContain(result.category);
    });

    it('should handle emails with undefined body', async () => {
      const email = createTestEmail({
        subject: 'Test',
        body: undefined as any,
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result).toBeDefined();
    });

    it('should handle emails with very long content', async () => {
      const email = createTestEmail({
        subject: 'Important Newsletter Update - Don\'t Miss Out!',
        body: 'This is marketing content with upcoming webinars. '.repeat(1000),
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result).toBeDefined();
      // newsletter + don't miss = 2 marketing patterns
      expect(result.category).toBe('marketing');
    });

    it('should be case-insensitive for pattern matching', async () => {
      const email = createTestEmail({
        subject: 'NEWSLETTER - WEEKLY UPDATE',
        body: 'LIMITED TIME OFFER',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('marketing');
    });
  });

  describe('Real-World Email Examples', () => {
    it('should classify GitHub notification as automated', async () => {
      const email = createTestEmail({
        subject: '[repo/project] Issue #123: Bug report',
        from: {
          email: 'notifications@github.com',
          name: 'GitHub',
        },
        body: 'A new issue was opened in your repository.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('automated');
    });

    it('should classify Slack notification as automated', async () => {
      const email = createTestEmail({
        subject: 'New messages in #general',
        from: {
          email: 'no-reply@slack.com',
          name: 'Slack',
        },
        body: 'You have unread messages.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('automated');
    });

    it('should classify Amazon shipping notification as transactional', async () => {
      const email = createTestEmail({
        subject: 'Your Amazon order has shipped',
        from: {
          email: 'shipment-tracking@amazon.com',
          name: 'Amazon.com',
        },
        body: 'Your order has shipped! Tracking number: 1Z999AA10123456784. Delivery update: arriving tomorrow.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('transactional');
    });

    it('should classify Mailchimp newsletter as marketing', async () => {
      const email = createTestEmail({
        subject: 'Your monthly roundup',
        from: {
          email: 'newsletter@mail.mailchimp.com',
          name: 'Monthly Roundup',
        },
        body: 'Check out our latest news and updates.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('marketing');
    });

    it('should classify HubSpot marketing email as marketing', async () => {
      const email = createTestEmail({
        subject: 'Check out our new features',
        from: {
          email: 'marketing@email.hubspot.com',
          name: 'HubSpot',
        },
        body: 'We have exciting new features to share.',
      });

      const result = await filterService.classify(email, { skipHuggingFace: true, skipLLM: true });

      expect(result.category).toBe('marketing');
    });
  });
});
