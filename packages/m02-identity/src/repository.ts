import type { Tx } from '@finapp/kernel';

/**
 * M02 persistence. Every method takes the caller's `Tx` — the repository never opens a transaction, so a
 * read and the write that depends on it cannot drift apart.
 *
 * Queries carry no `tenant_id` predicate where RLS already constrains the row set. The policy is the
 * guarantee; a redundant filter would suggest the filter is what keeps tenants apart.
 */

export function firstRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`${what}: expected exactly one row, got none.`);
  return row;
}

export interface IdentityRow {
  readonly id: string;
  readonly identity_type: string;
  readonly display_name: string;
  readonly given_name: string | null;
  readonly family_name: string | null;
  readonly primary_email: string | null;
  readonly primary_email_norm: string | null;
  readonly organization_ref: string | null;
  readonly external_ref: string | null;
  readonly status: string;
  readonly data_classification: string;
  readonly version: number;
  readonly created_at: Date;
}

export interface AccountRow {
  readonly id: string;
  readonly identity_id: string;
  readonly account_type: string;
  readonly login_identifier: string;
  readonly login_identifier_norm: string;
  readonly status: string;
  readonly activated_at: Date | null;
  readonly version: number;
  readonly created_at: Date;
}

export interface MembershipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly identity_id: string;
  readonly account_id: string | null;
  readonly membership_type: string;
  readonly status: string;
  readonly is_primary: boolean;
  readonly start_date: Date;
  readonly end_date: Date | null;
  readonly entity_id: string | null;
  readonly department_id: string | null;
  readonly branch_id: string | null;
  readonly environment_id: string | null;
  readonly version: number;
}

/** The single row actor resolution needs: account and its identity, joined. */
export interface AccountWithIdentityRow {
  readonly account_id: string;
  readonly account_status: string;
  readonly account_type: string;
  readonly identity_id: string;
  readonly identity_status: string;
  readonly identity_type: string;
}

export class IdentityRepository {
  // --- actor resolution ---------------------------------------------------------------------------

  /** One query, not two: the account and its identity must be judged as of the same instant. */
  async findAccountWithIdentity(tx: Tx, accountId: string): Promise<AccountWithIdentityRow | null> {
    const result = await tx.query<AccountWithIdentityRow>(
      `SELECT a.id AS account_id, a.status AS account_status, a.account_type,
              i.id AS identity_id, i.status AS identity_status, i.identity_type
       FROM user_accounts a JOIN identities i ON i.id = a.identity_id
       WHERE a.id = $1`,
      [accountId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * The identity's live membership in the CURRENT tenant context.
   *
   * No tenant predicate: RLS decides. Called inside withTenant, so a membership in another tenant is
   * invisible here — which is the point.
   */
  async findLiveMembership(tx: Tx, identityId: string): Promise<MembershipRow | null> {
    const result = await tx.query<MembershipRow>(
      `SELECT * FROM tenant_memberships WHERE identity_id = $1 AND status <> 'ended' LIMIT 1`,
      [identityId],
    );
    return result.rows[0] ?? null;
  }

  // --- identities ---------------------------------------------------------------------------------

  async insertIdentity(
    tx: Tx,
    input: {
      identityType: string;
      displayName: string;
      givenName: string | null;
      familyName: string | null;
      primaryEmail: string | null;
      primaryEmailNorm: string | null;
      organizationRef: string | null;
      externalRef: string | null;
      classification: string;
      createdBy: string | null;
    },
  ): Promise<IdentityRow> {
    const result = await tx.query<IdentityRow>(
      `INSERT INTO identities
         (identity_type, display_name, given_name, family_name, primary_email, primary_email_norm,
          organization_ref, external_ref, data_classification, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $10)
       RETURNING *`,
      [
        input.identityType,
        input.displayName,
        input.givenName,
        input.familyName,
        input.primaryEmail,
        input.primaryEmailNorm,
        input.organizationRef,
        input.externalRef,
        input.classification,
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert identity');
  }

  async findIdentity(tx: Tx, id: string): Promise<IdentityRow | null> {
    const result = await tx.query<IdentityRow>('SELECT * FROM identities WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async findIdentityByEmailNorm(tx: Tx, emailNorm: string): Promise<IdentityRow | null> {
    const result = await tx.query<IdentityRow>('SELECT * FROM identities WHERE primary_email_norm = $1', [
      emailNorm,
    ]);
    return result.rows[0] ?? null;
  }

  async listIdentities(
    tx: Tx,
    opts: { status?: string; limit: number; offset: number },
  ): Promise<IdentityRow[]> {
    const result = await tx.query<IdentityRow>(
      `SELECT * FROM identities WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [opts.status ?? null, opts.limit, opts.offset],
    );
    return result.rows;
  }

  async applyIdentityStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string; updatedBy: string | null },
  ): Promise<IdentityRow | null> {
    const result = await tx.query<IdentityRow>(
      `UPDATE identities SET status = $3, version = version + 1, updated_by = $4, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING *`,
      [input.id, input.expectedVersion, input.toStatus, input.updatedBy],
    );
    return result.rows[0] ?? null;
  }

  async updateIdentityProfile(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      displayName?: string | undefined;
      givenName?: string | null | undefined;
      familyName?: string | null | undefined;
      organizationRef?: string | null | undefined;
      updatedBy: string | null;
    },
  ): Promise<IdentityRow | null> {
    const result = await tx.query<IdentityRow>(
      `UPDATE identities SET
         display_name     = COALESCE($3, display_name),
         given_name       = CASE WHEN $4::boolean THEN $5 ELSE given_name END,
         family_name      = CASE WHEN $6::boolean THEN $7 ELSE family_name END,
         organization_ref = CASE WHEN $8::boolean THEN $9 ELSE organization_ref END,
         version = version + 1, updated_by = $10, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING *`,
      [
        input.id,
        input.expectedVersion,
        input.displayName ?? null,
        input.givenName !== undefined,
        input.givenName ?? null,
        input.familyName !== undefined,
        input.familyName ?? null,
        input.organizationRef !== undefined,
        input.organizationRef ?? null,
        input.updatedBy,
      ],
    );
    return result.rows[0] ?? null;
  }

  // --- accounts -----------------------------------------------------------------------------------

  async insertAccount(
    tx: Tx,
    input: {
      identityId: string;
      accountType: string;
      loginIdentifier: string;
      loginIdentifierNorm: string;
      createdBy: string | null;
    },
  ): Promise<AccountRow> {
    const result = await tx.query<AccountRow>(
      `INSERT INTO user_accounts
         (identity_id, account_type, login_identifier, login_identifier_norm, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'pending_activation', $5, $5)
       RETURNING *`,
      [
        input.identityId,
        input.accountType,
        input.loginIdentifier,
        input.loginIdentifierNorm,
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert account');
  }

  async findAccount(tx: Tx, id: string): Promise<AccountRow | null> {
    const result = await tx.query<AccountRow>('SELECT * FROM user_accounts WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async listAccounts(
    tx: Tx,
    opts: { identityId?: string; limit: number; offset: number },
  ): Promise<AccountRow[]> {
    const result = await tx.query<AccountRow>(
      `SELECT * FROM user_accounts WHERE ($1::uuid IS NULL OR identity_id = $1)
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [opts.identityId ?? null, opts.limit, opts.offset],
    );
    return result.rows;
  }

  async applyAccountStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string; updatedBy: string | null },
  ): Promise<AccountRow | null> {
    const result = await tx.query<AccountRow>(
      `UPDATE user_accounts SET
         status = $3, version = version + 1, updated_by = $4, updated_at = now(),
         activated_at = CASE WHEN $3 = 'active' AND activated_at IS NULL THEN now() ELSE activated_at END,
         suspended_at = CASE WHEN $3 = 'suspended' THEN now()
                             WHEN $3 = 'active' THEN NULL ELSE suspended_at END
       WHERE id = $1 AND version = $2 RETURNING *`,
      [input.id, input.expectedVersion, input.toStatus, input.updatedBy],
    );
    return result.rows[0] ?? null;
  }

  // --- memberships --------------------------------------------------------------------------------

  async insertMembership(
    tx: Tx,
    input: {
      tenantId: string;
      identityId: string;
      accountId: string | null;
      membershipType: string;
      isPrimary: boolean;
      entityId: string | null;
      departmentId: string | null;
      branchId: string | null;
      environmentId: string | null;
      createdBy: string | null;
    },
  ): Promise<MembershipRow> {
    const result = await tx.query<MembershipRow>(
      `INSERT INTO tenant_memberships
         (tenant_id, identity_id, account_id, membership_type, is_primary, entity_id, department_id,
          branch_id, environment_id, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $10)
       RETURNING *`,
      [
        input.tenantId,
        input.identityId,
        input.accountId,
        input.membershipType,
        input.isPrimary,
        input.entityId,
        input.departmentId,
        input.branchId,
        input.environmentId,
        input.createdBy,
      ],
    );
    return firstRow(result.rows, 'insert membership');
  }

  async findMembership(tx: Tx, id: string): Promise<MembershipRow | null> {
    const result = await tx.query<MembershipRow>('SELECT * FROM tenant_memberships WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async listMemberships(
    tx: Tx,
    opts: { status?: string; limit: number; offset: number },
  ): Promise<MembershipRow[]> {
    const result = await tx.query<MembershipRow>(
      `SELECT * FROM tenant_memberships WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [opts.status ?? null, opts.limit, opts.offset],
    );
    return result.rows;
  }

  async applyMembershipStatus(
    tx: Tx,
    input: { id: string; expectedVersion: number; toStatus: string; updatedBy: string | null },
  ): Promise<MembershipRow | null> {
    const result = await tx.query<MembershipRow>(
      `UPDATE tenant_memberships SET
         status = $3, version = version + 1, updated_by = $4, updated_at = now(),
         end_date = CASE WHEN $3 = 'ended' THEN now() ELSE end_date END
       WHERE id = $1 AND version = $2 RETURNING *`,
      [input.id, input.expectedVersion, input.toStatus, input.updatedBy],
    );
    return result.rows[0] ?? null;
  }

  async updateMembershipScope(
    tx: Tx,
    input: {
      id: string;
      expectedVersion: number;
      entityId?: string | null | undefined;
      departmentId?: string | null | undefined;
      branchId?: string | null | undefined;
      updatedBy: string | null;
    },
  ): Promise<MembershipRow | null> {
    const result = await tx.query<MembershipRow>(
      `UPDATE tenant_memberships SET
         entity_id     = CASE WHEN $3::boolean THEN $4::uuid ELSE entity_id END,
         department_id = CASE WHEN $5::boolean THEN $6::uuid ELSE department_id END,
         branch_id     = CASE WHEN $7::boolean THEN $8::uuid ELSE branch_id END,
         version = version + 1, updated_by = $9, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING *`,
      [
        input.id,
        input.expectedVersion,
        input.entityId !== undefined,
        input.entityId ?? null,
        input.departmentId !== undefined,
        input.departmentId ?? null,
        input.branchId !== undefined,
        input.branchId ?? null,
        input.updatedBy,
      ],
    );
    return result.rows[0] ?? null;
  }

  // --- histories (append-only) --------------------------------------------------------------------

  async appendIdentityHistory(
    tx: Tx,
    input: {
      identityId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO identity_status_history
         (identity_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.identityId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  async appendAccountHistory(
    tx: Tx,
    input: {
      accountId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO account_status_history
         (account_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.accountId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  async appendMembershipHistory(
    tx: Tx,
    input: {
      tenantId: string;
      membershipId: string;
      fromStatus: string | null;
      toStatus: string;
      action: string;
      reason: string | null;
      correlationId: string;
      changedBy: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO membership_status_history
         (tenant_id, membership_id, from_status, to_status, action, reason, correlation_id, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.tenantId,
        input.membershipId,
        input.fromStatus,
        input.toStatus,
        input.action,
        input.reason,
        input.correlationId,
        input.changedBy,
      ],
    );
  }

  /** Links an external auth subject. Readiness only — nothing authenticates against this in 1B. */
  async insertAuthSubject(
    tx: Tx,
    input: {
      accountId: string;
      providerCode: string;
      issuer: string;
      subject: string;
      createdBy: string | null;
    },
  ): Promise<{ id: string }> {
    const result = await tx.query<{ id: string }>(
      `INSERT INTO authentication_subjects (account_id, provider_code, issuer, subject, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.accountId, input.providerCode, input.issuer, input.subject, input.createdBy],
    );
    return firstRow(result.rows, 'insert auth subject');
  }
}
