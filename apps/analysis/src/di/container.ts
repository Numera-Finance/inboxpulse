import 'reflect-metadata';
import { container } from 'tsyringe';
import { logger } from '../utils/logger';

// Framework components
import { AnalysisRegistry, analysisRegistry } from '../framework/registry';
import { AnalysisExecutor } from '../framework/executor';
// Services that the executor still resolves via DI
import { AIService } from '../services/ai-service';

/**
 * Analysis service container. Only the framework + AIService go through DI;
 * the route-level singletons (domainService, contactService, emailFilterService)
 * are instantiated directly in routes/analysis.ts because they have no
 * dependencies and the route file is the only consumer.
 */
export function setupContainer() {
  logger.info('Analysis service container setup');

  try {
    container.register(AnalysisRegistry, { useValue: analysisRegistry });
    container.register(AnalysisExecutor, { useClass: AnalysisExecutor });
    container.register(AIService, { useClass: AIService });

    logger.info('Analysis service container setup complete');
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to setup container');
    throw error;
  }
}
