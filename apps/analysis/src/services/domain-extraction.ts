import type { Email } from '@crm/shared';
import { CustomerClient } from '@crm/clients';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

// Domain enrichment service available but not used yet - will be enabled when customer opts in
// import { DomainEnrichmentService, type DomainEnrichmentConfig } from './domain-enrichment';

/**
 * Personal email providers to exclude from customer extraction
 */
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'email.com',
]);

export interface ExtractedDomain {
  domain: string;
}

export interface ExtractedCustomer {
  id: string;
  domain: string; // First domain for backward compatibility
  domains: string[]; // All domains
  name?: string | null;
}

export class DomainExtractionService {
  private customerClient: CustomerClient;

  constructor() {
    this.customerClient = new CustomerClient(getEnv().SERVICE_API_URL, { internal: true });
  }

  /**
   * Extract top-level domain from email address
   * Handles: subdomain.example.com -> example.com
   */
  extractTopLevelDomain(email: string): string | null {
    try {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain) {
        logger.warn({ email }, 'No domain found in email address');
        return null;
      }

      // Check if personal domain
      if (PERSONAL_DOMAINS.has(domain)) {
        logger.debug({ domain }, 'Domain is personal email provider, excluding');
        return null;
      }

      // Extract top-level domain (simple approach - can be enhanced with public suffix list)
      const parts = domain.split('.');
      if (parts.length >= 2) {
        // Return last two parts (e.g., example.com, co.uk)
        return parts.slice(-2).join('.');
      }

      return domain;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, email }, 'Failed to extract top-level domain');
      return null;
    }
  }

  /**
   * Extract all unique domains from email
   */
  extractDomains(email: Email): ExtractedDomain[] {
    const domains = new Set<string>();
    const results: ExtractedDomain[] = [];

    try {
      logger.debug({
        fromEmail: email.from.email,
        tosCount: email.tos?.length || 0,
        ccsCount: email.ccs?.length || 0,
        bccsCount: email.bccs?.length || 0
      }, 'Extracting domains from email addresses');

      // From sender
      const fromDomain = this.extractTopLevelDomain(email.from.email);
      logger.debug({ fromEmail: email.from.email, fromDomain }, 'Extracted domain from sender');
      if (fromDomain) {
        domains.add(fromDomain);
        results.push({ domain: fromDomain });
      }

      // Recipients
      const allRecipients = [
        ...(email.tos || []),
        ...(email.ccs || []),
        ...(email.bccs || []),
      ];

      logger.debug({ recipientsCount: allRecipients.length }, 'Processing recipients');

      for (const addr of allRecipients) {
        const domain = this.extractTopLevelDomain(addr.email);
        logger.debug({ email: addr.email, domain }, 'Extracted domain from recipient');
        if (domain && !domains.has(domain)) {
          domains.add(domain);
          results.push({ domain });
        }
      }

      logger.info({
        emailId: email.messageId,
        domainsFound: results.length,
        domains: results.map(d => d.domain)
      }, 'Extracted domains from email');
      return results;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, emailId: email.messageId }, 'Failed to extract domains from email');
      return [];
    }
  }

  /**
   * Extract domains and create/update customers
   */
  async extractAndCreateCustomers(tenantId: string, email: Email): Promise<ExtractedCustomer[]> {
    try {
      const domains = this.extractDomains(email);
      const customers: ExtractedCustomer[] = [];

      logger.info({
        tenantId,
        domainsCount: domains.length,
        domains: domains.map(d => d.domain),
        emailId: email.messageId
      }, 'Creating/updating customers from extracted domains');

      for (const { domain } of domains) {
        let inferredName: string | undefined;
        try {
          // Skip personal domains (check if domain is in PERSONAL_DOMAINS set)
          if (PERSONAL_DOMAINS.has(domain)) {
            logger.debug({ domain }, 'Skipping personal domain');
            continue;
          }

          // Infer customer name from domain (simple approach)
          inferredName = this.inferCustomerName(domain);

          logger.debug({ tenantId, domain, inferredName }, 'Attempting to upsert customer');

          // Upsert customer
          const customer = await this.customerClient.upsertCustomer({
            tenantId,
            domains: [domain], // Single domain in array
            name: inferredName,
            isAutoCreated: true,
          });

          logger.debug({
            tenantId,
            domain,
            customer: JSON.stringify(customer),
            customerKeys: Object.keys(customer || {}),
            customerId: customer?.id,
            customerDomains: customer?.domains,
            customerName: customer?.name
          }, 'Customer response from API');

          if (!customer || !customer.id || !customer.domains || customer.domains.length === 0) {
            logger.error({
              tenantId,
              domain,
              customer: JSON.stringify(customer),
              customerType: typeof customer
            }, 'Invalid customer response - missing required fields');
            throw new Error(`Invalid customer response: missing id or domains. Customer: ${JSON.stringify(customer)}`);
          }

          customers.push({
            id: customer.id,
            domain: customer.domains[0], // Use first domain for backward compatibility
            domains: customer.domains, // All domains
            name: customer.name || undefined,
          });

          logger.info({ tenantId, domain, customerId: customer.id }, 'Successfully created/updated customer');
        } catch (error: any) {
          // Extract structured error from API response if available
          const structuredError = error.responseBodyParsed?.error;

          // Determine status code
          const statusCode = structuredError?.statusCode || error.status || 500;

          // Log detailed error information
          const errorDetails: any = {
            tenantId,
            domain,
            inferredName: inferredName || 'unknown',
            apiError: error.message,
            apiStatus: statusCode,
          };

          if (structuredError) {
            errorDetails.errorCode = structuredError.code;
            errorDetails.errorMessage = structuredError.message;
            errorDetails.statusCode = structuredError.statusCode;
            errorDetails.errorDetails = structuredError.details;
            errorDetails.fieldErrors = structuredError.fields;
          } else {
            errorDetails.error = error.message;
            errorDetails.stack = error.stack;
            if (error.responseBody) {
              errorDetails.apiResponseBody = error.responseBody;
            }
          }

          // For server errors (5xx), fail fast - don't continue
          if (statusCode >= 500) {
            logger.error(errorDetails, 'Server error during customer creation - failing operation');
            // Re-throw to fail the entire operation
            throw error;
          }

          // Client error (4xx) - log but continue with other domains
          logger.warn(errorDetails, 'Client error during customer creation - continuing with other domains');
          // Don't throw - continue with next domain
        }
      }

      logger.info({ tenantId, customersCreated: customers.length }, 'Completed customer extraction');
      return customers;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, tenantId, emailId: email.messageId }, 'Failed to extract and create customers');
      throw error;
    }
  }

  /**
   * Infer customer name from domain
   * Simple approach: "acme.com" -> "Acme"
   *
   * TODO: When user opts in for Clearbit/enrichment service:
   * - Check tenant config for enrichment enabled
   * - Call enrichmentService.enrichDomain() if enabled
   * - Use enriched data (name, industry, logo, etc.) if available
   * - Fallback to simple inference if enrichment fails or disabled
   */
  private inferCustomerName(domain: string): string {
    try {
      const namePart = domain.split('.')[0];
      return namePart
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    } catch (error: any) {
      logger.warn({ error: error.message, domain }, 'Failed to infer customer name from domain');
      return domain;
    }
  }
}
