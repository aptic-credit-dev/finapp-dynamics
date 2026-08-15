/**
 * @finapp/m41-security — Enterprise Security / Privacy / Compliance / GRC (Stage 6H, mvp:false). Exposes the security. / grc. /
 * privacy. permissions, the SEC_/GRC_/PRIV_ audit codes, the pure domain gates (posture-over-RBAC, maker-checker/SoD, secret
 * lifecycle, approved-algorithm allowlist, fail-closed DLP), the fail-closed SecretProviderPort, the repository, the emitter,
 * and the services. It declares /api/v1/security + /grc + /privacy, owns the seven security.* event families, and publishes
 * through the ONE m06 outbox — it owns no outbox, no second RBAC/audit/feature/AI engine, no secrets manager (framework-only),
 * and no arbitrary-execution engine. The real secret/key resolver backs m30's SecretResolver; the DLP evaluator backs m24's
 * DlpPolicyEvaluator; the real crypto/secret provider is deferred behind the fail-closed SecretProviderPort. Zero secret value.
 */
export {
  M41_PERMISSIONS,
  ALL_M41_PERMISSIONS,
  M41_PLATFORM_PERMISSIONS,
  M41_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M41Permission } from './permissions.ts';
export {
  M41_AUDIT_CODES,
  ALL_M41_AUDIT_CODES,
  SEC_AUDIT_PREFIX,
  GRC_AUDIT_PREFIX,
  PRIV_AUDIT_PREFIX,
} from './audit-codes.ts';
export type { M41AuditCode } from './audit-codes.ts';

export {
  M41_LIMITS,
  SECRET_STATES,
  TERMINAL_SECRET_STATES,
  MATERIAL_KINDS,
  DLP_ACTIONS,
  CLASSIFICATIONS,
  GRC_FRAMEWORKS,
  SCOPES,
  APPROVED_ALGORITHMS,
  isPlatformScope,
  isApprovedAlgorithm,
  REASON_CODES,
  ALL_REASON_CODES,
  evaluateSecurityPosture,
  isHumanActor,
  evaluateSodGate,
  isSecretTransitionAllowed,
  isSecretTerminal,
  evaluateDlp,
  isThreeSegmentPermission,
  isSecretReference,
  SECRET_REFERENCE_PATTERN,
  validateSecret,
  clampPage,
} from './domain.ts';
export type {
  SecretState,
  MaterialKind,
  DlpAction,
  Classification,
  GrcFramework,
  Scope,
  ReasonCodeKey,
  GateResult,
  SecurityPostureInput,
  SecretDraft,
  ValidationResult,
} from './domain.ts';

export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M41Emitter } from './emit.ts';

export { UnavailableSecretProvider, FixtureSecretProvider } from './ports.ts';
export type { SecretProviderPort, ProviderOutcome, ProviderMetadata } from './ports.ts';

export { SecurityRepository } from './repository.ts';
export type {
  SecretRow,
  SecretVersionRow,
  DlpPolicyRow,
  GrcControlRow,
  PrivacyClassificationRow,
} from './repository.ts';

export { SecretService } from './secret.service.ts';
export type { SecretMetadata } from './secret.service.ts';
export { DlpService } from './dlp.service.ts';
export type { DlpDecision } from './dlp.service.ts';
export { GovernanceService } from './governance.service.ts';
