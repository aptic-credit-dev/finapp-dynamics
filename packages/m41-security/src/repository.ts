/**
 * M41 repository — ALL SQL across its 13 security_/grc_/privacy_ tables. Every query is parameterized; every mutating UPDATE on
 * a mutable aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO tenant_id predicate: RLS
 * FORCE is the isolation guarantee. All methods take the caller's `Tx`. Reveal/finding/incident/review/history/assessment/record
 * + the idempotency ledger are append-only. THERE IS NO SECRET VALUE / ciphertext / token / private-key / password column —
 * secret_ref + provider_ref are opaque pointers only. Rotation is race-safe: the DB enforces ONE active version per secret (a
 * partial unique index); a second concurrent activation loses the race (unique violation).
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m41 repository: expected a row from ${what}`);
  return row;
}

export interface SecretRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly material_kind: string;
  readonly scope: string;
  readonly secret_key: string;
  readonly secret_ref: string;
  readonly algorithm: string | null;
  readonly state: string;
  readonly current_version_no: number;
  readonly version: number;
}
export interface SecretVersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly secret_id: string;
  readonly version_no: number;
  readonly state: string;
  readonly provider_ref: string | null;
  readonly version: number;
}
export interface DlpPolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly policy_key: string;
  readonly classification: string;
  readonly action: string;
  readonly state: string;
  readonly version: number;
}
export interface GrcControlRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly control_key: string;
  readonly framework: string;
  readonly state: string;
  readonly version: number;
}
export interface GrcControlListRow extends GrcControlRow {
  readonly title: string;
  readonly scope: string;
}
export interface GrcAssessmentListRow {
  readonly id: string;
  readonly control_id: string;
  readonly status: string;
  readonly evidence_ref: string | null;
  readonly reason_code: string | null;
  readonly assessed_by: string | null;
  readonly created_at: string;
}
export interface PrivacyClassificationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly classification_key: string;
  readonly level: string;
  readonly state: string;
  readonly version: number;
}

export class SecurityRepository {
  // ---- secret (mutable aggregate) ----
  async insertSecret(
    tx: Tx,
    s: {
      tenantId: string;
      materialKind: string;
      scope: string;
      secretKey: string;
      secretRef: string;
      algorithm: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SecretRow> {
    const { rows } = await tx.query<SecretRow>(
      `INSERT INTO security_secret (tenant_id, material_kind, scope, secret_key, secret_ref, algorithm, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING tenant_id, id, material_kind, scope, secret_key, secret_ref, algorithm, state, current_version_no, version`,
      [s.tenantId, s.materialKind, s.scope, s.secretKey, s.secretRef, s.algorithm, s.correlationId, s.by],
    );
    return firstRow(rows, 'insertSecret');
  }
  async getSecret(tx: Tx, id: string): Promise<SecretRow | null> {
    const { rows } = await tx.query<SecretRow>(
      `SELECT tenant_id, id, material_kind, scope, secret_key, secret_ref, algorithm, state, current_version_no, version FROM security_secret WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async getSecretByRef(tx: Tx, secretRef: string): Promise<SecretRow | null> {
    const { rows } = await tx.query<SecretRow>(
      `SELECT tenant_id, id, material_kind, scope, secret_key, secret_ref, algorithm, state, current_version_no, version FROM security_secret WHERE secret_ref=$1 LIMIT 1`,
      [secretRef],
    );
    return rows[0] ?? null;
  }
  async updateSecret(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; currentVersionNo: number; by: string | null },
  ): Promise<SecretRow | null> {
    const { rows } = await tx.query<SecretRow>(
      `UPDATE security_secret SET state=$3, current_version_no=$4, version=version+1, updated_at=now(), updated_by=$5
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, material_kind, scope, secret_key, secret_ref, algorithm, state, current_version_no, version`,
      [id, expectedVersion, patch.state, patch.currentVersionNo, patch.by],
    );
    return rows[0] ?? null;
  }
  async listSecrets(tx: Tx, limit: number, offset: number): Promise<SecretRow[]> {
    const { rows } = await tx.query<SecretRow>(
      `SELECT tenant_id, id, material_kind, scope, secret_key, secret_ref, algorithm, state, current_version_no, version FROM security_secret ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- secret version (mutable; one-active partial unique index; immutability trigger) ----
  async insertSecretVersion(
    tx: Tx,
    v: {
      tenantId: string;
      secretId: string;
      versionNo: number;
      providerRef: string | null;
      state: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SecretVersionRow> {
    const { rows } = await tx.query<SecretVersionRow>(
      `INSERT INTO security_secret_version (tenant_id, secret_id, version_no, state, provider_ref, activated_at, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $4='active' THEN now() ELSE NULL END,$6,$7,$7)
       RETURNING tenant_id, id, secret_id, version_no, state, provider_ref, version`,
      [v.tenantId, v.secretId, v.versionNo, v.state, v.providerRef, v.correlationId, v.by],
    );
    return firstRow(rows, 'insertSecretVersion');
  }
  async getActiveVersion(tx: Tx, secretId: string): Promise<SecretVersionRow | null> {
    const { rows } = await tx.query<SecretVersionRow>(
      `SELECT tenant_id, id, secret_id, version_no, state, provider_ref, version FROM security_secret_version WHERE secret_id=$1 AND state='active' LIMIT 1`,
      [secretId],
    );
    return rows[0] ?? null;
  }
  async countVersions(tx: Tx, secretId: string): Promise<number> {
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM security_secret_version WHERE secret_id=$1`,
      [secretId],
    );
    return Number(rows[0]?.n ?? '0');
  }
  async updateVersionState(
    tx: Tx,
    id: string,
    expectedVersion: number,
    state: string,
    by: string | null,
  ): Promise<SecretVersionRow | null> {
    const { rows } = await tx.query<SecretVersionRow>(
      `UPDATE security_secret_version SET state=$3, version=version+1, updated_at=now(), updated_by=$4
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, secret_id, version_no, state, provider_ref, version`,
      [id, expectedVersion, state, by],
    );
    return rows[0] ?? null;
  }

  // ---- reveal (append-only; maker-checker) ----
  async insertReveal(
    tx: Tx,
    r: {
      tenantId: string;
      secretId: string;
      requestedBy: string;
      approvedBy: string;
      purpose: string;
      reasonCode: string | null;
      granted: boolean;
      validTo: Date | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO security_reveal (tenant_id, secret_id, requested_by, approved_by, purpose, reason_code, granted, expires_at, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        r.tenantId,
        r.secretId,
        r.requestedBy,
        r.approvedBy,
        r.purpose,
        r.reasonCode,
        r.granted,
        r.validTo,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReveal');
  }

  // ---- dlp policy (mutable) + finding (append-only) ----
  async insertDlpPolicy(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      policyKey: string;
      classification: string;
      action: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DlpPolicyRow> {
    const { rows } = await tx.query<DlpPolicyRow>(
      `INSERT INTO security_dlp_policy (tenant_id, scope, policy_key, classification, action, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING tenant_id, id, policy_key, classification, action, state, version`,
      [p.tenantId, p.scope, p.policyKey, p.classification, p.action, p.correlationId, p.by],
    );
    return firstRow(rows, 'insertDlpPolicy');
  }
  async findDlpPolicy(tx: Tx, classification: string): Promise<DlpPolicyRow | null> {
    const { rows } = await tx.query<DlpPolicyRow>(
      `SELECT tenant_id, id, policy_key, classification, action, state, version FROM security_dlp_policy WHERE classification=$1 AND state='active' ORDER BY created_at DESC LIMIT 1`,
      [classification],
    );
    return rows[0] ?? null;
  }
  async insertDlpFinding(
    tx: Tx,
    f: {
      tenantId: string;
      policyId: string | null;
      classification: string;
      action: string;
      reasonCode: string | null;
      sourceRef: string | null;
      findingCount: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO security_dlp_finding (tenant_id, policy_id, classification, action, reason_code, source_ref, finding_count, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        f.tenantId,
        f.policyId,
        f.classification,
        f.action,
        f.reasonCode,
        f.sourceRef,
        f.findingCount,
        f.correlationId,
        f.by,
      ],
    );
    return firstRow(rows, 'insertDlpFinding');
  }

  // ---- incident (append-only) ----
  async insertIncident(
    tx: Tx,
    i: {
      tenantId: string;
      incidentKey: string;
      severity: string;
      category: string;
      reasonCode: string | null;
      evidenceRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO security_incident (tenant_id, incident_key, severity, category, reason_code, evidence_ref, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [i.tenantId, i.incidentKey, i.severity, i.category, i.reasonCode, i.evidenceRef, i.correlationId, i.by],
    );
    return firstRow(rows, 'insertIncident');
  }

  // ---- grc control (mutable) + assessment (append-only) ----
  async insertGrcControl(
    tx: Tx,
    c: {
      tenantId: string;
      scope: string;
      controlKey: string;
      framework: string;
      title: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GrcControlRow> {
    const { rows } = await tx.query<GrcControlRow>(
      `INSERT INTO grc_control (tenant_id, scope, control_key, framework, title, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, control_key, framework, state, version`,
      [c.tenantId, c.scope, c.controlKey, c.framework, c.title, c.correlationId, c.by],
    );
    return firstRow(rows, 'insertGrcControl');
  }
  async getGrcControl(tx: Tx, id: string): Promise<GrcControlRow | null> {
    const { rows } = await tx.query<GrcControlRow>(
      `SELECT tenant_id, id, control_key, framework, state, version FROM grc_control WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  // Read surface (RLS-scoped): the caller runs inside withTenant, so FORCE ROW LEVEL SECURITY restricts these
  // to the caller's tenant. Read-only — no audit event (reads are not audited; ADR-005/CLAUDE.md).
  async listGrcControls(tx: Tx): Promise<GrcControlListRow[]> {
    const { rows } = await tx.query<GrcControlListRow>(
      `SELECT tenant_id, id, control_key, framework, title, scope, state, version
         FROM grc_control ORDER BY framework, control_key`,
    );
    return rows;
  }
  async listGrcAssessments(tx: Tx, controlId: string): Promise<GrcAssessmentListRow[]> {
    const { rows } = await tx.query<GrcAssessmentListRow>(
      `SELECT id, control_id, status, evidence_ref, reason_code, assessed_by, created_at::text AS created_at
         FROM grc_assessment WHERE control_id=$1 ORDER BY created_at DESC`,
      [controlId],
    );
    return rows;
  }
  async insertGrcAssessment(
    tx: Tx,
    a: {
      tenantId: string;
      controlId: string;
      status: string;
      evidenceRef: string | null;
      reasonCode: string | null;
      assessedBy: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO grc_assessment (tenant_id, control_id, status, evidence_ref, reason_code, assessed_by, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [a.tenantId, a.controlId, a.status, a.evidenceRef, a.reasonCode, a.assessedBy, a.correlationId],
    );
    return firstRow(rows, 'insertGrcAssessment');
  }

  // ---- privacy classification (mutable) + record (append-only) ----
  async insertPrivacyClassification(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      classificationKey: string;
      level: string;
      retentionDays: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PrivacyClassificationRow> {
    const { rows } = await tx.query<PrivacyClassificationRow>(
      `INSERT INTO privacy_classification (tenant_id, scope, classification_key, level, retention_days, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING tenant_id, id, classification_key, level, state, version`,
      [p.tenantId, p.scope, p.classificationKey, p.level, p.retentionDays, p.correlationId, p.by],
    );
    return firstRow(rows, 'insertPrivacyClassification');
  }
  async insertPrivacyRecord(
    tx: Tx,
    r: {
      tenantId: string;
      subjectRef: string;
      classification: string | null;
      action: string;
      reasonCode: string | null;
      evidenceRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO privacy_record (tenant_id, subject_ref, classification, action, reason_code, evidence_ref, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        r.tenantId,
        r.subjectRef,
        r.classification,
        r.action,
        r.reasonCode,
        r.evidenceRef,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'insertPrivacyRecord');
  }

  // ---- review + history + idempotency (append-only) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetKind: string;
      targetId: string;
      decision: string;
      requestedBy: string;
      decidedBy: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO security_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        r.tenantId,
        r.targetKind,
        r.targetId,
        r.decision,
        r.requestedBy,
        r.decidedBy,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      subjectKind: string;
      subjectId: string;
      fromState: string | null;
      toState: string;
      reasonCode: string | null;
      actor: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO security_history (tenant_id, subject_kind, subject_id, from_state, to_state, reason_code, actor, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        h.tenantId,
        h.subjectKind,
        h.subjectId,
        h.fromState,
        h.toState,
        h.reasonCode,
        h.actor,
        h.correlationId,
      ],
    );
  }
  async claimIdempotency(
    tx: Tx,
    i: { tenantId: string; key: string; operation: string; correlationId: string; by: string | null },
  ): Promise<boolean> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO security_idempotency (tenant_id, idempotency_key, operation, correlation_id, created_by)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
      [i.tenantId, i.key, i.operation, i.correlationId, i.by],
    );
    return rows[0] !== undefined;
  }
}
