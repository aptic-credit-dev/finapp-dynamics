/**
 * @finapp/m31-studio — STUDIO (Stage 6B, mvp:false): the DESIGN-TIME authoring layer (author/validate/version/review/
 * publish/bind) for Workflow/BPM, Rules and reusable Forms. IT IS NOT A SECOND RUNTIME ENGINE. m06 stays the canonical
 * workflow engine, m07 the canonical rules engine; a validated+approved Studio design is COMPILED to their public
 * authoring contracts (DefinitionService/RuleSetService) and m31 stores ONLY the opaque binding — no workflow_definition/
 * rule_set table, no runtime execution, no engine. M31 is the canonical owner of reusable DECLARATIVE form definitions
 * (FORM DEFINITION != BUSINESS RECORD — no submitted data stored). HARD RULES: no arbitrary code (declarative metadata
 * only; conditions reuse the m06 sandbox + m07 structured conditions; prohibited expressions + raw secret values fail
 * closed); publishing is a CONTROLLED action with maker-checker/SoD (author != approver, human approver, validation
 * passed, valid binding) enforced in gates + services + DB CHECKs; a published version is IMMUTABLE (DB trigger); m33
 * integration is deferred behind a fail-closed capability-catalog port; secret-bearing design values are opaque
 * secretref: pointers (m30 seam) — zero secret VALUE columns. It declares the studio.lifecycle family (published through
 * the ONE m06 outbox), the studio.* permission namespace (GAP resolved, ADR-118) and the STUDIO_ audit prefix. NO REST
 * API (internal governed library). No float; no secret value; no second engine/outbox; no network.
 */

// Permissions + audit codes
export {
  M31_PERMISSIONS,
  ALL_M31_PERMISSIONS,
  M31_PLATFORM_PERMISSIONS,
  M31_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M31Permission } from './permissions.ts';
export { M31_AUDIT_CODES, ALL_M31_AUDIT_CODES, STUDIO_AUDIT_PREFIX } from './audit-codes.ts';
export type { M31AuditCode } from './audit-codes.ts';

// Domain
export {
  M31_LIMITS,
  StudioError,
  SCOPES,
  isScope,
  isPlatformScope,
  ARTIFACT_KINDS,
  isArtifactKind,
  VERSION_STATES,
  isVersionState,
  isVersionFrozen,
  TARGET_ENGINES,
  targetEngineForKind,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  validateArtifactSpec,
  validateFormSchema,
  scanSpecForProhibited,
  isFormFieldType,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  ArtifactKind,
  VersionState,
  TargetEngine,
  ReasonCodeKey,
  GateResult,
  PublishGateInput,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, versionConflict } from './errors.ts';
export { M31Emitter } from './emit.ts';

// Ports (canonical-engine binding seams + fail-closed integration catalog; deterministic doubles only)
export {
  M06WorkflowDefinitionAdapter,
  M07RuleDefinitionAdapter,
  FixtureWorkflowDefinitionPort,
  FixtureRuleDefinitionPort,
  UnavailableIntegrationCatalog,
  FixtureIntegrationCatalog,
} from './ports.ts';
export type {
  PublishedBinding,
  WorkflowDefinitionPort,
  RuleDefinitionPort,
  IntegrationCapability,
  IntegrationCapabilityCatalogPort,
} from './ports.ts';

// Persistence
export { StudioRepository } from './repository.ts';
export type {
  ProjectRow,
  ArtifactRow,
  ArtifactVersionRow,
  DependencyRow,
  ValidationResultRow,
  ReviewRow,
  BindingRow,
} from './repository.ts';

// Services
export { StudioProjectService } from './project.service.ts';
export { StudioArtifactService, contentHashOf } from './artifact.service.ts';
export { StudioBindingService } from './binding.service.ts';
