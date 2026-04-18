import type { AnalysisDefinition } from '../framework/types';
import type { AnalysisType, ModelConfig } from '@crm/shared';
import { DEFAULT_ANALYSIS_CONFIG } from '@crm/shared';
import {
  sentimentModule,
  escalationModule,
  upsellModule,
  churnModule,
  kudosModule,
  competitorModule,
  signatureModule,
} from './modules';

/**
 * Sentiment Analysis Definition
 */
export const sentimentAnalysisDefinition: AnalysisDefinition = {
  type: 'sentiment',
  name: 'Sentiment Analysis',
  module: sentimentModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs.sentiment,
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings.sentiment.timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings.sentiment.maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings.sentiment.priority,
  },
};

/**
 * Escalation Detection Definition
 */
export const escalationAnalysisDefinition: AnalysisDefinition = {
  type: 'escalation',
  name: 'Escalation Detection',
  module: escalationModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs.escalation,
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings.escalation.timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings.escalation.maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings.escalation.priority,
  },
};

/**
 * Upsell Detection Definition
 */
export const upsellAnalysisDefinition: AnalysisDefinition = {
  type: 'upsell',
  name: 'Upsell Detection',
  module: upsellModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs.upsell,
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings.upsell.timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings.upsell.maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings.upsell.priority,
  },
};

/**
 * Churn Risk Assessment Definition
 */
export const churnAnalysisDefinition: AnalysisDefinition = {
  type: 'churn',
  name: 'Churn Risk Assessment',
  module: churnModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs.churn,
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings.churn.timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings.churn.maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings.churn.priority,
  },
};

/**
 * Kudos Detection Definition
 */
export const kudosAnalysisDefinition: AnalysisDefinition = {
  type: 'kudos',
  name: 'Kudos Detection',
  module: kudosModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs.kudos,
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings.kudos.timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings.kudos.maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings.kudos.priority,
  },
};

/**
 * Competitor Mention Detection Definition
 */
export const competitorAnalysisDefinition: AnalysisDefinition = {
  type: 'competitor',
  name: 'Competitor Detection',
  module: competitorModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs.competitor,
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings.competitor.timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings.competitor.maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings.competitor.priority,
  },
};

/**
 * Signature Extraction Definition
 */
export const signatureExtractionAnalysisDefinition: AnalysisDefinition = {
  type: 'signature-extraction',
  name: 'Signature Extraction',
  module: signatureModule,
  models: DEFAULT_ANALYSIS_CONFIG.modelConfigs['signature-extraction'],
  settings: {
    timeout: DEFAULT_ANALYSIS_CONFIG.analysisSettings['signature-extraction'].timeout,
    maxRetries: DEFAULT_ANALYSIS_CONFIG.analysisSettings['signature-extraction'].maxRetries,
    priority: DEFAULT_ANALYSIS_CONFIG.analysisSettings['signature-extraction'].priority,
  },
};

/**
 * All analysis definitions (LLM analyses only — domain and contact extraction
 * are pure regex on the analyze handler and not part of this list).
 */
export const allAnalysisDefinitions: AnalysisDefinition[] = [
  sentimentAnalysisDefinition,
  escalationAnalysisDefinition,
  upsellAnalysisDefinition,
  churnAnalysisDefinition,
  kudosAnalysisDefinition,
  competitorAnalysisDefinition,
  signatureExtractionAnalysisDefinition,
];

/**
 * Definitions by type for easy lookup
 */
export const definitionsByType: Record<AnalysisType, AnalysisDefinition | undefined> = {
  'sentiment': sentimentAnalysisDefinition,
  'escalation': escalationAnalysisDefinition,
  'upsell': upsellAnalysisDefinition,
  'churn': churnAnalysisDefinition,
  'kudos': kudosAnalysisDefinition,
  'competitor': competitorAnalysisDefinition,
  'signature-extraction': signatureExtractionAnalysisDefinition,
};

/**
 * Helper to get definition by analysis type
 */
export function getAnalysisDefinition(type: AnalysisType): AnalysisDefinition | undefined {
  return definitionsByType[type];
}
