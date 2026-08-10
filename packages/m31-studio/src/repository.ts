/**
 * M31 repository — ALL SQL for the Studio design layer across its 9 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`, returning 0 rows on a
 * stale write). Queries carry NO tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the
 * caller's `Tx`. Dependency/validation/review/binding/history + the idempotency ledger are append-only. There is NO
 * secret VALUE column — a secret-bearing design value is an opaque `secretref:` pointer inside the declarative `spec`.
 * No float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m31 repository: expected a row from ${what}`);
  return row;
}

export interface ProjectRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly project_key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ArtifactRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly project_id: string;
  readonly scope: string;
  readonly kind: string;
  readonly artifact_key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly latest_version: number;
  readonly published_version: number | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ArtifactVersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly artifact_id: string;
  readonly version_no: number;
  readonly state: string;
  readonly spec: unknown;
  readonly content_hash: string;
  readonly validation_passed: boolean;
  readonly notes: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface DependencyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly artifact_version_id: string;
  readonly depends_on_artifact_id: string | null;
  readonly depends_on_kind: string | null;
  readonly required_min_version: number | null;
  readonly capability_ref: string | null;
}
export interface ValidationResultRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly artifact_version_id: string;
  readonly passed: boolean;
  readonly finding_count: number;
  readonly findings: unknown;
  readonly reason_code: string | null;
}
export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly artifact_version_id: string;
  readonly kind: string;
  readonly requested_by: string;
  readonly decided_by: string | null;
  readonly reason_code: string | null;
}
export interface BindingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly artifact_version_id: string;
  readonly target_engine: string;
  readonly target_definition_id: string | null;
  readonly target_version_id: string | null;
  readonly target_version_no: number | null;
  readonly target_code: string | null;
  readonly content_hash: string | null;
  readonly capability_ref: string | null;
}

export class StudioRepository {
  // ---- projects ----
  async insertProject(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      projectKey: string;
      name: string;
      description: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ProjectRow> {
    const { rows } = await tx.query<ProjectRow>(
      `INSERT INTO studio_project (tenant_id, scope, project_key, name, description, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [p.tenantId, p.scope, p.projectKey, p.name, p.description, p.idempotencyKey, p.correlationId, p.by],
    );
    return firstRow(rows, 'insertProject');
  }
  async findProjectByIdempotencyKey(tx: Tx, key: string): Promise<ProjectRow | null> {
    const { rows } = await tx.query<ProjectRow>(
      `SELECT * FROM studio_project WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getProject(tx: Tx, id: string): Promise<ProjectRow | null> {
    const { rows } = await tx.query<ProjectRow>(`SELECT * FROM studio_project WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }
  async updateProject(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { name: string; description: string | null; status: string; by: string | null },
  ): Promise<ProjectRow | null> {
    const { rows } = await tx.query<ProjectRow>(
      `UPDATE studio_project SET name=$3, description=$4, status=$5, version=version+1, updated_at=now(), updated_by=$6
       WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.name, patch.description, patch.status, patch.by],
    );
    return rows[0] ?? null;
  }
  async listProjects(tx: Tx, limit: number, offset: number): Promise<ProjectRow[]> {
    const { rows } = await tx.query<ProjectRow>(
      `SELECT * FROM studio_project ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- artifacts ----
  async insertArtifact(
    tx: Tx,
    a: {
      tenantId: string;
      projectId: string;
      scope: string;
      kind: string;
      artifactKey: string;
      name: string;
      description: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ArtifactRow> {
    const { rows } = await tx.query<ArtifactRow>(
      `INSERT INTO studio_artifact (tenant_id, project_id, scope, kind, artifact_key, name, description, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [
        a.tenantId,
        a.projectId,
        a.scope,
        a.kind,
        a.artifactKey,
        a.name,
        a.description,
        a.idempotencyKey,
        a.correlationId,
        a.by,
      ],
    );
    return firstRow(rows, 'insertArtifact');
  }
  async findArtifactByIdempotencyKey(tx: Tx, key: string): Promise<ArtifactRow | null> {
    const { rows } = await tx.query<ArtifactRow>(
      `SELECT * FROM studio_artifact WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  async getArtifact(tx: Tx, id: string): Promise<ArtifactRow | null> {
    const { rows } = await tx.query<ArtifactRow>(`SELECT * FROM studio_artifact WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }
  async updateArtifact(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: {
      name: string;
      description: string | null;
      status: string;
      latestVersion: number;
      publishedVersion: number | null;
      by: string | null;
    },
  ): Promise<ArtifactRow | null> {
    const { rows } = await tx.query<ArtifactRow>(
      `UPDATE studio_artifact SET name=$3, description=$4, status=$5, latest_version=$6, published_version=$7,
         version=version+1, updated_at=now(), updated_by=$8
       WHERE id=$1 AND version=$2 RETURNING *`,
      [
        id,
        expectedVersion,
        patch.name,
        patch.description,
        patch.status,
        patch.latestVersion,
        patch.publishedVersion,
        patch.by,
      ],
    );
    return rows[0] ?? null;
  }
  async listArtifacts(tx: Tx, projectId: string, limit: number, offset: number): Promise<ArtifactRow[]> {
    const { rows } = await tx.query<ArtifactRow>(
      `SELECT * FROM studio_artifact WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [projectId, limit, offset],
    );
    return rows;
  }

  // ---- versions ----
  async insertVersion(
    tx: Tx,
    v: {
      tenantId: string;
      artifactId: string;
      versionNo: number;
      spec: unknown;
      contentHash: string;
      notes: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ArtifactVersionRow> {
    const { rows } = await tx.query<ArtifactVersionRow>(
      `INSERT INTO studio_artifact_version (tenant_id, artifact_id, version_no, state, spec, content_hash, validation_passed, notes, idempotency_key, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,'draft',$4::jsonb,$5,false,$6,$7,$8,$9,$9) RETURNING *`,
      [
        v.tenantId,
        v.artifactId,
        v.versionNo,
        JSON.stringify(v.spec ?? null),
        v.contentHash,
        v.notes,
        v.idempotencyKey,
        v.correlationId,
        v.by,
      ],
    );
    return firstRow(rows, 'insertVersion');
  }
  async getVersion(tx: Tx, id: string): Promise<ArtifactVersionRow | null> {
    const { rows } = await tx.query<ArtifactVersionRow>(
      `SELECT * FROM studio_artifact_version WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getPublishedVersion(tx: Tx, artifactId: string): Promise<ArtifactVersionRow | null> {
    const { rows } = await tx.query<ArtifactVersionRow>(
      `SELECT * FROM studio_artifact_version WHERE artifact_id = $1 AND state = 'published' LIMIT 1`,
      [artifactId],
    );
    return rows[0] ?? null;
  }
  async findVersionByIdempotencyKey(tx: Tx, key: string): Promise<ArtifactVersionRow | null> {
    const { rows } = await tx.query<ArtifactVersionRow>(
      `SELECT * FROM studio_artifact_version WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }
  /** CAS state transition. `validationPassed` only ever moves false->true (the evidence gate is a DB CHECK too). */
  async updateVersionState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; validationPassed: boolean; by: string | null },
  ): Promise<ArtifactVersionRow | null> {
    const { rows } = await tx.query<ArtifactVersionRow>(
      `UPDATE studio_artifact_version SET state=$3, validation_passed=$4, version=version+1, updated_at=now(), updated_by=$5
       WHERE id=$1 AND version=$2 RETURNING *`,
      [id, expectedVersion, patch.state, patch.validationPassed, patch.by],
    );
    return rows[0] ?? null;
  }
  async listVersions(tx: Tx, artifactId: string): Promise<ArtifactVersionRow[]> {
    const { rows } = await tx.query<ArtifactVersionRow>(
      `SELECT * FROM studio_artifact_version WHERE artifact_id = $1 ORDER BY version_no DESC`,
      [artifactId],
    );
    return rows;
  }

  // ---- dependencies (append-only) ----
  async insertDependency(
    tx: Tx,
    d: {
      tenantId: string;
      artifactVersionId: string;
      dependsOnArtifactId: string | null;
      dependsOnKind: string | null;
      requiredMinVersion: number | null;
      capabilityRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DependencyRow> {
    const { rows } = await tx.query<DependencyRow>(
      `INSERT INTO studio_dependency (tenant_id, artifact_version_id, depends_on_artifact_id, depends_on_kind, required_min_version, capability_ref, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        d.tenantId,
        d.artifactVersionId,
        d.dependsOnArtifactId,
        d.dependsOnKind,
        d.requiredMinVersion,
        d.capabilityRef,
        d.correlationId,
        d.by,
      ],
    );
    return firstRow(rows, 'insertDependency');
  }
  async listDependencies(tx: Tx, versionId: string): Promise<DependencyRow[]> {
    const { rows } = await tx.query<DependencyRow>(
      `SELECT * FROM studio_dependency WHERE artifact_version_id = $1`,
      [versionId],
    );
    return rows;
  }

  // ---- validation results (append-only) ----
  async insertValidationResult(
    tx: Tx,
    r: {
      tenantId: string;
      artifactVersionId: string;
      passed: boolean;
      findingCount: number;
      findings: unknown;
      reasonCode: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ValidationResultRow> {
    const { rows } = await tx.query<ValidationResultRow>(
      `INSERT INTO studio_validation_result (tenant_id, artifact_version_id, passed, finding_count, findings, reason_code, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
      [
        r.tenantId,
        r.artifactVersionId,
        r.passed,
        r.findingCount,
        JSON.stringify(r.findings ?? []),
        r.reasonCode,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertValidationResult');
  }

  // ---- reviews (append-only maker-checker) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      artifactVersionId: string;
      kind: string;
      requestedBy: string;
      decidedBy: string | null;
      reason: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ReviewRow> {
    const { rows } = await tx.query<ReviewRow>(
      `INSERT INTO studio_review (tenant_id, artifact_version_id, kind, requested_by, decided_by, reason, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        r.tenantId,
        r.artifactVersionId,
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
  /** The most recent OPEN review request for a version (to recover the requester for the SoD check). */
  async findOpenReviewRequest(tx: Tx, versionId: string): Promise<ReviewRow | null> {
    const { rows } = await tx.query<ReviewRow>(
      `SELECT * FROM studio_review WHERE artifact_version_id = $1 AND kind = 'requested' ORDER BY created_at DESC LIMIT 1`,
      [versionId],
    );
    return rows[0] ?? null;
  }

  // ---- bindings (append-only) ----
  async insertBinding(
    tx: Tx,
    b: {
      tenantId: string;
      artifactVersionId: string;
      targetEngine: string;
      targetDefinitionId: string | null;
      targetVersionId: string | null;
      targetVersionNo: number | null;
      targetCode: string | null;
      contentHash: string | null;
      capabilityRef: string | null;
      reasonCode: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<BindingRow> {
    const { rows } = await tx.query<BindingRow>(
      `INSERT INTO studio_binding (tenant_id, artifact_version_id, target_engine, target_definition_id, target_version_id, target_version_no, target_code, content_hash, capability_ref, reason_code, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        b.tenantId,
        b.artifactVersionId,
        b.targetEngine,
        b.targetDefinitionId,
        b.targetVersionId,
        b.targetVersionNo,
        b.targetCode,
        b.contentHash,
        b.capabilityRef,
        b.reasonCode,
        b.correlationId,
        b.by,
      ],
    );
    return firstRow(rows, 'insertBinding');
  }
  async getBindingForVersion(tx: Tx, versionId: string): Promise<BindingRow | null> {
    const { rows } = await tx.query<BindingRow>(
      `SELECT * FROM studio_binding WHERE artifact_version_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [versionId],
    );
    return rows[0] ?? null;
  }

  // ---- history + idempotency (append-only) ----
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
      `INSERT INTO studio_artifact_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
      `INSERT INTO studio_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
