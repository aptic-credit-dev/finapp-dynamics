import type { AccountRow, IdentityRow, MembershipRow } from '@finapp/m02-identity';

/**
 * OUTPUT PROJECTION — what a caller is allowed to see. Nothing leaves the API as a raw row.
 *
 * Two things are being kept in, and both are the kind of leak that only looks harmless:
 *
 *  1. NORMALISED FORMS. `primary_email_norm` and `login_identifier_norm` are the columns the uniqueness
 *     constraints use. Returning them hands a caller the exact key that decides whether a duplicate
 *     exists — which turns "create and see if it conflicts" into a reliable membership oracle for an
 *     address the caller only guessed at. The display form is the caller's own input; the normalised form
 *     is the platform's index.
 *  2. `data_classification`. An internal handling label (ADR-006), not a fact about the person. It tells a
 *     caller how the platform routes the record — including which records are gated from AI providers —
 *     and nothing they need.
 *
 * Written as explicit field lists rather than destructure-and-rest. A spread would silently re-expose
 * every column added to the row type later; this way, a new column reaches the wire only when someone
 * writes the line that puts it there.
 */

export interface IdentityView {
  readonly id: string;
  readonly identityType: string;
  readonly displayName: string;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly primaryEmail: string | null;
  readonly organizationRef: string | null;
  readonly externalRef: string | null;
  readonly status: string;
  readonly version: number;
  readonly createdAt: string;
}

export function identityView(row: IdentityRow): IdentityView {
  return {
    id: row.id,
    identityType: row.identity_type,
    displayName: row.display_name,
    givenName: row.given_name,
    familyName: row.family_name,
    primaryEmail: row.primary_email,
    organizationRef: row.organization_ref,
    externalRef: row.external_ref,
    status: row.status,
    // Every mutation demands `expectedVersion`, so withholding the version would make the API unusable
    // rather than safer.
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

export interface AccountView {
  readonly id: string;
  readonly identityId: string;
  readonly accountType: string;
  readonly loginIdentifier: string;
  readonly status: string;
  readonly activatedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
}

/**
 * An account, minus its authentication surface (§10).
 *
 * There is no credential, no session and no provider subject in this projection, and that is not merely
 * because Stage 1B has not built them: `authentication_subjects` maps an identity to an external IdP
 * subject, and exposing that mapping would let a caller correlate a platform identity with an account at
 * Google or an enterprise directory. When Stage 1C adds credentials, they land behind their own route and
 * their own permission — never here, by widening this.
 */
export function accountView(row: AccountRow): AccountView {
  return {
    id: row.id,
    identityId: row.identity_id,
    accountType: row.account_type,
    loginIdentifier: row.login_identifier,
    status: row.status,
    activatedAt: row.activated_at === null ? null : row.activated_at.toISOString(),
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

export interface MembershipView {
  readonly id: string;
  readonly tenantId: string;
  readonly identityId: string;
  readonly accountId: string | null;
  readonly membershipType: string;
  readonly status: string;
  readonly isPrimary: boolean;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly entityId: string | null;
  readonly departmentId: string | null;
  readonly branchId: string | null;
  readonly environmentId: string | null;
  readonly version: number;
}

/**
 * `tenant_id` is included deliberately.
 *
 * It is not a leak: RLS means a caller can only ever hold a membership row from their own tenant, so the
 * value is one they supplied in `x-tenant-id` to get here. Echoing it lets a client detect a context
 * mix-up instead of quietly attributing a row to the wrong tenant.
 */
export function membershipView(row: MembershipRow): MembershipView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    identityId: row.identity_id,
    accountId: row.account_id,
    membershipType: row.membership_type,
    status: row.status,
    isPrimary: row.is_primary,
    startDate: row.start_date.toISOString(),
    endDate: row.end_date === null ? null : row.end_date.toISOString(),
    entityId: row.entity_id,
    departmentId: row.department_id,
    branchId: row.branch_id,
    environmentId: row.environment_id,
    version: row.version,
  };
}
