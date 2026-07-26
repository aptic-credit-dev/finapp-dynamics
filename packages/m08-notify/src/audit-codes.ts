/**
 * M08 audit codes — the authoritative constant map. Every controlled notification/escalation mutation and
 * every governed delivery attempt records one of these through the kernel `AUDIT` port (m03 AuditService) in
 * the SAME transaction as the state change. Codes are SCREAMING_SNAKE `NOTIFY_<ENTITY>_<ACTION>` (>= 3
 * segments) and MUST be registered in manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005).
 * Payloads never carry raw destinations, rendered bodies, provider secrets, or variable values (ADR-041).
 */
export const M08_AUDIT_CODES = {
  templateCreated: 'NOTIFY_TEMPLATE_CREATED',
  templateUpdated: 'NOTIFY_TEMPLATE_UPDATED',
  templateValidated: 'NOTIFY_TEMPLATE_VALIDATED',
  templateValidationFailed: 'NOTIFY_TEMPLATE_VALIDATION_FAILED',
  versionCreated: 'NOTIFY_VERSION_CREATED',
  versionPublished: 'NOTIFY_VERSION_PUBLISHED',
  versionActivated: 'NOTIFY_VERSION_ACTIVATED',
  versionRetired: 'NOTIFY_VERSION_RETIRED',
  requestCreated: 'NOTIFY_REQUEST_CREATED',
  requestCancelled: 'NOTIFY_REQUEST_CANCELLED',
  requestExpired: 'NOTIFY_REQUEST_EXPIRED',
  requestSuppressed: 'NOTIFY_REQUEST_SUPPRESSED',
  deliveryClaimed: 'NOTIFY_DELIVERY_CLAIMED',
  deliveryAttempted: 'NOTIFY_DELIVERY_ATTEMPTED',
  deliverySucceeded: 'NOTIFY_DELIVERY_SUCCEEDED',
  deliveryFailed: 'NOTIFY_DELIVERY_FAILED',
  retryScheduled: 'NOTIFY_RETRY_SCHEDULED',
  retryExhausted: 'NOTIFY_RETRY_EXHAUSTED',
  retryRequested: 'NOTIFY_RETRY_REQUESTED',
  escalationPolicyCreated: 'NOTIFY_ESCALATION_POLICY_CREATED',
  escalationPolicyUpdated: 'NOTIFY_ESCALATION_POLICY_UPDATED',
  escalationActivated: 'NOTIFY_ESCALATION_ACTIVATED',
  escalationAdvanced: 'NOTIFY_ESCALATION_ADVANCED',
  escalationAcknowledged: 'NOTIFY_ESCALATION_ACKNOWLEDGED',
  escalationResolved: 'NOTIFY_ESCALATION_RESOLVED',
  escalationCancelled: 'NOTIFY_ESCALATION_CANCELLED',
  preferenceChanged: 'NOTIFY_PREFERENCE_CHANGED',
  inboxRead: 'NOTIFY_INBOX_READ',
  platformConfigured: 'NOTIFY_PLATFORM_CONFIGURED',
} as const;

export type M08AuditCode = (typeof M08_AUDIT_CODES)[keyof typeof M08_AUDIT_CODES];

export const ALL_M08_AUDIT_CODES: readonly M08AuditCode[] = Object.values(M08_AUDIT_CODES);

export const NOTIFY_AUDIT_PREFIX = 'NOTIFY_';
