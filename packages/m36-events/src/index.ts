/**
 * @finapp/m36-events — WEBHOOKS & EVENT STREAMING (Stage 6D-4, mvp:false): the governed OUTBOUND fan-out layer over the
 * platform's domain events — external webhook endpoints, event subscriptions/filters, webhook delivery evidence, and tenant
 * event streams with consumer cursors. THE LOAD-BEARING BOUNDARY: m06 owns THE ONE outbox/event-delivery path — m36 owns no
 * outbox; it CONSUMES domain events by contract (fail-closed EventSourcePort fed by the m06 dispatcher) and fans them out to
 * governed external subscribers, recording each delivery. Webhook delivery is EXTERNAL EGRESS: framework-only behind a
 * fail-closed WebhookDeliveryPort (deterministic doubles, no production network; an unavailable runtime yields a durable
 * BLOCKED outcome; allow-listed https public URLs only). NOT a secrets manager (an endpoint signing secret is an opaque
 * secretref: pointer via the m30 seam; zero secret value columns; m41 deferred). Activating an external endpoint is a
 * human-governed controlled action (maker-checker/SoD; AI never approves; approved url/key immutable). Uses the webhook_,
 * eventstream_ and events_ table prefixes. Reuses m02/m03/m06/m30 by contract; owns webhook.lifecycle + eventstream.lifecycle
 * and publishes through the ONE m06 outbox. Declares /api/v1/webhooks + /api/v1/events + events.* (GAP-4 resolved) +
 * WEBHOOK_/EVENTSTREAM_. No secret value; no external network/provider; no arbitrary code.
 */

// Permissions + audit codes
export {
  M36_PERMISSIONS,
  ALL_M36_PERMISSIONS,
  M36_PLATFORM_PERMISSIONS,
  M36_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
} from './permissions.ts';
export type { M36Permission } from './permissions.ts';
export {
  M36_AUDIT_CODES,
  ALL_M36_AUDIT_CODES,
  WEBHOOK_AUDIT_PREFIX,
  EVENTSTREAM_AUDIT_PREFIX,
} from './audit-codes.ts';
export type { M36AuditCode } from './audit-codes.ts';

// Domain
export {
  M36_LIMITS,
  EventsError,
  SCOPES,
  isScope,
  isPlatformScope,
  ENDPOINT_STATES,
  isEndpointState,
  isEndpointFrozen,
  SUBSCRIPTION_STATUSES,
  isSubscriptionStatus,
  DELIVERY_STATUSES,
  isDeliveryStatus,
  STREAM_STATUSES,
  isStreamStatus,
  REASON_CODES,
  ALL_REASON_CODES,
  isHumanActor,
  evaluateSodGate,
  evaluateApprovalGate,
  validateEndpointUrl,
  validateEndpoint,
  isRegisteredEventFamily,
  eventMatchesSubscription,
  SECRET_REFERENCE_PATTERN,
  isSecretReference,
  clampPage,
} from './domain.ts';
export type {
  Scope,
  EndpointState,
  DeliveryStatus,
  ReasonCodeKey,
  GateResult,
  ApprovalGateInput,
  ValidationFinding,
  ValidationOutcome,
  Page,
} from './domain.ts';

// Errors + emit
export { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
export { M36Emitter } from './emit.ts';

// Ports (m06 event source + external webhook delivery + m30 secret resolver seam; deterministic doubles only)
export {
  EmptyEventSource,
  FixtureEventSource,
  UnavailableWebhookDelivery,
  FixtureWebhookDelivery,
  DeterministicSecretResolver,
  UnavailableSecretResolver,
} from './ports.ts';
export type {
  RelayEvent,
  EventSourcePort,
  DeliveryOutcome,
  WebhookDeliveryPort,
  SecretResolver,
} from './ports.ts';

// Persistence
export { EventsRepository } from './repository.ts';
export type {
  EndpointRow,
  SubscriptionRow,
  DeliveryRow,
  ReviewRow,
  StreamRow,
  CursorRow,
} from './repository.ts';

// Services
export { WebhookService } from './webhook.service.ts';
export { RelayService } from './relay.service.ts';
export { StreamService } from './stream.service.ts';
