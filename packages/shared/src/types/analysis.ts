/**
 * Analysis framework types
 * Shared types for the modular analysis system
 */

import { z } from 'zod';

import { DEFAULT_LLM_MODEL, DEFAULT_LLM_FALLBACK_MODEL } from '../constants/models';

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

// All known signal integer values (used to validate manual overrides)
export const ALL_SIGNALS: SignalType[] = Object.values(Signal) as SignalType[];

// All sentiment signals
export const SENTIMENT_SIGNALS = [
  Signal.SENTIMENT_POSITIVE,
  Signal.SENTIMENT_NEGATIVE,
  Signal.SENTIMENT_NEUTRAL,
] as const;

/**
 * Validate a manually supplied signals array for a signal override.
 *
 * Rules mirror the invariants the analysis pipeline produces:
 * - every value must be a known Signal
 * - no duplicates
 * - at most one sentiment signal
 * - at most one churn-risk level
 * - at most one classification
 *
 * Returns an error message when invalid, or null when the selection is valid.
 */
export function validateSignalSelection(signals: number[]): string | null {
  const seen = new Set<number>();
  for (const s of signals) {
    if (!ALL_SIGNALS.includes(s as SignalType)) {
      return `Unknown signal value: ${s}`;
    }
    if (seen.has(s)) {
      return `Duplicate signal value: ${s}`;
    }
    seen.add(s);
  }

  const countIn = (group: readonly number[]): number =>
    signals.filter((s) => group.includes(s)).length;

  if (countIn(SENTIMENT_SIGNALS) > 1) {
    return 'Only one sentiment signal is allowed';
  }
  if (countIn(CHURN_SIGNALS) > 1) {
    return 'Only one churn-risk level is allowed';
  }
  if (countIn(CLASSIFICATION_SIGNALS) > 1) {
    return 'Only one classification is allowed';
  }
  return null;
}

// =============================================================================

/**
 * LLM analysis types that can be enabled/disabled per tenant.
 *
 * Note: domain extraction and contact extraction are NOT analyses — they are
 * pure regex performed on every email and returned in the `extracted` field of
 * the /analyze response. They were previously listed here as "always run"
 * pseudo-analyses; that was misleading and has been removed.
 *
 * Single source of truth — both the TS type and the Zod schema are derived
 * from `ANALYSIS_TYPES` so they cannot drift.
 */
export const ANALYSIS_TYPES = [
  'signature-extraction',  // Conditional (if signature detected)
  'sentiment',             // Conditional (if enabled)
  'escalation',            // Conditional (if enabled)
  'upsell',                // Conditional (if enabled)
  'churn',                 // Conditional (if enabled)
  'kudos',                 // Conditional (if enabled)
  'competitor',            // Conditional (if enabled)
] as const;

export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

/**
 * Zod schema mirroring `AnalysisType`. Use at the API boundary so callers
 * sending unknown / removed types get a clean validation error instead of
 * the executor silently ignoring them.
 */
export const analysisTypeSchema = z.enum(ANALYSIS_TYPES);

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
    'signature-extraction': true,   // Enable signature extraction
    'sentiment': true,               // Enable sentiment analysis
    'escalation': false,              // Disabled — negative sentiment drives escalation workflow
    'upsell': true,                   // Enable upsell detection
    'churn': true,                    // Enable churn risk assessment
    'kudos': false,                   // Enable kudos detection
    'competitor': false,              // Enable competitor mentions
  },
  modelConfigs: {
    'signature-extraction': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
    'sentiment': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
    'escalation': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
    'upsell': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
    'churn': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
    'kudos': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
    'competitor': {
      primary: DEFAULT_LLM_MODEL,
      fallback: DEFAULT_LLM_FALLBACK_MODEL,
    },
  },
  promptVersions: {
    'signature-extraction': 'v1.0',
    'sentiment': 'v1.1',
    'escalation': 'v1.0',
    'upsell': 'v1.0',
    'churn': 'v1.0',
    'kudos': 'v1.0',
    'competitor': 'v1.0',
  },
  analysisSettings: {
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
