/**
 * M25 repository — ALL SQL for the operational-AI layer across its 9 tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale
 * command changes zero rows. Queries carry NO tenant_id predicate: RLS FORCE is the isolation guarantee. All methods
 * take the caller's `Tx`. Histories, evidence, reviews and the idempotency ledger are append-only. Confidence is an
 * INTEGER basis-points score. Feedback/case/document/m24-request/m24-output are OPAQUE uuid references (no cross-module
 * FK). m25 owns only its 9 tables and reads no other module's tables.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m25 repository: expected a row from ${what}`);
  return row;
}

export interface ConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly require_human_review: boolean;
  readonly auto_apply: boolean;
  readonly min_confidence_bps: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface SubjectRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly classification: string;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface AnalysisRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subject_id: string;
  readonly analysis_kind: string;
  readonly ai_request_ref: string | null;
  readonly ai_output_ref: string | null;
  readonly status: string;
  readonly confidence_bps: number;
  readonly sentiment_label: string | null;
  readonly category: string | null;
  readonly summary_document_ref: string | null;
  readonly reviewed_by: string | null;
  readonly review_reason_code: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface SuggestionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly analysis_id: string;
  readonly suggestion_type: string;
  readonly recommended_ref: string | null;
  readonly rationale_document_ref: string | null;
  readonly status: string;
  readonly confidence_bps: number;
  readonly decided_by: string | null;
  readonly decision_reason_code: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface EvidenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly source_type: string;
  readonly source_ref: string | null;
  readonly span: string | null;
  readonly confidence_bps: number;
  readonly correlation_id: string;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly reviewer: string;
  readonly decision: string;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}

const CONFIG_COLS = `tenant_id, id, scope, version_number, status, require_human_review, auto_apply, min_confidence_bps, idempotency_key, version, correlation_id`;
const SUBJECT_COLS = `tenant_id, id, subject_type, subject_ref, classification, status, version, correlation_id`;
const ANALYSIS_COLS = `tenant_id, id, subject_id, analysis_kind, ai_request_ref, ai_output_ref, status, confidence_bps, sentiment_label, category, summary_document_ref, reviewed_by, review_reason_code, idempotency_key, version, correlation_id`;
const SUGGESTION_COLS = `tenant_id, id, analysis_id, suggestion_type, recommended_ref, rationale_document_ref, status, confidence_bps, decided_by, decision_reason_code, version, correlation_id`;
const EVIDENCE_COLS = `tenant_id, id, target_type, target_id, source_type, source_ref, span, confidence_bps, correlation_id`;
const REVIEW_COLS = `tenant_id, id, target_type, target_id, reviewer, decision, reason_code, correlation_id`;

interface HistoryInsert {
  readonly tenantId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly reasonCode: string | null;
  readonly by: string | null;
  readonly correlationId: string;
}

export class OperationalAiRepository {
  // --- config ---------------------------------------------------------------------------------
  async insertConfig(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      name: string | null;
      minConfidenceBps: number;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConfigRow> {
    const r = await tx.query<ConfigRow>(
      `INSERT INTO ops_ai_config (tenant_id, scope, name, min_confidence_bps, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${CONFIG_COLS}`,
      [i.tenantId, i.scope, i.name, i.minConfidenceBps, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM ops_ai_config WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE ops_ai_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async findActiveConfig(tx: Tx, scope: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM ops_ai_config WHERE scope=$1 AND status='active'`,
      [scope],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<ConfigRow[]> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM ops_ai_config ORDER BY scope, version_number`,
    );
    return r.rows;
  }

  // --- subject --------------------------------------------------------------------------------
  async insertSubject(
    tx: Tx,
    i: {
      tenantId: string;
      subjectType: string;
      subjectRef: string;
      classification: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SubjectRow> {
    const r = await tx.query<SubjectRow>(
      `INSERT INTO ops_ai_subject (tenant_id, subject_type, subject_ref, classification, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING ${SUBJECT_COLS}`,
      [i.tenantId, i.subjectType, i.subjectRef, i.classification, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert subject');
  }
  async findSubject(tx: Tx, id: string): Promise<SubjectRow | null> {
    const r = await tx.query<SubjectRow>(`SELECT ${SUBJECT_COLS} FROM ops_ai_subject WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findSubjectByRef(tx: Tx, subjectType: string, subjectRef: string): Promise<SubjectRow | null> {
    const r = await tx.query<SubjectRow>(
      `SELECT ${SUBJECT_COLS} FROM ops_ai_subject WHERE subject_type=$1 AND subject_ref=$2`,
      [subjectType, subjectRef],
    );
    return r.rows[0] ?? null;
  }

  // --- analysis -------------------------------------------------------------------------------
  async insertAnalysis(
    tx: Tx,
    i: {
      tenantId: string;
      subjectId: string;
      analysisKind: string;
      aiRequestRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AnalysisRow> {
    const r = await tx.query<AnalysisRow>(
      `INSERT INTO ops_ai_analysis (tenant_id, subject_id, analysis_kind, ai_request_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${ANALYSIS_COLS}`,
      [i.tenantId, i.subjectId, i.analysisKind, i.aiRequestRef, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert analysis');
  }
  async findAnalysis(tx: Tx, id: string): Promise<AnalysisRow | null> {
    const r = await tx.query<AnalysisRow>(`SELECT ${ANALYSIS_COLS} FROM ops_ai_analysis WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findAnalysisByIdempotencyKey(tx: Tx, key: string): Promise<AnalysisRow | null> {
    const r = await tx.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLS} FROM ops_ai_analysis WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateAnalysis(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      aiOutputRef?: string | null;
      confidenceBps?: number | null;
      sentimentLabel?: string | null;
      category?: string | null;
      summaryDocumentRef?: string | null;
      reviewedBy?: string | null;
      reviewReasonCode?: string | null;
      by: string | null;
    },
  ): Promise<AnalysisRow | null> {
    const r = await tx.query<AnalysisRow>(
      `UPDATE ops_ai_analysis SET status=$3, ai_output_ref=COALESCE($4, ai_output_ref), confidence_bps=COALESCE($5, confidence_bps), sentiment_label=COALESCE($6, sentiment_label), category=COALESCE($7, category), summary_document_ref=COALESCE($8, summary_document_ref), reviewed_by=COALESCE($9, reviewed_by), review_reason_code=COALESCE($10, review_reason_code), updated_by=$11, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ANALYSIS_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.aiOutputRef ?? null,
        i.confidenceBps ?? null,
        i.sentimentLabel ?? null,
        i.category ?? null,
        i.summaryDocumentRef ?? null,
        i.reviewedBy ?? null,
        i.reviewReasonCode ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listAnalyses(tx: Tx, subjectId: string): Promise<AnalysisRow[]> {
    const r = await tx.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLS} FROM ops_ai_analysis WHERE subject_id=$1 ORDER BY created_at`,
      [subjectId],
    );
    return r.rows;
  }
  async insertAnalysisHistory(tx: Tx, i: HistoryInsert & { analysisId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ops_ai_analysis_history (tenant_id, analysis_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.analysisId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- suggestion -----------------------------------------------------------------------------
  async insertSuggestion(
    tx: Tx,
    i: {
      tenantId: string;
      analysisId: string;
      suggestionType: string;
      recommendedRef: string | null;
      rationaleDocumentRef: string | null;
      confidenceBps: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SuggestionRow> {
    const r = await tx.query<SuggestionRow>(
      `INSERT INTO ops_ai_suggestion (tenant_id, analysis_id, suggestion_type, recommended_ref, rationale_document_ref, confidence_bps, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${SUGGESTION_COLS}`,
      [
        i.tenantId,
        i.analysisId,
        i.suggestionType,
        i.recommendedRef,
        i.rationaleDocumentRef,
        i.confidenceBps,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert suggestion');
  }
  async findSuggestion(tx: Tx, id: string): Promise<SuggestionRow | null> {
    const r = await tx.query<SuggestionRow>(`SELECT ${SUGGESTION_COLS} FROM ops_ai_suggestion WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async updateSuggestion(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      decidedBy?: string | null;
      decisionReasonCode?: string | null;
      by: string | null;
    },
  ): Promise<SuggestionRow | null> {
    const r = await tx.query<SuggestionRow>(
      `UPDATE ops_ai_suggestion SET status=$3, decided_by=COALESCE($4, decided_by), decision_reason_code=COALESCE($5, decision_reason_code), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SUGGESTION_COLS}`,
      [i.id, i.expectedVersion, i.status, i.decidedBy ?? null, i.decisionReasonCode ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listSuggestions(tx: Tx, analysisId: string): Promise<SuggestionRow[]> {
    const r = await tx.query<SuggestionRow>(
      `SELECT ${SUGGESTION_COLS} FROM ops_ai_suggestion WHERE analysis_id=$1 ORDER BY created_at`,
      [analysisId],
    );
    return r.rows;
  }
  async insertSuggestionHistory(tx: Tx, i: HistoryInsert & { suggestionId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ops_ai_suggestion_history (tenant_id, suggestion_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.suggestionId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- evidence / review / idempotency --------------------------------------------------------
  async insertEvidence(
    tx: Tx,
    i: {
      tenantId: string;
      targetType: string;
      targetId: string;
      sourceType: string;
      sourceRef: string | null;
      span: string | null;
      confidenceBps: number;
      by: string | null;
      correlationId: string;
    },
  ): Promise<EvidenceRow> {
    const r = await tx.query<EvidenceRow>(
      `INSERT INTO ops_ai_evidence (tenant_id, target_type, target_id, source_type, source_ref, span, confidence_bps, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${EVIDENCE_COLS}`,
      [
        i.tenantId,
        i.targetType,
        i.targetId,
        i.sourceType,
        i.sourceRef,
        i.span,
        i.confidenceBps,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert evidence');
  }
  async countEvidence(tx: Tx, targetType: string, targetId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM ops_ai_evidence WHERE target_type=$1 AND target_id=$2`,
      [targetType, targetId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }
  async listEvidence(tx: Tx, targetType: string, targetId: string): Promise<EvidenceRow[]> {
    const r = await tx.query<EvidenceRow>(
      `SELECT ${EVIDENCE_COLS} FROM ops_ai_evidence WHERE target_type=$1 AND target_id=$2 ORDER BY created_at`,
      [targetType, targetId],
    );
    return r.rows;
  }
  async insertReview(
    tx: Tx,
    i: {
      tenantId: string;
      targetType: string;
      targetId: string;
      reviewer: string;
      decision: string;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const r = await tx.query<ReviewRow>(
      `INSERT INTO ops_ai_review (tenant_id, target_type, target_id, reviewer, decision, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${REVIEW_COLS}`,
      [i.tenantId, i.targetType, i.targetId, i.reviewer, i.decision, i.reason, i.reasonCode, i.correlationId],
    );
    return firstRow(r.rows, 'insert review');
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      analysisId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ops_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [i.tenantId, i.idempotencyKey, i.analysisId, i.correlationId, i.by],
    );
  }
}
