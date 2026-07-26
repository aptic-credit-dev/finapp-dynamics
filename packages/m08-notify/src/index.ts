/**
 * @finapp/m08-notify — generic multi-tenant notifications + escalation (Stage 2.4).
 *
 * The PURE domain layer (safe deterministic template rendering, typed variable validation, channel + destination
 * normalization with an SSRF guard, the template/request/escalation state machines, the retry policy calculator,
 * escalation level calculation, recipient dedup, and preference/suppression evaluation) carries no I/O and is
 * exhaustively unit-tested. Templates are DATA: the only dynamic construct is `{{ variable }}` substitution —
 * there is no eval/Function/vm, so injection is impossible by construction (ADR-040). The services layer runs
 * everything inside `db.withTenant(ctx, tx => …)` with audit + outbox in the same transaction; m08 consumes
 * DB/AUDIT/AUTHZ via kernel tokens and publishes `notification.lifecycle` through the ONE outbox m06 owns.
 * Delivery is performed by provider adapters (ports); m08 ships deterministic test doubles only — no secrets,
 * no real integration.
 */

// Vocabularies (registered in manifests/*.yaml + seeded)
export { M08_PERMISSIONS, ALL_M08_PERMISSIONS } from './permissions.ts';
export type { M08Permission } from './permissions.ts';
export { M08_AUDIT_CODES, ALL_M08_AUDIT_CODES, NOTIFY_AUDIT_PREFIX } from './audit-codes.ts';
export type { M08AuditCode } from './audit-codes.ts';

// Domain — limits + errors
export { NOTIFY_LIMITS, NotifyError } from './domain/limits.ts';

// Domain — channels
export {
  CHANNELS,
  isChannel,
  channelEscapes,
  channelHasSubject,
  normalizeDestination,
  requireDestination,
} from './domain/channels.ts';
export type { Channel, DestinationResult } from './domain/channels.ts';

// Domain — template spec + variables + safe rendering
export {
  TEMPLATE_SCHEMA_VERSION,
  VARIABLE_TYPES,
  validateTemplateSpec,
  templateVariables,
} from './domain/template.ts';
export type {
  TemplateSpec,
  VariableSchema,
  VariableType,
  TemplateError,
  TemplateValidation,
} from './domain/template.ts';
export { validateVariables } from './domain/variables.ts';
export type { VariableError, VariableValidation } from './domain/variables.ts';
export { renderTemplate, extractPlaceholders, hasMalformedPlaceholder, escapeHtml } from './domain/render.ts';
export type { RenderValue, RenderOptions } from './domain/render.ts';

// Domain — lifecycles
export {
  TEMPLATE_STATUSES,
  TEMPLATE_ACTIONS,
  checkTemplateTransition,
  isTemplateContentFrozen,
  REQUEST_STATUSES,
  REQUEST_TERMINAL,
  checkRequestTransition,
  isRequestTerminal,
  ESCALATION_STATUSES,
  ESCALATION_TERMINAL,
  checkEscalationTransition,
  isEscalationTerminal,
} from './domain/lifecycles.ts';
export type {
  TemplateStatus,
  TemplateAction,
  RequestStatus,
  EscalationStatus,
  TransitionResult,
} from './domain/lifecycles.ts';

// Domain — retry
export {
  ERROR_CATEGORIES,
  BACKOFF_STRATEGIES,
  DEFAULT_RETRY_POLICY,
  validateRetryPolicy,
  retryDecision,
} from './domain/retry.ts';
export type { ErrorCategory, BackoffStrategy, RetryPolicy, RetryDecision } from './domain/retry.ts';

// Domain — escalation spec + calculator
export {
  ESCALATION_SCHEMA_VERSION,
  validateEscalationSpec,
  nextEscalation,
  levelAt,
  assertValidEscalationSpec,
} from './domain/escalation.ts';
export type { EscalationPolicySpec, EscalationLevel, EscalationStep } from './domain/escalation.ts';

// Domain — recipients + preferences
export { RECIPIENT_KINDS, dedupeRecipients, orderRecipients } from './domain/recipients.ts';
export type { RecipientRef, ResolvedRecipient, RecipientKind } from './domain/recipients.ts';
export { NOTIFICATION_CATEGORIES, isMandatoryCategory, evaluateDelivery } from './domain/preferences.ts';
export type {
  NotificationCategory,
  ChannelPreference,
  QuietHours,
  DeliveryDecision,
} from './domain/preferences.ts';

// Hash utilities
export { contentHashOf, canonicalJson } from './hash.ts';

// Persistence
export { NotifyRepository } from './repository.ts';
export type {
  TemplateRow,
  TemplateVersionRow,
  RequestRow,
  DeliveryRow,
  EscalationPolicyRow,
  EscalationInstanceRow,
  PreferenceRow,
  InboxRow,
} from './repository.ts';

// Emit (audit + the ONE outbox m06 owns) + error helpers
export { M08Emitter } from './emit.ts';
export { badRequest, invalidTemplate, invalidVariables } from './errors.ts';

// Providers (ports + test doubles)
export { ProviderRegistry, DeterministicProvider } from './provider.ts';
export type { NotificationProvider, DispatchInput, DispatchResult } from './provider.ts';

// Services
export { TemplateService } from './template.service.ts';
export { NotificationService } from './notification.service.ts';
export type { CreateRequestInput, DispatchOutcome } from './notification.service.ts';
export { EscalationService } from './escalation.service.ts';
export { PreferenceService } from './preference.service.ts';
export { InboxService } from './inbox.service.ts';
