/**
 * M28 repository — ALL SQL for the executive-copilot layer across its 7 tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`). Queries carry
 * NO tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Citations, feedback
 * and the idempotency ledger are append-only. Confidence is an INTEGER basis-points score. The full question/answer text
 * is NEVER stored — only OPAQUE m09 references (question_ref / answer_ref) and OPAQUE m24 ids (ai_request_ref /
 * ai_output_ref). There is no cross-module FK.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m28 repository: expected a row from ${what}`);
  return row;
}

export interface ConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly read_only: boolean;
  readonly citations_required: boolean;
  readonly require_human_review_for_export: boolean;
  readonly min_confidence_bps: number;
  readonly max_sources: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface SessionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope_level: string;
  readonly subject_label: string | null;
  readonly classification: string;
  readonly status: string;
  readonly query_count: number;
  readonly version: number;
  readonly correlation_id: string;
}
export interface QueryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly session_id: string;
  readonly intent_class: string;
  readonly scope_level: string;
  readonly classification: string;
  readonly question_ref: string | null;
  readonly read_only: boolean;
  readonly status: string;
  readonly confidence_bps: number;
  readonly source_count: number;
  readonly refusal_reason_code: string | null;
  readonly ai_request_ref: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ResponseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly query_id: string;
  readonly answer_ref: string | null;
  readonly ai_output_ref: string | null;
  readonly status: string;
  readonly confidence_bps: number;
  readonly citation_count: number;
  readonly citations_required: boolean;
  readonly review_required: boolean;
  readonly reason_code: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface CitationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly response_id: string;
  readonly source_type: string;
  readonly source_module: string;
  readonly record_ref: string | null;
  readonly document_ref: string | null;
  readonly document_version: string | null;
  readonly location: string | null;
  readonly confidence_bps: number;
  readonly entitlement_result: string;
  readonly correlation_id: string;
}
export interface FeedbackRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly response_id: string;
  readonly rating: string;
  readonly reason_code: string | null;
  readonly comment_ref: string | null;
  readonly by_user: string;
  readonly correlation_id: string;
}

const CONFIG_COLS = `tenant_id, id, scope, version_number, status, read_only, citations_required, require_human_review_for_export, min_confidence_bps, max_sources, idempotency_key, version, correlation_id`;
const SESSION_COLS = `tenant_id, id, scope_level, subject_label, classification, status, query_count, version, correlation_id`;
const QUERY_COLS = `tenant_id, id, session_id, intent_class, scope_level, classification, question_ref, read_only, status, confidence_bps, source_count, refusal_reason_code, ai_request_ref, idempotency_key, version, correlation_id`;
const RESPONSE_COLS = `tenant_id, id, query_id, answer_ref, ai_output_ref, status, confidence_bps, citation_count, citations_required, review_required, reason_code, version, correlation_id`;
const CITATION_COLS = `tenant_id, id, response_id, source_type, source_module, record_ref, document_ref, document_version, location, confidence_bps, entitlement_result, correlation_id`;
const FEEDBACK_COLS = `tenant_id, id, response_id, rating, reason_code, comment_ref, by_user, correlation_id`;

export class ExecutiveAiRepository {
  // --- config -----------------------------------------------------------------------------------
  async insertConfig(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      name: string | null;
      minConfidenceBps: number;
      maxSources: number;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConfigRow> {
    const r = await tx.query<ConfigRow>(
      `INSERT INTO copilot_config (tenant_id, scope, name, min_confidence_bps, max_sources, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${CONFIG_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.name,
        i.minConfidenceBps,
        i.maxSources,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM copilot_config WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async findActiveConfig(tx: Tx, scope: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM copilot_config WHERE scope=$1 AND status='active'`,
      [scope],
    );
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE copilot_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<ConfigRow[]> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM copilot_config ORDER BY scope, version_number`,
    );
    return r.rows;
  }

  // --- session ----------------------------------------------------------------------------------
  async insertSession(
    tx: Tx,
    i: {
      tenantId: string;
      scopeLevel: string;
      subjectLabel: string | null;
      classification: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SessionRow> {
    const r = await tx.query<SessionRow>(
      `INSERT INTO copilot_session (tenant_id, scope_level, subject_label, classification, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${SESSION_COLS}`,
      [i.tenantId, i.scopeLevel, i.subjectLabel, i.classification, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert session');
  }
  async findSession(tx: Tx, id: string): Promise<SessionRow | null> {
    const r = await tx.query<SessionRow>(`SELECT ${SESSION_COLS} FROM copilot_session WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findSessionByIdempotencyKey(tx: Tx, key: string): Promise<SessionRow | null> {
    const r = await tx.query<SessionRow>(
      `SELECT ${SESSION_COLS} FROM copilot_session WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async bumpSessionQueryCount(tx: Tx, id: string, by: string | null): Promise<void> {
    await tx.query(
      `UPDATE copilot_session SET query_count=query_count+1, updated_by=$2, updated_at=now(), version=version+1 WHERE id=$1`,
      [id, by],
    );
  }
  async listSessions(tx: Tx, limit: number, offset: number): Promise<SessionRow[]> {
    const r = await tx.query<SessionRow>(
      `SELECT ${SESSION_COLS} FROM copilot_session ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  // --- query ------------------------------------------------------------------------------------
  async insertQuery(
    tx: Tx,
    i: {
      tenantId: string;
      sessionId: string;
      intentClass: string;
      scopeLevel: string;
      classification: string;
      questionRef: string | null;
      status: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<QueryRow> {
    const r = await tx.query<QueryRow>(
      `INSERT INTO copilot_query (tenant_id, session_id, intent_class, scope_level, classification, question_ref, status, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${QUERY_COLS}`,
      [
        i.tenantId,
        i.sessionId,
        i.intentClass,
        i.scopeLevel,
        i.classification,
        i.questionRef,
        i.status,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert query');
  }
  async findQuery(tx: Tx, id: string): Promise<QueryRow | null> {
    const r = await tx.query<QueryRow>(`SELECT ${QUERY_COLS} FROM copilot_query WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findQueryByIdempotencyKey(tx: Tx, key: string): Promise<QueryRow | null> {
    const r = await tx.query<QueryRow>(`SELECT ${QUERY_COLS} FROM copilot_query WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async updateQuery(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      confidenceBps?: number | null;
      sourceCount?: number | null;
      refusalReasonCode?: string | null;
      aiRequestRef?: string | null;
      by: string | null;
    },
  ): Promise<QueryRow | null> {
    const r = await tx.query<QueryRow>(
      `UPDATE copilot_query SET status=$3, confidence_bps=COALESCE($4, confidence_bps), source_count=COALESCE($5, source_count), refusal_reason_code=COALESCE($6, refusal_reason_code), ai_request_ref=COALESCE($7, ai_request_ref), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${QUERY_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.confidenceBps ?? null,
        i.sourceCount ?? null,
        i.refusalReasonCode ?? null,
        i.aiRequestRef ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listQueries(tx: Tx, sessionId: string | null, limit: number, offset: number): Promise<QueryRow[]> {
    if (sessionId !== null) {
      const r = await tx.query<QueryRow>(
        `SELECT ${QUERY_COLS} FROM copilot_query WHERE session_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [sessionId, limit, offset],
      );
      return r.rows;
    }
    const r = await tx.query<QueryRow>(
      `SELECT ${QUERY_COLS} FROM copilot_query ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  // --- response ---------------------------------------------------------------------------------
  async insertResponse(
    tx: Tx,
    i: {
      tenantId: string;
      queryId: string;
      answerRef: string | null;
      aiOutputRef: string | null;
      confidenceBps: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ResponseRow> {
    const r = await tx.query<ResponseRow>(
      `INSERT INTO copilot_response (tenant_id, query_id, answer_ref, ai_output_ref, confidence_bps, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${RESPONSE_COLS}`,
      [i.tenantId, i.queryId, i.answerRef, i.aiOutputRef, i.confidenceBps, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert response');
  }
  async findResponse(tx: Tx, id: string): Promise<ResponseRow | null> {
    const r = await tx.query<ResponseRow>(`SELECT ${RESPONSE_COLS} FROM copilot_response WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findResponseByQuery(tx: Tx, queryId: string): Promise<ResponseRow | null> {
    const r = await tx.query<ResponseRow>(`SELECT ${RESPONSE_COLS} FROM copilot_response WHERE query_id=$1`, [
      queryId,
    ]);
    return r.rows[0] ?? null;
  }
  async updateResponse(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      citationCount?: number | null;
      reviewRequired?: boolean | null;
      reasonCode?: string | null;
      by: string | null;
    },
  ): Promise<ResponseRow | null> {
    const r = await tx.query<ResponseRow>(
      `UPDATE copilot_response SET status=$3, citation_count=COALESCE($4, citation_count), review_required=COALESCE($5, review_required), reason_code=COALESCE($6, reason_code), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RESPONSE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.citationCount ?? null,
        i.reviewRequired ?? null,
        i.reasonCode ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }

  // --- citation (append-only) -------------------------------------------------------------------
  async insertCitation(
    tx: Tx,
    i: {
      tenantId: string;
      responseId: string;
      sourceType: string;
      sourceModule: string;
      recordRef: string | null;
      documentRef: string | null;
      documentVersion: string | null;
      location: string | null;
      confidenceBps: number;
      by: string | null;
      correlationId: string;
    },
  ): Promise<CitationRow> {
    const r = await tx.query<CitationRow>(
      `INSERT INTO copilot_citation (tenant_id, response_id, source_type, source_module, record_ref, document_ref, document_version, location, confidence_bps, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${CITATION_COLS}`,
      [
        i.tenantId,
        i.responseId,
        i.sourceType,
        i.sourceModule,
        i.recordRef,
        i.documentRef,
        i.documentVersion,
        i.location,
        i.confidenceBps,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert citation');
  }
  async listCitations(tx: Tx, responseId: string): Promise<CitationRow[]> {
    const r = await tx.query<CitationRow>(
      `SELECT ${CITATION_COLS} FROM copilot_citation WHERE response_id=$1 ORDER BY created_at`,
      [responseId],
    );
    return r.rows;
  }

  // --- feedback (append-only) -------------------------------------------------------------------
  async insertFeedback(
    tx: Tx,
    i: {
      tenantId: string;
      responseId: string;
      rating: string;
      reasonCode: string | null;
      commentRef: string | null;
      byUser: string;
      idempotencyKey: string | null;
      correlationId: string;
    },
  ): Promise<FeedbackRow> {
    const r = await tx.query<FeedbackRow>(
      `INSERT INTO copilot_feedback (tenant_id, response_id, rating, reason_code, comment_ref, by_user, idempotency_key, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${FEEDBACK_COLS}`,
      [
        i.tenantId,
        i.responseId,
        i.rating,
        i.reasonCode,
        i.commentRef,
        i.byUser,
        i.idempotencyKey,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert feedback');
  }
  async findFeedbackByIdempotencyKey(tx: Tx, key: string): Promise<FeedbackRow | null> {
    const r = await tx.query<FeedbackRow>(
      `SELECT ${FEEDBACK_COLS} FROM copilot_feedback WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  // --- idempotency (append-only) ----------------------------------------------------------------
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      queryId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO copilot_idempotency (tenant_id, idempotency_key, query_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [i.tenantId, i.idempotencyKey, i.queryId, i.correlationId, i.by],
    );
  }
}
