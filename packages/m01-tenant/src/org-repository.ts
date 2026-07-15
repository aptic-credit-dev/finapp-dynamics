import type { Tx } from '@finapp/kernel';
import { firstRow } from './repository.ts';

/**
 * Organisational scope persistence — environments, entities, departments, branches.
 *
 * Every query is written WITHOUT a tenant_id predicate wherever RLS already constrains the row set. The
 * policy is the guarantee; adding a redundant `AND tenant_id = $1` would suggest the filter is what keeps
 * tenants apart, and the day someone forgets it they would be right.
 */

export interface EnvironmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly environment_type: string;
  readonly region: string | null;
  readonly status: string;
  readonly is_default: boolean;
  readonly provisioning_status: string;
  readonly version: number;
  readonly created_at: Date;
}

export interface OrgNodeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly version: number;
  readonly created_at: Date;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
}

export interface EntityRow extends OrgNodeRow {
  readonly legal_name: string;
  readonly trading_name: string | null;
  readonly parent_entity_id: string | null;
  readonly country: string | null;
}

export interface DepartmentRow extends OrgNodeRow {
  readonly entity_id: string;
  readonly parent_department_id: string | null;
  readonly name: string;
}

export interface BranchRow extends OrgNodeRow {
  readonly entity_id: string;
  readonly name: string;
  readonly country: string | null;
}

export class OrgRepository {
  // --- environments -------------------------------------------------------------------------------

  async insertEnvironment(
    tx: Tx,
    input: {
      tenantId: string;
      code: string;
      environmentType: string;
      region: string | null;
      isDefault: boolean;
      createdBy: string | null;
    },
  ): Promise<EnvironmentRow> {
    const result = await tx.query<EnvironmentRow>(
      `INSERT INTO tenant_environments
         (tenant_id, code, environment_type, region, is_default, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [input.tenantId, input.code, input.environmentType, input.region, input.isDefault, input.createdBy],
    );
    return firstRow(result.rows, 'insert environment');
  }

  async listEnvironments(tx: Tx): Promise<EnvironmentRow[]> {
    const result = await tx.query<EnvironmentRow>(
      'SELECT * FROM tenant_environments ORDER BY environment_type, code',
    );
    return result.rows;
  }

  /**
   * Clears the current default so a new one can take its place.
   *
   * Runs before the insert inside the same transaction, because a partial unique index enforces one
   * default per tenant and would otherwise reject the second one.
   */
  async clearDefaultEnvironment(tx: Tx): Promise<void> {
    await tx.query('UPDATE tenant_environments SET is_default = false, updated_at = now() WHERE is_default');
  }

  // --- entities -----------------------------------------------------------------------------------

  async insertEntity(
    tx: Tx,
    input: {
      tenantId: string;
      code: string;
      legalName: string;
      tradingName: string | null;
      parentEntityId: string | null;
      country: string | null;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      createdBy: string | null;
    },
  ): Promise<EntityRow> {
    const result = await tx.query<EntityRow>(
      `INSERT INTO tenant_entities
         (tenant_id, code, legal_name, trading_name, parent_entity_id, country,
          effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.legalName,
        input.tradingName,
        input.parentEntityId,
        input.country,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert entity');
  }

  async listEntities(tx: Tx): Promise<EntityRow[]> {
    const result = await tx.query<EntityRow>('SELECT * FROM tenant_entities ORDER BY code');
    return result.rows;
  }

  async findEntity(tx: Tx, id: string): Promise<EntityRow | null> {
    const result = await tx.query<EntityRow>('SELECT * FROM tenant_entities WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  /**
   * The ancestor chain of an entity, nearest first.
   *
   * Used to reject cycles before a write. The recursive CTE is depth-capped: without the cap, an already
   * corrupt row would make this query loop forever, and the cycle check would hang instead of failing.
   */
  async entityAncestors(tx: Tx, entityId: string): Promise<string[]> {
    const result = await tx.query<{ id: string }>(
      `WITH RECURSIVE chain(id, parent_entity_id, depth) AS (
         SELECT e.id, e.parent_entity_id, 0
         FROM tenant_entities e WHERE e.id = $1
         UNION ALL
         SELECT e.id, e.parent_entity_id, c.depth + 1
         FROM tenant_entities e JOIN chain c ON e.id = c.parent_entity_id
         WHERE c.depth < 64
       )
       SELECT id FROM chain WHERE id <> $1`,
      [entityId],
    );
    return result.rows.map((r) => r.id);
  }

  // --- departments --------------------------------------------------------------------------------

  async insertDepartment(
    tx: Tx,
    input: {
      tenantId: string;
      entityId: string;
      parentDepartmentId: string | null;
      code: string;
      name: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      createdBy: string | null;
    },
  ): Promise<DepartmentRow> {
    const result = await tx.query<DepartmentRow>(
      `INSERT INTO tenant_departments
         (tenant_id, entity_id, parent_department_id, code, name, effective_from, effective_to,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.entityId,
        input.parentDepartmentId,
        input.code,
        input.name,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert department');
  }

  async listDepartments(tx: Tx): Promise<DepartmentRow[]> {
    const result = await tx.query<DepartmentRow>('SELECT * FROM tenant_departments ORDER BY code');
    return result.rows;
  }

  async departmentAncestors(tx: Tx, departmentId: string): Promise<string[]> {
    const result = await tx.query<{ id: string }>(
      `WITH RECURSIVE chain(id, parent_department_id, depth) AS (
         SELECT d.id, d.parent_department_id, 0
         FROM tenant_departments d WHERE d.id = $1
         UNION ALL
         SELECT d.id, d.parent_department_id, c.depth + 1
         FROM tenant_departments d JOIN chain c ON d.id = c.parent_department_id
         WHERE c.depth < 64
       )
       SELECT id FROM chain WHERE id <> $1`,
      [departmentId],
    );
    return result.rows.map((r) => r.id);
  }

  // --- branches -----------------------------------------------------------------------------------

  async insertBranch(
    tx: Tx,
    input: {
      tenantId: string;
      entityId: string;
      code: string;
      name: string;
      country: string | null;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      createdBy: string | null;
    },
  ): Promise<BranchRow> {
    const result = await tx.query<BranchRow>(
      `INSERT INTO tenant_branches
         (tenant_id, entity_id, code, name, country, effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.entityId,
        input.code,
        input.name,
        input.country,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert branch');
  }

  async listBranches(tx: Tx): Promise<BranchRow[]> {
    const result = await tx.query<BranchRow>('SELECT * FROM tenant_branches ORDER BY code');
    return result.rows;
  }

  /**
   * Retires an org node (ADR-010): status + removed_at/removed_by, never a DELETE. The application role
   * holds no DELETE privilege on these tables, so this is the only way out.
   */
  async setOrgStatus(
    tx: Tx,
    table: 'tenant_entities' | 'tenant_departments' | 'tenant_branches',
    input: { id: string; expectedVersion: number; status: string; actor: string | null },
  ): Promise<OrgNodeRow | null> {
    // `table` is a closed union, never caller-supplied text — the only safe way to vary an identifier.
    const result = await tx.query<OrgNodeRow>(
      `UPDATE ${table} SET
         status     = $3,
         removed_at = CASE WHEN $3 = 'removed' THEN now() ELSE NULL END,
         removed_by = CASE WHEN $3 = 'removed' THEN $4::uuid ELSE NULL END,
         version    = version + 1,
         updated_by = $4,
         updated_at = now()
       WHERE id = $1 AND version = $2
       RETURNING *`,
      [input.id, input.expectedVersion, input.status, input.actor],
    );
    return result.rows[0] ?? null;
  }
}
