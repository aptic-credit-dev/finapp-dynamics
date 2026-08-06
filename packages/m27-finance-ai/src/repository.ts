/**
 * M27 repository — ALL SQL for the finance-AI layer across its 12 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Histories, model
 * results, exception classifications, features, evidence, reviews and the idempotency ledger are append-only.
 * Confidence is an INTEGER basis-points score. Money is bigint MINOR UNITS: `amount_minor` is PROJECTED `::text` and
 * carried as a STRING, never a float (ADR-007). M15/M20/M24 subjects are OPAQUE uuid references (no cross-module FK).
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m27 repository: expected a row from ${what}`);
  return row;
}

export interface ConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly require_human_review: boolean;
  readonly auto_post: boolean;
  readonly auto_match: boolean;
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
  readonly source_ref: string | null;
  readonly target_ref: string | null;
  readonly matching_method_ref: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly status: string;
  readonly confidence_bps: number;
  readonly explainability_required: boolean;
  readonly feature_count: number;
  readonly decided_by: string | null;
  readonly decision_reason_code: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface FeatureRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly suggestion_id: string;
  readonly feature_type: string;
  readonly weight_bps: number;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface ExceptionClassificationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly analysis_id: string;
  readonly exception_ref: string | null;
  readonly category: string;
  readonly confidence_bps: number;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface ModelResultRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly analysis_id: string;
  readonly ai_output_ref: string | null;
  readonly score_bps: number;
  readonly anomaly: boolean;
  readonly method_ref: string | null;
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

const CONFIG_COLS = `tenant_id, id, scope, version_number, status, require_human_review, auto_post, auto_match, min_confidence_bps, idempotency_key, version, correlation_id`;
const SUBJECT_COLS = `tenant_id, id, subject_type, subject_ref, classification, status, version, correlation_id`;
const ANALYSIS_COLS = `tenant_id, id, subject_id, analysis_kind, ai_request_ref, ai_output_ref, status, confidence_bps, reviewed_by, review_reason_code, idempotency_key, version, correlation_id`;
const SUGGESTION_COLS = `tenant_id, id, analysis_id, suggestion_type, source_ref, target_ref, matching_method_ref, amount_minor::text AS amount_minor, currency, status, confidence_bps, explainability_required, feature_count, decided_by, decision_reason_code, version, correlation_id`;
const FEATURE_COLS = `tenant_id, id, suggestion_id, feature_type, weight_bps, reason_code, correlation_id`;
const EXC_COLS = `tenant_id, id, analysis_id, exception_ref, category, confidence_bps, reason_code, correlation_id`;
const MODEL_COLS = `tenant_id, id, analysis_id, ai_output_ref, score_bps, anomaly, method_ref, correlation_id`;
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

export class FinanceAiRepository {
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
      `INSERT INTO finance_ai_config (tenant_id, scope, name, min_confidence_bps, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${CONFIG_COLS}`,
      [i.tenantId, i.scope, i.name, i.minConfidenceBps, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM finance_ai_config WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE finance_ai_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<ConfigRow[]> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM finance_ai_config ORDER BY scope, version_number`,
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
      `INSERT INTO finance_ai_subject (tenant_id, subject_type, subject_ref, classification, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING ${SUBJECT_COLS}`,
      [i.tenantId, i.subjectType, i.subjectRef, i.classification, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert subject');
  }
  async findSubject(tx: Tx, id: string): Promise<SubjectRow | null> {
    const r = await tx.query<SubjectRow>(`SELECT ${SUBJECT_COLS} FROM finance_ai_subject WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findSubjectByRef(tx: Tx, subjectType: string, subjectRef: string): Promise<SubjectRow | null> {
    const r = await tx.query<SubjectRow>(
      `SELECT ${SUBJECT_COLS} FROM finance_ai_subject WHERE subject_type=$1 AND subject_ref=$2`,
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
      `INSERT INTO finance_ai_analysis (tenant_id, subject_id, analysis_kind, ai_request_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${ANALYSIS_COLS}`,
      [i.tenantId, i.subjectId, i.analysisKind, i.aiRequestRef, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert analysis');
  }
  async findAnalysis(tx: Tx, id: string): Promise<AnalysisRow | null> {
    const r = await tx.query<AnalysisRow>(`SELECT ${ANALYSIS_COLS} FROM finance_ai_analysis WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findAnalysisByIdempotencyKey(tx: Tx, key: string): Promise<AnalysisRow | null> {
    const r = await tx.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLS} FROM finance_ai_analysis WHERE idempotency_key=$1`,
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
      reviewedBy?: string | null;
      reviewReasonCode?: string | null;
      by: string | null;
    },
  ): Promise<AnalysisRow | null> {
    const r = await tx.query<AnalysisRow>(
      `UPDATE finance_ai_analysis SET status=$3, ai_output_ref=COALESCE($4, ai_output_ref), confidence_bps=COALESCE($5, confidence_bps), reviewed_by=COALESCE($6, reviewed_by), review_reason_code=COALESCE($7, review_reason_code), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ANALYSIS_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.aiOutputRef ?? null,
        i.confidenceBps ?? null,
        i.reviewedBy ?? null,
        i.reviewReasonCode ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listAnalyses(tx: Tx, subjectId: string): Promise<AnalysisRow[]> {
    const r = await tx.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLS} FROM finance_ai_analysis WHERE subject_id=$1 ORDER BY created_at`,
      [subjectId],
    );
    return r.rows;
  }
  async insertAnalysisHistory(tx: Tx, i: HistoryInsert & { analysisId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO finance_ai_analysis_history (tenant_id, analysis_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.analysisId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- model result / exception classification ------------------------------------------------
  async insertModelResult(
    tx: Tx,
    i: {
      tenantId: string;
      analysisId: string;
      aiOutputRef: string | null;
      scoreBps: number;
      anomaly: boolean;
      methodRef: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ModelResultRow> {
    const r = await tx.query<ModelResultRow>(
      `INSERT INTO finance_ai_model_result (tenant_id, analysis_id, ai_output_ref, score_bps, anomaly, method_ref, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${MODEL_COLS}`,
      [i.tenantId, i.analysisId, i.aiOutputRef, i.scoreBps, i.anomaly, i.methodRef, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert model result');
  }
  async insertExceptionClassification(
    tx: Tx,
    i: {
      tenantId: string;
      analysisId: string;
      exceptionRef: string | null;
      category: string;
      confidenceBps: number;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ExceptionClassificationRow> {
    const r = await tx.query<ExceptionClassificationRow>(
      `INSERT INTO finance_ai_exception_classification (tenant_id, analysis_id, exception_ref, category, confidence_bps, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${EXC_COLS}`,
      [
        i.tenantId,
        i.analysisId,
        i.exceptionRef,
        i.category,
        i.confidenceBps,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert exception classification');
  }

  // --- suggestion + feature -------------------------------------------------------------------
  async insertSuggestion(
    tx: Tx,
    i: {
      tenantId: string;
      analysisId: string;
      suggestionType: string;
      sourceRef: string | null;
      targetRef: string | null;
      matchingMethodRef: string | null;
      amountMinor: string | null;
      currency: string | null;
      confidenceBps: number;
      explainabilityRequired: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SuggestionRow> {
    const r = await tx.query<SuggestionRow>(
      `INSERT INTO finance_ai_suggestion (tenant_id, analysis_id, suggestion_type, source_ref, target_ref, matching_method_ref, amount_minor, currency, confidence_bps, explainability_required, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${SUGGESTION_COLS}`,
      [
        i.tenantId,
        i.analysisId,
        i.suggestionType,
        i.sourceRef,
        i.targetRef,
        i.matchingMethodRef,
        i.amountMinor,
        i.currency,
        i.confidenceBps,
        i.explainabilityRequired,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert suggestion');
  }
  async findSuggestion(tx: Tx, id: string): Promise<SuggestionRow | null> {
    const r = await tx.query<SuggestionRow>(
      `SELECT ${SUGGESTION_COLS} FROM finance_ai_suggestion WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updateSuggestion(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      featureCount?: number | null;
      decidedBy?: string | null;
      decisionReasonCode?: string | null;
      by: string | null;
    },
  ): Promise<SuggestionRow | null> {
    const r = await tx.query<SuggestionRow>(
      `UPDATE finance_ai_suggestion SET status=$3, feature_count=COALESCE($4, feature_count), decided_by=COALESCE($5, decided_by), decision_reason_code=COALESCE($6, decision_reason_code), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SUGGESTION_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.featureCount ?? null,
        i.decidedBy ?? null,
        i.decisionReasonCode ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listSuggestions(tx: Tx, analysisId: string): Promise<SuggestionRow[]> {
    const r = await tx.query<SuggestionRow>(
      `SELECT ${SUGGESTION_COLS} FROM finance_ai_suggestion WHERE analysis_id=$1 ORDER BY created_at`,
      [analysisId],
    );
    return r.rows;
  }
  async insertSuggestionHistory(tx: Tx, i: HistoryInsert & { suggestionId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO finance_ai_suggestion_history (tenant_id, suggestion_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.suggestionId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async insertFeature(
    tx: Tx,
    i: {
      tenantId: string;
      suggestionId: string;
      featureType: string;
      weightBps: number;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<FeatureRow> {
    const r = await tx.query<FeatureRow>(
      `INSERT INTO finance_ai_feature (tenant_id, suggestion_id, feature_type, weight_bps, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${FEATURE_COLS}`,
      [i.tenantId, i.suggestionId, i.featureType, i.weightBps, i.reasonCode, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert feature');
  }
  async countFeatures(tx: Tx, suggestionId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM finance_ai_feature WHERE suggestion_id=$1`,
      [suggestionId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }
  async listFeatures(tx: Tx, suggestionId: string): Promise<FeatureRow[]> {
    const r = await tx.query<FeatureRow>(
      `SELECT ${FEATURE_COLS} FROM finance_ai_feature WHERE suggestion_id=$1 ORDER BY created_at`,
      [suggestionId],
    );
    return r.rows;
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
      `INSERT INTO finance_ai_evidence (tenant_id, target_type, target_id, source_type, source_ref, span, confidence_bps, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${EVIDENCE_COLS}`,
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
      `INSERT INTO finance_ai_review (tenant_id, target_type, target_id, reviewer, decision, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${REVIEW_COLS}`,
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
      `INSERT INTO finance_ai_idempotency (tenant_id, idempotency_key, analysis_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [i.tenantId, i.idempotencyKey, i.analysisId, i.correlationId, i.by],
    );
  }
}
