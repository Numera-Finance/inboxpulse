import EmailReplyParser from 'email-reply-parser';
import { convert } from 'html-to-text';
import * as talon from 'talonjs';

export interface EmailExtractionResult {
  messageBody: string;       // Reply content only (no signature, no quotes)
  signature: string | null;  // Extracted signature text
  originalLength: number;
  cleanedLength: number;
  tokenSavingsPercent: number;
}

export interface SignatureInfo {
  detected: boolean;
  style: string | null;
  text: string | null;
}

// Common signature patterns to detect
const SIGNATURE_PATTERNS = [
  /^--\s*$/m,                                    // Standard -- delimiter
  /^Best regards?,?\s*$/im,
  /^Best,?\s*$/im,
  /^Regards?,?\s*$/im,
  /^Thanks?,?\s*$/im,
  /^Thank you,?\s*$/im,
  /^Cheers,?\s*$/im,
  /^Sincerely,?\s*$/im,
  /^Warm regards?,?\s*$/im,
  /^Kind regards?,?\s*$/im,
  /^All the best,?\s*$/im,
  /^Yours truly,?\s*$/im,
  /^Respectfully,?\s*$/im,
  /^Take care,?\s*$/im,
  /^Talk soon,?\s*$/im,
  /^Sent from my iPhone/im,
  /^Sent from my iPad/im,
  /^Get Outlook for/im,
];

/**
 * Convert HTML to plain text for parsing
 */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'head', format: 'skip' },
    ],
    preserveNewlines: true,
  });
}

/**
 * Detect signature in email text and return info about it
 * Returns the signature start position and style, but NOT the full text yet
 * (text will be extracted later using cleanedText length as boundary)
 */
export function detectSignature(text: string): SignatureInfo & { startIndex?: number } {
  for (const pattern of SIGNATURE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      return {
        detected: true,
        style: match[0].trim(),
        text: null, // Will be extracted later
        startIndex: match.index,
      };
    }
  }

  return {
    detected: false,
    style: null,
    text: null,
  };
}

/**
 * Extract signature using talonjs
 * talonjs is based on Mailgun's Talon - good at signature detection
 */
function extractSignatureWithTalon(textBody: string): string | null {
  try {
    // talonjs returns body without quotes but WITH signature
    const withSignature = talon.quotations.extractFromPlain(textBody);

    // email-reply-parser returns body without quotes AND without signature
    const parsed = new EmailReplyParser().read(textBody);
    const withoutSignature = parsed.getVisibleText().trim();

    // The difference is the signature
    if (withSignature.body.length > withoutSignature.length) {
      // Find where they diverge - that's where signature starts
      const signatureStart = withoutSignature.length;
      const signature = withSignature.body.slice(signatureStart).trim();
      return signature.length > 0 ? signature : null;
    }

    // Fallback: check email-reply-parser fragments for signature
    // Cast to any because fragments is private in types but accessible at runtime
    const fragments = (parsed as any).fragments as Array<{
      isSignature: () => boolean;
      isQuoted: () => boolean;
      getContent: () => string;
    }>;
    if (fragments) {
      const signatureFragments = fragments.filter(f => f.isSignature() && !f.isQuoted());
      if (signatureFragments.length > 0) {
        const sig = signatureFragments
          .map(f => f.getContent())
          .join('\n')
          .trim();
        return sig.length > 0 ? sig : null;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract the latest reply and signature separately
 *
 * 1. talonjs extracts signature
 * 2. email-reply-parser extracts reply (without signature, without quotes)
 *
 * This allows sending them separately to analysis service for lower token usage
 */
export function extractLatestReply(emailBody: string, isHtml: boolean = false): EmailExtractionResult {
  // Convert to text
  const textBody = isHtml ? htmlToText(emailBody) : emailBody;
  const originalLength = textBody.length;

  // Handle empty or very short emails
  if (originalLength < 10) {
    return {
      messageBody: textBody.trim(),
      signature: null,
      originalLength,
      cleanedLength: textBody.trim().length,
      tokenSavingsPercent: 0,
    };
  }

  let messageBody = '';
  let signature: string | null = null;

  try {
    // Step 1: Extract signature using talonjs + email-reply-parser comparison
    signature = extractSignatureWithTalon(textBody);

    // Step 2: Extract reply using email-reply-parser (strips quotes AND signature)
    const parsed = new EmailReplyParser().read(textBody);
    messageBody = parsed.getVisibleText().trim();
  } catch (e) {
    // Fallback to original if parsing fails
    messageBody = textBody.trim();
  }

  // If extraction returned empty, fallback to original
  if (messageBody.length === 0) {
    messageBody = textBody.trim();
  }

  const cleanedLength = messageBody.length + (signature?.length || 0);
  const tokenSavingsPercent = originalLength > 0
    ? Math.round((1 - cleanedLength / originalLength) * 100)
    : 0;

  return {
    messageBody,
    signature,
    originalLength,
    cleanedLength,
    tokenSavingsPercent,
  };
}

/**
 * Process an email and return full extraction analysis
 */
export interface FullExtractionResult extends EmailExtractionResult {
  signatureInfo: SignatureInfo;  // Detection info (style, detected flag)
  signatureExtracted: boolean;   // Whether we successfully extracted the signature
}

export function analyzeEmailExtraction(emailBody: string, isHtml: boolean = false): FullExtractionResult {
  const textBody = isHtml ? htmlToText(emailBody) : emailBody;

  // Detect signature pattern in original
  const signatureInfo = detectSignature(textBody);

  // Extract reply and signature separately
  const extraction = extractLatestReply(emailBody, isHtml);

  // Check if we successfully extracted a signature
  const signatureExtracted = extraction.signature !== null && extraction.signature.length > 0;

  return {
    ...extraction,
    signatureInfo,
    signatureExtracted,
  };
}
