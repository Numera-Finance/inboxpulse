import 'reflect-metadata';
import { container } from 'tsyringe';
import { logger } from '../utils/logger';

// Import classes to ensure they're loaded and decorators are evaluated
import { DomainExtractionService } from '../services/domain-extraction';
import { ContactExtractionService } from '../services/contact-extraction';
import { DomainEnrichmentService } from '../services/domain-enrichment';
import { AIService } from '../services/ai-service';
import { EmailFilterService } from '../services/email-filter';
// Framework components
import { AnalysisRegistry, analysisRegistry } from '../framework/registry';
import { AnalysisExecutor } from '../framework/executor';

export function setupContainer() {
  logger.info('Analysis service container setup');
  
  try {
    // Clients are now instantiated directly in services (no DI needed for React compatibility)
    
    // Register framework components - use singleton registry instance
    container.register(AnalysisRegistry, { useValue: analysisRegistry });
    container.register(AnalysisExecutor, { useClass: AnalysisExecutor });
    
    // Then register services that depend on clients
    container.register(DomainEnrichmentService, { useClass: DomainEnrichmentService });
    container.register(DomainExtractionService, { useClass: DomainExtractionService });
    container.register(ContactExtractionService, { useClass: ContactExtractionService });
    container.register(AIService, { useClass: AIService });
    container.register(EmailFilterService, { useClass: EmailFilterService });

    logger.info('Analysis service container setup complete');
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to setup container');
    throw error;
  }
}
