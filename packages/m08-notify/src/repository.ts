/**
 * M08 repository — ALL SQL for notifications + escalation. Every query is parameterized; every mutating UPDATE
 * is optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a stale or
 * losing command changes zero rows and the caller reacts (409 / not-claimed). Queries carry NO tenant_id
 * predicate: RLS is the isolation guarantee, not a WHERE clause. All methods take the caller's `Tx` (from
 * `db.withTenant`) so state, evidence, audit and outbox commit atomically. Delivery attempts are append-only.
 */
import type { Tx } from '@finapp/kernel';

// --- row types ----------------------------------------------------------------------------------
export interface TemplateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly channel: string;
  readonly scope: string;
  readonly status: string;
  readonly version: number;
}

export interface TemplateVersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly template_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly notes: string | null;
  readonly version: number;
}

export interface RequestRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly template_version_id: string;
  readonly channel: string;
  readonly destination: string;
  readonly recipient_ref: string | null;
  readonly category: string;
  readonly priority: string;
  readonly variables: unknown;
  readonly variables_hash: string;
  readonly retry_policy: unknown;
  readonly status: string;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly next_attempt_at: string | null;
  readonly scheduled_at: string | null;
  readonly expires_at: string | null;
  readonly last_error_category: string | null;
  readonly suppressed_reason: string | null;
  readonly locked_by: string | null;
  readonly locked_until: string | null;
  readonly idempotency_key: string | null;
  readonly correlation_id: string;
  readonly origin_module: string | null;
  readonly origin_entity_type: string | null;
  readonly origin_entity_id: string | null;
  readonly version: number;
}

export interface DeliveryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly attempt_number: number;
  readonly provider_code: string;
  readonly outcome: string;
  readonly response_code: string | null;
  readonly error_category: string | null;
  readonly retryable: boolean;
  readonly provider_ref: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly next_retry_at: string | null;
  readonly correlation_id: string;
}

export interface EscalationPolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly key: string;
  readonly version_number: number;
  readonly name: string;
  readonly scope: string;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly version: number;
}

export interface EscalationInstanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly policy_id: string;
  readonly origin_module: string | null;
  readonly origin_entity_type: string | null;
  readonly origin_entity_id: string | null;
  readonly current_level: number;
  readonly status: string;
  readonly next_escalation_at: string | null;
  readonly acknowledged_by: string | null;
  readonly acknowledged_at: string | null;
  readonly resolved_by: string | null;
  readonly resolved_at: string | null;
  readonly resolution: string | null;
  readonly locked_by: string | null;
  readonly locked_until: string | null;
  readonly idempotency_key: string | null;
  readonly correlation_id: string;
  readonly version: number;
}

export interface PreferenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subject_id: string | null;
  readonly destination: string | null;
  readonly channel: string;
  readonly opt_in: boolean;
  readonly suppressed: boolean;
  readonly quiet_hours: unknown;
  readonly reason: string | null;
  readonly version: number;
}

export interface InboxRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recipient_id: string;
  readonly request_id: string | null;
  readonly severity: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly deep_link: unknown;
  readonly origin_module: string | null;
  readonly origin_entity_type: string | null;
  readonly origin_entity_id: string | null;
  readonly delivered_at: string;
  readonly read_at: string | null;
  readonly expires_at: string | null;
  readonly version: number;
}

const TEMPLATE_COLS = 'tenant_id, id, key, name, description, channel, scope, status, version';
const VERSION_COLS = 'tenant_id, id, template_id, version_number, status, spec, content_hash, notes, version';
const REQUEST_COLS =
  'tenant_id, id, template_version_id, channel, destination, recipient_ref, category, priority, variables, ' +
  'variables_hash, retry_policy, status, attempt_count, max_attempts, next_attempt_at, scheduled_at, ' +
  'expires_at, last_error_category, suppressed_reason, locked_by, locked_until, idempotency_key, ' +
  'correlation_id, origin_module, origin_entity_type, origin_entity_id, version';
const DELIVERY_COLS =
  'tenant_id, id, request_id, attempt_number, provider_code, outcome, response_code, error_category, ' +
  'retryable, provider_ref, started_at, completed_at, next_retry_at, correlation_id';
const POLICY_COLS = 'tenant_id, id, key, version_number, name, scope, status, spec, content_hash, version';
const INSTANCE_COLS =
  'tenant_id, id, policy_id, origin_module, origin_entity_type, origin_entity_id, current_level, status, ' +
  'next_escalation_at, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution, locked_by, ' +
  'locked_until, idempotency_key, correlation_id, version';
const PREFERENCE_COLS =
  'tenant_id, id, subject_id, destination, channel, opt_in, suppressed, quiet_hours, reason, version';
const INBOX_COLS =
  'tenant_id, id, recipient_id, request_id, severity, title, body, status, deep_link, origin_module, ' +
  'origin_entity_type, origin_entity_id, delivered_at, read_at, expires_at, version';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m08 repository: expected a row from ${what}`);
  return row;
}

export class NotifyRepository {
  // --- templates --------------------------------------------------------------------------------
  async insertTemplate(
    tx: Tx,
    input: {
      tenantId: string;
      key: string;
      name: string;
      description: string | null;
      channel: string;
      scope: string;
      createdBy: string | null;
    },
  ): Promise<TemplateRow> {
    const r = await tx.query<TemplateRow>(
      `INSERT INTO notification_template (tenant_id, key, name, description, channel, scope, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING ${TEMPLATE_COLS}`,
      [input.tenantId, input.key, input.name, input.description, input.channel, input.scope, input.createdBy],
    );
    return firstRow(r.rows, 'insert notification_template');
  }

  async findTemplate(tx: Tx, id: string): Promise<TemplateRow | null> {
    const r = await tx.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLS} FROM notification_template WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async findTemplateByKey(tx: Tx, key: string): Promise<TemplateRow | null> {
    const r = await tx.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLS} FROM notification_template WHERE key = $1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  async listTemplates(tx: Tx): Promise<TemplateRow[]> {
    const r = await tx.query<TemplateRow>(`SELECT ${TEMPLATE_COLS} FROM notification_template ORDER BY key`);
    return r.rows;
  }

  async updateTemplate(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      name: string;
      description: string | null;
      updatedBy: string | null;
    },
  ): Promise<TemplateRow | null> {
    const r = await tx.query<TemplateRow>(
      `UPDATE notification_template
         SET name = $3, description = $4, updated_by = $5, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${TEMPLATE_COLS}`,
      [input.id, input.expectedVersion, input.name, input.description, input.updatedBy],
    );
    return r.rows[0] ?? null;
  }

  // --- template versions ------------------------------------------------------------------------
  async nextVersionNumber(tx: Tx, templateId: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
       FROM notification_template_version WHERE template_id = $1`,
      [templateId],
    );
    return firstRow(r.rows, 'next version number').next;
  }

  async insertVersion(
    tx: Tx,
    input: {
      tenantId: string;
      templateId: string;
      versionNumber: number;
      spec: unknown;
      notes: string | null;
      createdBy: string | null;
    },
  ): Promise<TemplateVersionRow> {
    const r = await tx.query<TemplateVersionRow>(
      `INSERT INTO notification_template_version (tenant_id, template_id, version_number, spec, notes, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING ${VERSION_COLS}`,
      [
        input.tenantId,
        input.templateId,
        input.versionNumber,
        JSON.stringify(input.spec),
        input.notes,
        input.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert notification_template_version');
  }

  async findVersion(tx: Tx, id: string): Promise<TemplateVersionRow | null> {
    const r = await tx.query<TemplateVersionRow>(
      `SELECT ${VERSION_COLS} FROM notification_template_version WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async findActiveVersion(tx: Tx, templateId: string): Promise<TemplateVersionRow | null> {
    const r = await tx.query<TemplateVersionRow>(
      `SELECT ${VERSION_COLS} FROM notification_template_version WHERE template_id = $1 AND status = 'ACTIVE'`,
      [templateId],
    );
    return r.rows[0] ?? null;
  }

  async listVersions(tx: Tx, templateId: string): Promise<TemplateVersionRow[]> {
    const r = await tx.query<TemplateVersionRow>(
      `SELECT ${VERSION_COLS} FROM notification_template_version WHERE template_id = $1 ORDER BY version_number`,
      [templateId],
    );
    return r.rows;
  }

  async updateVersionStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash?: string | null;
      publishedBy?: string | null;
    },
  ): Promise<TemplateVersionRow | null> {
    const r = await tx.query<TemplateVersionRow>(
      `UPDATE notification_template_version
         SET status = $3,
             content_hash = COALESCE($4, content_hash),
             published_at = CASE WHEN $3 = 'PUBLISHED' THEN now() ELSE published_at END,
             published_by = COALESCE($5, published_by),
             version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${VERSION_COLS}`,
      [input.id, input.expectedVersion, input.toStatus, input.contentHash ?? null, input.publishedBy ?? null],
    );
    return r.rows[0] ?? null;
  }

  /** Retire the currently-ACTIVE sibling of a template so a new version can activate (one-active invariant). */
  async retireActiveVersions(tx: Tx, templateId: string, exceptId: string): Promise<void> {
    await tx.query(
      `UPDATE notification_template_version SET status = 'RETIRED', version = version + 1
       WHERE template_id = $1 AND status = 'ACTIVE' AND id <> $2`,
      [templateId, exceptId],
    );
  }

  // --- requests ---------------------------------------------------------------------------------
  async insertRequest(
    tx: Tx,
    input: {
      tenantId: string;
      templateVersionId: string;
      channel: string;
      destination: string;
      recipientRef: string | null;
      category: string;
      priority: string;
      variables: unknown;
      variablesHash: string;
      retryPolicy: unknown;
      maxAttempts: number;
      status: string;
      nextAttemptAt: string | null;
      scheduledAt: string | null;
      expiresAt: string | null;
      suppressedReason: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      originModule: string | null;
      originEntityType: string | null;
      originEntityId: string | null;
      createdBy: string | null;
    },
  ): Promise<RequestRow> {
    const r = await tx.query<RequestRow>(
      `INSERT INTO notification_request
         (tenant_id, template_version_id, channel, destination, recipient_ref, category, priority, variables,
          variables_hash, retry_policy, max_attempts, status, next_attempt_at, scheduled_at, expires_at,
          suppressed_reason, idempotency_key, correlation_id, causation_id, origin_module, origin_entity_type,
          origin_entity_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23)
       RETURNING ${REQUEST_COLS}`,
      [
        input.tenantId,
        input.templateVersionId,
        input.channel,
        input.destination,
        input.recipientRef,
        input.category,
        input.priority,
        JSON.stringify(input.variables),
        input.variablesHash,
        JSON.stringify(input.retryPolicy),
        input.maxAttempts,
        input.status,
        input.nextAttemptAt,
        input.scheduledAt,
        input.expiresAt,
        input.suppressedReason,
        input.idempotencyKey,
        input.correlationId,
        input.causationId,
        input.originModule,
        input.originEntityType,
        input.originEntityId,
        input.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert notification_request');
  }

  async findRequest(tx: Tx, id: string): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(`SELECT ${REQUEST_COLS} FROM notification_request WHERE id = $1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }

  async findRequestByIdempotencyKey(tx: Tx, key: string): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(
      `SELECT ${REQUEST_COLS} FROM notification_request WHERE idempotency_key = $1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  async listRequests(tx: Tx, limit: number, offset: number): Promise<RequestRow[]> {
    const r = await tx.query<RequestRow>(
      `SELECT ${REQUEST_COLS} FROM notification_request ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  /** Version-guarded status change (queue/cancel/expire/suppress and lifecycle bookkeeping). */
  async updateRequestStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      nextAttemptAt?: string | null;
      lastErrorCategory?: string | null;
      suppressedReason?: string | null;
      clearLease?: boolean;
      updatedBy?: string | null;
    },
  ): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(
      `UPDATE notification_request
         SET status = $3,
             next_attempt_at = $4,
             last_error_category = COALESCE($5, last_error_category),
             suppressed_reason = COALESCE($6, suppressed_reason),
             locked_by = CASE WHEN $7 THEN NULL ELSE locked_by END,
             locked_until = CASE WHEN $7 THEN NULL ELSE locked_until END,
             updated_by = $8, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${REQUEST_COLS}`,
      [
        input.id,
        input.expectedVersion,
        input.toStatus,
        input.nextAttemptAt ?? null,
        input.lastErrorCategory ?? null,
        input.suppressedReason ?? null,
        input.clearLease ?? false,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ?? null;
  }

  /**
   * Compare-and-set claim of a due request for a worker, taking a lease. Returns the claimed row or null if it
   * is not claimable (terminal, already leased by a live lease, not yet due, or expired). This is the
   * concurrency choke point: two workers racing produce one winner. Sets status='processing' and bumps attempt.
   */
  async claimRequest(tx: Tx, id: string, workerId: string, leaseSeconds: number): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(
      `UPDATE notification_request
         SET status = 'processing',
             locked_by = $2,
             locked_until = now() + make_interval(secs => $3),
             attempt_count = attempt_count + 1,
             version = version + 1,
             updated_at = now()
       WHERE id = $1
         AND status IN ('requested', 'queued', 'retry_scheduled')
         AND (locked_until IS NULL OR locked_until < now())
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING ${REQUEST_COLS}`,
      [id, workerId, leaseSeconds],
    );
    return r.rows[0] ?? null;
  }

  // --- deliveries (append-only) -----------------------------------------------------------------
  async insertDelivery(
    tx: Tx,
    input: {
      tenantId: string;
      requestId: string;
      attemptNumber: number;
      providerCode: string;
      outcome: string;
      responseCode: string | null;
      errorCategory: string | null;
      retryable: boolean;
      providerRef: string | null;
      completedAt: string | null;
      nextRetryAt: string | null;
      correlationId: string;
    },
  ): Promise<DeliveryRow> {
    const r = await tx.query<DeliveryRow>(
      `INSERT INTO notification_delivery
         (tenant_id, request_id, attempt_number, provider_code, outcome, response_code, error_category,
          retryable, provider_ref, completed_at, next_retry_at, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${DELIVERY_COLS}`,
      [
        input.tenantId,
        input.requestId,
        input.attemptNumber,
        input.providerCode,
        input.outcome,
        input.responseCode,
        input.errorCategory,
        input.retryable,
        input.providerRef,
        input.completedAt,
        input.nextRetryAt,
        input.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert notification_delivery');
  }

  async listDeliveries(tx: Tx, requestId: string): Promise<DeliveryRow[]> {
    const r = await tx.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLS} FROM notification_delivery WHERE request_id = $1 ORDER BY attempt_number`,
      [requestId],
    );
    return r.rows;
  }

  // --- escalation policies ----------------------------------------------------------------------
  async nextPolicyVersion(tx: Tx, key: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM escalation_policy WHERE key = $1`,
      [key],
    );
    return firstRow(r.rows, 'next policy version').next;
  }

  async insertPolicy(
    tx: Tx,
    input: {
      tenantId: string;
      key: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ): Promise<EscalationPolicyRow> {
    const r = await tx.query<EscalationPolicyRow>(
      `INSERT INTO escalation_policy (tenant_id, key, version_number, name, scope, spec, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING ${POLICY_COLS}`,
      [
        input.tenantId,
        input.key,
        input.versionNumber,
        input.name,
        input.scope,
        JSON.stringify(input.spec),
        input.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert escalation_policy');
  }

  async findPolicy(tx: Tx, id: string): Promise<EscalationPolicyRow | null> {
    const r = await tx.query<EscalationPolicyRow>(
      `SELECT ${POLICY_COLS} FROM escalation_policy WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async findActivePolicyByKey(tx: Tx, key: string): Promise<EscalationPolicyRow | null> {
    const r = await tx.query<EscalationPolicyRow>(
      `SELECT ${POLICY_COLS} FROM escalation_policy WHERE key = $1 AND status = 'ACTIVE'`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  async listPolicies(tx: Tx): Promise<EscalationPolicyRow[]> {
    const r = await tx.query<EscalationPolicyRow>(
      `SELECT ${POLICY_COLS} FROM escalation_policy ORDER BY key, version_number`,
    );
    return r.rows;
  }

  async updatePolicyStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash?: string | null;
      publishedBy?: string | null;
    },
  ): Promise<EscalationPolicyRow | null> {
    const r = await tx.query<EscalationPolicyRow>(
      `UPDATE escalation_policy
         SET status = $3,
             content_hash = COALESCE($4, content_hash),
             published_at = CASE WHEN $3 = 'PUBLISHED' THEN now() ELSE published_at END,
             published_by = COALESCE($5, published_by),
             version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${POLICY_COLS}`,
      [input.id, input.expectedVersion, input.toStatus, input.contentHash ?? null, input.publishedBy ?? null],
    );
    return r.rows[0] ?? null;
  }

  async retireActivePolicies(tx: Tx, key: string, exceptId: string): Promise<void> {
    await tx.query(
      `UPDATE escalation_policy SET status = 'RETIRED', version = version + 1
       WHERE key = $1 AND status = 'ACTIVE' AND id <> $2`,
      [key, exceptId],
    );
  }

  // --- escalation instances ---------------------------------------------------------------------
  async insertInstance(
    tx: Tx,
    input: {
      tenantId: string;
      policyId: string;
      originModule: string | null;
      originEntityType: string | null;
      originEntityId: string | null;
      status: string;
      nextEscalationAt: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      createdBy: string | null;
    },
  ): Promise<EscalationInstanceRow> {
    const r = await tx.query<EscalationInstanceRow>(
      `INSERT INTO escalation_instance
         (tenant_id, policy_id, origin_module, origin_entity_type, origin_entity_id, status, next_escalation_at,
          idempotency_key, correlation_id, causation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING ${INSTANCE_COLS}`,
      [
        input.tenantId,
        input.policyId,
        input.originModule,
        input.originEntityType,
        input.originEntityId,
        input.status,
        input.nextEscalationAt,
        input.idempotencyKey,
        input.correlationId,
        input.causationId,
        input.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert escalation_instance');
  }

  async findInstance(tx: Tx, id: string): Promise<EscalationInstanceRow | null> {
    const r = await tx.query<EscalationInstanceRow>(
      `SELECT ${INSTANCE_COLS} FROM escalation_instance WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async findInstanceByIdempotencyKey(tx: Tx, key: string): Promise<EscalationInstanceRow | null> {
    const r = await tx.query<EscalationInstanceRow>(
      `SELECT ${INSTANCE_COLS} FROM escalation_instance WHERE idempotency_key = $1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  async listInstances(tx: Tx, limit: number, offset: number): Promise<EscalationInstanceRow[]> {
    const r = await tx.query<EscalationInstanceRow>(
      `SELECT ${INSTANCE_COLS} FROM escalation_instance ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  /** Version-guarded instance update (advance level, acknowledge, resolve, cancel, expire). */
  async updateInstance(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      currentLevel?: number | null;
      nextEscalationAt?: string | null;
      acknowledgedBy?: string | null;
      resolvedBy?: string | null;
      resolution?: string | null;
      clearLease?: boolean;
      updatedBy?: string | null;
    },
  ): Promise<EscalationInstanceRow | null> {
    const r = await tx.query<EscalationInstanceRow>(
      `UPDATE escalation_instance
         SET status = $3,
             current_level = COALESCE($4, current_level),
             next_escalation_at = $5,
             acknowledged_by = COALESCE($6, acknowledged_by),
             acknowledged_at = CASE WHEN $6 IS NOT NULL THEN now() ELSE acknowledged_at END,
             resolved_by = COALESCE($7, resolved_by),
             resolved_at = CASE WHEN $7 IS NOT NULL THEN now() ELSE resolved_at END,
             resolution = COALESCE($8, resolution),
             locked_by = CASE WHEN $9 THEN NULL ELSE locked_by END,
             locked_until = CASE WHEN $9 THEN NULL ELSE locked_until END,
             updated_by = $10, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${INSTANCE_COLS}`,
      [
        input.id,
        input.expectedVersion,
        input.toStatus,
        input.currentLevel ?? null,
        input.nextEscalationAt ?? null,
        input.acknowledgedBy ?? null,
        input.resolvedBy ?? null,
        input.resolution ?? null,
        input.clearLease ?? false,
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ?? null;
  }

  /** Compare-and-set claim of a due escalation instance for advancement (lease). One winner under contention. */
  async claimInstance(
    tx: Tx,
    id: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<EscalationInstanceRow | null> {
    const r = await tx.query<EscalationInstanceRow>(
      `UPDATE escalation_instance
         SET locked_by = $2, locked_until = now() + make_interval(secs => $3), version = version + 1, updated_at = now()
       WHERE id = $1
         AND status IN ('pending', 'active')
         AND (locked_until IS NULL OR locked_until < now())
         AND (next_escalation_at IS NULL OR next_escalation_at <= now())
       RETURNING ${INSTANCE_COLS}`,
      [id, workerId, leaseSeconds],
    );
    return r.rows[0] ?? null;
  }

  // --- preferences ------------------------------------------------------------------------------
  async findSubjectPreference(tx: Tx, subjectId: string, channel: string): Promise<PreferenceRow | null> {
    const r = await tx.query<PreferenceRow>(
      `SELECT ${PREFERENCE_COLS} FROM notification_preference WHERE subject_id = $1 AND channel = $2`,
      [subjectId, channel],
    );
    return r.rows[0] ?? null;
  }

  async findDestinationSuppression(
    tx: Tx,
    destination: string,
    channel: string,
  ): Promise<PreferenceRow | null> {
    const r = await tx.query<PreferenceRow>(
      `SELECT ${PREFERENCE_COLS} FROM notification_preference WHERE destination = $1 AND channel = $2`,
      [destination, channel],
    );
    return r.rows[0] ?? null;
  }

  async listPreferences(tx: Tx, subjectId: string): Promise<PreferenceRow[]> {
    const r = await tx.query<PreferenceRow>(
      `SELECT ${PREFERENCE_COLS} FROM notification_preference WHERE subject_id = $1 ORDER BY channel`,
      [subjectId],
    );
    return r.rows;
  }

  /** Upsert a user channel preference (insert or version-independent overwrite of the settings). */
  async upsertSubjectPreference(
    tx: Tx,
    input: {
      tenantId: string;
      subjectId: string;
      channel: string;
      optIn: boolean;
      suppressed: boolean;
      quietHours: unknown;
      updatedBy: string | null;
    },
  ): Promise<PreferenceRow> {
    const r = await tx.query<PreferenceRow>(
      `INSERT INTO notification_preference
         (tenant_id, subject_id, channel, opt_in, suppressed, quiet_hours, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
       ON CONFLICT (tenant_id, subject_id, channel) WHERE subject_id IS NOT NULL
       DO UPDATE SET opt_in = EXCLUDED.opt_in, suppressed = EXCLUDED.suppressed,
                     quiet_hours = EXCLUDED.quiet_hours, updated_by = EXCLUDED.updated_by,
                     updated_at = now(), version = notification_preference.version + 1
       RETURNING ${PREFERENCE_COLS}`,
      [
        input.tenantId,
        input.subjectId,
        input.channel,
        input.optIn,
        input.suppressed,
        input.quietHours === null ? null : JSON.stringify(input.quietHours),
        input.updatedBy,
      ],
    );
    return firstRow(r.rows, 'upsert subject preference');
  }

  /** Upsert a destination suppression row (administrative or bounce-driven). */
  async upsertDestinationSuppression(
    tx: Tx,
    input: {
      tenantId: string;
      destination: string;
      channel: string;
      suppressed: boolean;
      reason: string | null;
      updatedBy: string | null;
    },
  ): Promise<PreferenceRow> {
    const r = await tx.query<PreferenceRow>(
      `INSERT INTO notification_preference
         (tenant_id, destination, channel, opt_in, suppressed, reason, created_by, updated_by)
       VALUES ($1, $2, $3, true, $4, $5, $6, $6)
       ON CONFLICT (tenant_id, destination, channel) WHERE destination IS NOT NULL
       DO UPDATE SET suppressed = EXCLUDED.suppressed, reason = EXCLUDED.reason,
                     updated_by = EXCLUDED.updated_by, updated_at = now(),
                     version = notification_preference.version + 1
       RETURNING ${PREFERENCE_COLS}`,
      [input.tenantId, input.destination, input.channel, input.suppressed, input.reason, input.updatedBy],
    );
    return firstRow(r.rows, 'upsert destination suppression');
  }

  // --- inbox ------------------------------------------------------------------------------------
  async insertInbox(
    tx: Tx,
    input: {
      tenantId: string;
      recipientId: string;
      requestId: string | null;
      severity: string;
      title: string;
      body: string;
      deepLink: unknown;
      originModule: string | null;
      originEntityType: string | null;
      originEntityId: string | null;
      expiresAt: string | null;
    },
  ): Promise<InboxRow> {
    const r = await tx.query<InboxRow>(
      `INSERT INTO inbox_notification
         (tenant_id, recipient_id, request_id, severity, title, body, deep_link, origin_module,
          origin_entity_type, origin_entity_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       RETURNING ${INBOX_COLS}`,
      [
        input.tenantId,
        input.recipientId,
        input.requestId,
        input.severity,
        input.title,
        input.body,
        input.deepLink === null ? null : JSON.stringify(input.deepLink),
        input.originModule,
        input.originEntityType,
        input.originEntityId,
        input.expiresAt,
      ],
    );
    return firstRow(r.rows, 'insert inbox_notification');
  }

  async findInbox(tx: Tx, id: string): Promise<InboxRow | null> {
    const r = await tx.query<InboxRow>(`SELECT ${INBOX_COLS} FROM inbox_notification WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async listInbox(
    tx: Tx,
    recipientId: string,
    status: string | null,
    limit: number,
    offset: number,
  ): Promise<InboxRow[]> {
    const r = await tx.query<InboxRow>(
      `SELECT ${INBOX_COLS} FROM inbox_notification
       WHERE recipient_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY delivered_at DESC LIMIT $3 OFFSET $4`,
      [recipientId, status, limit, offset],
    );
    return r.rows;
  }

  /** Mark an inbox row read (version-guarded, only the owning recipient's row via RLS + explicit recipient). */
  async markInboxRead(
    tx: Tx,
    id: string,
    recipientId: string,
    expectedVersion: number,
  ): Promise<InboxRow | null> {
    const r = await tx.query<InboxRow>(
      `UPDATE inbox_notification
         SET status = 'read', read_at = now(), version = version + 1
       WHERE id = $1 AND recipient_id = $2 AND version = $3 AND status = 'unread'
       RETURNING ${INBOX_COLS}`,
      [id, recipientId, expectedVersion],
    );
    return r.rows[0] ?? null;
  }
}
