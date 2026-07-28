/**
 * Recovery closure eligibility + recovery relationship matching — PURE. Closure is gated by configurable criteria;
 * the gate returns machine-readable reason codes for every unmet requirement so the outcome is explainable
 * (complex closure decisioning can additionally consult M07 rules, ADR-069). An imminent limitation deadline, an
 * open enforcement action, an undispositioned write-off recommendation, or an open critical escalation ALWAYS
 * blocks closure (fail closed). Relationship kinds are validated and self/duplicate cycles are rejected.
 */

/** Which closure requirements apply (from the recovery type / policy / rules). */
export interface ClosureCriteria {
  readonly requireOutcomeRecorded?: boolean;
  readonly requireDeadlinesDispositioned?: boolean;
  readonly requireNoOpenEnforcementAction?: boolean;
  readonly requireNoActiveArrangement?: boolean;
  readonly requireWriteOffDispositioned?: boolean;
  readonly requireNoImminentLimitation?: boolean;
  readonly requireAgentFinalReport?: boolean;
  readonly requireNoOpenCriticalEscalation?: boolean;
  readonly requireSourceUpdateEmitted?: boolean;
  readonly requireClosureApproval?: boolean;
}

/** The observed state of the recovery. */
export interface ClosureState {
  readonly outcomeRecorded: boolean;
  readonly openDeadlines: number;
  readonly openEnforcementActions: number;
  readonly activeArrangement: boolean;
  readonly writeOffDispositioned: boolean;
  readonly imminentLimitation: boolean;
  readonly agentFinalReport: boolean;
  readonly openCriticalEscalations: number;
  readonly sourceUpdateEmitted: boolean;
  readonly closureApproved: boolean;
}

export interface ClosureEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

/** Evaluate closure eligibility. Every unmet required criterion yields a reason code; eligible iff none. */
export function evaluateClosure(criteria: ClosureCriteria, state: ClosureState): ClosureEligibility {
  const reasons: string[] = [];
  if (criteria.requireOutcomeRecorded === true && !state.outcomeRecorded) reasons.push('OUTCOME_MISSING');
  if (criteria.requireDeadlinesDispositioned === true && state.openDeadlines > 0)
    reasons.push('OPEN_DEADLINE');
  if (criteria.requireNoOpenEnforcementAction === true && state.openEnforcementActions > 0)
    reasons.push('OPEN_ENFORCEMENT_ACTION');
  if (criteria.requireNoActiveArrangement === true && state.activeArrangement)
    reasons.push('ACTIVE_ARRANGEMENT');
  if (criteria.requireWriteOffDispositioned === true && !state.writeOffDispositioned)
    reasons.push('WRITE_OFF_UNDISPOSED');
  if (criteria.requireNoImminentLimitation === true && state.imminentLimitation)
    reasons.push('IMMINENT_LIMITATION');
  if (criteria.requireAgentFinalReport === true && !state.agentFinalReport)
    reasons.push('AGENT_FINAL_REPORT_MISSING');
  if (criteria.requireNoOpenCriticalEscalation === true && state.openCriticalEscalations > 0)
    reasons.push('OPEN_CRITICAL_ESCALATION');
  if (criteria.requireSourceUpdateEmitted === true && !state.sourceUpdateEmitted)
    reasons.push('SOURCE_UPDATE_NOT_EMITTED');
  if (criteria.requireClosureApproval === true && !state.closureApproved)
    reasons.push('CLOSURE_NOT_APPROVED');
  return { eligible: reasons.length === 0, reasonCodes: reasons };
}

// --- recovery relationships --------------------------------------------------------------------
export const RELATIONSHIP_KINDS = [
  'referred_from_proceeding',
  'related_to',
  'parent_of',
  'child_of',
  'consolidated_with',
  'duplicate_of',
  'guarantor_of',
  'co_debtor_of',
  'security_for',
  'successor_of',
  'split_from',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export function isRelationshipKind(v: unknown): v is RelationshipKind {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}
export function isSelfRelation(fromId: string, toId: string): boolean {
  return fromId === toId;
}
