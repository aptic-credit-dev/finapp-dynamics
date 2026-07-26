/**
 * M12 repository — ALL SQL for feedback management. Every query is parameterized; every mutating UPDATE is
 * optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a stale/losing
 * command changes zero rows and the caller reacts. Queries carry NO tenant_id predicate: RLS is the isolation
 * guarantee. All methods take the caller's `Tx` so state, evidence, audit and outbox commit atomically. Answers,
 * contact attempts and assignment history are append-only (INSERT+SELECT by grant); no table grants DELETE.
 */
import type { Tx } from '@finapp/kernel';

export interface SpecRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string;
  readonly scope: string;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly version: number;
}

export interface SourceTransactionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly source_system: string;
  readonly external_transaction_id: string;
  readonly transaction_type: string;
  readonly product: string;
  readonly product_category: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly customer_ref: string;
  readonly status: string;
  readonly idempotency_key: string | null;
  readonly correlation_id: string;
}

export interface FeedbackRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly source_transaction_id: string | null;
  readonly customer_ref: string | null;
  readonly customer_contact: string | null;
  readonly product: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly responsible_officer: string | null;
  readonly channel: string | null;
  readonly feedback_type: string;
  readonly rating: number | null;
  readonly rating_scale: number | null;
  readonly sentiment: string | null;
  readonly category: string | null;
  readonly severity: string | null;
  readonly narrative: string | null;
  readonly csat: string | null;
  readonly nps: number | null;
  readonly questionnaire_code: string | null;
  readonly questionnaire_version: number | null;
  readonly severity_rule_eval_id: string | null;
  readonly sla_policy_code: string | null;
  readonly escalation_ref: string | null;
  readonly current_owner: string | null;
  readonly status: string;
  readonly resolution_status: string | null;
  readonly closure_status: string | null;
  readonly case_handoff_status: string | null;
  readonly customer_confirmed: boolean;
  readonly customer_informed: boolean;
  readonly correlation_id: string;
  readonly idempotency_key: string | null;
  readonly version: number;
}

export interface QueueItemRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly source_transaction_id: string | null;
  readonly feedback_id: string | null;
  readonly product: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly priority: string;
  readonly contact_status: string;
  readonly attempts: number;
  readonly assigned_officer: string | null;
  readonly status: string;
  readonly version: number;
}

export interface ContactAttemptRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly queue_item_id: string | null;
  readonly feedback_id: string | null;
  readonly attempt_number: number;
  readonly officer: string | null;
  readonly outcome: string;
  readonly reached: boolean;
}

export interface ActivityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly feedback_id: string;
  readonly activity_type: string;
  readonly headline: string;
  readonly mandatory: boolean;
  readonly completed: boolean;
  readonly confidentiality: string;
  readonly version: number;
}

export interface ResolutionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly feedback_id: string;
  readonly resolution_type: string | null;
  readonly summary: string | null;
  readonly approval_status: string;
  readonly root_cause_category: string | null;
  readonly response_customer_facing: string | null;
  readonly submitted_by: string | null;
  readonly version: number;
}

export interface SlaInstanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly feedback_id: string;
  readonly sla_policy_code: string;
  readonly sla_policy_version: number;
  readonly started_at: string;
  readonly resolution_due_at: string | null;
  readonly paused_ms: string;
  readonly paused_at: string | null;
  readonly breached: boolean;
  readonly breach_stage: string | null;
  readonly waived: boolean;
  readonly disposition_recorded: boolean;
  readonly version: number;
}

export interface CaseHandoffRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly feedback_id: string;
  readonly recommended_case_type: string | null;
  readonly severity: string | null;
  readonly status: string;
  readonly case_ref: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
}

export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_feedback_id: string;
  readonly to_feedback_id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
}

const SPEC_COLS = 'tenant_id, id, code, version_number, name, scope, status, spec, content_hash, version';
const TXN_COLS =
  'tenant_id, id, source_system, external_transaction_id, transaction_type, product, product_category, branch, department, customer_ref, status, idempotency_key, correlation_id';
const FB_COLS =
  'tenant_id, id, code, source_transaction_id, customer_ref, customer_contact, product, branch, department, ' +
  'responsible_officer, channel, feedback_type, rating, rating_scale, sentiment, category, severity, narrative, ' +
  'csat, nps, questionnaire_code, questionnaire_version, severity_rule_eval_id, sla_policy_code, escalation_ref, ' +
  'current_owner, status, resolution_status, closure_status, case_handoff_status, customer_confirmed, ' +
  'customer_informed, correlation_id, idempotency_key, version';
const QUEUE_COLS =
  'tenant_id, id, source_transaction_id, feedback_id, product, branch, department, priority, contact_status, attempts, assigned_officer, status, version';
const ATTEMPT_COLS = 'tenant_id, id, queue_item_id, feedback_id, attempt_number, officer, outcome, reached';
const ACT_COLS =
  'tenant_id, id, feedback_id, activity_type, headline, mandatory, completed, confidentiality, version';
const RES_COLS =
  'tenant_id, id, feedback_id, resolution_type, summary, approval_status, root_cause_category, response_customer_facing, submitted_by, version';
const SLA_COLS =
  'tenant_id, id, feedback_id, sla_policy_code, sla_policy_version, started_at, resolution_due_at, paused_ms, paused_at, breached, breach_stage, waived, disposition_recorded, version';
const HANDOFF_COLS =
  'tenant_id, id, feedback_id, recommended_case_type, severity, status, case_ref, idempotency_key, version';
const REL_COLS = 'tenant_id, id, from_feedback_id, to_feedback_id, kind, status, version';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m12 repository: expected a row from ${what}`);
  return row;
}

export class FeedbackRepository {
  // --- specs (questionnaire + sla_policy share shape) -------------------------------------------
  private async insertSpec(
    tx: Tx,
    table: string,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ): Promise<SpecRow> {
    const r = await tx.query<SpecRow>(
      `INSERT INTO ${table} (tenant_id, code, version_number, name, scope, spec, created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING ${SPEC_COLS}`,
      [i.tenantId, i.code, i.versionNumber, i.name, i.scope, JSON.stringify(i.spec), i.createdBy],
    );
    return firstRow(r.rows, `insert ${table}`);
  }
  private async nextSpecVersion(tx: Tx, table: string, code: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM ${table} WHERE code=$1`,
      [code],
    );
    return firstRow(r.rows, 'next version').next;
  }
  private async findSpec(tx: Tx, table: string, id: string): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(`SELECT ${SPEC_COLS} FROM ${table} WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  private async findActiveSpec(tx: Tx, table: string, code: string): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(`SELECT ${SPEC_COLS} FROM ${table} WHERE code=$1 AND status='ACTIVE'`, [
      code,
    ]);
    return r.rows[0] ?? null;
  }
  private async updateSpecStatus(
    tx: Tx,
    table: string,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(
      `UPDATE ${table} SET status=$3, content_hash=COALESCE($4,content_hash), published_at=CASE WHEN $3='PUBLISHED' THEN now() ELSE published_at END, published_by=COALESCE($5,published_by), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SPEC_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.contentHash, i.publishedBy],
    );
    return r.rows[0] ?? null;
  }
  private async retireActiveSpec(tx: Tx, table: string, code: string, exceptId: string): Promise<void> {
    await tx.query(
      `UPDATE ${table} SET status='RETIRED', version=version+1 WHERE code=$1 AND status='ACTIVE' AND id<>$2`,
      [code, exceptId],
    );
  }
  insertQuestionnaire(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ) {
    return this.insertSpec(tx, 'feedback_questionnaire', i);
  }
  nextQuestionnaireVersion(tx: Tx, code: string) {
    return this.nextSpecVersion(tx, 'feedback_questionnaire', code);
  }
  findQuestionnaire(tx: Tx, id: string) {
    return this.findSpec(tx, 'feedback_questionnaire', id);
  }
  findActiveQuestionnaire(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'feedback_questionnaire', code);
  }
  updateQuestionnaireStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'feedback_questionnaire', i);
  }
  retireActiveQuestionnaires(tx: Tx, code: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'feedback_questionnaire', code, exceptId);
  }
  insertSlaPolicy(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ) {
    return this.insertSpec(tx, 'feedback_sla_policy', i);
  }
  nextSlaPolicyVersion(tx: Tx, code: string) {
    return this.nextSpecVersion(tx, 'feedback_sla_policy', code);
  }
  findSlaPolicy(tx: Tx, id: string) {
    return this.findSpec(tx, 'feedback_sla_policy', id);
  }
  findActiveSlaPolicy(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'feedback_sla_policy', code);
  }
  updateSlaPolicyStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'feedback_sla_policy', i);
  }
  retireActiveSlaPolicies(tx: Tx, code: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'feedback_sla_policy', code, exceptId);
  }

  // --- source system + category (simple config) -------------------------------------------------
  async upsertSourceSystem(
    tx: Tx,
    i: { tenantId: string; code: string; name: string; active: boolean; by: string | null },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO feedback_source_system (tenant_id, code, name, active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now(), version=feedback_source_system.version+1`,
      [i.tenantId, i.code, i.name, i.active, i.by],
    );
  }
  async findSourceSystem(tx: Tx, code: string): Promise<{ code: string; active: boolean } | null> {
    const r = await tx.query<{ code: string; active: boolean }>(
      `SELECT code, active FROM feedback_source_system WHERE code=$1`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  async upsertCategory(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string;
      defaultSentiment: string | null;
      active: boolean;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO feedback_category (tenant_id, code, name, default_sentiment, active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, default_sentiment=EXCLUDED.default_sentiment, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now(), version=feedback_category.version+1`,
      [i.tenantId, i.code, i.name, i.defaultSentiment, i.active, i.by],
    );
  }

  // --- source transaction (ingestion) -----------------------------------------------------------
  async insertSourceTransaction(
    tx: Tx,
    i: {
      tenantId: string;
      sourceSystem: string;
      externalTransactionId: string;
      transactionType: string;
      product: string;
      productCategory: string | null;
      branch: string | null;
      department: string | null;
      relationshipOfficer: string | null;
      transactionDate: string | null;
      amountMinor: number | null;
      currency: string | null;
      customerRef: string;
      transactionStatus: string | null;
      payloadHash: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SourceTransactionRow> {
    const r = await tx.query<SourceTransactionRow>(
      `INSERT INTO feedback_source_transaction (tenant_id, source_system, external_transaction_id, transaction_type, product, product_category, branch, department, relationship_officer, transaction_date, amount_minor, currency, customer_ref, transaction_status, payload_hash, idempotency_key, correlation_id, ingested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${TXN_COLS}`,
      [
        i.tenantId,
        i.sourceSystem,
        i.externalTransactionId,
        i.transactionType,
        i.product,
        i.productCategory,
        i.branch,
        i.department,
        i.relationshipOfficer,
        i.transactionDate,
        i.amountMinor,
        i.currency,
        i.customerRef,
        i.transactionStatus,
        i.payloadHash,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert source transaction');
  }
  async findSourceTransaction(tx: Tx, id: string): Promise<SourceTransactionRow | null> {
    const r = await tx.query<SourceTransactionRow>(
      `SELECT ${TXN_COLS} FROM feedback_source_transaction WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findSourceTransactionByExternal(
    tx: Tx,
    sourceSystem: string,
    externalId: string,
  ): Promise<SourceTransactionRow | null> {
    const r = await tx.query<SourceTransactionRow>(
      `SELECT ${TXN_COLS} FROM feedback_source_transaction WHERE source_system=$1 AND external_transaction_id=$2`,
      [sourceSystem, externalId],
    );
    return r.rows[0] ?? null;
  }
  async setSourceTransactionStatus(tx: Tx, id: string, status: string): Promise<void> {
    await tx.query(`UPDATE feedback_source_transaction SET status=$2 WHERE id=$1`, [id, status]);
  }

  // --- queue ------------------------------------------------------------------------------------
  async insertQueueItem(
    tx: Tx,
    i: {
      tenantId: string;
      sourceTransactionId: string | null;
      product: string | null;
      branch: string | null;
      department: string | null;
      priority: string;
      preferredChannel: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<QueueItemRow> {
    const r = await tx.query<QueueItemRow>(
      `INSERT INTO feedback_queue_item (tenant_id, source_transaction_id, product, branch, department, priority, preferred_channel, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${QUEUE_COLS}`,
      [
        i.tenantId,
        i.sourceTransactionId,
        i.product,
        i.branch,
        i.department,
        i.priority,
        i.preferredChannel,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert queue item');
  }
  async findQueueItem(tx: Tx, id: string): Promise<QueueItemRow | null> {
    const r = await tx.query<QueueItemRow>(`SELECT ${QUEUE_COLS} FROM feedback_queue_item WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  /** Compare-and-set claim: only an unclaimed OPEN item can be claimed — single-winner under contention. */
  async claimQueueItem(tx: Tx, id: string, officer: string): Promise<QueueItemRow | null> {
    const r = await tx.query<QueueItemRow>(
      `UPDATE feedback_queue_item SET assigned_officer=$2, status='claimed', contact_status='claimed', locked_by=$2, locked_until=now()+make_interval(secs=>900), version=version+1, updated_at=now() WHERE id=$1 AND status='open' AND assigned_officer IS NULL RETURNING ${QUEUE_COLS}`,
      [id, officer],
    );
    return r.rows[0] ?? null;
  }
  async listQueue(
    tx: Tx,
    f: { status?: string; branch?: string; department?: string; limit: number; offset: number },
  ): Promise<QueueItemRow[]> {
    const r = await tx.query<QueueItemRow>(
      `SELECT ${QUEUE_COLS} FROM feedback_queue_item WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR branch=$2) AND ($3::text IS NULL OR department=$3) ORDER BY created_at LIMIT $4 OFFSET $5`,
      [f.status ?? null, f.branch ?? null, f.department ?? null, f.limit, f.offset],
    );
    return r.rows;
  }
  async bumpQueueAttempt(
    tx: Tx,
    id: string,
    expectedVersion: number,
    outcome: string,
  ): Promise<QueueItemRow | null> {
    const r = await tx.query<QueueItemRow>(
      `UPDATE feedback_queue_item SET attempts=attempts+1, last_attempt_at=now(), contact_status=$3, status=CASE WHEN $3 IN ('completed','declined') THEN 'done' ELSE status END, version=version+1, updated_at=now() WHERE id=$1 AND version=$2 RETURNING ${QUEUE_COLS}`,
      [id, expectedVersion, outcome],
    );
    return r.rows[0] ?? null;
  }

  // --- contact attempts (append-only) -----------------------------------------------------------
  async nextAttemptNumber(tx: Tx, queueItemId: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(attempt_number),0)+1 AS next FROM feedback_contact_attempt WHERE queue_item_id=$1`,
      [queueItemId],
    );
    return firstRow(r.rows, 'next attempt').next;
  }
  async insertContactAttempt(
    tx: Tx,
    i: {
      tenantId: string;
      queueItemId: string | null;
      feedbackId: string | null;
      attemptNumber: number;
      officer: string | null;
      channel: string | null;
      outcome: string;
      reached: boolean;
      callbackRequested: boolean;
      nextContactAt: string | null;
      failureCategory: string | null;
      identityVerified: boolean | null;
      notes: string | null;
      correlationId: string;
    },
  ): Promise<ContactAttemptRow> {
    const r = await tx.query<ContactAttemptRow>(
      `INSERT INTO feedback_contact_attempt (tenant_id, queue_item_id, feedback_id, attempt_number, officer, channel, completed_at, outcome, reached, callback_requested, next_contact_at, failure_category, identity_verified, notes, correlation_id) VALUES ($1,$2,$3,$4,$5,$6, now(), $7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${ATTEMPT_COLS}`,
      [
        i.tenantId,
        i.queueItemId,
        i.feedbackId,
        i.attemptNumber,
        i.officer,
        i.channel,
        i.outcome,
        i.reached,
        i.callbackRequested,
        i.nextContactAt,
        i.failureCategory,
        i.identityVerified,
        i.notes,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert contact attempt');
  }
  async listContactAttempts(tx: Tx, queueItemId: string): Promise<ContactAttemptRow[]> {
    const r = await tx.query<ContactAttemptRow>(
      `SELECT ${ATTEMPT_COLS} FROM feedback_contact_attempt WHERE queue_item_id=$1 ORDER BY attempt_number`,
      [queueItemId],
    );
    return r.rows;
  }

  // --- feedback record --------------------------------------------------------------------------
  async insertFeedback(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      sourceTransactionId: string | null;
      customerRef: string | null;
      customerContact: string | null;
      product: string | null;
      branch: string | null;
      department: string | null;
      responsibleOfficer: string | null;
      channel: string | null;
      feedbackType: string;
      narrative: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      originModule: string | null;
      by: string | null;
    },
  ): Promise<FeedbackRow> {
    const r = await tx.query<FeedbackRow>(
      `INSERT INTO feedback_record (tenant_id, code, source_transaction_id, customer_ref, customer_contact, product, branch, department, responsible_officer, channel, feedback_type, narrative, idempotency_key, correlation_id, causation_id, origin_module, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING ${FB_COLS}`,
      [
        i.tenantId,
        i.code,
        i.sourceTransactionId,
        i.customerRef,
        i.customerContact,
        i.product,
        i.branch,
        i.department,
        i.responsibleOfficer,
        i.channel,
        i.feedbackType,
        i.narrative,
        i.idempotencyKey,
        i.correlationId,
        i.causationId,
        i.originModule,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert feedback');
  }
  async findFeedback(tx: Tx, id: string): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(`SELECT ${FB_COLS} FROM feedback_record WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findFeedbackByIdempotencyKey(tx: Tx, key: string): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(`SELECT ${FB_COLS} FROM feedback_record WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async updateFeedbackStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(
      `UPDATE feedback_record SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${FB_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async captureFeedback(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      rating: number | null;
      ratingScale: number | null;
      csat: number | null;
      nps: number | null;
      questionnaireCode: string | null;
      questionnaireVersion: number | null;
      narrative: string | null;
      channel: string | null;
      feedbackType: string;
      by: string | null;
    },
  ): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(
      `UPDATE feedback_record SET rating=$3, rating_scale=$4, csat=$5, nps=$6, questionnaire_code=$7, questionnaire_version=$8, narrative=COALESCE($9, narrative), channel=COALESCE($10, channel), feedback_type=$11, status='feedback_captured', feedback_at=now(), updated_by=$12, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${FB_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.rating,
        i.ratingScale,
        i.csat,
        i.nps,
        i.questionnaireCode,
        i.questionnaireVersion,
        i.narrative,
        i.channel,
        i.feedbackType,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async classifyFeedback(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      sentiment: string;
      category: string | null;
      subcategory: string | null;
      severity: string;
      ruleEvalId: string | null;
      by: string | null;
    },
  ): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(
      `UPDATE feedback_record SET sentiment=$3, category=$4, subcategory=$5, severity=$6, severity_rule_eval_id=$7, updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${FB_COLS}`,
      [i.id, i.expectedVersion, i.sentiment, i.category, i.subcategory, i.severity, i.ruleEvalId, i.by],
    );
    return r.rows[0] ?? null;
  }
  async assignFeedback(
    tx: Tx,
    i: { id: string; expectedVersion: number; owner: string; toStatus: string; by: string | null },
  ): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(
      `UPDATE feedback_record SET current_owner=$3, status=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${FB_COLS}`,
      [i.id, i.expectedVersion, i.owner, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async patchFeedback(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      slaPolicyCode?: string | null;
      escalationRef?: string | null;
      resolutionStatus?: string | null;
      closureStatus?: string | null;
      caseHandoffStatus?: string | null;
      customerInformed?: boolean | null;
      customerConfirmed?: boolean | null;
      by: string | null;
    },
  ): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(
      `UPDATE feedback_record SET sla_policy_code=COALESCE($3, sla_policy_code), escalation_ref=COALESCE($4, escalation_ref), resolution_status=COALESCE($5, resolution_status), closure_status=COALESCE($6, closure_status), case_handoff_status=COALESCE($7, case_handoff_status), customer_informed=COALESCE($8, customer_informed), customer_confirmed=COALESCE($9, customer_confirmed), updated_by=$10, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${FB_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.slaPolicyCode ?? null,
        i.escalationRef ?? null,
        i.resolutionStatus ?? null,
        i.closureStatus ?? null,
        i.caseHandoffStatus ?? null,
        i.customerInformed ?? null,
        i.customerConfirmed ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async searchFeedback(
    tx: Tx,
    f: {
      product?: string;
      branch?: string;
      department?: string;
      status?: string;
      sentiment?: string;
      severity?: string;
      category?: string;
      limit: number;
      offset: number;
    },
  ): Promise<FeedbackRow[]> {
    const r = await tx.query<FeedbackRow>(
      `SELECT ${FB_COLS} FROM feedback_record WHERE ($1::text IS NULL OR product=$1) AND ($2::text IS NULL OR branch=$2) AND ($3::text IS NULL OR department=$3) AND ($4::text IS NULL OR status=$4) AND ($5::text IS NULL OR sentiment=$5) AND ($6::text IS NULL OR severity=$6) AND ($7::text IS NULL OR category=$7) ORDER BY created_at DESC LIMIT $8 OFFSET $9`,
      [
        f.product ?? null,
        f.branch ?? null,
        f.department ?? null,
        f.status ?? null,
        f.sentiment ?? null,
        f.severity ?? null,
        f.category ?? null,
        f.limit,
        f.offset,
      ],
    );
    return r.rows;
  }
  /** Safe aggregate analytics — counts by a bounded dimension. No raw SQL input; deterministic. */
  async analyticsByDimension(
    tx: Tx,
    dimension: 'product' | 'branch' | 'department' | 'sentiment' | 'severity' | 'category' | 'status',
  ): Promise<{ dim: string | null; count: string }[]> {
    const col = {
      product: 'product',
      branch: 'branch',
      department: 'department',
      sentiment: 'sentiment',
      severity: 'severity',
      category: 'category',
      status: 'status',
    }[dimension];
    const r = await tx.query<{ dim: string | null; count: string }>(
      `SELECT ${col} AS dim, count(*)::text AS count FROM feedback_record GROUP BY ${col} ORDER BY count DESC`,
    );
    return r.rows;
  }

  // --- answers (append-only) --------------------------------------------------------------------
  async insertAnswer(
    tx: Tx,
    i: {
      tenantId: string;
      feedbackId: string;
      questionKey: string;
      answerType: string;
      valueText: string | null;
      valueNumber: number | null;
      valueBool: boolean | null;
      valueChoices: unknown;
      questionnaireCode: string;
      questionnaireVersion: number;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO feedback_answer (tenant_id, feedback_id, question_key, answer_type, value_text, value_number, value_bool, value_choices, questionnaire_code, questionnaire_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        i.tenantId,
        i.feedbackId,
        i.questionKey,
        i.answerType,
        i.valueText,
        i.valueNumber,
        i.valueBool,
        i.valueChoices === null ? null : JSON.stringify(i.valueChoices),
        i.questionnaireCode,
        i.questionnaireVersion,
      ],
    );
  }

  // --- assignment history (append-only) ---------------------------------------------------------
  async insertAssignment(
    tx: Tx,
    i: {
      tenantId: string;
      feedbackId: string;
      kind: string;
      ref: string;
      by: string | null;
      reason: string | null;
      ruleEvalId: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO feedback_assignment_history (tenant_id, feedback_id, assigned_to_kind, assigned_to_ref, assigned_by, reason, rule_eval_id, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.feedbackId, i.kind, i.ref, i.by, i.reason, i.ruleEvalId, i.correlationId],
    );
  }

  // --- activities -------------------------------------------------------------------------------
  async insertActivity(
    tx: Tx,
    i: {
      tenantId: string;
      feedbackId: string;
      activityType: string;
      headline: string;
      description: string | null;
      dueAt: string | null;
      assignedTo: string | null;
      mandatory: boolean;
      confidentiality: string;
      documentRefs: unknown;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ActivityRow> {
    const r = await tx.query<ActivityRow>(
      `INSERT INTO feedback_activity (tenant_id, feedback_id, activity_type, headline, description, due_at, assigned_to, mandatory, confidentiality, document_refs, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING ${ACT_COLS}`,
      [
        i.tenantId,
        i.feedbackId,
        i.activityType,
        i.headline,
        i.description,
        i.dueAt,
        i.assignedTo,
        i.mandatory,
        i.confidentiality,
        i.documentRefs === null ? null : JSON.stringify(i.documentRefs),
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert activity');
  }
  async findActivity(tx: Tx, id: string): Promise<ActivityRow | null> {
    const r = await tx.query<ActivityRow>(`SELECT ${ACT_COLS} FROM feedback_activity WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async completeActivity(
    tx: Tx,
    i: { id: string; expectedVersion: number; outcome: string | null },
  ): Promise<ActivityRow | null> {
    const r = await tx.query<ActivityRow>(
      `UPDATE feedback_activity SET completed=true, completed_at=now(), outcome=$3, version=version+1 WHERE id=$1 AND version=$2 AND completed=false RETURNING ${ACT_COLS}`,
      [i.id, i.expectedVersion, i.outcome],
    );
    return r.rows[0] ?? null;
  }
  async listActivities(tx: Tx, feedbackId: string): Promise<ActivityRow[]> {
    const r = await tx.query<ActivityRow>(
      `SELECT ${ACT_COLS} FROM feedback_activity WHERE feedback_id=$1 ORDER BY created_at`,
      [feedbackId],
    );
    return r.rows;
  }
  async countOpenMandatoryActivities(tx: Tx, feedbackId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM feedback_activity WHERE feedback_id=$1 AND mandatory=true AND completed=false`,
      [feedbackId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }

  // --- resolution -------------------------------------------------------------------------------
  async upsertResolution(
    tx: Tx,
    i: {
      tenantId: string;
      feedbackId: string;
      resolutionType: string | null;
      summary: string | null;
      actionTaken: string | null;
      responsibleParty: string | null;
      responsibleDepartment: string | null;
      investigationFindings: string | null;
      rootCauseCategory: string | null;
      correctiveAction: string | null;
      preventiveAction: string | null;
      responseConfidential: string | null;
      responseCustomerFacing: string | null;
      submittedBy: string | null;
    },
  ): Promise<ResolutionRow> {
    const r = await tx.query<ResolutionRow>(
      `INSERT INTO feedback_resolution (tenant_id, feedback_id, resolution_type, summary, action_taken, responsible_party, responsible_department, investigation_findings, root_cause_category, corrective_action, preventive_action, response_confidential, response_customer_facing, submitted_by, submitted_at, approval_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), 'proposed') ON CONFLICT (tenant_id, feedback_id) DO UPDATE SET resolution_type=EXCLUDED.resolution_type, summary=EXCLUDED.summary, action_taken=EXCLUDED.action_taken, responsible_party=EXCLUDED.responsible_party, responsible_department=EXCLUDED.responsible_department, investigation_findings=EXCLUDED.investigation_findings, root_cause_category=EXCLUDED.root_cause_category, corrective_action=EXCLUDED.corrective_action, preventive_action=EXCLUDED.preventive_action, response_confidential=EXCLUDED.response_confidential, response_customer_facing=EXCLUDED.response_customer_facing, submitted_by=EXCLUDED.submitted_by, submitted_at=now(), approval_status='proposed', version=feedback_resolution.version+1 RETURNING ${RES_COLS}`,
      [
        i.tenantId,
        i.feedbackId,
        i.resolutionType,
        i.summary,
        i.actionTaken,
        i.responsibleParty,
        i.responsibleDepartment,
        i.investigationFindings,
        i.rootCauseCategory,
        i.correctiveAction,
        i.preventiveAction,
        i.responseConfidential,
        i.responseCustomerFacing,
        i.submittedBy,
      ],
    );
    return firstRow(r.rows, 'upsert resolution');
  }
  async findResolution(tx: Tx, feedbackId: string): Promise<ResolutionRow | null> {
    const r = await tx.query<ResolutionRow>(
      `SELECT ${RES_COLS} FROM feedback_resolution WHERE feedback_id=$1`,
      [feedbackId],
    );
    return r.rows[0] ?? null;
  }
  async setResolutionApproval(
    tx: Tx,
    i: { id: string; expectedVersion: number; approval: string; approvedBy: string | null },
  ): Promise<ResolutionRow | null> {
    const r = await tx.query<ResolutionRow>(
      `UPDATE feedback_resolution SET approval_status=$3, approved_by=$4, approved_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RES_COLS}`,
      [i.id, i.expectedVersion, i.approval, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }

  // --- sla instance -----------------------------------------------------------------------------
  async insertSlaInstance(
    tx: Tx,
    i: {
      tenantId: string;
      feedbackId: string;
      policyCode: string;
      policyVersion: number;
      startedAt: string;
      ackDueAt: string;
      assignDueAt: string;
      responseDueAt: string;
      resolutionDueAt: string;
      closureDueAt: string;
    },
  ): Promise<SlaInstanceRow> {
    const r = await tx.query<SlaInstanceRow>(
      `INSERT INTO feedback_sla_instance (tenant_id, feedback_id, sla_policy_code, sla_policy_version, started_at, ack_due_at, assign_due_at, response_due_at, resolution_due_at, closure_due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${SLA_COLS}`,
      [
        i.tenantId,
        i.feedbackId,
        i.policyCode,
        i.policyVersion,
        i.startedAt,
        i.ackDueAt,
        i.assignDueAt,
        i.responseDueAt,
        i.resolutionDueAt,
        i.closureDueAt,
      ],
    );
    return firstRow(r.rows, 'insert sla instance');
  }
  async findSlaInstance(tx: Tx, feedbackId: string): Promise<SlaInstanceRow | null> {
    const r = await tx.query<SlaInstanceRow>(
      `SELECT ${SLA_COLS} FROM feedback_sla_instance WHERE feedback_id=$1`,
      [feedbackId],
    );
    return r.rows[0] ?? null;
  }
  async pauseSla(
    tx: Tx,
    i: { id: string; expectedVersion: number; reason: string },
  ): Promise<SlaInstanceRow | null> {
    const r = await tx.query<SlaInstanceRow>(
      `UPDATE feedback_sla_instance SET paused_at=now(), pause_reason=$3, version=version+1 WHERE id=$1 AND version=$2 AND paused_at IS NULL RETURNING ${SLA_COLS}`,
      [i.id, i.expectedVersion, i.reason],
    );
    return r.rows[0] ?? null;
  }
  async resumeSla(
    tx: Tx,
    i: { id: string; expectedVersion: number; addPausedMs: number },
  ): Promise<SlaInstanceRow | null> {
    const r = await tx.query<SlaInstanceRow>(
      `UPDATE feedback_sla_instance SET paused_at=NULL, pause_reason=NULL, paused_ms=paused_ms+$3, version=version+1 WHERE id=$1 AND version=$2 AND paused_at IS NOT NULL RETURNING ${SLA_COLS}`,
      [i.id, i.expectedVersion, i.addPausedMs],
    );
    return r.rows[0] ?? null;
  }
  async markSlaBreach(
    tx: Tx,
    i: { id: string; expectedVersion: number; stage: string },
  ): Promise<SlaInstanceRow | null> {
    const r = await tx.query<SlaInstanceRow>(
      `UPDATE feedback_sla_instance SET breached=true, breach_stage=$3, breach_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND breached=false RETURNING ${SLA_COLS}`,
      [i.id, i.expectedVersion, i.stage],
    );
    return r.rows[0] ?? null;
  }
  async setSlaDisposition(tx: Tx, feedbackId: string): Promise<void> {
    await tx.query(
      `UPDATE feedback_sla_instance SET disposition_recorded=true, version=version+1 WHERE feedback_id=$1`,
      [feedbackId],
    );
  }

  // --- case handoff -----------------------------------------------------------------------------
  async insertHandoff(
    tx: Tx,
    i: {
      tenantId: string;
      feedbackId: string;
      recommendedCaseType: string | null;
      severity: string | null;
      category: string | null;
      summary: string | null;
      customerRef: string | null;
      product: string | null;
      sourceTransactionId: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CaseHandoffRow> {
    const r = await tx.query<CaseHandoffRow>(
      `INSERT INTO feedback_case_handoff (tenant_id, feedback_id, recommended_case_type, severity, category, summary, customer_ref, product, source_transaction_id, idempotency_key, correlation_id, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${HANDOFF_COLS}`,
      [
        i.tenantId,
        i.feedbackId,
        i.recommendedCaseType,
        i.severity,
        i.category,
        i.summary,
        i.customerRef,
        i.product,
        i.sourceTransactionId,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert handoff');
  }
  async findHandoff(tx: Tx, id: string): Promise<CaseHandoffRow | null> {
    const r = await tx.query<CaseHandoffRow>(
      `SELECT ${HANDOFF_COLS} FROM feedback_case_handoff WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findHandoffByIdempotencyKey(tx: Tx, key: string): Promise<CaseHandoffRow | null> {
    const r = await tx.query<CaseHandoffRow>(
      `SELECT ${HANDOFF_COLS} FROM feedback_case_handoff WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async completeHandoff(
    tx: Tx,
    i: { id: string; expectedVersion: number; caseRef: string },
  ): Promise<CaseHandoffRow | null> {
    const r = await tx.query<CaseHandoffRow>(
      `UPDATE feedback_case_handoff SET status='completed', case_ref=$3, completed_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='pending' RETURNING ${HANDOFF_COLS}`,
      [i.id, i.expectedVersion, i.caseRef],
    );
    return r.rows[0] ?? null;
  }

  // --- relationships ----------------------------------------------------------------------------
  async insertRelationship(
    tx: Tx,
    i: { tenantId: string; fromId: string; toId: string; kind: string; by: string | null },
  ): Promise<RelationshipRow> {
    const r = await tx.query<RelationshipRow>(
      `INSERT INTO feedback_relationship (tenant_id, from_feedback_id, to_feedback_id, kind, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING ${REL_COLS}`,
      [i.tenantId, i.fromId, i.toId, i.kind, i.by],
    );
    return firstRow(r.rows, 'insert relationship');
  }
  async listRelationships(tx: Tx, feedbackId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM feedback_relationship WHERE (from_feedback_id=$1 OR to_feedback_id=$1) AND status='active' ORDER BY created_at`,
      [feedbackId],
    );
    return r.rows;
  }
}
