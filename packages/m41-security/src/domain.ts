/**
 * M41 domain — the PURE, side-effect-free security rules (no DB, no clock, no crypto). These are the load-bearing controls
 * proven in the smoke suite and enforced by the services:
 *
 *  - POSTURE OVER RBAC (`evaluateSecurityPosture`, ADR-009): effective access = m02 RBAC AND m41 SECURITY policy AND the owning
 *    module's controls — security posture AUGMENTS RBAC; it NEVER replaces or grants it. Any deny denies.
 *  - MAKER-CHECKER / SoD (`evaluateSodGate` + `isHumanActor`): a secret rotate/revoke/destroy/reveal is decided by a HUMAN who is
 *    not the requester; `system`/`ai`/`automation`/null are never approvers.
 *  - SECRET/KEY LIFECYCLE (`isSecretTransitionAllowed`): only governed transitions; terminal states protected.
 *  - NO HOME-GROWN CRYPTO (`isApprovedAlgorithm`): only approved algorithm identifiers; the real provider is deferred.
 *  - No secret VALUE is ever handled here — only opaque `secretref:` pointers + metadata.
 */

export const M41_LIMITS = { maxPageSize: 200 } as const;

export const SECRET_STATES = [
  'draft',
  'pending_approval',
  'active',
  'rotating',
  'retired',
  'revoked',
  'destroyed',
] as const;
export type SecretState = (typeof SECRET_STATES)[number];
export const TERMINAL_SECRET_STATES: readonly SecretState[] = ['revoked', 'destroyed'];

export const MATERIAL_KINDS = ['secret', 'key'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const DLP_ACTIONS = ['allow', 'redact', 'block'] as const;
export type DlpAction = (typeof DLP_ACTIONS)[number];

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const GRC_FRAMEWORKS = ['iso27001', 'soc2', 'gdpr', 'kenya_dpa', 'other'] as const;
export type GrcFramework = (typeof GRC_FRAMEWORKS)[number];

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isPlatformScope(scope: string): boolean {
  return scope === 'platform';
}

/**
 * Approved cryptographic algorithm identifiers — NO home-grown crypto, NO tenant-chosen arbitrary algorithm. The actual crypto
 * is performed by a deferred provider (KMS/HSM/Vault) behind a fail-closed port; m41 stores only the approved identifier + an
 * opaque provider reference.
 */
export const APPROVED_ALGORITHMS = [
  'aes-256-gcm',
  'rsa-4096',
  'ecdsa-p256',
  'chacha20-poly1305',
  'ed25519',
] as const;
export type ApprovedAlgorithm = (typeof APPROVED_ALGORITHMS)[number];
export function isApprovedAlgorithm(algorithm: string | null | undefined): boolean {
  if (algorithm === null || algorithm === undefined) return true; // a secret (non-key) may carry no algorithm
  return (APPROVED_ALGORITHMS as readonly string[]).includes(algorithm);
}

export const REASON_CODES = {
  // posture stack
  rbacDenied: 'rbac_denied',
  securityDenied: 'security_policy_denied',
  ownerDenied: 'owning_module_denied',
  accessGranted: 'access_granted',
  // maker-checker
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval',
  approved: 'approved',
  // provider / resolver
  providerUnavailable: 'secret_provider_unavailable',
  secretUnavailable: 'secret_unavailable',
  secretResolvable: 'secret_reference_resolvable',
  // dlp
  dlpBlocked: 'dlp_blocked',
  dlpCleared: 'dlp_cleared',
  dlpUnavailable: 'dlp_unavailable',
  // lifecycle / structural
  invalidTransition: 'invalid_transition',
  invalidAlgorithm: 'invalid_algorithm',
  structuralInvalid: 'structural_invalid',
  terminal: 'terminal_immutable',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

// ---- POSTURE OVER RBAC (load-bearing, ADR-009) ----

export interface SecurityPostureInput {
  /** m02 RBAC decision — whether the actor holds the required permission (authoritative). */
  readonly rbacAllowed: boolean;
  /** m41 SECURITY policy decision — whether the security posture permits it (augments, never grants). */
  readonly securityAllowed: boolean;
  /** the owning module's own controls (optional; defaults to allow when not applicable). */
  readonly ownerAllowed?: boolean | undefined;
}

/**
 * The effective security gate. ALLOW iff RBAC allows AND the security policy allows AND the owning module's controls allow.
 * Security posture AUGMENTS m02 RBAC — a security "allow" can NEVER grant an action RBAC denies. Any deny denies; the denial
 * surfaces the most authoritative layer first (RBAC, then security, then owner).
 */
export function evaluateSecurityPosture(input: SecurityPostureInput): GateResult {
  if (!input.rbacAllowed) return { allowed: false, reasonCode: REASON_CODES.rbacDenied };
  if (!input.securityAllowed) return { allowed: false, reasonCode: REASON_CODES.securityDenied };
  if (input.ownerAllowed === false) return { allowed: false, reasonCode: REASON_CODES.ownerDenied };
  return { allowed: true, reasonCode: REASON_CODES.accessGranted };
}

// ---- maker-checker (controlled secret rotate/revoke/destroy/reveal) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.approved };
}

// ---- secret/key lifecycle ----

const SECRET_TRANSITIONS: Record<SecretState, readonly SecretState[]> = {
  draft: ['pending_approval', 'active', 'revoked'],
  pending_approval: ['active', 'revoked'],
  active: ['rotating', 'retired', 'revoked'],
  rotating: ['active', 'revoked'],
  retired: ['revoked', 'destroyed'],
  revoked: ['destroyed'],
  destroyed: [],
};
export function isSecretTransitionAllowed(from: SecretState, to: SecretState): boolean {
  return SECRET_TRANSITIONS[from].includes(to);
}
export function isSecretTerminal(state: SecretState): boolean {
  return TERMINAL_SECRET_STATES.includes(state);
}

// ---- DLP (fail closed) ----

/** The pure DLP decision for a classification + a "looks-secret" signal. Restricted+secret-looking => BLOCK; else the policy
 *  action (default allow). This is what m41's DlpPolicyEvaluator (backing m24's port) applies against governed policies. */
export function evaluateDlp(input: {
  classification: string;
  looksSecret: boolean;
  policyAction?: string | undefined;
}): {
  action: DlpAction;
  reasonCode: string;
} {
  if (input.classification === 'restricted' && input.looksSecret)
    return { action: 'block', reasonCode: REASON_CODES.dlpBlocked };
  const action = (input.policyAction as DlpAction | undefined) ?? 'allow';
  if (action === 'block') return { action: 'block', reasonCode: REASON_CODES.dlpBlocked };
  if (action === 'redact') return { action: 'redact', reasonCode: REASON_CODES.dlpCleared };
  return { action: 'allow', reasonCode: REASON_CODES.dlpCleared };
}

// ---- validation ----

export function isThreeSegmentPermission(p: string): boolean {
  return typeof p === 'string' && p.split('.').length === 3 && !p.split('.').includes('');
}

export const SECRET_REFERENCE_PATTERN = /^secretref:[A-Za-z0-9_.:/-]{3,200}$/;
export function isSecretReference(value: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(value);
}

export interface SecretDraft {
  readonly materialKind: string;
  readonly secretRef: string;
  readonly algorithm?: string | null;
}
export interface ValidationResult {
  readonly passed: boolean;
  readonly findings: readonly { code: string; ref: string }[];
}
/** A secret/key is well-formed iff its kind is known, its ref is a valid secretref, and any algorithm is APPROVED. */
export function validateSecret(draft: SecretDraft): ValidationResult {
  const findings: { code: string; ref: string }[] = [];
  if (!(MATERIAL_KINDS as readonly string[]).includes(draft.materialKind))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'material_kind' });
  if (!isSecretReference(draft.secretRef))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'secret_ref' });
  if (!isApprovedAlgorithm(draft.algorithm))
    findings.push({ code: REASON_CODES.invalidAlgorithm, ref: 'algorithm' });
  return { passed: findings.length === 0, findings };
}

export function clampPage(page?: number, size?: number): { limit: number; offset: number } {
  const s = Math.min(Math.max(1, Math.floor(size ?? 50)), M41_LIMITS.maxPageSize);
  const p = Math.max(1, Math.floor(page ?? 1));
  return { limit: s, offset: (p - 1) * s };
}
