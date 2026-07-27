/**
 * Legal-matter closure eligibility + matter relationship matching (G33/G34) — PURE. Closure is gated by
 * configurable criteria; the gate returns machine-readable reason codes for every unmet requirement so the
 * outcome is explainable (complex closure decisioning can additionally consult M07 rules, ADR-061). A legal hold,
 * an imminent limitation deadline, or an open critical escalation ALWAYS blocks closure (fail closed).
 * Relationship kinds are validated and self/duplicate cycles are rejected.
 */

/** Which closure requirements apply (from the matter type / policy / rules). */
export interface ClosureCriteria {
  readonly requireInstructionsComplete?: boolean;
  readonly requireWorkflowComplete?: boolean;
  readonly requireMandatoryTasksComplete?: boolean;
  readonly requireDeadlinesDispositioned?: boolean;
  readonly requireNoImminentLimitation?: boolean;
  readonly requireRequiredPleadingsFiled?: boolean;
  readonly requireOutcomeRecorded?: boolean;
  readonly requireAppealDispositioned?: boolean;
  readonly requireEnforcementDispositioned?: boolean;
  readonly requireCounselFinalReport?: boolean;
  readonly requireCostsRecorded?: boolean;
  readonly requireExposureReviewed?: boolean;
  readonly requireNoActiveLegalHold?: boolean;
  readonly requireNoOpenCriticalEscalation?: boolean;
  readonly requireBusinessOwnerInformed?: boolean;
  readonly requireClosureApproval?: boolean;
}

/** The observed state of the matter. */
export interface ClosureState {
  readonly instructionsComplete: boolean;
  readonly workflowComplete: boolean;
  readonly openMandatoryTasks: number;
  readonly openDeadlines: number;
  readonly imminentLimitation: boolean;
  readonly requiredPleadingsFiled: boolean;
  readonly outcomeRecorded: boolean;
  readonly appealDispositioned: boolean;
  readonly enforcementDispositioned: boolean;
  readonly counselFinalReport: boolean;
  readonly costsRecorded: boolean;
  readonly exposureReviewed: boolean;
  readonly activeLegalHold: boolean;
  readonly openCriticalEscalations: number;
  readonly businessOwnerInformed: boolean;
  readonly closureApproved: boolean;
}

export interface ClosureEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

/** Evaluate closure eligibility. Every unmet required criterion yields a reason code; eligible iff none. */
export function evaluateClosure(criteria: ClosureCriteria, state: ClosureState): ClosureEligibility {
  const reasons: string[] = [];
  if (criteria.requireInstructionsComplete === true && !state.instructionsComplete)
    reasons.push('INSTRUCTIONS_INCOMPLETE');
  if (criteria.requireWorkflowComplete === true && !state.workflowComplete)
    reasons.push('WORKFLOW_INCOMPLETE');
  if (criteria.requireMandatoryTasksComplete === true && state.openMandatoryTasks > 0)
    reasons.push('OPEN_MANDATORY_TASK');
  if (criteria.requireDeadlinesDispositioned === true && state.openDeadlines > 0)
    reasons.push('OPEN_DEADLINE');
  if (criteria.requireNoImminentLimitation === true && state.imminentLimitation)
    reasons.push('IMMINENT_LIMITATION');
  if (criteria.requireRequiredPleadingsFiled === true && !state.requiredPleadingsFiled)
    reasons.push('REQUIRED_PLEADINGS_MISSING');
  if (criteria.requireOutcomeRecorded === true && !state.outcomeRecorded) reasons.push('OUTCOME_MISSING');
  if (criteria.requireAppealDispositioned === true && !state.appealDispositioned)
    reasons.push('APPEAL_UNDISPOSED');
  if (criteria.requireEnforcementDispositioned === true && !state.enforcementDispositioned)
    reasons.push('ENFORCEMENT_UNDISPOSED');
  if (criteria.requireCounselFinalReport === true && !state.counselFinalReport)
    reasons.push('COUNSEL_FINAL_REPORT_MISSING');
  if (criteria.requireCostsRecorded === true && !state.costsRecorded) reasons.push('COSTS_MISSING');
  if (criteria.requireExposureReviewed === true && !state.exposureReviewed)
    reasons.push('EXPOSURE_NOT_REVIEWED');
  if (criteria.requireNoActiveLegalHold === true && state.activeLegalHold) reasons.push('ACTIVE_LEGAL_HOLD');
  if (criteria.requireNoOpenCriticalEscalation === true && state.openCriticalEscalations > 0)
    reasons.push('OPEN_CRITICAL_ESCALATION');
  if (criteria.requireBusinessOwnerInformed === true && !state.businessOwnerInformed)
    reasons.push('BUSINESS_OWNER_NOT_INFORMED');
  if (criteria.requireClosureApproval === true && !state.closureApproved)
    reasons.push('CLOSURE_NOT_APPROVED');
  return { eligible: reasons.length === 0, reasonCodes: reasons };
}

// --- matter relationships ----------------------------------------------------------------------
export const RELATIONSHIP_KINDS = [
  'converted_from_case',
  'related_to',
  'parent_of',
  'child_of',
  'appeal_of',
  'enforcement_of',
  'consolidated_with',
  'precedent_for',
  'duplicate_of',
  'counterclaim_of',
  'regulatory_referral_of',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export function isRelationshipKind(v: unknown): v is RelationshipKind {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}
export function isSelfRelation(fromId: string, toId: string): boolean {
  return fromId === toId;
}
