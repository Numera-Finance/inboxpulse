import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import type { Email } from '@crm/shared';
import { AIService, type ModelConfig } from './ai-service';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

/**
 * Email classification categories
 */
export type EmailCategory = 'spam' | 'marketing' | 'transactional' | 'automated' | 'business';

/**
 * Classification result with confidence and stage info
 */
export interface ClassificationResult {
  category: EmailCategory;
  confidence: number;
  stage: string;
  reasoning?: string;
}

/**
 * HuggingFace inference response type
 */
interface HFClassificationResponse {
  label: string;
  score: number;
}

/**
 * Email Filter Service
 * Uses a cascading strategy to classify emails efficiently:
 * 1. Free heuristic checks (patterns, headers)
 * 2. Free HuggingFace spam detection
 * 3. Free HuggingFace zero-shot classification
 * 4. Paid LLM classification (fallback)
 */
@injectable()
export class EmailFilterService {
  // Known spam/marketing patterns
  private static readonly SPAM_PATTERNS = [
    /unsubscribe/i,
    /opt[- ]?out/i,
    /click here to stop/i,
    /manage.*(preferences|subscriptions)/i,
    /no longer (wish to )?receive/i,
    /remove (me |yourself )?from/i,
  ];

  private static readonly MARKETING_PATTERNS = [
    /limited.time.offer/i,
    /act now/i,
    /exclusive deal/i,
    /free trial/i,
    /special promotion/i,
    /newsletter/i,
    /\d+%\s*off/i,
    /discount code/i,
    /promo code/i,
    // Event/webinar marketing
    /events?\s*(roundup|digest|recap|update)/i,
    /upcoming\s+(events?|webinars?|sessions?)/i,
    /don'?t miss/i,
    /register (now|today|here|to attend)/i,
    /join us (for|at)/i,
    /webinar/i,
    /virtual event/i,
    /save your (spot|seat)/i,
    /rsvp/i,
  ];

  private static readonly TRANSACTIONAL_PATTERNS = [
    /order.*(confirm|receipt|ship)/i,
    /invoice #?\d+/i,
    /payment.*(confirm|receiv|process)/i,
    /tracking number/i,
    /delivery.*(update|confirm|status)/i,
    /receipt for/i,
    /your (order|purchase)/i,
  ];

  private static readonly AUTOMATED_PATTERNS = [
    /auto[- ]?generated/i,
    /do[- ]?not[- ]?reply/i,
    /noreply/i,
    /automated (message|notification|email)/i,
    /this is an? automated/i,
    /system (notification|alert|message)/i,
  ];

  // Known automated/no-reply senders
  private static readonly AUTOMATED_SENDERS = [
    /noreply/i,
    /no-reply/i,
    /donotreply/i,
    /do-not-reply/i,
    /notifications?@/i,
    /alerts?@/i,
    /mailer-daemon/i,
    /postmaster/i,
    /support@.*\.com$/i,
  ];

  // Known marketing sender domains
  private static readonly MARKETING_DOMAINS = [
    'mailchimp.com',
    'sendgrid.net',
    'constantcontact.com',
    'hubspot.com',
    'marketo.com',
    'pardot.com',
    'klaviyo.com',
    'mailgun.org',
    'amazonses.com',
    'sendinblue.com',
  ];

  // Social site notification domains
  private static readonly SOCIAL_NOTIFICATION_DOMAINS = [
    // Social networks
    'facebookmail.com',
    'facebook.com',
    'linkedin.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'quora.com',
    'reddit.com',
    'pinterest.com',
    'tiktok.com',
    'snapchat.com',
    'medium.com',
    'substack.com',
    // Developer/productivity tools
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'slack.com',
    'notion.so',
    'figma.com',
    'asana.com',
    'trello.com',
    'jira.atlassian.com',
    'monday.com',
    'clickup.com',
    'linear.app',
    // Chat/messaging platforms
    'chat.google.com',
    'teams.microsoft.com',
    'discordapp.com',
    'discord.com',
    'whatsapp.com',
    'telegram.org',
    'webex.com',
    'ringcentral.com',
    'gotomeeting.com',
  ];

  // Calendar notification senders
  private static readonly CALENDAR_SENDERS = [
    'calendar-notification@google.com',
    'noreply@calendar.google.com',
    'calendar-noreply@google.com',
    'outlook.office365.com',
    'noreply@microsoft.com',
    'calendly.com',
    'zoom.us',
    'meetings.zoom.us',
  ];

  // Chat/messaging notification senders
  private static readonly CHAT_NOTIFICATION_SENDERS = [
    // Google Chat
    'chat-noreply@google.com',
    'workspace-noreply@google.com',
    '@chat.google.com',
    // Microsoft Teams
    'noreply@email.teams.microsoft.com',
    '@teams.microsoft.com',
    // Slack (in addition to domain check)
    'notification@slack.com',
    'feedback@slack.com',
    // Discord
    'noreply@discord.com',
    // Zoom chat
    'noreply@zoom.us',
    // WebEx
    'messenger@webex.com',
  ];

  // ICS calendar format marker - highly reliable indicator of calendar invite
  private static readonly ICS_PATTERN = /BEGIN:VCALENDAR/i;

  // HuggingFace API settings
  private static readonly HF_API_URL = 'https://api-inference.huggingface.co/models';
  private static readonly HF_SPAM_MODEL = 'mshenoda/roberta-spam'; // Email spam detection
  private static readonly HF_ZERO_SHOT_MODEL = 'facebook/bart-large-mnli';
  private static readonly HF_RETRY_DELAY_MS = 2000;
  private static readonly HF_MAX_RETRIES = 3;

  // Confidence thresholds
  private static readonly HIGH_CONFIDENCE_THRESHOLD = 0.85;
  private static readonly MEDIUM_CONFIDENCE_THRESHOLD = 0.7;
  private static readonly PATTERN_HIGH_CONFIDENCE = 0.9;
  private static readonly PATTERN_MEDIUM_CONFIDENCE = 0.75;

  constructor(@inject(AIService) private aiService: AIService) {}

  /**
   * Classify an email using cascading strategy
   * Returns classification result with category, confidence, and stage info
   */
  async classify(
    email: Email,
    options?: {
      llmModel?: ModelConfig;
      skipHuggingFace?: boolean;
      skipLLM?: boolean;
      tenantId?: string;
    }
  ): Promise<ClassificationResult> {
    const startTime = Date.now();
    const tenantId = options?.tenantId;

    logger.debug(
      { emailId: email.messageId, subject: email.subject, tenantId },
      'Starting email classification'
    );

    // Stage 1: Pattern-based classification (FREE - instant)
    const patternResult = this.runPatternClassification(email);
    if (patternResult && patternResult.confidence >= EmailFilterService.HIGH_CONFIDENCE_THRESHOLD) {
      logger.info(
        {
          emailId: email.messageId,
          category: patternResult.category,
          confidence: patternResult.confidence,
          stage: 'pattern',
          durationMs: Date.now() - startTime,
          tenantId,
        },
        'Email classified by pattern matching'
      );
      return patternResult;
    }

    // Stage 2: Sender-based classification (FREE - instant)
    const senderResult = this.runSenderClassification(email);
    if (senderResult && senderResult.confidence >= EmailFilterService.HIGH_CONFIDENCE_THRESHOLD) {
      logger.info(
        {
          emailId: email.messageId,
          category: senderResult.category,
          confidence: senderResult.confidence,
          stage: 'sender',
          durationMs: Date.now() - startTime,
          tenantId,
        },
        'Email classified by sender analysis'
      );
      return senderResult;
    }

    // Stage 3: HuggingFace spam detection (FREE - API call)
    if (!options?.skipHuggingFace) {
      const hfSpamResult = await this.runHuggingFaceSpamDetection(email);
      if (hfSpamResult && hfSpamResult.confidence >= EmailFilterService.MEDIUM_CONFIDENCE_THRESHOLD) {
        logger.info(
          {
            emailId: email.messageId,
            category: hfSpamResult.category,
            confidence: hfSpamResult.confidence,
            stage: 'huggingface-spam',
            durationMs: Date.now() - startTime,
            tenantId,
          },
          'Email classified by HuggingFace spam detection'
        );
        return hfSpamResult;
      }

      // Stage 4: HuggingFace zero-shot classification (FREE - API call)
      const hfZeroShotResult = await this.runHuggingFaceZeroShot(email);
      if (hfZeroShotResult && hfZeroShotResult.confidence >= EmailFilterService.MEDIUM_CONFIDENCE_THRESHOLD) {
        logger.info(
          {
            emailId: email.messageId,
            category: hfZeroShotResult.category,
            confidence: hfZeroShotResult.confidence,
            stage: 'huggingface-zeroshot',
            durationMs: Date.now() - startTime,
            tenantId,
          },
          'Email classified by HuggingFace zero-shot'
        );
        return hfZeroShotResult;
      }
    }

    // Stage 5: LLM classification (PAID - fallback)
    if (!options?.skipLLM) {
      const llmResult = await this.runLLMClassification(email, options?.llmModel, tenantId);
      logger.info(
        {
          emailId: email.messageId,
          category: llmResult.category,
          confidence: llmResult.confidence,
          stage: 'llm',
          durationMs: Date.now() - startTime,
          tenantId,
        },
        'Email classified by LLM'
      );
      return llmResult;
    }

    // Default: classify as business if all stages skipped or inconclusive
    logger.info(
      {
        emailId: email.messageId,
        category: 'business',
        confidence: 0.5,
        stage: 'default',
        durationMs: Date.now() - startTime,
        tenantId,
      },
      'Email classified as business (default)'
    );
    return {
      category: 'business',
      confidence: 0.5,
      stage: 'default',
    };
  }

  /**
   * Check if email should be filtered out (is spam/marketing/automated)
   */
  async shouldFilter(
    email: Email,
    options?: {
      llmModel?: ModelConfig;
      skipHuggingFace?: boolean;
      skipLLM?: boolean;
      tenantId?: string;
    }
  ): Promise<{ filter: boolean; result: ClassificationResult }> {
    const result = await this.classify(email, options);
    const filter = result.category === 'spam' || result.category === 'marketing' || result.category === 'automated';
    return { filter, result };
  }

  /**
   * Stage 1: Pattern-based classification
   */
  private runPatternClassification(email: Email): ClassificationResult | null {
    const content = `${email.subject} ${email.body || ''}`.toLowerCase();

    // Check for spam patterns
    const spamMatches = EmailFilterService.SPAM_PATTERNS.filter((p) => p.test(content));
    if (spamMatches.length >= 2) {
      return {
        category: 'spam',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'pattern',
        reasoning: `Matched ${spamMatches.length} spam patterns`,
      };
    }

    // Check for marketing patterns
    const marketingMatches = EmailFilterService.MARKETING_PATTERNS.filter((p) => p.test(content));
    if (marketingMatches.length >= 2) {
      return {
        category: 'marketing',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'pattern',
        reasoning: `Matched ${marketingMatches.length} marketing patterns`,
      };
    }

    // Check for transactional patterns
    const transactionalMatches = EmailFilterService.TRANSACTIONAL_PATTERNS.filter((p) => p.test(content));
    if (transactionalMatches.length >= 2) {
      return {
        category: 'transactional',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'pattern',
        reasoning: `Matched ${transactionalMatches.length} transactional patterns`,
      };
    }

    // Check for automated patterns
    const automatedMatches = EmailFilterService.AUTOMATED_PATTERNS.filter((p) => p.test(content));
    if (automatedMatches.length >= 1) {
      return {
        category: 'automated',
        confidence: EmailFilterService.PATTERN_MEDIUM_CONFIDENCE,
        stage: 'pattern',
        reasoning: `Matched ${automatedMatches.length} automated patterns`,
      };
    }

    // Check for ICS calendar content (BEGIN:VCALENDAR marker)
    if (EmailFilterService.ICS_PATTERN.test(content)) {
      return {
        category: 'automated',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'pattern',
        reasoning: 'Contains ICS calendar data (BEGIN:VCALENDAR)',
      };
    }

    // Single pattern matches with lower confidence
    if (spamMatches.length === 1) {
      return {
        category: 'spam',
        confidence: EmailFilterService.PATTERN_MEDIUM_CONFIDENCE,
        stage: 'pattern',
        reasoning: 'Matched 1 spam pattern',
      };
    }

    if (marketingMatches.length === 1) {
      return {
        category: 'marketing',
        confidence: EmailFilterService.PATTERN_MEDIUM_CONFIDENCE,
        stage: 'pattern',
        reasoning: 'Matched 1 marketing pattern',
      };
    }

    return null;
  }

  /**
   * Stage 2: Sender-based classification
   */
  private runSenderClassification(email: Email): ClassificationResult | null {
    const senderEmail = email.from.email.toLowerCase();
    const senderName = email.from.name?.toLowerCase() || '';

    // Check for automated senders
    for (const pattern of EmailFilterService.AUTOMATED_SENDERS) {
      if (pattern.test(senderEmail) || pattern.test(senderName)) {
        return {
          category: 'automated',
          confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
          stage: 'sender',
          reasoning: `Sender matches automated pattern: ${senderEmail}`,
        };
      }
    }

    // Check for marketing domains
    const senderDomain = senderEmail.split('@')[1];
    if (senderDomain && EmailFilterService.MARKETING_DOMAINS.some((d) => senderDomain.includes(d))) {
      return {
        category: 'marketing',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'sender',
        reasoning: `Sender domain is a known marketing service: ${senderDomain}`,
      };
    }

    // Check for social notification domains
    if (senderDomain && EmailFilterService.SOCIAL_NOTIFICATION_DOMAINS.some((d) => senderDomain.includes(d))) {
      return {
        category: 'automated',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'sender',
        reasoning: `Sender domain is a known notification service: ${senderDomain}`,
      };
    }

    // Check for calendar notification senders
    if (EmailFilterService.CALENDAR_SENDERS.some((s) => senderEmail.includes(s))) {
      return {
        category: 'automated',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'sender',
        reasoning: `Sender is a known calendar service: ${senderEmail}`,
      };
    }

    // Check for chat/messaging notification senders
    if (EmailFilterService.CHAT_NOTIFICATION_SENDERS.some((s) => senderEmail.includes(s))) {
      return {
        category: 'automated',
        confidence: EmailFilterService.PATTERN_HIGH_CONFIDENCE,
        stage: 'sender',
        reasoning: `Sender is a known chat/messaging service: ${senderEmail}`,
      };
    }

    return null;
  }

  /**
   * Stage 3: HuggingFace spam detection
   */
  private async runHuggingFaceSpamDetection(email: Email): Promise<ClassificationResult | null> {
    const hfToken = getEnv().HUGGINGFACE_API_TOKEN;
    if (!hfToken) {
      logger.debug('HuggingFace API token not configured, skipping spam detection');
      return null;
    }

    const content = this.prepareContentForHF(email);

    try {
      const response = await this.callHuggingFaceWithRetry<HFClassificationResponse[][]>(
        EmailFilterService.HF_SPAM_MODEL,
        { inputs: content },
        hfToken
      );

      if (!response || !Array.isArray(response) || response.length === 0) {
        return null;
      }

      // Response format: [[{label: 'LABEL_1', score: 0.99}, {label: 'LABEL_0', score: 0.01}]]
      const predictions = response[0];
      if (!predictions || predictions.length === 0) {
        return null;
      }

      // Find the prediction with highest score
      const topPrediction = predictions.reduce((a, b) => (a.score > b.score ? a : b));

      // LABEL_1 = spam, LABEL_0 = not spam (ham)
      if (topPrediction.label === 'LABEL_1' || topPrediction.label.toLowerCase() === 'spam') {
        return {
          category: 'spam',
          confidence: topPrediction.score,
          stage: 'huggingface-spam',
          reasoning: `HuggingFace spam model confidence: ${(topPrediction.score * 100).toFixed(1)}%`,
        };
      }

      return null;
    } catch (error: any) {
      logger.warn(
        { error: error.message, model: EmailFilterService.HF_SPAM_MODEL },
        'HuggingFace spam detection failed'
      );
      return null;
    }
  }

  /**
   * Stage 4: HuggingFace zero-shot classification
   */
  private async runHuggingFaceZeroShot(email: Email): Promise<ClassificationResult | null> {
    const hfToken = getEnv().HUGGINGFACE_API_TOKEN;
    if (!hfToken) {
      logger.debug('HuggingFace API token not configured, skipping zero-shot classification');
      return null;
    }

    const content = this.prepareContentForHF(email);
    const candidateLabels = ['business email', 'marketing email', 'spam', 'transactional notification', 'automated system message'];

    try {
      const response = await this.callHuggingFaceWithRetry<{
        labels: string[];
        scores: number[];
      }>(
        EmailFilterService.HF_ZERO_SHOT_MODEL,
        {
          inputs: content,
          parameters: { candidate_labels: candidateLabels },
        },
        hfToken
      );

      if (!response || !response.labels || !response.scores) {
        return null;
      }

      // Find highest scoring label
      const maxIndex = response.scores.indexOf(Math.max(...response.scores));
      const topLabel = response.labels[maxIndex];
      const topScore = response.scores[maxIndex];

      // Map labels to categories
      const categoryMap: Record<string, EmailCategory> = {
        'business email': 'business',
        'marketing email': 'marketing',
        'spam': 'spam',
        'transactional notification': 'transactional',
        'automated system message': 'automated',
      };

      const category = categoryMap[topLabel] || 'business';

      return {
        category,
        confidence: topScore,
        stage: 'huggingface-zeroshot',
        reasoning: `HuggingFace zero-shot: ${topLabel} (${(topScore * 100).toFixed(1)}%)`,
      };
    } catch (error: any) {
      logger.warn(
        { error: error.message, model: EmailFilterService.HF_ZERO_SHOT_MODEL },
        'HuggingFace zero-shot classification failed'
      );
      return null;
    }
  }

  /**
   * Stage 5: LLM classification (using AIService)
   */
  async runLLMClassification(
    email: Email,
    modelConfig?: ModelConfig,
    tenantId?: string
  ): Promise<ClassificationResult> {
    // Default model config if not provided
    const model: ModelConfig = modelConfig || {
      provider: 'google',
      model: 'gemini-2.0-flash',
      temperature: 0.3,
      maxTokens: 500,
    };

    const classificationSchema = z.object({
      category: z.enum(['spam', 'marketing', 'transactional', 'automated', 'business']),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    });

    const prompt = `Classify this email into one of these categories:
- spam: Unsolicited, unwanted, potentially malicious emails
- marketing: Promotional content, newsletters, product announcements
- transactional: Order confirmations, receipts, shipping updates
- automated: System notifications, alerts, auto-generated messages
- business: Legitimate business communication requiring human attention

Email Subject: ${email.subject}
Email From: ${email.from.name || ''} <${email.from.email}>
Email Body:
${email.body || '(no body)'}

Respond with:
- category: The most appropriate category
- confidence: Your confidence level (0.0 to 1.0)
- reasoning: Brief explanation of your classification`;

    try {
      const result = await this.aiService.generateStructuredOutput({
        model,
        prompt,
        schema: classificationSchema,
        labels: {
          tenantId,
          tags: ['email-filter', 'classification'],
          metadata: {
            emailId: email.messageId,
            stage: 'llm',
          },
        },
        maxRetries: 1,
      });

      return {
        category: result.object.category,
        confidence: result.object.confidence,
        stage: 'llm',
        reasoning: result.object.reasoning,
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, model: model.model, emailId: email.messageId },
        'LLM classification failed'
      );
      // Return low-confidence business classification on failure
      return {
        category: 'business',
        confidence: 0.5,
        stage: 'llm-fallback',
        reasoning: `LLM classification failed: ${error.message}`,
      };
    }
  }

  /**
   * Helper: Prepare email content for HuggingFace API
   */
  private prepareContentForHF(email: Email): string {
    const subject = email.subject || '';
    const body = email.body || '';
    // Limit content length to avoid API issues
    const combined = `Subject: ${subject}\n\n${body}`;
    return combined.substring(0, 1000);
  }

  /**
   * Helper: Call HuggingFace API with retry logic for 503 errors
   */
  private async callHuggingFaceWithRetry<T>(
    model: string,
    payload: Record<string, any>,
    token: string
  ): Promise<T | null> {
    let attempt = 0;

    while (attempt < EmailFilterService.HF_MAX_RETRIES) {
      try {
        const response = await fetch(`${EmailFilterService.HF_API_URL}/${model}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 503) {
          // Model is loading, wait and retry
          attempt++;
          logger.debug(
            { model, attempt, maxRetries: EmailFilterService.HF_MAX_RETRIES },
            'HuggingFace model loading, retrying...'
          );
          await this.sleep(EmailFilterService.HF_RETRY_DELAY_MS * attempt);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HuggingFace API error ${response.status}: ${errorText}`);
        }

        return await response.json() as T;
      } catch (error: any) {
        if (attempt >= EmailFilterService.HF_MAX_RETRIES - 1) {
          throw error;
        }
        attempt++;
        await this.sleep(EmailFilterService.HF_RETRY_DELAY_MS);
      }
    }

    return null;
  }

  /**
   * Helper: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
