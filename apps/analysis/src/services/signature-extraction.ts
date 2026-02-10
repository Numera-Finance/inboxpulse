import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import type { Email } from '@crm/shared';
import { AIService } from './ai-service';
import { ContactClient } from '@crm/clients';
import { logger } from '../utils/logger';

// API service base URL for clients
const apiBaseUrl = process.env.SERVICE_API_URL;

/**
 * Zod schema for extracted signature data
 */
// Helper to normalize URLs - add https:// if missing protocol
const normalizeUrl = (url: string): string => {
  url = url.trim();
  if (!url.match(/^https?:\/\//i)) {
    return `https://${url}`;
  }
  return url;
};

// Custom URL schema that accepts URLs with or without protocol
const urlSchema = z.string()
  .transform((val) => {
    if (!val) return val;
    return normalizeUrl(val);
  })
  .pipe(z.string().url());

export const signatureSchema = z.object({
  name: z.string().describe('Full name of the person, e.g. "John Doe". Omit if not found.').optional(),
  title: z.string().describe('Job title or position, e.g. "CEO", "VP of Sales". Omit if not found.').optional(),
  company: z.string().describe('Company or organization name. Omit if not found.').optional(),
  email: z.string().email().describe('Email address from signature. Omit if not found.').optional(),
  phone: z.string().describe('Phone number with country code. Omit if not found.').optional(),
  mobile: z.string().describe('Mobile/cell phone number. Omit if not found.').optional(),
  address: z.string().describe('Physical street address. Omit if not found.').optional(),
  website: urlSchema.describe('Website URL. Omit if not found.').optional(),
  linkedin: urlSchema.describe('LinkedIn profile URL. Omit if not found.').optional(),
  x: z.string().describe('X (formerly Twitter) handle or URL. Omit if not found.').optional(),
  linktree: urlSchema.describe('Linktree profile URL. Omit if not found.').optional(),
});

export type ExtractedSignature = z.infer<typeof signatureSchema>;

/**
 * Result from signature detection
 */
export interface SignatureDetectionResult {
  hasSignature: boolean;
  confidence?: number;
}

/**
 * Result from signature extraction
 */
export interface SignatureExtractionResult {
  signature: ExtractedSignature;
  contactId?: string; // If contact was updated
}

/**
 * Service for extracting and processing email signatures
 */
@injectable()
export class SignatureExtractionService {
  private contactClient: ContactClient;

  constructor(
    @inject(AIService) private aiService: AIService
  ) {
    this.contactClient = new ContactClient(apiBaseUrl, { internal: true });
  }

  /**
   * Step 1: Detect if email has a signature
   * Uses a simple heuristic approach (can be enhanced with SLM if needed)
   */
  async detectSignature(email: Email): Promise<SignatureDetectionResult> {
    try {
      logger.debug({ emailId: email.messageId }, 'Detecting signature in email');

      // Simple heuristic: check if email body contains common signature patterns
      const body = email.body || '';
      const hasSignature = this.hasSignaturePattern(body);

      logger.info(
        {
          emailId: email.messageId,
          hasSignature,
          bodyLength: body.length,
        },
        'Signature detection completed'
      );

      return {
        hasSignature,
        confidence: hasSignature ? 0.7 : 0.3, // Basic confidence score
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, emailId: email.messageId },
        'Failed to detect signature'
      );
      return { hasSignature: false };
    }
  }

  /**
   * Step 2: Extract signature details using SLM (gemini-1.5-flash)
   */
  async extractSignature(
    tenantId: string,
    email: Email,
    labels?: { traceId?: string; tenantId?: string }
  ): Promise<SignatureExtractionResult> {
    try {
      logger.debug({ emailId: email.messageId, tenantId }, 'Extracting signature from email');

      // Build the extraction prompt
      const prompt = this.buildExtractionPrompt(email);
      logger.debug(
        { emailId: email.messageId, promptLength: prompt.length, tenantId },
        'Prompt built, calling AI service'
      );

      // Extract signature using SLM - using gemini-2.5-pro for structured output support
      logger.debug(
        { emailId: email.messageId, model: 'gemini-2.5-pro', tenantId },
        'Calling generateStructuredOutput'
      );
      const result = await this.aiService.generateStructuredOutput({
        model: {
          provider: 'google',
          model: 'gemini-2.5-pro', // Pro model supports structured output reliably
          temperature: 0.1, // Low temperature for consistent extraction
        },
        prompt,
        schema: signatureSchema,
        labels: {
          tenantId,
          traceId: labels?.traceId,
          tags: ['signature-extraction', 'slm'],
          metadata: {
            emailId: email.messageId,
            fromEmail: email.from.email,
          },
        },
        maxRetries: 1,
      });

      logger.debug(
        { emailId: email.messageId, tenantId, hasResult: !!result },
        'AI service returned result'
      );

      const signature = result.object;

      logger.debug(
        { emailId: email.messageId, tenantId, signatureKeys: Object.keys(signature) },
        'Extracted signature object'
      );

      logger.info(
        {
          emailId: email.messageId,
          tenantId,
          signatureFields: Object.keys(signature).filter((k) => signature[k as keyof ExtractedSignature] !== undefined),
          extractedSignature: signature, // Log the full extracted signature
          hasReasoning: !!result.reasoning,
        },
        'Signature extracted successfully'
      );

      // Update contact with signature details if email matches
      let contactId: string | undefined;
      try {
        contactId = await this.updateContactWithSignature(tenantId, email.from.email, signature);
      } catch (error: any) {
        logger.warn(
          { error: error.message, email: email.from.email, tenantId },
          'Failed to update contact with signature, continuing'
        );
      }

      return {
        signature,
        contactId,
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, stack: error.stack, emailId: email.messageId, tenantId },
        'Failed to extract signature'
      );
      throw error;
    }
  }

  /**
   * Complete workflow: detect and extract signature
   */
  async detectAndExtractSignature(
    tenantId: string,
    email: Email,
    labels?: { traceId?: string; tenantId?: string }
  ): Promise<SignatureExtractionResult | null> {
    try {
      // Step 1: Detect signature
      const detection = await this.detectSignature(email);

      if (!detection.hasSignature) {
        logger.debug({ emailId: email.messageId }, 'No signature detected, skipping extraction');
        return null;
      }

      // Step 2: Extract signature
      return await this.extractSignature(tenantId, email, labels);
    } catch (error: any) {
      logger.error(
        { error: error.message, emailId: email.messageId, tenantId },
        'Failed in detect and extract signature workflow'
      );
      throw error;
    }
  }

  /**
   * Build prompt for signature extraction
   */
  private buildExtractionPrompt(email: Email): string {
    return `You are extracting contact information from an email signature. Carefully analyze the email body below and extract ALL available signature fields.

Email Body:
${email.body || ''}

CRITICAL INSTRUCTIONS:
1. The signature is typically at the END of the email, after phrases like "Best regards", "Sincerely", "Thanks", etc.
2. Extract ALL of the following fields if they appear in the signature:
   - name: Full name (e.g., "John Doe")
   - title: Job title or position (e.g., "CEO", "VP of Sales")
   - company: Company or organization name (e.g., "Acme Corporation")
   - email: Email address (ONLY if different from sender's email or explicitly shown in signature)
   - phone: Phone number (look for "Phone:", "Tel:", or phone number patterns)
   - mobile: Mobile/cell number (look for "Mobile:", "Cell:", or mobile number patterns)
   - address: Physical address (street address, city, state, zip)
   - website: Website URL (look for "www.", "http://", or "https://")
   - linkedin: LinkedIn profile URL (look for "linkedin.com" or "LinkedIn:")
   - x: X (formerly Twitter) handle or URL (look for "@", "x.com", "twitter.com", or "X:")
   - linktree: Linktree profile URL (look for "linktr.ee" or "linktree.com")

3. IMPORTANT EXTRACTION RULES:
   - Extract company name even if it's just mentioned (e.g., "CEO, Acme Corporation" → company: "Acme Corporation")
   - Extract phone numbers in any format and normalize them (e.g., "+1-555-123-4567", "(555) 123-4567", "555.123.4567")
   - Extract mobile separately if both phone and mobile are present
   - Extract full addresses including street, city, state, zip
   - Extract LinkedIn URLs even if partial (add https:// if missing)
   - Extract X handles with or without @ symbol (formerly Twitter)
   - Extract Linktree URLs (linktr.ee or linktree.com)
   - Look carefully - some fields might be on separate lines or formatted differently

4. IGNORE:
   - The main email content (everything before the signature)
   - The sender's email address (unless it's explicitly repeated in the signature)
   - Generic phrases or greetings

5. OUTPUT FORMAT:
   - Return a JSON object with ONLY the fields that were actually found in the signature
   - OMIT fields entirely if not found - do NOT use placeholder values like "string", "null", or empty strings
   - Only include a field if you found actual data for it
   - Be thorough - extract every piece of contact information available

Extract the signature information now and return it as valid JSON.`;
  }

  /**
   * Check if email body contains signature patterns
   */
  private hasSignaturePattern(body: string): boolean {
    if (!body || body.length < 50) {
      return false;
    }

    const lowerBody = body.toLowerCase();

    // Common signature indicators
    const signatureIndicators = [
      /best regards/i,
      /sincerely/i,
      /regards/i,
      /thanks/i,
      /thank you/i,
      /sent from/i,
      /mobile:/i,
      /phone:/i,
      /tel:/i,
      /linkedin/i,
      /twitter/i,
      /www\./i,
      /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/, // Phone number pattern
      /\b[A-Z][a-z]+ [A-Z][a-z]+\b.*\n.*\n/, // Name followed by multiple lines
    ];

    // Check if at least 2 indicators are present (more reliable)
    const matches = signatureIndicators.filter((pattern) => pattern.test(lowerBody)).length;

    // Also check if body ends with structured information (common signature pattern)
    const lastLines = body.split('\n').slice(-5).join('\n');
    const hasStructuredEnd = /(phone|mobile|email|linkedin|twitter|www)/i.test(lastLines);

    return matches >= 2 || hasStructuredEnd;
  }

  /**
   * Update contact with extracted signature information
   */
  private async updateContactWithSignature(
    tenantId: string,
    email: string,
    signature: ExtractedSignature
  ): Promise<string | undefined> {
    try {
      // Find contact by email
      const contact = await this.contactClient.getContactByEmail(tenantId, email);

      if (!contact) {
        logger.debug({ email, tenantId }, 'Contact not found, cannot update signature');
        return undefined;
      }

      // Helper to check if a value is valid (not empty, not placeholder like "string")
      const isValidValue = (value: string | undefined): boolean => {
        if (!value) return false;
        const trimmed = value.trim().toLowerCase();
        // Filter out empty strings and placeholder values
        return trimmed.length > 0 && trimmed !== 'string' && trimmed !== 'null' && trimmed !== 'undefined';
      };

      // Prepare update data (only include fields that have valid values)
      const updateData: {
        name?: string;
        title?: string;
        phone?: string;
        mobile?: string;
        address?: string;
        website?: string;
        linkedin?: string;
        x?: string;
        linktree?: string;
      } = {};
      const fieldsUpdated: string[] = [];

      if (isValidValue(signature.name)) {
        updateData.name = signature.name!.trim();
        fieldsUpdated.push('name');
      }

      if (isValidValue(signature.title)) {
        updateData.title = signature.title!.trim();
        fieldsUpdated.push('title');
      }

      if (isValidValue(signature.phone)) {
        updateData.phone = signature.phone!.trim();
        fieldsUpdated.push('phone');
      }

      if (isValidValue(signature.mobile)) {
        updateData.mobile = signature.mobile!.trim();
        fieldsUpdated.push('mobile');
      }

      if (isValidValue(signature.address)) {
        updateData.address = signature.address!.trim();
        fieldsUpdated.push('address');
      }

      if (isValidValue(signature.website)) {
        updateData.website = signature.website!.trim();
        fieldsUpdated.push('website');
      }

      if (isValidValue(signature.linkedin)) {
        updateData.linkedin = signature.linkedin!.trim();
        fieldsUpdated.push('linkedin');
      }

      if (isValidValue(signature.x)) {
        updateData.x = signature.x!.trim();
        fieldsUpdated.push('x');
      }

      if (isValidValue(signature.linktree)) {
        updateData.linktree = signature.linktree!.trim();
        fieldsUpdated.push('linktree');
      }

      // Only update if we have data to update
      if (fieldsUpdated.length === 0) {
        logger.debug({ contactId: contact.id }, 'No signature data to update contact');
        return contact.id;
      }

      // Update contact with signature data
      logger.info(
        {
          contactId: contact.id,
          email,
          fieldsUpdated,
          tenantId,
          logType: 'SIGNATURE_CONTACT_ENRICHED',
        },
        'SIGNATURE ENRICHMENT: Updating contact with signature data'
      );

      await this.contactClient.updateContact(contact.id, updateData);

      logger.info(
        {
          contactId: contact.id,
          email,
          tenantId,
          fieldsUpdated,
          logType: 'SIGNATURE_CONTACT_ENRICHED',
        },
        'SIGNATURE ENRICHMENT: Contact updated with signature data successfully'
      );

      return contact.id;
    } catch (error: any) {
      logger.error(
        { error: error.message, email, tenantId },
        'Failed to update contact with signature'
      );
      throw error;
    }
  }
}
