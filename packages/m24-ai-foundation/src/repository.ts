/**
 * M24 repository — ALL SQL for the AI foundation across its 17 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale command
 * changes zero rows (single-winner / stale-version rejection). Queries carry NO tenant_id predicate: RLS FORCE is the
 * isolation guarantee. All methods take the caller's `Tx`. Histories, citations, human reviews, DLP findings, usage,
 * governance events and the idempotency ledger are append-only. Money is INTEGER MINOR UNITS (bigint): `cost_minor` /
 * `rate_per_1k_minor` are PROJECTED `::text` and carried as STRINGS, never a float (ADR-007). Confidence is an INTEGER
 * basis-points score. Large content lives behind m09 document references (`*_document_ref` opaque ids). m24 owns only
 * its 17 tables and reads no other module's tables.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m24 repository: expected a row from ${what}`);
  return row;
}

export interface ProviderRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly kind: string;
  readonly status: string;
  readonly approved: boolean;
  readonly classifications: string[];
  readonly secret_reference: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ModelRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly provider_id: string | null;
  readonly code: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly capability: string;
  readonly status: string;
  readonly rate_per_1k_minor: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface PromptRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly template: string;
  readonly status: string;
  readonly content_hash: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface DlpPolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly block_restricted: boolean;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly require_human_review: boolean;
  readonly min_confidence_bps: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface RequestRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subject_type: string;
  readonly subject_ref: string | null;
  readonly module_ref: string | null;
  readonly classification: string;
  readonly provider_id: string | null;
  readonly model_id: string | null;
  readonly prompt_id: string | null;
  readonly input_document_ref: string | null;
  readonly status: string;
  readonly dlp_checked: boolean;
  readonly dlp_action: string | null;
  readonly provider_approved: boolean;
  readonly confidence_bps: number;
  readonly requested_by: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface OutputRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly output_kind: string;
  readonly output_document_ref: string | null;
  readonly confidence_bps: number;
  readonly citations_required: boolean;
  readonly citation_count: number;
  readonly status: string;
  readonly reviewed_by: string | null;
  readonly review_reason_code: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface HistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface CitationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly output_id: string;
  readonly document_ref: string | null;
  readonly span: string | null;
  readonly confidence_bps: number;
  readonly correlation_id: string;
}
export interface HumanReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly output_id: string;
  readonly request_id: string;
  readonly reviewer: string;
  readonly decision: string;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface UsageRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly cost_minor: string;
  readonly latency_ms: number;
  readonly correlation_id: string;
}

const PROV_COLS = `tenant_id, id, code, version_number, name, kind, status, approved, classifications, secret_reference, version, correlation_id`;
const MODEL_COLS = `tenant_id, id, provider_id, code, version_number, name, capability, status, rate_per_1k_minor::text AS rate_per_1k_minor, version, correlation_id`;
const PROMPT_COLS = `tenant_id, id, code, version_number, name, template, status, content_hash, version, correlation_id`;
const DLP_COLS = `tenant_id, id, scope, version_number, status, block_restricted, version, correlation_id`;
const CONFIG_COLS = `tenant_id, id, scope, version_number, status, require_human_review, min_confidence_bps, idempotency_key, version, correlation_id`;
const REQ_COLS = `tenant_id, id, subject_type, subject_ref, module_ref, classification, provider_id, model_id, prompt_id, input_document_ref, status, dlp_checked, dlp_action, provider_approved, confidence_bps, requested_by, idempotency_key, version, correlation_id`;
const OUT_COLS = `tenant_id, id, request_id, output_kind, output_document_ref, confidence_bps, citations_required, citation_count, status, reviewed_by, review_reason_code, version, correlation_id`;
const CITE_COLS = `tenant_id, id, output_id, document_ref, span, confidence_bps, correlation_id`;
const REVIEW_COLS = `tenant_id, id, output_id, request_id, reviewer, decision, reason_code, correlation_id`;
const USAGE_COLS = `tenant_id, id, request_id, prompt_tokens, completion_tokens, total_tokens, cost_minor::text AS cost_minor, latency_ms, correlation_id`;

export class AiRepository {
  // --- provider -------------------------------------------------------------------------------
  async insertProvider(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string | null;
      kind: string;
      approved: boolean;
      classifications: string[];
      secretReference: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ProviderRow> {
    const r = await tx.query<ProviderRow>(
      `INSERT INTO ai_provider (tenant_id, code, name, kind, approved, classifications, secret_reference, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${PROV_COLS}`,
      [
        i.tenantId,
        i.code,
        i.name,
        i.kind,
        i.approved,
        i.classifications,
        i.secretReference,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert provider');
  }
  async findProvider(tx: Tx, id: string): Promise<ProviderRow | null> {
    const r = await tx.query<ProviderRow>(`SELECT ${PROV_COLS} FROM ai_provider WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async setProviderStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; approved?: boolean | null; by: string | null },
  ): Promise<ProviderRow | null> {
    const r = await tx.query<ProviderRow>(
      `UPDATE ai_provider SET status=$3, approved=COALESCE($4, approved), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PROV_COLS}`,
      [i.id, i.expectedVersion, i.status, i.approved ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listProviders(tx: Tx): Promise<ProviderRow[]> {
    const r = await tx.query<ProviderRow>(
      `SELECT ${PROV_COLS} FROM ai_provider ORDER BY code, version_number`,
    );
    return r.rows;
  }
  async insertProviderHistory(tx: Tx, i: HistoryInsert & { providerId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ai_provider_history (tenant_id, provider_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.providerId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- model ----------------------------------------------------------------------------------
  async insertModel(
    tx: Tx,
    i: {
      tenantId: string;
      providerId: string | null;
      code: string;
      name: string | null;
      capability: string;
      ratePer1kMinor: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ModelRow> {
    const r = await tx.query<ModelRow>(
      `INSERT INTO ai_model (tenant_id, provider_id, code, name, capability, rate_per_1k_minor, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${MODEL_COLS}`,
      [i.tenantId, i.providerId, i.code, i.name, i.capability, i.ratePer1kMinor, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert model');
  }
  async findModel(tx: Tx, id: string): Promise<ModelRow | null> {
    const r = await tx.query<ModelRow>(`SELECT ${MODEL_COLS} FROM ai_model WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async setModelStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ModelRow | null> {
    const r = await tx.query<ModelRow>(
      `UPDATE ai_model SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${MODEL_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listModels(tx: Tx): Promise<ModelRow[]> {
    const r = await tx.query<ModelRow>(`SELECT ${MODEL_COLS} FROM ai_model ORDER BY code, version_number`);
    return r.rows;
  }

  // --- prompt ---------------------------------------------------------------------------------
  async insertPrompt(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string | null;
      template: string;
      contentHash: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PromptRow> {
    const r = await tx.query<PromptRow>(
      `INSERT INTO ai_prompt (tenant_id, code, name, template, content_hash, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${PROMPT_COLS}`,
      [i.tenantId, i.code, i.name, i.template, i.contentHash, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert prompt');
  }
  async findPrompt(tx: Tx, id: string): Promise<PromptRow | null> {
    const r = await tx.query<PromptRow>(`SELECT ${PROMPT_COLS} FROM ai_prompt WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async setPromptStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<PromptRow | null> {
    const r = await tx.query<PromptRow>(
      `UPDATE ai_prompt SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PROMPT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listPrompts(tx: Tx): Promise<PromptRow[]> {
    const r = await tx.query<PromptRow>(`SELECT ${PROMPT_COLS} FROM ai_prompt ORDER BY code, version_number`);
    return r.rows;
  }
  async insertPromptHistory(tx: Tx, i: HistoryInsert & { promptId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ai_prompt_history (tenant_id, prompt_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.promptId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- dlp policy / config --------------------------------------------------------------------
  async insertDlpPolicy(
    tx: Tx,
    i: { tenantId: string; scope: string; name: string | null; correlationId: string; by: string | null },
  ): Promise<DlpPolicyRow> {
    const r = await tx.query<DlpPolicyRow>(
      `INSERT INTO ai_dlp_policy (tenant_id, scope, name, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5) RETURNING ${DLP_COLS}`,
      [i.tenantId, i.scope, i.name, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert dlp policy');
  }
  async setDlpPolicyStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<DlpPolicyRow | null> {
    const r = await tx.query<DlpPolicyRow>(
      `UPDATE ai_dlp_policy SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${DLP_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async findDlpPolicy(tx: Tx, id: string): Promise<DlpPolicyRow | null> {
    const r = await tx.query<DlpPolicyRow>(`SELECT ${DLP_COLS} FROM ai_dlp_policy WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async listDlpPolicies(tx: Tx): Promise<DlpPolicyRow[]> {
    const r = await tx.query<DlpPolicyRow>(
      `SELECT ${DLP_COLS} FROM ai_dlp_policy ORDER BY scope, version_number`,
    );
    return r.rows;
  }
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
      `INSERT INTO ai_config (tenant_id, scope, name, min_confidence_bps, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${CONFIG_COLS}`,
      [i.tenantId, i.scope, i.name, i.minConfidenceBps, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM ai_config WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE ai_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<ConfigRow[]> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM ai_config ORDER BY scope, version_number`,
    );
    return r.rows;
  }

  // --- request --------------------------------------------------------------------------------
  async insertRequest(
    tx: Tx,
    i: {
      tenantId: string;
      subjectType: string;
      subjectRef: string | null;
      moduleRef: string | null;
      classification: string;
      providerId: string | null;
      modelId: string | null;
      promptId: string | null;
      inputDocumentRef: string | null;
      requestedBy: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RequestRow> {
    const r = await tx.query<RequestRow>(
      `INSERT INTO ai_request (tenant_id, subject_type, subject_ref, module_ref, classification, provider_id, model_id, prompt_id, input_document_ref, requested_by, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${REQ_COLS}`,
      [
        i.tenantId,
        i.subjectType,
        i.subjectRef,
        i.moduleRef,
        i.classification,
        i.providerId,
        i.modelId,
        i.promptId,
        i.inputDocumentRef,
        i.requestedBy,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert request');
  }
  async findRequest(tx: Tx, id: string): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(`SELECT ${REQ_COLS} FROM ai_request WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findRequestByIdempotencyKey(tx: Tx, key: string): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(`SELECT ${REQ_COLS} FROM ai_request WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async updateRequest(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      dlpChecked?: boolean | null;
      dlpAction?: string | null;
      providerApproved?: boolean | null;
      confidenceBps?: number | null;
      by: string | null;
    },
  ): Promise<RequestRow | null> {
    const r = await tx.query<RequestRow>(
      `UPDATE ai_request SET status=$3, dlp_checked=COALESCE($4, dlp_checked), dlp_action=COALESCE($5, dlp_action), provider_approved=COALESCE($6, provider_approved), confidence_bps=COALESCE($7, confidence_bps), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${REQ_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.dlpChecked ?? null,
        i.dlpAction ?? null,
        i.providerApproved ?? null,
        i.confidenceBps ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listRequests(tx: Tx, status?: string): Promise<RequestRow[]> {
    if (status !== undefined) {
      const r = await tx.query<RequestRow>(
        `SELECT ${REQ_COLS} FROM ai_request WHERE status=$1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows;
    }
    const r = await tx.query<RequestRow>(`SELECT ${REQ_COLS} FROM ai_request ORDER BY created_at DESC`);
    return r.rows;
  }
  async insertRequestHistory(tx: Tx, i: HistoryInsert & { requestId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO ai_request_history (tenant_id, request_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.requestId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- output ---------------------------------------------------------------------------------
  async insertOutput(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      outputKind: string;
      outputDocumentRef: string | null;
      confidenceBps: number;
      citationsRequired: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OutputRow> {
    const r = await tx.query<OutputRow>(
      `INSERT INTO ai_output (tenant_id, request_id, output_kind, output_document_ref, confidence_bps, citations_required, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${OUT_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.outputKind,
        i.outputDocumentRef,
        i.confidenceBps,
        i.citationsRequired,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert output');
  }
  async findOutput(tx: Tx, id: string): Promise<OutputRow | null> {
    const r = await tx.query<OutputRow>(`SELECT ${OUT_COLS} FROM ai_output WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async updateOutput(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      reviewedBy?: string | null;
      reviewReasonCode?: string | null;
      citationCount?: number | null;
      by: string | null;
    },
  ): Promise<OutputRow | null> {
    const r = await tx.query<OutputRow>(
      `UPDATE ai_output SET status=$3, reviewed_by=COALESCE($4, reviewed_by), review_reason_code=COALESCE($5, review_reason_code), citation_count=COALESCE($6, citation_count), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${OUT_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.reviewedBy ?? null,
        i.reviewReasonCode ?? null,
        i.citationCount ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listOutputs(tx: Tx, requestId: string): Promise<OutputRow[]> {
    const r = await tx.query<OutputRow>(
      `SELECT ${OUT_COLS} FROM ai_output WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async insertOutputHistory(
    tx: Tx,
    i: HistoryInsert & { outputId: string; requestId: string },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ai_output_history (tenant_id, output_id, request_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        i.tenantId,
        i.outputId,
        i.requestId,
        i.fromStatus,
        i.toStatus,
        i.reason,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
  }

  // --- citation / human review / dlp finding / usage / governance / idempotency ---------------
  async insertCitation(
    tx: Tx,
    i: {
      tenantId: string;
      outputId: string;
      documentRef: string | null;
      span: string | null;
      confidenceBps: number;
      by: string | null;
      correlationId: string;
    },
  ): Promise<CitationRow> {
    const r = await tx.query<CitationRow>(
      `INSERT INTO ai_citation (tenant_id, output_id, document_ref, span, confidence_bps, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${CITE_COLS}`,
      [i.tenantId, i.outputId, i.documentRef, i.span, i.confidenceBps, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert citation');
  }
  async countCitations(tx: Tx, outputId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM ai_citation WHERE output_id=$1`,
      [outputId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }
  async listCitations(tx: Tx, outputId: string): Promise<CitationRow[]> {
    const r = await tx.query<CitationRow>(
      `SELECT ${CITE_COLS} FROM ai_citation WHERE output_id=$1 ORDER BY created_at`,
      [outputId],
    );
    return r.rows;
  }
  async insertHumanReview(
    tx: Tx,
    i: {
      tenantId: string;
      outputId: string;
      requestId: string;
      reviewer: string;
      decision: string;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<HumanReviewRow> {
    const r = await tx.query<HumanReviewRow>(
      `INSERT INTO ai_human_review (tenant_id, output_id, request_id, reviewer, decision, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${REVIEW_COLS}`,
      [i.tenantId, i.outputId, i.requestId, i.reviewer, i.decision, i.reason, i.reasonCode, i.correlationId],
    );
    return firstRow(r.rows, 'insert human review');
  }
  async insertDlpFinding(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      classification: string;
      action: string;
      reasonCode: string | null;
      findingCount: number;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ai_dlp_finding (tenant_id, request_id, classification, action, reason_code, finding_count, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.requestId, i.classification, i.action, i.reasonCode, i.findingCount, i.correlationId],
    );
  }
  async insertUsage(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costMinor: number;
      latencyMs: number;
      by: string | null;
      correlationId: string;
    },
  ): Promise<UsageRow> {
    const r = await tx.query<UsageRow>(
      `INSERT INTO ai_usage (tenant_id, request_id, prompt_tokens, completion_tokens, total_tokens, cost_minor, latency_ms, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${USAGE_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.promptTokens,
        i.completionTokens,
        i.totalTokens,
        i.costMinor,
        i.latencyMs,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert usage');
  }
  async listUsage(tx: Tx, requestId: string): Promise<UsageRow[]> {
    const r = await tx.query<UsageRow>(
      `SELECT ${USAGE_COLS} FROM ai_usage WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async insertGovernanceEvent(
    tx: Tx,
    i: {
      tenantId: string;
      eventType: string;
      subjectType: string | null;
      subjectRef: string | null;
      reasonCode: string | null;
      actor: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ai_governance_event (tenant_id, event_type, subject_type, subject_ref, reason_code, actor, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.eventType, i.subjectType, i.subjectRef, i.reasonCode, i.actor, i.correlationId],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      requestId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ai_idempotency (tenant_id, idempotency_key, request_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [i.tenantId, i.idempotencyKey, i.requestId, i.correlationId, i.by],
    );
  }
}

interface HistoryInsert {
  readonly tenantId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly reasonCode: string | null;
  readonly by: string | null;
  readonly correlationId: string;
}
