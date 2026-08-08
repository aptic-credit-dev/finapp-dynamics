/**
 * M29 repository — ALL SQL for the AI-governance layer across its 7 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Evaluations, decisions,
 * histories and the idempotency ledger are append-only. Confidence/accuracy are INTEGER basis points. M24 assets are
 * referenced by OPAQUE uuid (no cross-module FK). There is no secret/credential column and no float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m29 repository: expected a row from ${what}`);
  return row;
}

export interface PolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly require_human_approval: boolean;
  readonly require_evaluation: boolean;
  readonly allow_restricted_provider: boolean;
  readonly min_confidence_bps: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface UseCaseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly module_ref: string;
  readonly purpose: string | null;
  readonly classification: string;
  readonly risk_tier: string;
  readonly provider_ref: string | null;
  readonly model_ref: string | null;
  readonly prompt_ref: string | null;
  readonly human_review_required: boolean;
  readonly citation_required: boolean;
  readonly controlled_action_prohibited: boolean;
  readonly deployment_status: string;
  readonly owner: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ReleaseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly use_case_id: string | null;
  readonly subject_kind: string;
  readonly subject_ref: string | null;
  readonly risk_tier: string;
  readonly status: string;
  readonly evaluation_passed: boolean;
  readonly proposed_by: string;
  readonly approved_by: string | null;
  readonly decision_reason_code: string | null;
  readonly reason: string | null;
  readonly provider_restricted: boolean;
  readonly expires_at: string | null;
  readonly compensating_control_ref: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface EvaluationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly release_id: string;
  readonly eval_ref: string | null;
  readonly model_ref: string | null;
  readonly prompt_ref: string | null;
  readonly provider_ref: string | null;
  readonly classification: string;
  readonly dlp_result: string;
  readonly safety_result: string;
  readonly citation_result: string;
  readonly accuracy_bps: number;
  readonly passed: boolean;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface DecisionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly decision: string;
  readonly decider: string;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}

const POLICY_COLS = `tenant_id, id, scope, version_number, status, require_human_approval, require_evaluation, allow_restricted_provider, min_confidence_bps, idempotency_key, version, correlation_id`;
const USE_CASE_COLS = `tenant_id, id, module_ref, purpose, classification, risk_tier, provider_ref, model_ref, prompt_ref, human_review_required, citation_required, controlled_action_prohibited, deployment_status, owner, version, correlation_id`;
const RELEASE_COLS = `tenant_id, id, use_case_id, subject_kind, subject_ref, risk_tier, status, evaluation_passed, proposed_by, approved_by, decision_reason_code, reason, provider_restricted, expires_at, compensating_control_ref, idempotency_key, version, correlation_id`;
const EVAL_COLS = `tenant_id, id, release_id, eval_ref, model_ref, prompt_ref, provider_ref, classification, dlp_result, safety_result, citation_result, accuracy_bps, passed, reason_code, correlation_id`;
const DECISION_COLS = `tenant_id, id, target_type, target_id, decision, decider, reason_code, correlation_id`;

interface HistoryInsert {
  readonly tenantId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly reasonCode: string | null;
  readonly by: string | null;
  readonly correlationId: string;
}

export class AiGovernanceRepository {
  // --- policy -----------------------------------------------------------------------------------
  async insertPolicy(
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
  ): Promise<PolicyRow> {
    const r = await tx.query<PolicyRow>(
      `INSERT INTO ai_governance_policy (tenant_id, scope, name, min_confidence_bps, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${POLICY_COLS}`,
      [i.tenantId, i.scope, i.name, i.minConfidenceBps, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert policy');
  }
  async findPolicyByIdempotencyKey(tx: Tx, key: string): Promise<PolicyRow | null> {
    const r = await tx.query<PolicyRow>(
      `SELECT ${POLICY_COLS} FROM ai_governance_policy WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async findActivePolicy(tx: Tx, scope: string): Promise<PolicyRow | null> {
    const r = await tx.query<PolicyRow>(
      `SELECT ${POLICY_COLS} FROM ai_governance_policy WHERE scope=$1 AND status='active'`,
      [scope],
    );
    return r.rows[0] ?? null;
  }
  async setPolicyStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<PolicyRow | null> {
    const r = await tx.query<PolicyRow>(
      `UPDATE ai_governance_policy SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${POLICY_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listPolicies(tx: Tx): Promise<PolicyRow[]> {
    const r = await tx.query<PolicyRow>(
      `SELECT ${POLICY_COLS} FROM ai_governance_policy ORDER BY scope, version_number`,
    );
    return r.rows;
  }

  // --- use case ---------------------------------------------------------------------------------
  async insertUseCase(
    tx: Tx,
    i: {
      tenantId: string;
      moduleRef: string;
      purpose: string | null;
      classification: string;
      riskTier: string;
      providerRef: string | null;
      modelRef: string | null;
      promptRef: string | null;
      humanReviewRequired: boolean;
      citationRequired: boolean;
      owner: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<UseCaseRow> {
    const r = await tx.query<UseCaseRow>(
      `INSERT INTO ai_governance_use_case (tenant_id, module_ref, purpose, classification, risk_tier, provider_ref, model_ref, prompt_ref, human_review_required, citation_required, owner, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${USE_CASE_COLS}`,
      [
        i.tenantId,
        i.moduleRef,
        i.purpose,
        i.classification,
        i.riskTier,
        i.providerRef,
        i.modelRef,
        i.promptRef,
        i.humanReviewRequired,
        i.citationRequired,
        i.owner,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert use case');
  }
  async findUseCase(tx: Tx, id: string): Promise<UseCaseRow | null> {
    const r = await tx.query<UseCaseRow>(`SELECT ${USE_CASE_COLS} FROM ai_governance_use_case WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findUseCaseByIdempotencyKey(tx: Tx, key: string): Promise<UseCaseRow | null> {
    const r = await tx.query<UseCaseRow>(
      `SELECT ${USE_CASE_COLS} FROM ai_governance_use_case WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setUseCaseDeployment(
    tx: Tx,
    i: { id: string; expectedVersion: number; deploymentStatus: string; by: string | null },
  ): Promise<UseCaseRow | null> {
    const r = await tx.query<UseCaseRow>(
      `UPDATE ai_governance_use_case SET deployment_status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${USE_CASE_COLS}`,
      [i.id, i.expectedVersion, i.deploymentStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listUseCases(tx: Tx, limit: number, offset: number): Promise<UseCaseRow[]> {
    const r = await tx.query<UseCaseRow>(
      `SELECT ${USE_CASE_COLS} FROM ai_governance_use_case ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  // --- release ----------------------------------------------------------------------------------
  async insertRelease(
    tx: Tx,
    i: {
      tenantId: string;
      useCaseId: string | null;
      subjectKind: string;
      subjectRef: string | null;
      riskTier: string;
      proposedBy: string;
      providerRestricted: boolean;
      expiresAt: string | null;
      compensatingControlRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReleaseRow> {
    const r = await tx.query<ReleaseRow>(
      `INSERT INTO ai_governance_release (tenant_id, use_case_id, subject_kind, subject_ref, risk_tier, proposed_by, provider_restricted, expires_at, compensating_control_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${RELEASE_COLS}`,
      [
        i.tenantId,
        i.useCaseId,
        i.subjectKind,
        i.subjectRef,
        i.riskTier,
        i.proposedBy,
        i.providerRestricted,
        i.expiresAt,
        i.compensatingControlRef,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert release');
  }
  async findRelease(tx: Tx, id: string): Promise<ReleaseRow | null> {
    const r = await tx.query<ReleaseRow>(`SELECT ${RELEASE_COLS} FROM ai_governance_release WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findReleaseByIdempotencyKey(tx: Tx, key: string): Promise<ReleaseRow | null> {
    const r = await tx.query<ReleaseRow>(
      `SELECT ${RELEASE_COLS} FROM ai_governance_release WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateRelease(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      evaluationPassed?: boolean | null;
      approvedBy?: string | null;
      decisionReasonCode?: string | null;
      reason?: string | null;
      by: string | null;
    },
  ): Promise<ReleaseRow | null> {
    const r = await tx.query<ReleaseRow>(
      `UPDATE ai_governance_release SET status=$3, evaluation_passed=COALESCE($4, evaluation_passed), approved_by=COALESCE($5, approved_by), decision_reason_code=COALESCE($6, decision_reason_code), reason=COALESCE($7, reason), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RELEASE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.evaluationPassed ?? null,
        i.approvedBy ?? null,
        i.decisionReasonCode ?? null,
        i.reason ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listReleases(tx: Tx, useCaseId: string | null, limit: number, offset: number): Promise<ReleaseRow[]> {
    if (useCaseId !== null) {
      const r = await tx.query<ReleaseRow>(
        `SELECT ${RELEASE_COLS} FROM ai_governance_release WHERE use_case_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [useCaseId, limit, offset],
      );
      return r.rows;
    }
    const r = await tx.query<ReleaseRow>(
      `SELECT ${RELEASE_COLS} FROM ai_governance_release ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  // --- evaluation / decision / history / idempotency (append-only) ------------------------------
  async insertEvaluation(
    tx: Tx,
    i: {
      tenantId: string;
      releaseId: string;
      evalRef: string | null;
      modelRef: string | null;
      promptRef: string | null;
      providerRef: string | null;
      classification: string;
      dlpResult: string;
      safetyResult: string;
      citationResult: string;
      accuracyBps: number;
      passed: boolean;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<EvaluationRow> {
    const r = await tx.query<EvaluationRow>(
      `INSERT INTO ai_governance_evaluation (tenant_id, release_id, eval_ref, model_ref, prompt_ref, provider_ref, classification, dlp_result, safety_result, citation_result, accuracy_bps, passed, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${EVAL_COLS}`,
      [
        i.tenantId,
        i.releaseId,
        i.evalRef,
        i.modelRef,
        i.promptRef,
        i.providerRef,
        i.classification,
        i.dlpResult,
        i.safetyResult,
        i.citationResult,
        i.accuracyBps,
        i.passed,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert evaluation');
  }
  async listEvaluations(tx: Tx, releaseId: string): Promise<EvaluationRow[]> {
    const r = await tx.query<EvaluationRow>(
      `SELECT ${EVAL_COLS} FROM ai_governance_evaluation WHERE release_id=$1 ORDER BY created_at`,
      [releaseId],
    );
    return r.rows;
  }
  async insertDecision(
    tx: Tx,
    i: {
      tenantId: string;
      targetType: string;
      targetId: string;
      decision: string;
      decider: string;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<DecisionRow> {
    const r = await tx.query<DecisionRow>(
      `INSERT INTO ai_governance_decision (tenant_id, target_type, target_id, decision, decider, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${DECISION_COLS}`,
      [i.tenantId, i.targetType, i.targetId, i.decision, i.decider, i.reason, i.reasonCode, i.correlationId],
    );
    return firstRow(r.rows, 'insert decision');
  }
  async insertHistory(tx: Tx, i: HistoryInsert): Promise<void> {
    await tx.query(
      `INSERT INTO ai_governance_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        i.tenantId,
        i.targetType,
        i.targetId,
        i.fromStatus,
        i.toStatus,
        i.reason,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      releaseId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO ai_governance_idempotency (tenant_id, idempotency_key, release_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [i.tenantId, i.idempotencyKey, i.releaseId, i.correlationId, i.by],
    );
  }
}
