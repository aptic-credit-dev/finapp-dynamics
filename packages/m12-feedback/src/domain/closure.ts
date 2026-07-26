/**
 * Closure eligibility + duplicate/related matching (F16/F27) — PURE. Closure is gated by configurable criteria;
 * the gate returns machine-readable reason codes for every unmet requirement so the outcome is explainable
 * (deferred: complex closure decisioning can additionally consult M07 rules, ADR-053). Duplicate/related
 * detection is deterministic (no AI similarity) and tenant-scoped by construction.
 */

/** Which closure requirements apply (from policy / rules). */
export interface ClosureCriteria {
  readonly requireCaptured?: boolean;
  readonly requireAssigned?: boolean;
  readonly requireResponse?: boolean;
  readonly requireResolution?: boolean;
  readonly requireCustomerInformed?: boolean;
  readonly requireCustomerConfirmation?: boolean;
  readonly requireSlaDisposition?: boolean;
  readonly requireRootCause?: boolean;
  readonly requireNoOpenMandatoryActivity?: boolean;
  readonly requireNoUnresolvedCriticalEscalation?: boolean;
}

/** The observed state of the feedback record. */
export interface ClosureState {
  readonly captured: boolean;
  readonly assigned: boolean;
  readonly responseComplete: boolean;
  readonly resolutionRecorded: boolean;
  readonly customerInformed: boolean;
  readonly customerConfirmed: boolean;
  readonly customerConfirmationWaived: boolean;
  readonly slaDispositionRecorded: boolean;
  readonly rootCauseRecorded: boolean;
  readonly openMandatoryActivities: number;
  readonly unresolvedCriticalEscalations: number;
}

export interface ClosureEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

/** Evaluate closure eligibility. Every unmet required criterion yields a reason code; eligible iff none. */
export function evaluateClosure(criteria: ClosureCriteria, state: ClosureState): ClosureEligibility {
  const reasons: string[] = [];
  if (criteria.requireCaptured === true && !state.captured) reasons.push('FEEDBACK_NOT_CAPTURED');
  if (criteria.requireAssigned === true && !state.assigned) reasons.push('NO_OWNER_ASSIGNED');
  if (criteria.requireResponse === true && !state.responseComplete) reasons.push('RESPONSE_INCOMPLETE');
  if (criteria.requireResolution === true && !state.resolutionRecorded) reasons.push('RESOLUTION_MISSING');
  if (criteria.requireCustomerInformed === true && !state.customerInformed)
    reasons.push('CUSTOMER_NOT_INFORMED');
  if (
    criteria.requireCustomerConfirmation === true &&
    !state.customerConfirmed &&
    !state.customerConfirmationWaived
  ) {
    reasons.push('CUSTOMER_CONFIRMATION_MISSING');
  }
  if (criteria.requireSlaDisposition === true && !state.slaDispositionRecorded)
    reasons.push('SLA_DISPOSITION_MISSING');
  if (criteria.requireRootCause === true && !state.rootCauseRecorded) reasons.push('ROOT_CAUSE_MISSING');
  if (criteria.requireNoOpenMandatoryActivity === true && state.openMandatoryActivities > 0)
    reasons.push('OPEN_MANDATORY_ACTIVITY');
  if (criteria.requireNoUnresolvedCriticalEscalation === true && state.unresolvedCriticalEscalations > 0)
    reasons.push('UNRESOLVED_CRITICAL_ESCALATION');
  return { eligible: reasons.length === 0, reasonCodes: reasons };
}

// --- duplicate / related matching --------------------------------------------------------------
export const RELATIONSHIP_KINDS = ['duplicate', 'related', 'repeat_complaint'] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export function isRelationshipKind(v: unknown): v is RelationshipKind {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}

/** Deterministic duplicate key — two feedbacks for the SAME source transaction are duplicates. */
export function duplicateKey(sourceTransactionId: string): string {
  return `txn:${sourceTransactionId}`;
}

/** Deterministic related key — same customer + product + category groups a repeat/related complaint. */
export function relatedKey(customerRef: string, product: string, category: string): string {
  return `rel:${customerRef}:${product}:${category}`;
}
