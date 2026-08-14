/**
 * M38 audit codes — the `AUTOMATION_` and `EXTENSION_` prefixes. Every controlled automation/schedule/run/extension action is
 * audited through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE `<PREFIX>_<ENTITY>_<ACTION>` (>= 3
 * segments), registered in manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids, a
 * capability/schedule reference, a status, a trust tier and reason codes ONLY — never a secret, executable content, a full
 * downstream payload, a credential or personal data.
 */
export const M38_AUDIT_CODES = {
  automationDefined: 'AUTOMATION_JOB_DEFINED',
  automationStepAdded: 'AUTOMATION_STEP_ADDED',
  automationScheduleSet: 'AUTOMATION_SCHEDULE_SET',
  automationReviewRequested: 'AUTOMATION_REVIEW_REQUESTED',
  automationActivated: 'AUTOMATION_JOB_ACTIVATED',
  automationSuspended: 'AUTOMATION_JOB_SUSPENDED',
  automationArchived: 'AUTOMATION_JOB_ARCHIVED',
  automationReviewRejected: 'AUTOMATION_REVIEW_REJECTED',
  runRecorded: 'AUTOMATION_RUN_RECORDED',
  runBlocked: 'AUTOMATION_RUN_BLOCKED',
  sodBlocked: 'AUTOMATION_SOD_BLOCKED',
  capabilityBlocked: 'AUTOMATION_CAPABILITY_BLOCKED',
  extensionDefined: 'EXTENSION_REGISTRY_DEFINED',
  extensionPointAdded: 'EXTENSION_POINT_ADDED',
  extensionReviewRequested: 'EXTENSION_REVIEW_REQUESTED',
  extensionPublished: 'EXTENSION_REGISTRY_PUBLISHED',
  extensionDeprecated: 'EXTENSION_REGISTRY_DEPRECATED',
  extensionInstalled: 'EXTENSION_INSTALL_ENABLED',
  extensionDisabled: 'EXTENSION_INSTALL_DISABLED',
  extensionSodBlocked: 'EXTENSION_SOD_BLOCKED',
} as const;

export type M38AuditCode = (typeof M38_AUDIT_CODES)[keyof typeof M38_AUDIT_CODES];
export const ALL_M38_AUDIT_CODES: readonly M38AuditCode[] = Object.values(M38_AUDIT_CODES);
export const AUTOMATION_AUDIT_PREFIX = 'AUTOMATION_';
export const EXTENSION_AUDIT_PREFIX = 'EXTENSION_';
