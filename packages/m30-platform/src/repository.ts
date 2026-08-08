/**
 * M30 repository — ALL SQL for the platform-foundation layer across its 10 tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`). Queries carry
 * NO tenant_id predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx`. Config/feature/
 * secret-reference histories and the idempotency ledger are append-only. There is NO secret VALUE column — a
 * secret-bearing config value and a secret reference hold an OPAQUE `secretref:` pointer only. No float.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m30 repository: expected a row from ${what}`);
  return row;
}

export interface MetadataRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly category: string;
  readonly meta_key: string;
  readonly value_json: unknown;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConfigDefinitionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly config_key: string;
  readonly value_type: string;
  readonly secret_bearing: boolean;
  readonly is_absolute: boolean;
  readonly required: boolean;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ConfigValueRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly definition_id: string;
  readonly scope: string;
  readonly value_json: unknown;
  readonly secret_ref: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface FeatureDefinitionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly feature_key: string;
  readonly description: string | null;
  readonly default_enabled: boolean;
  readonly is_absolute: boolean;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface FeatureAssignmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly definition_id: string;
  readonly scope: string;
  readonly enabled: boolean;
  readonly reason_code: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface SecretReferenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly ref_key: string;
  readonly secret_ref: string;
  readonly purpose: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

const META_COLS = `tenant_id, id, scope, category, meta_key, value_json, status, version, correlation_id`;
const CDEF_COLS = `tenant_id, id, scope, config_key, value_type, secret_bearing, is_absolute, required, description, status, version, correlation_id`;
const CVAL_COLS = `tenant_id, id, definition_id, scope, value_json, secret_ref, status, version, correlation_id`;
const FDEF_COLS = `tenant_id, id, scope, feature_key, description, default_enabled, is_absolute, status, version, correlation_id`;
const FASG_COLS = `tenant_id, id, definition_id, scope, enabled, reason_code, status, version, correlation_id`;
const SREF_COLS = `tenant_id, id, scope, ref_key, secret_ref, purpose, status, version, correlation_id`;

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

export class PlatformRepository {
  // --- metadata ---------------------------------------------------------------------------------
  async insertMetadata(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      category: string;
      metaKey: string;
      valueJson: unknown;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<MetadataRow> {
    const r = await tx.query<MetadataRow>(
      `INSERT INTO platform_metadata (tenant_id, scope, category, meta_key, value_json, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8) RETURNING ${META_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.category,
        i.metaKey,
        JSON.stringify(i.valueJson ?? null),
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert metadata');
  }
  async findMetadataByIdempotencyKey(tx: Tx, key: string): Promise<MetadataRow | null> {
    const r = await tx.query<MetadataRow>(
      `SELECT ${META_COLS} FROM platform_metadata WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateMetadata(
    tx: Tx,
    i: { id: string; expectedVersion: number; valueJson: unknown; by: string | null },
  ): Promise<MetadataRow | null> {
    const r = await tx.query<MetadataRow>(
      `UPDATE platform_metadata SET value_json=$3::jsonb, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${META_COLS}`,
      [i.id, i.expectedVersion, JSON.stringify(i.valueJson ?? null), i.by],
    );
    return r.rows[0] ?? null;
  }
  async listMetadata(tx: Tx, limit: number, offset: number): Promise<MetadataRow[]> {
    const r = await tx.query<MetadataRow>(
      `SELECT ${META_COLS} FROM platform_metadata ORDER BY scope, category, meta_key LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  // --- config definition ------------------------------------------------------------------------
  async insertConfigDefinition(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      configKey: string;
      valueType: string;
      secretBearing: boolean;
      isAbsolute: boolean;
      required: boolean;
      description: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConfigDefinitionRow> {
    const r = await tx.query<ConfigDefinitionRow>(
      `INSERT INTO platform_config_definition (tenant_id, scope, config_key, value_type, secret_bearing, is_absolute, required, description, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${CDEF_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.configKey,
        i.valueType,
        i.secretBearing,
        i.isAbsolute,
        i.required,
        i.description,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config definition');
  }
  async findConfigDefinition(tx: Tx, id: string): Promise<ConfigDefinitionRow | null> {
    const r = await tx.query<ConfigDefinitionRow>(
      `SELECT ${CDEF_COLS} FROM platform_config_definition WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findActiveConfigDefinition(
    tx: Tx,
    scope: string,
    configKey: string,
  ): Promise<ConfigDefinitionRow | null> {
    const r = await tx.query<ConfigDefinitionRow>(
      `SELECT ${CDEF_COLS} FROM platform_config_definition WHERE scope=$1 AND config_key=$2 AND status='active'`,
      [scope, configKey],
    );
    return r.rows[0] ?? null;
  }
  async findConfigDefinitionByIdempotencyKey(tx: Tx, key: string): Promise<ConfigDefinitionRow | null> {
    const r = await tx.query<ConfigDefinitionRow>(
      `SELECT ${CDEF_COLS} FROM platform_config_definition WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setConfigDefinitionStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ConfigDefinitionRow | null> {
    const r = await tx.query<ConfigDefinitionRow>(
      `UPDATE platform_config_definition SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CDEF_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }

  // --- config value -----------------------------------------------------------------------------
  async insertConfigValue(
    tx: Tx,
    i: {
      tenantId: string;
      definitionId: string;
      scope: string;
      valueJson: unknown;
      secretRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConfigValueRow> {
    const r = await tx.query<ConfigValueRow>(
      `INSERT INTO platform_config_value (tenant_id, definition_id, scope, value_json, secret_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$8) RETURNING ${CVAL_COLS}`,
      [
        i.tenantId,
        i.definitionId,
        i.scope,
        i.valueJson === null ? null : JSON.stringify(i.valueJson),
        i.secretRef,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config value');
  }
  async findActiveConfigValue(tx: Tx, definitionId: string, scope: string): Promise<ConfigValueRow | null> {
    const r = await tx.query<ConfigValueRow>(
      `SELECT ${CVAL_COLS} FROM platform_config_value WHERE definition_id=$1 AND scope=$2 AND status='active'`,
      [definitionId, scope],
    );
    return r.rows[0] ?? null;
  }
  async findConfigValueByIdempotencyKey(tx: Tx, key: string): Promise<ConfigValueRow | null> {
    const r = await tx.query<ConfigValueRow>(
      `SELECT ${CVAL_COLS} FROM platform_config_value WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  // --- feature definition -----------------------------------------------------------------------
  async insertFeatureDefinition(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      featureKey: string;
      description: string | null;
      defaultEnabled: boolean;
      isAbsolute: boolean;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FeatureDefinitionRow> {
    const r = await tx.query<FeatureDefinitionRow>(
      `INSERT INTO platform_feature_definition (tenant_id, scope, feature_key, description, default_enabled, is_absolute, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${FDEF_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.featureKey,
        i.description,
        i.defaultEnabled,
        i.isAbsolute,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert feature definition');
  }
  async findFeatureDefinition(tx: Tx, id: string): Promise<FeatureDefinitionRow | null> {
    const r = await tx.query<FeatureDefinitionRow>(
      `SELECT ${FDEF_COLS} FROM platform_feature_definition WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findActiveFeatureDefinition(
    tx: Tx,
    scope: string,
    featureKey: string,
  ): Promise<FeatureDefinitionRow | null> {
    const r = await tx.query<FeatureDefinitionRow>(
      `SELECT ${FDEF_COLS} FROM platform_feature_definition WHERE scope=$1 AND feature_key=$2 AND status='active'`,
      [scope, featureKey],
    );
    return r.rows[0] ?? null;
  }
  async findFeatureDefinitionByIdempotencyKey(tx: Tx, key: string): Promise<FeatureDefinitionRow | null> {
    const r = await tx.query<FeatureDefinitionRow>(
      `SELECT ${FDEF_COLS} FROM platform_feature_definition WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  // --- feature assignment -----------------------------------------------------------------------
  async insertFeatureAssignment(
    tx: Tx,
    i: {
      tenantId: string;
      definitionId: string;
      scope: string;
      enabled: boolean;
      reasonCode: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FeatureAssignmentRow> {
    const r = await tx.query<FeatureAssignmentRow>(
      `INSERT INTO platform_feature_assignment (tenant_id, definition_id, scope, enabled, reason_code, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${FASG_COLS}`,
      [i.tenantId, i.definitionId, i.scope, i.enabled, i.reasonCode, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert feature assignment');
  }
  async findActiveFeatureAssignment(
    tx: Tx,
    definitionId: string,
    scope: string,
  ): Promise<FeatureAssignmentRow | null> {
    const r = await tx.query<FeatureAssignmentRow>(
      `SELECT ${FASG_COLS} FROM platform_feature_assignment WHERE definition_id=$1 AND scope=$2 AND status='active'`,
      [definitionId, scope],
    );
    return r.rows[0] ?? null;
  }
  async findFeatureAssignmentByIdempotencyKey(tx: Tx, key: string): Promise<FeatureAssignmentRow | null> {
    const r = await tx.query<FeatureAssignmentRow>(
      `SELECT ${FASG_COLS} FROM platform_feature_assignment WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  // --- secret reference -------------------------------------------------------------------------
  async insertSecretReference(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      refKey: string;
      secretRef: string;
      purpose: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SecretReferenceRow> {
    const r = await tx.query<SecretReferenceRow>(
      `INSERT INTO platform_secret_reference (tenant_id, scope, ref_key, secret_ref, purpose, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${SREF_COLS}`,
      [i.tenantId, i.scope, i.refKey, i.secretRef, i.purpose, i.idempotencyKey, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert secret reference');
  }
  async findSecretReference(tx: Tx, id: string): Promise<SecretReferenceRow | null> {
    const r = await tx.query<SecretReferenceRow>(
      `SELECT ${SREF_COLS} FROM platform_secret_reference WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findSecretReferenceByIdempotencyKey(tx: Tx, key: string): Promise<SecretReferenceRow | null> {
    const r = await tx.query<SecretReferenceRow>(
      `SELECT ${SREF_COLS} FROM platform_secret_reference WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setSecretReferenceStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<SecretReferenceRow | null> {
    const r = await tx.query<SecretReferenceRow>(
      `UPDATE platform_secret_reference SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SREF_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }

  // --- histories + idempotency (append-only) ----------------------------------------------------
  async insertConfigHistory(tx: Tx, i: HistoryInsert): Promise<void> {
    await tx.query(
      `INSERT INTO platform_config_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
  async insertFeatureHistory(tx: Tx, i: HistoryInsert): Promise<void> {
    await tx.query(
      `INSERT INTO platform_feature_history (tenant_id, target_type, target_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
  async insertSecretReferenceHistory(tx: Tx, i: HistoryInsert & { referenceId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO platform_secret_reference_history (tenant_id, reference_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.referenceId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
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
      `INSERT INTO platform_idempotency (tenant_id, idempotency_key, target_type, target_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [i.tenantId, i.idempotencyKey, i.targetType, i.targetId, i.correlationId, i.by],
    );
  }
}
