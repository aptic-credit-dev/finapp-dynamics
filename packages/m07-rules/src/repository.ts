/**
 * M07 repository — ALL SQL for the rules engine. Every query is parameterized; every mutating UPDATE is
 * optimistic-lock guarded (`WHERE ... AND version = $expected`) so a stale command changes zero rows and the
 * caller raises 409. Queries carry NO tenant_id predicate: RLS is the isolation guarantee, not a WHERE clause.
 * All methods take the caller's `Tx` (obtained from `db.withTenant`) so state, evidence, audit and outbox
 * commit atomically. Evaluation + history are append-only (the app role has no UPDATE on them, by GRANT).
 */
import type { Tx } from '@finapp/kernel';

export interface RuleSetRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly scope: string;
  readonly status: string;
  readonly version: number;
}

export interface RuleSetVersionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly rule_set_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly notes: string | null;
  readonly version: number;
}

export interface RuleEvaluationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly rule_set_id: string;
  readonly version_id: string;
  readonly version_number: number;
  readonly idempotency_key: string | null;
  readonly input_hash: string;
  readonly engine_version: string;
  readonly status: string;
  readonly outcome: unknown;
  readonly reason_codes: string[];
  readonly mode: string;
  readonly correlation_id: string;
  readonly evaluated_at: string;
  readonly evaluated_by: string | null;
}

export interface RuleTestCaseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly rule_set_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly input: unknown;
  readonly expected: unknown;
  readonly enabled: boolean;
  readonly version: number;
}

const RULE_SET_COLS = 'tenant_id, id, key, name, description, scope, status, version';
const VERSION_COLS =
  'tenant_id, id, rule_set_id, version_number, status, spec, content_hash, notes, version';
const EVAL_COLS =
  'tenant_id, id, rule_set_id, version_id, version_number, idempotency_key, input_hash, engine_version, status, outcome, reason_codes, mode, correlation_id, evaluated_at, evaluated_by';
const TEST_COLS =
  'tenant_id, id, rule_set_id, name, description, input, expected, enabled, version';

export class RulesRepository {
  // --- rule sets --------------------------------------------------------------------------------
  async insertRuleSet(
    tx: Tx,
    input: {
      tenantId: string;
      key: string;
      name: string;
      description: string | null;
      scope: string;
      createdBy: string | null;
    },
  ): Promise<RuleSetRow> {
    const r = await tx.query<RuleSetRow>(
      `INSERT INTO rule_set (tenant_id, key, name, description, scope, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING ${RULE_SET_COLS}`,
      [input.tenantId, input.key, input.name, input.description, input.scope, input.createdBy],
    );
    return firstRow(r.rows, 'insert rule_set');
  }

  async findRuleSet(tx: Tx, id: string): Promise<RuleSetRow | null> {
    const r = await tx.query<RuleSetRow>(`SELECT ${RULE_SET_COLS} FROM rule_set WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async findRuleSetByKey(tx: Tx, key: string): Promise<RuleSetRow | null> {
    const r = await tx.query<RuleSetRow>(`SELECT ${RULE_SET_COLS} FROM rule_set WHERE key = $1`, [key]);
    return r.rows[0] ?? null;
  }

  async listRuleSets(tx: Tx): Promise<RuleSetRow[]> {
    const r = await tx.query<RuleSetRow>(`SELECT ${RULE_SET_COLS} FROM rule_set ORDER BY key`);
    return r.rows;
  }

  /** Rename / re-describe a rule set. Version-guarded; returns null on stale version. */
  async updateRuleSet(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      name: string;
      description: string | null;
      updatedBy: string | null;
    },
  ): Promise<RuleSetRow | null> {
    const r = await tx.query<RuleSetRow>(
      `UPDATE rule_set
         SET name = $3, description = $4, updated_by = $5, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${RULE_SET_COLS}`,
      [input.id, input.expectedVersion, input.name, input.description, input.updatedBy],
    );
    return r.rows[0] ?? null;
  }

  async retireRuleSet(
    tx: Tx,
    input: { id: string; expectedVersion: number; updatedBy: string | null },
  ): Promise<RuleSetRow | null> {
    const r = await tx.query<RuleSetRow>(
      `UPDATE rule_set
         SET status = 'retired', updated_by = $3, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $2 AND status = 'active'
       RETURNING ${RULE_SET_COLS}`,
      [input.id, input.expectedVersion, input.updatedBy],
    );
    return r.rows[0] ?? null;
  }

  // --- versions ---------------------------------------------------------------------------------
  /** Next version number for a rule set (max + 1). MAX over the tenant-isolated rows. */
  async nextVersionNumber(tx: Tx, ruleSetId: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
       FROM rule_set_version WHERE rule_set_id = $1`,
      [ruleSetId],
    );
    return firstRow(r.rows, 'next version number').next;
  }

  async insertVersion(
    tx: Tx,
    input: {
      tenantId: string;
      ruleSetId: string;
      versionNumber: number;
      spec: unknown;
      notes: string | null;
      createdBy: string | null;
    },
  ): Promise<RuleSetVersionRow> {
    const r = await tx.query<RuleSetVersionRow>(
      `INSERT INTO rule_set_version (tenant_id, rule_set_id, version_number, spec, notes, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING ${VERSION_COLS}`,
      [
        input.tenantId,
        input.ruleSetId,
        input.versionNumber,
        JSON.stringify(input.spec),
        input.notes,
        input.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert version');
  }

  async findVersion(tx: Tx, id: string): Promise<RuleSetVersionRow | null> {
    const r = await tx.query<RuleSetVersionRow>(`SELECT ${VERSION_COLS} FROM rule_set_version WHERE id = $1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }

  async findVersionByNumber(
    tx: Tx,
    ruleSetId: string,
    versionNumber: number,
  ): Promise<RuleSetVersionRow | null> {
    const r = await tx.query<RuleSetVersionRow>(
      `SELECT ${VERSION_COLS} FROM rule_set_version WHERE rule_set_id = $1 AND version_number = $2`,
      [ruleSetId, versionNumber],
    );
    return r.rows[0] ?? null;
  }

  async findActiveVersion(tx: Tx, ruleSetId: string): Promise<RuleSetVersionRow | null> {
    const r = await tx.query<RuleSetVersionRow>(
      `SELECT ${VERSION_COLS} FROM rule_set_version WHERE rule_set_id = $1 AND status = 'ACTIVE'`,
      [ruleSetId],
    );
    return r.rows[0] ?? null;
  }

  async listVersions(tx: Tx, ruleSetId: string): Promise<RuleSetVersionRow[]> {
    const r = await tx.query<RuleSetVersionRow>(
      `SELECT ${VERSION_COLS} FROM rule_set_version WHERE rule_set_id = $1 ORDER BY version_number`,
      [ruleSetId],
    );
    return r.rows;
  }

  /**
   * Version-guarded status change (validate/publish/activate/retire/archive). At publish we also freeze the
   * canonical content hash. Returns null on stale version (409). The immutable spec column is NEVER updated
   * here — a published version's content is frozen; a change means a NEW version.
   */
  async updateVersionStatus(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash?: string | null;
      publishedBy?: string | null;
    },
  ): Promise<RuleSetVersionRow | null> {
    const r = await tx.query<RuleSetVersionRow>(
      `UPDATE rule_set_version
         SET status = $3,
             content_hash = COALESCE($4, content_hash),
             published_at = CASE WHEN $3 = 'PUBLISHED' THEN now() ELSE published_at END,
             published_by = COALESCE($5, published_by),
             version = version + 1
       WHERE id = $1 AND version = $2
       RETURNING ${VERSION_COLS}`,
      [input.id, input.expectedVersion, input.toStatus, input.contentHash ?? null, input.publishedBy ?? null],
    );
    return r.rows[0] ?? null;
  }

  /** Retire the currently-ACTIVE version of a rule set (so a new one can activate). */
  async retireActiveVersions(tx: Tx, ruleSetId: string): Promise<void> {
    await tx.query(
      `UPDATE rule_set_version SET status = 'RETIRED', version = version + 1
       WHERE rule_set_id = $1 AND status = 'ACTIVE'`,
      [ruleSetId],
    );
  }

  // --- evaluation evidence (append-only) --------------------------------------------------------
  /**
   * Insert a decision record. For governed 'evaluate' calls with an idempotency key, a duplicate key raises a
   * unique violation — the caller catches it and returns the stored decision (idempotent retry). The raw input
   * is NEVER stored; only its hash and the redacted outcome (ADR-035).
   */
  async insertEvaluation(
    tx: Tx,
    input: {
      tenantId: string;
      ruleSetId: string;
      versionId: string;
      versionNumber: number;
      idempotencyKey: string | null;
      inputHash: string;
      engineVersion: string;
      status: string;
      outcome: unknown;
      reasonCodes: string[];
      mode: string;
      correlationId: string;
      evaluatedBy: string | null;
    },
  ): Promise<RuleEvaluationRow> {
    const r = await tx.query<RuleEvaluationRow>(
      `INSERT INTO rule_evaluation
         (tenant_id, rule_set_id, version_id, version_number, idempotency_key, input_hash, engine_version,
          status, outcome, reason_codes, mode, correlation_id, evaluated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
       RETURNING ${EVAL_COLS}`,
      [
        input.tenantId,
        input.ruleSetId,
        input.versionId,
        input.versionNumber,
        input.idempotencyKey,
        input.inputHash,
        input.engineVersion,
        input.status,
        JSON.stringify(input.outcome),
        input.reasonCodes,
        input.mode,
        input.correlationId,
        input.evaluatedBy,
      ],
    );
    return firstRow(r.rows, 'insert evaluation');
  }

  async findEvaluation(tx: Tx, id: string): Promise<RuleEvaluationRow | null> {
    const r = await tx.query<RuleEvaluationRow>(`SELECT ${EVAL_COLS} FROM rule_evaluation WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  /** Look up a prior governed evaluation by idempotency key (mode 'evaluate' only, matching the unique index). */
  async findEvaluationByIdempotencyKey(
    tx: Tx,
    ruleSetId: string,
    idempotencyKey: string,
  ): Promise<RuleEvaluationRow | null> {
    const r = await tx.query<RuleEvaluationRow>(
      `SELECT ${EVAL_COLS} FROM rule_evaluation
       WHERE rule_set_id = $1 AND idempotency_key = $2 AND mode = 'evaluate'`,
      [ruleSetId, idempotencyKey],
    );
    return r.rows[0] ?? null;
  }

  async listEvaluations(tx: Tx, ruleSetId: string, limit: number): Promise<RuleEvaluationRow[]> {
    const r = await tx.query<RuleEvaluationRow>(
      `SELECT ${EVAL_COLS} FROM rule_evaluation
       WHERE rule_set_id = $1 ORDER BY evaluated_at DESC LIMIT $2`,
      [ruleSetId, limit],
    );
    return r.rows;
  }

  // --- test cases -------------------------------------------------------------------------------
  async insertTestCase(
    tx: Tx,
    input: {
      tenantId: string;
      ruleSetId: string;
      name: string;
      description: string | null;
      input: unknown;
      expected: unknown;
      createdBy: string | null;
    },
  ): Promise<RuleTestCaseRow> {
    const r = await tx.query<RuleTestCaseRow>(
      `INSERT INTO rule_test_case (tenant_id, rule_set_id, name, description, input, expected, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $7)
       RETURNING ${TEST_COLS}`,
      [
        input.tenantId,
        input.ruleSetId,
        input.name,
        input.description,
        JSON.stringify(input.input),
        JSON.stringify(input.expected),
        input.createdBy,
      ],
    );
    return firstRow(r.rows, 'insert test case');
  }

  async findTestCase(tx: Tx, id: string): Promise<RuleTestCaseRow | null> {
    const r = await tx.query<RuleTestCaseRow>(`SELECT ${TEST_COLS} FROM rule_test_case WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async listTestCases(tx: Tx, ruleSetId: string): Promise<RuleTestCaseRow[]> {
    const r = await tx.query<RuleTestCaseRow>(
      `SELECT ${TEST_COLS} FROM rule_test_case WHERE rule_set_id = $1 ORDER BY name`,
      [ruleSetId],
    );
    return r.rows;
  }

  // --- history (append-only) --------------------------------------------------------------------
  async appendHistory(
    tx: Tx,
    input: {
      tenantId: string;
      ruleSetId: string;
      versionId: string | null;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO rule_set_history
         (tenant_id, rule_set_id, version_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.tenantId,
        input.ruleSetId,
        input.versionId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  async listHistory(tx: Tx, ruleSetId: string): Promise<RuleSetHistoryRow[]> {
    const r = await tx.query<RuleSetHistoryRow>(
      `SELECT tenant_id, id, rule_set_id, version_id, from_status, to_status, action, reason, correlation_id, changed_by, at
       FROM rule_set_history WHERE rule_set_id = $1 ORDER BY at`,
      [ruleSetId],
    );
    return r.rows;
  }
}

export interface RuleSetHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly rule_set_id: string;
  readonly version_id: string | null;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly action: string;
  readonly reason: string | null;
  readonly correlation_id: string;
  readonly changed_by: string | null;
  readonly at: string;
}

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m07 repository: expected a row from ${what}`);
  return row;
}
