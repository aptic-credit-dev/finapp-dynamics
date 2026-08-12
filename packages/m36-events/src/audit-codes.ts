/**
 * M36 audit codes — the `WEBHOOK_` and `EVENTSTREAM_` prefixes. Every controlled endpoint/subscription/delivery/stream
 * action is audited through the kernel AUDIT port in the SAME transaction. SCREAMING_SNAKE `<PREFIX>_<ENTITY>_<ACTION>`
 * (>= 3 segments), registered in manifests/audit-code-registry.yaml (unregistered codes fail CI). Payloads carry safe ids,
 * an event family/type, a delivery status and reason codes ONLY — never a signing secret, an event payload body, an
 * endpoint credential, or personal data.
 */
export const M36_AUDIT_CODES = {
  endpointRegistered: 'WEBHOOK_ENDPOINT_REGISTERED',
  endpointReviewRequested: 'WEBHOOK_ENDPOINT_REVIEW_REQUESTED',
  endpointApproved: 'WEBHOOK_ENDPOINT_APPROVED',
  endpointRejected: 'WEBHOOK_ENDPOINT_REJECTED',
  endpointSuspended: 'WEBHOOK_ENDPOINT_SUSPENDED',
  subscriptionAdded: 'WEBHOOK_SUBSCRIPTION_ADDED',
  deliveryAttempted: 'WEBHOOK_DELIVERY_ATTEMPTED',
  deliverySucceeded: 'WEBHOOK_DELIVERY_SUCCEEDED',
  deliveryFailed: 'WEBHOOK_DELIVERY_FAILED',
  deliveryBlocked: 'WEBHOOK_DELIVERY_BLOCKED',
  deliveryReplayed: 'WEBHOOK_DELIVERY_REPLAYED',
  approvalBlocked: 'WEBHOOK_APPROVAL_BLOCKED',
  sodBlocked: 'WEBHOOK_SOD_BLOCKED',
  streamCreated: 'EVENTSTREAM_STREAM_CREATED',
  streamPaused: 'EVENTSTREAM_STREAM_PAUSED',
  streamSubscriptionAdded: 'EVENTSTREAM_SUBSCRIPTION_ADDED',
  cursorAdvanced: 'EVENTSTREAM_CURSOR_ADVANCED',
} as const;

export type M36AuditCode = (typeof M36_AUDIT_CODES)[keyof typeof M36_AUDIT_CODES];
export const ALL_M36_AUDIT_CODES: readonly M36AuditCode[] = Object.values(M36_AUDIT_CODES);
export const WEBHOOK_AUDIT_PREFIX = 'WEBHOOK_';
export const EVENTSTREAM_AUDIT_PREFIX = 'EVENTSTREAM_';
