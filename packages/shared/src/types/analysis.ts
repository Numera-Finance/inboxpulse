/**
 * Analysis framework types
 * Shared types for the modular analysis system
 */

// =============================================================================
// Email Signals - Integer constants for the signals[] array on emails table
// Using ranges to group related signals and leave room for future additions
// =============================================================================

export const Signal = {
  // Sentiment (1-9)
  SENTIMENT_POSITIVE: 1,
  SENTIMENT_NEGATIVE: 2,
  SENTIMENT_NEUTRAL: 3,

  // Escalation (10-19)
  ESCALATION: 10,

  // Upsell (20-29)
  UPSELL: 20,

  // Churn risk levels (30-39)
  CHURN_LOW: 30,
  CHURN_MEDIUM: 31,
  CHURN_HIGH: 32,
  CHURN_CRITICAL: 33,

  // Kudos (40-49)
  KUDOS: 40,

  // Competitor mention (50-59)
  COMPETITOR: 50,

  // Email classification (60-69)
  CLASSIFICATION_SPAM: 60,
  CLASSIFICATION_MARKETING: 61,
  CLASSIFICATION_TRANSACTIONAL: 62,
  CLASSIFICATION_AUTOMATED: 63,
  CLASSIFICATION_BUSINESS: 64,
} as const;

export type SignalType = (typeof Signal)[keyof typeof Signal];

// Signal labels for UI display
export const SIGNAL_LABELS: Record<SignalType, string> = {
  [Signal.SENTIMENT_POSITIVE]: 'Positive',
  [Signal.SENTIMENT_NEGATIVE]: 'Negative',
  [Signal.SENTIMENT_NEUTRAL]: 'Neutral',
  [Signal.ESCALATION]: 'Escalation',
  [Signal.UPSELL]: 'Upsell Opportunity',
  [Signal.CHURN_LOW]: 'Churn Risk (Low)',
  [Signal.CHURN_MEDIUM]: 'Churn Risk (Medium)',
  [Signal.CHURN_HIGH]: 'Churn Risk (High)',
  [Signal.CHURN_CRITICAL]: 'Churn Risk (Critical)',
  [Signal.KUDOS]: 'Kudos',
  [Signal.COMPETITOR]: 'Competitor Mention',
  [Signal.CLASSIFICATION_SPAM]: 'Spam',
  [Signal.CLASSIFICATION_MARKETING]: 'Marketing',
  [Signal.CLASSIFICATION_TRANSACTIONAL]: 'Transactional',
  [Signal.CLASSIFICATION_AUTOMATED]: 'Automated',
  [Signal.CLASSIFICATION_BUSINESS]: 'Business',
};

// Helper to check if signals array contains a specific signal
export function hasSignal(signals: number[] | null | undefined, signal: SignalType): boolean {
  return signals?.includes(signal) ?? false;
}

// Helper to check if signals array contains any of the given signals
export function hasAnySignal(signals: number[] | null | undefined, checkSignals: SignalType[]): boolean {
  if (!signals) return false;
  return checkSignals.some(s => signals.includes(s));
}

// Helper to get sentiment from signals array
export function getSentimentFromSignals(signals: number[] | null | undefined): 'positive' | 'negative' | 'neutral' | null {
  if (!signals) return null;
  if (signals.includes(Signal.SENTIMENT_POSITIVE)) return 'positive';
  if (signals.includes(Signal.SENTIMENT_NEGATIVE)) return 'negative';
  if (signals.includes(Signal.SENTIMENT_NEUTRAL)) return 'neutral';
  return null;
}

// Helper to get churn risk level from signals array
export function getChurnRiskFromSignals(signals: number[] | null | undefined): 'low' | 'medium' | 'high' | 'critical' | null {
  if (!signals) return null;
  if (signals.includes(Signal.CHURN_CRITICAL)) return 'critical';
  if (signals.includes(Signal.CHURN_HIGH)) return 'high';
  if (signals.includes(Signal.CHURN_MEDIUM)) return 'medium';
  if (signals.includes(Signal.CHURN_LOW)) return 'low';
  return null;
}

// All churn signals for filtering "has any churn risk"
export const CHURN_SIGNALS = [
  Signal.CHURN_LOW,
  Signal.CHURN_MEDIUM,
  Signal.CHURN_HIGH,
  Signal.CHURN_CRITICAL,
] as const;

// All classification signals
export const CLASSIFICATION_SIGNALS = [
  Signal.CLASSIFICATION_SPAM,
  Signal.CLASSIFICATION_MARKETING,
  Signal.CLASSIFICATION_TRANSACTIONAL,
  Signal.CLASSIFICATION_AUTOMATED,
  Signal.CLASSIFICATION_BUSINESS,
] as const;

// Classification type for the email filter
export type EmailClassification = 'spam' | 'marketing' | 'transactional' | 'automated' | 'business';

// Helper to get classification from signals array
export function getClassificationFromSignals(signals: number[] | null | undefined): EmailClassification | null {
  if (!signals) return null;
  if (signals.includes(Signal.CLASSIFICATION_SPAM)) return 'spam';
  if (signals.includes(Signal.CLASSIFICATION_MARKETING)) return 'marketing';
  if (signals.includes(Signal.CLASSIFICATION_TRANSACTIONAL)) return 'transactional';
  if (signals.includes(Signal.CLASSIFICATION_AUTOMATED)) return 'automated';
  if (signals.includes(Signal.CLASSIFICATION_BUSINESS)) return 'business';
  return null;
}

// Helper to get signal from classification category
export function getSignalFromClassification(classification: EmailClassification): SignalType {
  switch (classification) {
    case 'spam': return Signal.CLASSIFICATION_SPAM;
    case 'marketing': return Signal.CLASSIFICATION_MARKETING;
    case 'transactional': return Signal.CLASSIFICATION_TRANSACTIONAL;
    case 'automated': return Signal.CLASSIFICATION_AUTOMATED;
    case 'business': return Signal.CLASSIFICATION_BUSINESS;
  }
}

// =============================================================================

/**
 * Analysis types that can be enabled/disabled per tenant
 */
export type AnalysisType =
  | 'domain-extraction'      // Always run (sync)
  | 'contact-extraction'     // Always run (sync)
  | 'signature-extraction'   // Conditional (if signature detected)
  | 'sentiment'              // Conditional (if enabled)
  | 'escalation'             // Conditional (if enabled)
  | 'upsell'                 // Conditional (if enabled)
  | 'churn'                  // Conditional (if enabled)
  | 'kudos'                  // Conditional (if enabled)
  | 'competitor';            // Conditional (if enabled)

/**
 * Model configuration with primary and optional fallback
 */
export interface ModelConfig {
  primary: string;    // e.g., 'gemini-2.5-pro'
  fallback?: string;  // e.g., 'gpt-4o-mini' (optional)
}

/**
 * Analysis-specific settings
 */
export interface AnalysisSettings {
  minConfidenceThreshold?: number;
  requireLLMIfRegexFieldsMissing?: number;
  alwaysUseLLM?: boolean;
  timeout?: number;
  maxRetries?: number;
  priority?: number;
}

/**
 * Complete analysis configuration for a tenant
 */
export interface AnalysisConfig {
  tenantId: string;
  enabledAnalyses: Record<AnalysisType, boolean>;
  modelConfigs: Record<AnalysisType, ModelConfig>;
  promptVersions: Record<AnalysisType, string>;
  customPrompts?: Record<AnalysisType, string>;
  analysisSettings: Record<AnalysisType, AnalysisSettings>;
}

/**
 * Default analysis configuration
 */
export const DEFAULT_ANALYSIS_CONFIG: Omit<AnalysisConfig, 'tenantId'> = {
  enabledAnalyses: {
    'domain-extraction': true,      // Always enabled
    'contact-extraction': true,     // Always enabled
    'signature-extraction': true,   // Enable signature extraction
    'sentiment': true,               // Enable sentiment analysis
    'escalation': false,              // Disabled — negative sentiment drives escalation workflow
    'upsell': true,                   // Enable upsell detection
    'churn': false,                   // Enable churn risk assessment
    'kudos': false,                   // Enable kudos detection
    'competitor': false,              // Enable competitor mentions
  },
  modelConfigs: {
    'domain-extraction': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'contact-extraction': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'signature-extraction': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'sentiment': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'escalation': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'upsell': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'churn': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'kudos': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
    'competitor': {
      primary: 'gemini-2.0-flash',
      fallback: 'gemini-1.5-flash',
    },
  },
  promptVersions: {
    'domain-extraction': 'v1.0',
    'contact-extraction': 'v1.0',
    'signature-extraction': 'v1.0',
    'sentiment': 'v1.1',
    'escalation': 'v1.0',
    'upsell': 'v1.0',
    'churn': 'v1.0',
    'kudos': 'v1.0',
    'competitor': 'v1.0',
  },
  analysisSettings: {
    'domain-extraction': {},
    'contact-extraction': {},
    'signature-extraction': {
      requireLLMIfRegexFieldsMissing: 2,
      alwaysUseLLM: false,
    },
    'sentiment': {},
    'escalation': {
      minConfidenceThreshold: 0.7,
    },
    'upsell': {
      minConfidenceThreshold: 0.6,
    },
    'churn': {
      minConfidenceThreshold: 0.7,
    },
    'kudos': {
      minConfidenceThreshold: 0.6,
    },
    'competitor': {
      minConfidenceThreshold: 0.6,
    },
  },
};
