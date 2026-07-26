import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `rules.lifecycle` event family — owned by m07-rules (Stage 2.3).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the engine that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023). Classification
 * `confidential`. Payloads carry IDENTIFIERS, REASON CODES and INPUT/CONTEXT HASHES ONLY — never raw rule
 * inputs, outputs, or derived values (evaluations may concern regulated/personal data). A consumer that needs
 * detail reads it back through the rules API under its own permissions.
 */

export const RULES_LIFECYCLE_FAMILY = 'rules.lifecycle';
export const RULES_LIFECYCLE_VERSION = 1;

export type RulesLifecycleEventType =
  | 'RuleSetCreated'
  | 'RuleSetValidated'
  | 'RuleSetPublished'
  | 'RuleSetActivated'
  | 'RuleSetRetired'
  | 'RuleEvaluationCompleted'
  | 'RuleEvaluationFailed'
  | 'RuleEvaluationReplayed'
  | 'RuleTestCompleted';

export const RULES_LIFECYCLE_EVENT_TYPES: readonly RulesLifecycleEventType[] = [
  'RuleSetCreated',
  'RuleSetValidated',
  'RuleSetPublished',
  'RuleSetActivated',
  'RuleSetRetired',
  'RuleEvaluationCompleted',
  'RuleEvaluationFailed',
  'RuleEvaluationReplayed',
  'RuleTestCompleted',
];

/** A rule-set / version lifecycle transition. Identifiers only. */
export interface RuleSetLifecyclePayload {
  readonly ruleSetId: string;
  readonly versionId?: string;
  readonly versionNumber?: number;
  readonly code: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reason?: string;
}

/** A governed evaluation outcome. Carries the input HASH, never the raw input/output values. */
export interface RuleEvaluationPayload {
  readonly evaluationId: string;
  readonly ruleSetId: string;
  readonly versionId: string;
  readonly outcome: string;
  readonly inputHash: string;
  readonly reasonCodes?: readonly string[];
  readonly subjectType?: string;
  readonly subjectId?: string;
}

/** A rule test-case execution result. */
export interface RuleTestPayload {
  readonly testId: string;
  readonly ruleSetId: string;
  readonly passed: boolean;
}

export type RulesLifecyclePayload = RuleSetLifecyclePayload | RuleEvaluationPayload | RuleTestPayload;

export type RulesLifecycleEvent = DomainEventEnvelope<
  typeof RULES_LIFECYCLE_FAMILY,
  RulesLifecycleEventType,
  RulesLifecyclePayload
>;
