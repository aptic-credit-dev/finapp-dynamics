/**
 * Closure eligibility + case relationship matching (F30/F31) — PURE. Closure is gated by configurable criteria;
 * the gate returns machine-readable reason codes for every unmet requirement so the outcome is explainable
 * (complex closure decisioning can additionally consult M07 rules, ADR-057). A legal hold or an open critical
 * escalation ALWAYS blocks closure (fail closed). Relationship kinds are validated and self/duplicate cycles are
 * rejected.
 */

/** Which closure requirements apply (from the case type / policy / rules). */
export interface ClosureCriteria {
  readonly requireWorkflowComplete?: boolean;
  readonly requireMandatoryTasksComplete?: boolean;
  readonly requireFindingsRecorded?: boolean;
  readonly requireDecisionApproved?: boolean;
  readonly requireRequiredDocuments?: boolean;
  readonly requireDeadlinesDispositioned?: boolean;
  readonly requireSubjectInformed?: boolean;
  readonly requireRemedyRecorded?: boolean;
  readonly requireSettlementResolved?: boolean;
  readonly requireNoActiveLegalHold?: boolean;
  readonly requireNoOpenCriticalEscalation?: boolean;
  readonly requireNoUnresolvedMandatoryIssue?: boolean;
  readonly requireRegulatoryActionComplete?: boolean;
}

/** The observed state of the case. */
export interface ClosureState {
  readonly workflowComplete: boolean;
  readonly openMandatoryTasks: number;
  readonly findingsRecorded: boolean;
  readonly decisionApproved: boolean;
  readonly requiredDocumentsPresent: boolean;
  readonly openDeadlines: number;
  readonly subjectInformed: boolean;
  readonly remedyRecorded: boolean;
  readonly settlementResolved: boolean;
  readonly activeLegalHold: boolean;
  readonly openCriticalEscalations: number;
  readonly unresolvedMandatoryIssues: number;
  readonly regulatoryActionComplete: boolean;
}

export interface ClosureEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

/** Evaluate closure eligibility. Every unmet required criterion yields a reason code; eligible iff none. */
export function evaluateClosure(criteria: ClosureCriteria, state: ClosureState): ClosureEligibility {
  const reasons: string[] = [];
  if (criteria.requireWorkflowComplete === true && !state.workflowComplete)
    reasons.push('WORKFLOW_INCOMPLETE');
  if (criteria.requireMandatoryTasksComplete === true && state.openMandatoryTasks > 0)
    reasons.push('OPEN_MANDATORY_TASK');
  if (criteria.requireFindingsRecorded === true && !state.findingsRecorded) reasons.push('FINDINGS_MISSING');
  if (criteria.requireDecisionApproved === true && !state.decisionApproved)
    reasons.push('DECISION_NOT_APPROVED');
  if (criteria.requireRequiredDocuments === true && !state.requiredDocumentsPresent)
    reasons.push('REQUIRED_DOCUMENTS_MISSING');
  if (criteria.requireDeadlinesDispositioned === true && state.openDeadlines > 0)
    reasons.push('OPEN_DEADLINE');
  if (criteria.requireSubjectInformed === true && !state.subjectInformed)
    reasons.push('SUBJECT_NOT_INFORMED');
  if (criteria.requireRemedyRecorded === true && !state.remedyRecorded) reasons.push('REMEDY_MISSING');
  if (criteria.requireSettlementResolved === true && !state.settlementResolved)
    reasons.push('SETTLEMENT_UNRESOLVED');
  // Hard guards — always fail closed regardless of the criteria flag intent, when requested.
  if (criteria.requireNoActiveLegalHold === true && state.activeLegalHold) reasons.push('ACTIVE_LEGAL_HOLD');
  if (criteria.requireNoOpenCriticalEscalation === true && state.openCriticalEscalations > 0)
    reasons.push('OPEN_CRITICAL_ESCALATION');
  if (criteria.requireNoUnresolvedMandatoryIssue === true && state.unresolvedMandatoryIssues > 0)
    reasons.push('UNRESOLVED_MANDATORY_ISSUE');
  if (criteria.requireRegulatoryActionComplete === true && !state.regulatoryActionComplete)
    reasons.push('REGULATORY_ACTION_INCOMPLETE');
  return { eligible: reasons.length === 0, reasonCodes: reasons };
}

// --- case relationships ------------------------------------------------------------------------
export const RELATIONSHIP_KINDS = [
  'duplicate_of',
  'related_to',
  'parent_of',
  'child_of',
  'appeal_of',
  'enforcement_of',
  'investigation_of',
  'complaint_from',
  'consolidated_with',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export function isRelationshipKind(v: unknown): v is RelationshipKind {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}

/**
 * A directed relationship whose reverse would create a trivial cycle. `parent_of`/`child_of` and
 * `duplicate_of` must not point a case at itself, and a symmetric duplicate/parent edge in the opposite
 * direction is rejected by the caller against existing edges. This pure helper rejects the self-edge.
 */
export function isSelfRelation(fromId: string, toId: string): boolean {
  return fromId === toId;
}
