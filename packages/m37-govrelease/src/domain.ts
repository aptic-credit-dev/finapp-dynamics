/**
 * M37 PURE domain — vocabulary, guards, the maker-checker/SoD + approval gates, the QA-GATE evaluation, and the SECRET-SEAM
 * re-export. No I/O. THE QA RULE: a release cannot be approved unless every REQUIRED gate has PASSED (or been waived) — the
 * evidence gate. THE APPROVAL RULE: promoting a release to released is decided by a HUMAN who is NOT the requester (AI/
 * system/automation never approve or release). THE SECRET RULE: a release signature/attestation is an opaque `secretref:`
 * pointer (the m30 seam) — never a value. m37 references an artifact by an OPAQUE (kind, ref) and reads no other module's
 * table; it records the governed DECISION and executes no release.
 */
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class GovreleaseError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'GovreleaseError';
    this.reasonCode = reasonCode;
  }
}

export const M37_LIMITS = {
  maxFindings: 100,
  maxPageSize: 200,
  defaultPageSize: 50,
} as const;

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
export function isPlatformScope(s: string): boolean {
  return s === 'platform';
}

/** The kind of integration artifact m37 governs — each is an OPAQUE reference to the owning module's record. */
export const ARTIFACT_KINDS = [
  'connector',
  'marketplace',
  'devportal',
  'webhook',
  'eventstream',
  'internal',
] as const;
export function isArtifactKind(s: string): boolean {
  return (ARTIFACT_KINDS as readonly string[]).includes(s);
}

export const ARTIFACT_STATUSES = ['active', 'retired'] as const;
export function isArtifactStatus(s: string): boolean {
  return (ARTIFACT_STATUSES as readonly string[]).includes(s);
}

export const ENVIRONMENT_STATUSES = ['active', 'retired'] as const;
export function isEnvironmentStatus(s: string): boolean {
  return (ENVIRONMENT_STATUSES as readonly string[]).includes(s);
}

export const RELEASE_STATES = [
  'draft',
  'qa_pending',
  'qa_passed',
  'review_pending',
  'released',
  'rejected',
  'rolled_back',
] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];
export function isReleaseState(s: string): s is ReleaseState {
  return (RELEASE_STATES as readonly string[]).includes(s);
}
export function isReleaseFrozen(s: string): boolean {
  return s === 'rejected';
}

export const GATE_STATUSES = ['pending', 'passed', 'failed', 'waived'] as const;
export function isGateStatus(s: string): boolean {
  return (GATE_STATUSES as readonly string[]).includes(s);
}

export const CHECK_STATUSES = ['passed', 'failed'] as const;
export function isCheckStatus(s: string): boolean {
  return (CHECK_STATUSES as readonly string[]).includes(s);
}

export const REASON_CODES = {
  artifactRegistered: 'artifact_registered',
  artifactRetired: 'artifact_retired',
  environmentDefined: 'environment_defined',
  releaseRequested: 'release_requested',
  gateAdded: 'gate_added',
  checkRecorded: 'check_recorded',
  qaPassed: 'qa_passed',
  qaFailed: 'qa_failed',
  reviewRequested: 'review_requested',
  releaseApproved: 'release_approved',
  releaseRejected: 'release_rejected',
  releaseRolledBack: 'release_rolled_back',
  evidenceAdded: 'evidence_added',
  qaNotPassed: 'qa_not_passed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  invalidSecretReference: 'invalid_secret_reference',
  artifactUnavailable: 'artifact_unavailable',
  artifactNotActive: 'artifact_not_active',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker (controlled release approval) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.releaseApproved };
}

export interface ApprovalGateInput {
  readonly qaPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
}
/** Promoting a release to released needs the QA evidence gate PASSED and an independent human approver. */
export function evaluateApprovalGate(input: ApprovalGateInput): GateResult {
  if (!input.qaPassed) return { allowed: false, reasonCode: REASON_CODES.qaNotPassed };
  return evaluateSodGate(input.requestedBy, input.approver);
}

export interface GateState {
  readonly required: boolean;
  readonly status: string;
}
/** The QA evidence gate: every REQUIRED gate must be `passed` or `waived`. At least one required gate must exist. */
export function evaluateQaGate(gates: readonly GateState[]): GateResult {
  const required = gates.filter((g) => g.required);
  if (required.length === 0) return { allowed: false, reasonCode: REASON_CODES.qaNotPassed };
  const allSatisfied = required.every((g) => g.status === 'passed' || g.status === 'waived');
  return allSatisfied
    ? { allowed: true, reasonCode: REASON_CODES.qaPassed }
    : { allowed: false, reasonCode: REASON_CODES.qaNotPassed };
}

// ---- validation (fail closed) ----

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}
export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

/** A release is structurally valid if its key/artifact/environment are present and versions are sane. The artifact's
 * releasability is checked against the owning module through the fail-closed port at request time (not here). Fail closed. */
export function validateRelease(input: {
  releaseKey: string;
  artifactRef: string;
  environmentRef: string;
  toVersion: number;
}): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (input.releaseKey.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'release_key' });
  if (input.artifactRef.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'artifact' });
  if (input.environmentRef.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'environment' });
  if (!Number.isInteger(input.toVersion) || input.toVersion < 1)
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'to_version' });
  return { passed: findings.length === 0, findings };
}

/** A release signature/attestation must be an opaque `secretref:` pointer (the m30 seam) — never a value. */
export function validateSignatureRef(ref: string | null): ValidationFinding[] {
  if (ref === null || ref === '') return [];
  return isSecretReference(ref) ? [] : [{ code: REASON_CODES.invalidSecretReference, ref: 'signature_ref' }];
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M37_LIMITS.defaultPageSize : Math.min(limit, M37_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
