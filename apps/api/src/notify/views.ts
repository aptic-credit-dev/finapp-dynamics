import type {
  TemplateRow,
  TemplateVersionRow,
  RequestRow,
  DeliveryRow,
  EscalationPolicyRow,
  EscalationInstanceRow,
  PreferenceRow,
  InboxRow,
} from '@finapp/m08-notify';

/**
 * Response shapes for the notifications API (m08). Persistence rows are snake_case; these map to camelCase DTOs.
 * The tenant is implicit (x-tenant-id + RLS), so `tenant_id` is never re-exposed. Deliberate REDACTIONS
 * (ADR-041, prompt §E17): request views omit the raw `variables` values (a variables HASH stands in) and the
 * worker LEASE (`locked_by`/`locked_until`); delivery views omit provider secrets (none are stored anyway).
 * Every mutable view carries `version` for the caller's next optimistic-lock `expectedVersion`.
 */

export function templateView(row: TemplateRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    channel: row.channel,
    scope: row.scope,
    status: row.status,
    version: row.version,
  };
}

export function versionView(row: TemplateVersionRow) {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    status: row.status,
    spec: row.spec,
    contentHash: row.content_hash,
    notes: row.notes,
    version: row.version,
  };
}

export function requestView(row: RequestRow) {
  return {
    id: row.id,
    templateVersionId: row.template_version_id,
    channel: row.channel,
    destination: row.destination,
    recipientRef: row.recipient_ref,
    category: row.category,
    priority: row.priority,
    variablesHash: row.variables_hash,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    scheduledAt: row.scheduled_at,
    expiresAt: row.expires_at,
    lastErrorCategory: row.last_error_category,
    suppressedReason: row.suppressed_reason,
    originModule: row.origin_module,
    originEntityType: row.origin_entity_type,
    originEntityId: row.origin_entity_id,
    version: row.version,
  };
}

export function deliveryView(row: DeliveryRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    attemptNumber: row.attempt_number,
    providerCode: row.provider_code,
    outcome: row.outcome,
    responseCode: row.response_code,
    errorCategory: row.error_category,
    retryable: row.retryable,
    providerRef: row.provider_ref,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    nextRetryAt: row.next_retry_at,
  };
}

export function policyView(row: EscalationPolicyRow) {
  return {
    id: row.id,
    key: row.key,
    versionNumber: row.version_number,
    name: row.name,
    scope: row.scope,
    status: row.status,
    spec: row.spec,
    contentHash: row.content_hash,
    version: row.version,
  };
}

export function instanceView(row: EscalationInstanceRow) {
  return {
    id: row.id,
    policyId: row.policy_id,
    originModule: row.origin_module,
    originEntityType: row.origin_entity_type,
    originEntityId: row.origin_entity_id,
    currentLevel: row.current_level,
    status: row.status,
    nextEscalationAt: row.next_escalation_at,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
    version: row.version,
  };
}

export function preferenceView(row: PreferenceRow) {
  return {
    id: row.id,
    subjectId: row.subject_id,
    destination: row.destination,
    channel: row.channel,
    optIn: row.opt_in,
    suppressed: row.suppressed,
    quietHours: row.quiet_hours,
    version: row.version,
  };
}

export function inboxView(row: InboxRow) {
  return {
    id: row.id,
    severity: row.severity,
    title: row.title,
    body: row.body,
    status: row.status,
    deepLink: row.deep_link,
    originModule: row.origin_module,
    originEntityType: row.origin_entity_type,
    originEntityId: row.origin_entity_id,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    version: row.version,
  };
}
