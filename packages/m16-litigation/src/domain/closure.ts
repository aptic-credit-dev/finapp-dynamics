/**
 * Proceeding closure eligibility + proceeding relationship matching — PURE. Closure is gated by configurable
 * criteria; the gate returns machine-readable reason codes for every unmet requirement so the outcome is
 * explainable (complex closure decisioning can additionally consult M07 rules, ADR-065). A legal hold, an
 * imminent limitation deadline, an active stay/procedural blocker, or an open critical escalation ALWAYS blocks
 * closure (fail closed). Relationship kinds are validated and self/duplicate cycles are rejected.
 */

/** Which closure requirements apply (from the proceeding type / policy / rules). */
export interface ClosureCriteria {
  readonly requireFilingsDispositioned?: boolean;
  readonly requireServiceCompleted?: boolean;
  readonly requireAppearancesConcluded?: boolean;
  readonly requireHearingsConcluded?: boolean;
  readonly requireOutcomeRecorded?: boolean;
  readonly requireAppealDispositioned?: boolean;
  readonly requireComplianceDispositioned?: boolean;
  readonly requireCounselFinalReport?: boolean;
  readonly requireRequiredDocuments?: boolean;
  readonly requireDeadlinesDispositioned?: boolean;
  readonly requireNoImminentLimitation?: boolean;
  readonly requireNoActiveStay?: boolean;
  readonly requireNoOpenCriticalEscalation?: boolean;
  readonly requireMatterUpdateEmitted?: boolean;
  readonly requireClosureApproval?: boolean;
}

/** The observed state of the proceeding. */
export interface ClosureState {
  readonly openFilings: number;
  readonly serviceCompleted: boolean;
  readonly openAppearances: number;
  readonly openHearings: number;
  readonly outcomeRecorded: boolean;
  readonly appealDispositioned: boolean;
  readonly openComplianceObligations: number;
  readonly counselFinalReport: boolean;
  readonly requiredDocumentsPresent: boolean;
  readonly openDeadlines: number;
  readonly imminentLimitation: boolean;
  readonly activeStay: boolean;
  readonly openCriticalEscalations: number;
  readonly matterUpdateEmitted: boolean;
  readonly closureApproved: boolean;
}

export interface ClosureEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

/** Evaluate closure eligibility. Every unmet required criterion yields a reason code; eligible iff none. */
export function evaluateClosure(criteria: ClosureCriteria, state: ClosureState): ClosureEligibility {
  const reasons: string[] = [];
  if (criteria.requireFilingsDispositioned === true && state.openFilings > 0) reasons.push('OPEN_FILING');
  if (criteria.requireServiceCompleted === true && !state.serviceCompleted)
    reasons.push('SERVICE_INCOMPLETE');
  if (criteria.requireAppearancesConcluded === true && state.openAppearances > 0)
    reasons.push('OPEN_APPEARANCE');
  if (criteria.requireHearingsConcluded === true && state.openHearings > 0) reasons.push('OPEN_HEARING');
  if (criteria.requireOutcomeRecorded === true && !state.outcomeRecorded) reasons.push('OUTCOME_MISSING');
  if (criteria.requireAppealDispositioned === true && !state.appealDispositioned)
    reasons.push('APPEAL_UNDISPOSED');
  if (criteria.requireComplianceDispositioned === true && state.openComplianceObligations > 0)
    reasons.push('OPEN_COMPLIANCE_OBLIGATION');
  if (criteria.requireCounselFinalReport === true && !state.counselFinalReport)
    reasons.push('COUNSEL_FINAL_REPORT_MISSING');
  if (criteria.requireRequiredDocuments === true && !state.requiredDocumentsPresent)
    reasons.push('REQUIRED_DOCUMENTS_MISSING');
  if (criteria.requireDeadlinesDispositioned === true && state.openDeadlines > 0)
    reasons.push('OPEN_DEADLINE');
  if (criteria.requireNoImminentLimitation === true && state.imminentLimitation)
    reasons.push('IMMINENT_LIMITATION');
  if (criteria.requireNoActiveStay === true && state.activeStay) reasons.push('ACTIVE_STAY');
  if (criteria.requireNoOpenCriticalEscalation === true && state.openCriticalEscalations > 0)
    reasons.push('OPEN_CRITICAL_ESCALATION');
  if (criteria.requireMatterUpdateEmitted === true && !state.matterUpdateEmitted)
    reasons.push('MATTER_UPDATE_NOT_EMITTED');
  if (criteria.requireClosureApproval === true && !state.closureApproved)
    reasons.push('CLOSURE_NOT_APPROVED');
  return { eligible: reasons.length === 0, reasonCodes: reasons };
}

// --- proceeding relationships ------------------------------------------------------------------
export const RELATIONSHIP_KINDS = [
  'referred_from_matter',
  'related_to',
  'parent_of',
  'child_of',
  'appeal_of',
  'review_of',
  'consolidated_with',
  'precedent_for',
  'duplicate_of',
  'counterclaim_in',
  'enforcement_referral_of',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export function isRelationshipKind(v: unknown): v is RelationshipKind {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}
export function isSelfRelation(fromId: string, toId: string): boolean {
  return fromId === toId;
}
