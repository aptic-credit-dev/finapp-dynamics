/**
 * M37 repository — ALL SQL for governance/QA/release across its 9 govrelease_* tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO
 * tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Check/review/evidence/history
 * + the idempotency ledger are append-only. There is NO secret VALUE column — govrelease_evidence holds an opaque
 * `secretref:` signature pointer only. No float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m37 repository: expected a row from ${what}`);
  return row;
}

export interface ArtifactRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly artifact_key: string;
  readonly artifact_kind: string;
  readonly artifact_ref: string;
  readonly name: string;
  readonly status: string;
  readonly version: number;
}
export interface EnvironmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly env_key: string;
  readonly tier: number;
  readonly requires_approval: boolean;
  readonly status: string;
  readonly version: number;
}
export interface ReleaseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly artifact_id: string;
  readonly environment_id: string;
  readonly scope: string;
  readonly release_key: string;
  readonly from_version: number | null;
  readonly to_version: number;
  readonly state: string;
  readonly qa_passed: boolean;
  readonly requested_by: string | null;
  readonly content_hash: string;
  readonly version: number;
}
export interface GateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly release_id: string;
  readonly gate_key: string;
  readonly kind: string;
  readonly required: boolean;
  readonly status: string;
  readonly version: number;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
}
export interface EvidenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly release_id: string;
  readonly evidence_kind: string;
  readonly evidence_ref: string | null;
  readonly signature_ref: string | null;
}

export class GovreleaseRepository {
  // ---- artifact ----
  async insertArtifact(
    tx: Tx,
    a: {
      tenantId: string;
      scope: string;
      artifactKey: string;
      artifactKind: string;
      artifactRef: string;
      name: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ArtifactRow> {
    const { rows } = await tx.query<ArtifactRow>(
      `INSERT INTO govrelease_artifact (tenant_id, scope, artifact_key, artifact_kind, artifact_ref, name, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING tenant_id, id, scope, artifact_key, artifact_kind, artifact_ref, name, status, version`,
      [
        a.tenantId,
        a.scope,
        a.artifactKey,
        a.artifactKind,
        a.artifactRef,
        a.name,
        a.idempotencyKey,
        a.correlationId,
        a.by,
      ],
    );
    return firstRow(rows, 'insertArtifact');
  }
  async findArtifactByIdempotencyKey(tx: Tx, key: string): Promise<ArtifactRow | null> {
    const { rows } = await tx.query<ArtifactRow>(
      `SELECT tenant_id, id, scope, artifact_key, artifact_kind, artifact_ref, name, status, version FROM govrelease_artifact WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getArtifact(tx: Tx, id: string): Promise<ArtifactRow | null> {
    const { rows } = await tx.query<ArtifactRow>(
      `SELECT tenant_id, id, scope, artifact_key, artifact_kind, artifact_ref, name, status, version FROM govrelease_artifact WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateArtifactStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<ArtifactRow | null> {
    const { rows } = await tx.query<ArtifactRow>(
      `UPDATE govrelease_artifact SET status=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, artifact_key, artifact_kind, artifact_ref, name, status, version`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }
  async listArtifacts(tx: Tx, limit: number, offset: number): Promise<ArtifactRow[]> {
    const { rows } = await tx.query<ArtifactRow>(
      `SELECT tenant_id, id, scope, artifact_key, artifact_kind, artifact_ref, name, status, version FROM govrelease_artifact ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- environment ----
  async insertEnvironment(
    tx: Tx,
    e: {
      tenantId: string;
      scope: string;
      envKey: string;
      tier: number;
      requiresApproval: boolean;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EnvironmentRow> {
    const { rows } = await tx.query<EnvironmentRow>(
      `INSERT INTO govrelease_environment (tenant_id, scope, env_key, tier, requires_approval, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING tenant_id, id, scope, env_key, tier, requires_approval, status, version`,
      [e.tenantId, e.scope, e.envKey, e.tier, e.requiresApproval, e.idempotencyKey, e.correlationId, e.by],
    );
    return firstRow(rows, 'insertEnvironment');
  }
  async findEnvironmentByIdempotencyKey(tx: Tx, key: string): Promise<EnvironmentRow | null> {
    const { rows } = await tx.query<EnvironmentRow>(
      `SELECT tenant_id, id, scope, env_key, tier, requires_approval, status, version FROM govrelease_environment WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getEnvironment(tx: Tx, id: string): Promise<EnvironmentRow | null> {
    const { rows } = await tx.query<EnvironmentRow>(
      `SELECT tenant_id, id, scope, env_key, tier, requires_approval, status, version FROM govrelease_environment WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async listEnvironments(tx: Tx, limit: number, offset: number): Promise<EnvironmentRow[]> {
    const { rows } = await tx.query<EnvironmentRow>(
      `SELECT tenant_id, id, scope, env_key, tier, requires_approval, status, version FROM govrelease_environment ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- release ----
  async insertRelease(
    tx: Tx,
    r: {
      tenantId: string;
      artifactId: string;
      environmentId: string;
      scope: string;
      releaseKey: string;
      fromVersion: number | null;
      toVersion: number;
      requestedBy: string | null;
      contentHash: string;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReleaseRow> {
    const { rows } = await tx.query<ReleaseRow>(
      `INSERT INTO govrelease_release (tenant_id, artifact_id, environment_id, scope, release_key, from_version, to_version, requested_by, content_hash, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version`,
      [
        r.tenantId,
        r.artifactId,
        r.environmentId,
        r.scope,
        r.releaseKey,
        r.fromVersion,
        r.toVersion,
        r.requestedBy,
        r.contentHash,
        r.idempotencyKey,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertRelease');
  }
  async findReleaseByIdempotencyKey(tx: Tx, key: string): Promise<ReleaseRow | null> {
    const { rows } = await tx.query<ReleaseRow>(
      `SELECT tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version FROM govrelease_release WHERE idempotency_key=$1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getRelease(tx: Tx, id: string): Promise<ReleaseRow | null> {
    const { rows } = await tx.query<ReleaseRow>(
      `SELECT tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version FROM govrelease_release WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getReleasedForArtifactEnv(
    tx: Tx,
    artifactId: string,
    environmentId: string,
  ): Promise<ReleaseRow | null> {
    const { rows } = await tx.query<ReleaseRow>(
      `SELECT tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version FROM govrelease_release WHERE artifact_id=$1 AND environment_id=$2 AND state='released' LIMIT 1`,
      [artifactId, environmentId],
    );
    return rows[0] ?? null;
  }
  async updateReleaseState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; qaPassed: boolean; by: string | null },
  ): Promise<ReleaseRow | null> {
    const { rows } = await tx.query<ReleaseRow>(
      `UPDATE govrelease_release SET state=$3, qa_passed=$4, version=version+1, updated_at=now(), updated_by=$5 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version`,
      [id, expectedVersion, patch.state, patch.qaPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listReleases(tx: Tx, limit: number, offset: number): Promise<ReleaseRow[]> {
    const { rows } = await tx.query<ReleaseRow>(
      `SELECT tenant_id, id, artifact_id, environment_id, scope, release_key, from_version, to_version, state, qa_passed, requested_by, content_hash, version FROM govrelease_release ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- gate ----
  async insertGate(
    tx: Tx,
    g: {
      tenantId: string;
      releaseId: string;
      gateKey: string;
      kind: string;
      required: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GateRow> {
    const { rows } = await tx.query<GateRow>(
      `INSERT INTO govrelease_gate (tenant_id, release_id, gate_key, kind, required, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, release_id, gate_key, kind, required, status, version`,
      [g.tenantId, g.releaseId, g.gateKey, g.kind, g.required, g.correlationId, g.by],
    );
    return firstRow(rows, 'insertGate');
  }
  async getGate(tx: Tx, id: string): Promise<GateRow | null> {
    const { rows } = await tx.query<GateRow>(
      `SELECT tenant_id, id, release_id, gate_key, kind, required, status, version FROM govrelease_gate WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async listGatesForRelease(tx: Tx, releaseId: string): Promise<GateRow[]> {
    const { rows } = await tx.query<GateRow>(
      `SELECT tenant_id, id, release_id, gate_key, kind, required, status, version FROM govrelease_gate WHERE release_id=$1`,
      [releaseId],
    );
    return rows;
  }
  async updateGateStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { status: string; by: string | null },
  ): Promise<GateRow | null> {
    const { rows } = await tx.query<GateRow>(
      `UPDATE govrelease_gate SET status=$3, version=version+1, updated_at=now(), updated_by=$4 WHERE id=$1 AND version=$2 RETURNING tenant_id, id, release_id, gate_key, kind, required, status, version`,
      [id, expectedVersion, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }

  // ---- check + review + evidence + history + idempotency (append-only) ----
  async insertCheck(
    tx: Tx,
    c: {
      tenantId: string;
      gateId: string;
      releaseId: string;
      checkKind: string;
      status: string;
      evidenceRef: string | null;
      detail: string | null;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO govrelease_check (tenant_id, gate_id, release_id, check_kind, status, evidence_ref, detail, reason_code, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        c.tenantId,
        c.gateId,
        c.releaseId,
        c.checkKind,
        c.status,
        c.evidenceRef,
        c.detail,
        c.reasonCode,
        c.correlationId,
        c.by,
      ],
    );
  }
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetType: string;
      targetId: string;
      kind: string;
      requestedBy: string;
      decidedBy: string | null;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const { rows } = await tx.query<ReviewRow>(
      `INSERT INTO govrelease_review (tenant_id, target_type, target_id, kind, requested_by, decided_by, reason, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, target_type, target_id, kind, requested_by, decided_by`,
      [
        r.tenantId,
        r.targetType,
        r.targetId,
        r.kind,
        r.requestedBy,
        r.decidedBy,
        r.reason,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async findOpenReviewRequest(tx: Tx, targetType: string, targetId: string): Promise<ReviewRow | null> {
    const { rows } = await tx.query<ReviewRow>(
      `SELECT tenant_id, id, target_type, target_id, kind, requested_by, decided_by FROM govrelease_review WHERE target_type=$1 AND target_id=$2 AND kind='requested' ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    return rows[0] ?? null;
  }
  async insertEvidence(
    tx: Tx,
    e: {
      tenantId: string;
      releaseId: string;
      evidenceKind: string;
      evidenceRef: string | null;
      signatureRef: string | null;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EvidenceRow> {
    const { rows } = await tx.query<EvidenceRow>(
      `INSERT INTO govrelease_evidence (tenant_id, release_id, evidence_kind, evidence_ref, signature_ref, reason_code, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING tenant_id, id, release_id, evidence_kind, evidence_ref, signature_ref`,
      [
        e.tenantId,
        e.releaseId,
        e.evidenceKind,
        e.evidenceRef,
        e.signatureRef,
        e.reasonCode,
        e.correlationId,
        e.by,
      ],
    );
    return firstRow(rows, 'insertEvidence');
  }
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      targetType: string;
      targetId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO govrelease_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        h.tenantId,
        h.targetType,
        h.targetId,
        h.fromStatus,
        h.toStatus,
        h.reason,
        h.reasonCode,
        h.by,
        h.correlationId,
      ],
    );
  }
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      targetType: string | null;
      targetId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO govrelease_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
