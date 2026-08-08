/**
 * M31 audit codes — the `STUDIO_` prefix (naming-map; registered to m31). Every design mutation, every validation and
 * every publication/review decision is audited through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE
 * `STUDIO_<ENTITY>_<ACTION>` (>= 3 segments), registered in manifests/audit-code-registry.yaml (unregistered codes fail
 * CI). Payloads carry safe ids, keys, kinds, scopes, states and reason codes ONLY — never a design spec, a form field,
 * a configuration/secret value or personal data.
 */
export const M31_AUDIT_CODES = {
  projectCreated: 'STUDIO_PROJECT_CREATED',
  projectUpdated: 'STUDIO_PROJECT_UPDATED',
  artifactCreated: 'STUDIO_ARTIFACT_CREATED',
  artifactVersionCreated: 'STUDIO_ARTIFACT_VERSION_CREATED',
  artifactValidated: 'STUDIO_ARTIFACT_VALIDATED',
  artifactValidationFailed: 'STUDIO_ARTIFACT_VALIDATION_FAILED',
  reviewRequested: 'STUDIO_REVIEW_REQUESTED',
  artifactPublished: 'STUDIO_ARTIFACT_PUBLISHED',
  reviewRejected: 'STUDIO_REVIEW_REJECTED',
  artifactSuperseded: 'STUDIO_ARTIFACT_SUPERSEDED',
  artifactArchived: 'STUDIO_ARTIFACT_ARCHIVED',
  bindingCreated: 'STUDIO_BINDING_CREATED',
  publishBlocked: 'STUDIO_PUBLISH_BLOCKED',
  sodBlocked: 'STUDIO_SOD_BLOCKED',
} as const;

export type M31AuditCode = (typeof M31_AUDIT_CODES)[keyof typeof M31_AUDIT_CODES];
export const ALL_M31_AUDIT_CODES: readonly M31AuditCode[] = Object.values(M31_AUDIT_CODES);
export const STUDIO_AUDIT_PREFIX = 'STUDIO_';
