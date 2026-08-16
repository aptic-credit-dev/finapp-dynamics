/**
 * @finapp/m42-certification — Enterprise Integration / Certification / Production Release (Stage 6I). The FINAL Stage-6 module
 * and the Stage-6 CLOSURE GATE: a governance runtime + evidence/closure layer that RECORDS certification programmes, domain x
 * aspect assessments (the 12 modules M30-M41 x 8 aspects), findings, waivers, readiness (migration/UAT/pilot/release), role
 * sign-offs, and issues a DENY-BY-DEFAULT GO/CONDITIONAL_GO/NO_GO decision (ADR-012) + an immutable Stage-6 closure artifact. It
 * ASSESSES M30-M41 by contract (opaque refs) and EXECUTES nothing. A GO is DERIVED from governed evidence, never caller-set.
 * Independence: requester != certifier; no self-sign of one's own assessed domain; AI/system/automation never self-certify.
 */
export {
  M42_PERMISSIONS,
  ALL_M42_PERMISSIONS,
  M42_PLATFORM_PERMISSIONS,
  M42_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
  isThreeSegmentPermission,
  type M42Permission,
} from './permissions.ts';
export { M42_AUDIT_CODES, ALL_M42_AUDIT_CODES, CERT_AUDIT_PREFIX, type M42AuditCode } from './audit-codes.ts';
export {
  CERT_DOMAINS,
  CERT_ASPECTS,
  CERT_DECISIONS,
  PROGRAMME_STATES,
  ASSESSMENT_STATUSES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  WAIVER_STATES,
  READINESS_KINDS,
  READINESS_RESULTS,
  REQUIRED_SIGNOFF_ROLES,
  REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  isPlatformScope,
  evaluateCertificationDecision,
  isWaiverActive,
  isProgrammeState,
  clampPage,
  type CertDomain,
  type CertAspect,
  type CertDecision,
  type GateResult,
  type AssessmentInput,
  type FindingInput,
  type ReadinessInput,
  type SignoffInput,
  type CertificationState,
  type CertificationVerdict,
} from './domain.ts';
export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export {
  CertificationRepository,
  type ProgrammeRow,
  type AssessmentRow,
  type FindingRow,
  type WaiverRow,
  type ReadinessRow,
  type DecisionRow,
  type ClosureRow,
} from './repository.ts';
export { M42Emitter } from './emit.ts';
export { ProgrammeService } from './programme.service.ts';
export { DecisionService, type DecisionResult } from './decision.service.ts';
