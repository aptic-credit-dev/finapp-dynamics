/**
 * M42 certification DOMAIN — pure, DB-free governance logic. THE LOAD-BEARING CONTROL is `evaluateCertificationDecision`: a
 * DENY-BY-DEFAULT GO/CONDITIONAL_GO/NO_GO engine (ADR-012) that DERIVES the verdict from governed evidence — a caller can never
 * set GO. Plus maker-checker/SoD (`evaluateSodGate` + `isHumanActor`: null/blank/system/ai/automation are not human), the
 * Stage-6 assessment matrix (the 12 modules M30-M41 x 8 aspects), and lifecycle vocabularies. No secret/PII/raw evidence here —
 * assessments/findings/evidence carry OPAQUE references only.
 */

/** The 12 Stage-6 domains under certification = the modules M30-M41 (repository truth: the Phase-6 platform build). */
export const CERT_DOMAINS = [
  'm30',
  'm31',
  'm32',
  'm33',
  'm34',
  'm35',
  'm36',
  'm37',
  'm38',
  'm39',
  'm40',
  'm41',
] as const;
export type CertDomain = (typeof CERT_DOMAINS)[number];

/**
 * The 8 assessment ASPECTS. The Phase-6 spec cites "12 domains x 8 aspects"; these eight are the dimensions the M30-M41
 * certification reports actually verify (architecture, security, tenancy/RLS, SoD/maker-checker, events/outbox, shared-service
 * boundaries, tests/CI, data/migration) — see ADR-129. Each cell references EVIDENCE; it never copies operational data.
 */
export const CERT_ASPECTS = [
  'architecture',
  'security',
  'tenancy_rls',
  'sod_maker_checker',
  'events_outbox',
  'shared_service_boundaries',
  'tests_ci',
  'data_migration',
] as const;
export type CertAspect = (typeof CERT_ASPECTS)[number];

export const CERT_DECISIONS = ['go', 'conditional_go', 'no_go'] as const;
export type CertDecision = (typeof CERT_DECISIONS)[number];

export const PROGRAMME_STATES = ['draft', 'assessing', 'in_review', 'decided', 'closed'] as const;
export const ASSESSMENT_STATUSES = ['not_assessed', 'pass', 'fail', 'waived'] as const;
export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const FINDING_STATUSES = ['open', 'resolved', 'waived'] as const;
export const WAIVER_STATES = ['requested', 'approved', 'rejected', 'expired'] as const;
export const READINESS_KINDS = ['migration', 'uat', 'pilot', 'release'] as const;
export const READINESS_RESULTS = ['pending', 'pass', 'fail'] as const;

/** The mandatory role sign-offs a Stage-6 GO requires (ADR-012: a GO needs all role sign-offs; no self-sign of own domain). */
export const REQUIRED_SIGNOFF_ROLES = ['engineering', 'security', 'operations', 'product'] as const;

export const REASON_CODES = {
  notHumanActor: 'not_human_actor',
  selfApproval: 'self_approval_forbidden',
  selfSignOwnDomain: 'self_signoff_own_domain_forbidden',
  assessmentIncomplete: 'assessment_incomplete',
  assessmentFailed: 'assessment_failed',
  criticalFindingOpen: 'critical_finding_open',
  readinessIncomplete: 'readiness_incomplete',
  signoffMissing: 'signoff_missing',
  signoffRejected: 'signoff_rejected',
  waiverExpired: 'waiver_expired',
  absoluteNotWaivable: 'absolute_control_not_waivable',
  go: 'certification_go',
  conditionalGo: 'certification_conditional_go',
  noGo: 'certification_no_go',
  invalidTransition: 'invalid_transition',
} as const;

const NON_HUMAN = new Set(['', 'system', 'ai', 'automation']);
/** A human actor is a concrete non-system identity. null/blank/system/ai/automation are NOT human (they can never approve/certify). */
export function isHumanActor(actor: string | null | undefined): boolean {
  return typeof actor === 'string' && actor.trim() !== '' && !NON_HUMAN.has(actor.trim().toLowerCase());
}

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

/** Maker-checker/SoD: an approver/certifier must be a HUMAN who is not the requester. */
export function evaluateSodGate(requestedBy: string, actor: string | null | undefined): GateResult {
  if (!isHumanActor(actor)) return { allowed: false, reasonCode: REASON_CODES.notHumanActor };
  if (actor === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.go };
}

export function isPlatformScope(scope: string): boolean {
  return scope === 'platform';
}

// ---- The GO/CONDITIONAL_GO/NO_GO decision engine (deny-by-default; ADR-012) --------------------------

export interface AssessmentInput {
  readonly domainKey: string;
  readonly aspectKey: string;
  readonly status: string; // not_assessed | pass | fail | waived
}
export interface FindingInput {
  readonly severity: string;
  readonly status: string; // open | resolved | waived
  readonly waiverActive?: boolean; // a 'waived' finding only counts if its waiver is approved AND not expired
}
export interface ReadinessInput {
  readonly kind: string;
  readonly result: string; // pending | pass | fail
}
export interface SignoffInput {
  readonly roleKey: string;
  readonly disposition: string; // approve | reject
}
export interface CertificationState {
  readonly requiredDomains: readonly string[];
  readonly requiredAspects: readonly string[];
  readonly requiredReadinessKinds: readonly string[];
  readonly requiredSignoffRoles: readonly string[];
  readonly assessments: readonly AssessmentInput[];
  readonly findings: readonly FindingInput[];
  readonly readiness: readonly ReadinessInput[];
  readonly signoffs: readonly SignoffInput[];
  readonly residualConditions: number; // count of bounded, approved residual conditions (Stage-7 hardening etc.)
}
export interface CertificationVerdict {
  readonly decision: CertDecision;
  readonly blockers: readonly string[];
  readonly reasonCode: string;
}

/**
 * DERIVE the certification verdict from governed evidence. DENY-BY-DEFAULT: the verdict starts at NO_GO and only escalates when
 * every mandatory control is satisfied. A missing/failed assessment, a critical OPEN finding (a 'waived' critical whose waiver is
 * inactive counts as open), a missing/failed mandatory readiness, or a missing/rejected mandatory sign-off each BLOCKS a GO. When
 * all mandatory controls pass: bounded approved residual conditions -> CONDITIONAL_GO; otherwise -> GO. Callers cannot set GO.
 */
export function evaluateCertificationDecision(state: CertificationState): CertificationVerdict {
  const blockers: string[] = [];

  // 1) every required domain x aspect cell must be pass or waived.
  for (const d of state.requiredDomains) {
    for (const a of state.requiredAspects) {
      const cell = state.assessments.find((x) => x.domainKey === d && x.aspectKey === a);
      if (!cell || cell.status === 'not_assessed') {
        blockers.push(`${REASON_CODES.assessmentIncomplete}:${d}.${a}`);
      } else if (cell.status === 'fail') {
        blockers.push(`${REASON_CODES.assessmentFailed}:${d}.${a}`);
      }
    }
  }

  // 2) no CRITICAL finding may be effectively open (a 'waived' critical whose waiver is inactive counts as open).
  for (const f of state.findings) {
    const effectivelyOpen = f.status === 'open' || (f.status === 'waived' && f.waiverActive !== true);
    if (f.severity === 'critical' && effectivelyOpen) blockers.push(REASON_CODES.criticalFindingOpen);
  }

  // 3) every mandatory readiness kind must be present and pass.
  for (const k of state.requiredReadinessKinds) {
    const r = state.readiness.find((x) => x.kind === k);
    if (r?.result !== 'pass') blockers.push(`${REASON_CODES.readinessIncomplete}:${k}`);
  }

  // 4) every mandatory sign-off role must be present and approving; any rejection blocks.
  if (state.signoffs.some((s) => s.disposition === 'reject')) blockers.push(REASON_CODES.signoffRejected);
  for (const role of state.requiredSignoffRoles) {
    if (!state.signoffs.some((s) => s.roleKey === role && s.disposition === 'approve')) {
      blockers.push(`${REASON_CODES.signoffMissing}:${role}`);
    }
  }

  if (blockers.length > 0) return { decision: 'no_go', blockers, reasonCode: REASON_CODES.noGo };
  if (state.residualConditions > 0)
    return { decision: 'conditional_go', blockers: [], reasonCode: REASON_CODES.conditionalGo };
  return { decision: 'go', blockers: [], reasonCode: REASON_CODES.go };
}

/** A waiver is EFFECTIVE only when approved AND not expired (validTo in the future). An expired waiver stops satisfying the gate. */
export function isWaiverActive(state: string, validTo: Date | null | undefined, now: Date): boolean {
  if (state !== 'approved') return false;
  if (!validTo) return false;
  return validTo.getTime() > now.getTime();
}

export function isProgrammeState(s: string): boolean {
  return (PROGRAMME_STATES as readonly string[]).includes(s);
}

export function clampPage(page?: number, size?: number): { limit: number; offset: number } {
  const p = typeof page === 'number' && Number.isInteger(page) && page > 0 ? page : 1;
  const s = typeof size === 'number' && Number.isInteger(size) && size > 0 && size <= 200 ? size : 50;
  return { limit: s, offset: (p - 1) * s };
}
