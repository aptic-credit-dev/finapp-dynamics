/**
 * Hard limits + shared vocabulary for the feedback domain. Every bound is enforced fail-closed so an oversized
 * narrative, an excessive answer set, or a runaway batch is rejected deterministically (ADR-056). These are
 * DATA, shared by the validators and services. Customer contacts and narratives are treated as sensitive: they
 * are stored under RLS and redacted, and never placed in events/audit (ADR-055).
 */
export const FEEDBACK_LIMITS = {
  maxNarrativeChars: 20_000,
  maxAnswerChars: 8_000,
  maxAnswers: 200,
  maxQuestions: 200,
  maxCommentChars: 8_000,
  maxBatchIngest: 500,
  maxSearchLimit: 200,
  maxRatingScale: 100,
} as const;

export class FeedbackError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FeedbackError';
    this.code = code;
  }
}

export const FEEDBACK_CHANNELS = [
  'phone',
  'email',
  'sms',
  'branch',
  'web',
  'app',
  'survey',
  'other',
] as const;
export type FeedbackChannel = (typeof FEEDBACK_CHANNELS)[number];
export function isChannel(v: unknown): v is FeedbackChannel {
  return typeof v === 'string' && (FEEDBACK_CHANNELS as readonly string[]).includes(v);
}

export const SENTIMENTS = ['positive', 'neutral', 'negative', 'critical'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export function isSentiment(v: unknown): v is Sentiment {
  return typeof v === 'string' && (SENTIMENTS as readonly string[]).includes(v);
}

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export function isSeverity(v: unknown): v is Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
}
export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/** The high-level TYPE of feedback — what kind of business object it is (drives routing, not the lifecycle). */
export const FEEDBACK_TYPES = [
  'general',
  'complaint',
  'critical_complaint',
  'suggestion',
  'compliment',
  'service_issue',
  'potential_fraud',
  'potential_legal',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export function isFeedbackType(v: unknown): v is FeedbackType {
  return typeof v === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(v);
}

/** Positive outcomes need no investigation; the rest enter controlled analysis (F-E). */
export function isPositiveType(t: FeedbackType): boolean {
  return t === 'compliment';
}

export const ROOT_CAUSE_CATEGORIES = [
  'people',
  'process',
  'system',
  'policy',
  'third_party',
  'customer_misunderstanding',
  'product_design',
  'training',
  'control_failure',
  'communication',
  'external_event',
  'unknown',
] as const;
export type RootCauseCategory = (typeof ROOT_CAUSE_CATEGORIES)[number];
export function isRootCauseCategory(v: unknown): v is RootCauseCategory {
  return typeof v === 'string' && (ROOT_CAUSE_CATEGORIES as readonly string[]).includes(v);
}
