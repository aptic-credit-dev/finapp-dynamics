import { randomUUID } from 'node:crypto';
import { defineDbSpec, type DbSpecContext } from '@finapp/test-runner';
import { ProblemError, type RequestContext } from '@finapp/kernel';
import { PgDb } from '@finapp/kernel/pg';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import {
  AssignmentService,
  CatalogueService,
  PermissionResolver,
  RbacAuthz,
  RbacEmitter,
  RbacRepository,
  RoleService,
  SodService,
} from '@finapp/m02-rbac';

/**
 * m02-rbac AGAINST A REAL DATABASE — the properties that only PostgreSQL + RLS can prove, exercised through
 * the REAL services and resolver (not a lookalike): permissions resolve from persistent assignments, a
 * tenant's grants never leak into another tenant, revocation takes effect on the very next resolve (no
 * cache), the services enforce their permission and refuse escalation, SoD blocks a conflicting grant at
 * grant time, and a system role is immutable.
 *
 * Everything runs as the NON-SUPERUSER application role, so isolation is proven by the POLICY, exactly as in
 * production. Setup is done as superuser; nothing is proven through that connection.
 */

const PLATFORM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001';

interface Seeded {
  readonly tenantId: string;
  readonly identityId: string;
  readonly accountId: string;
  readonly membershipId: string;
}

async function seedActor(ctx: DbSpecContext, code: string, tenantId?: string): Promise<Seeded> {
  const resolvedTenant = tenantId ?? randomUUID();
  const identityId = randomUUID();
  const accountId = randomUUID();
  const membershipId = randomUUID();
  await ctx.asSuperuser(null, async (tx) => {
    if (tenantId === undefined) {
      await tx.query(
        `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at)
         VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
        [resolvedTenant, `${code}_t_${resolvedTenant.slice(0, 8)}`, `${code} Ltd`],
      );
    }
    await tx.query(
      `INSERT INTO identities (id, identity_type, display_name, primary_email, primary_email_norm, status)
       VALUES ($1, 'internal_person', $2, $3, $3, 'active')`,
      [identityId, `${code} Person`, `${code}.${identityId.slice(0, 8)}@example.com`],
    );
    await tx.query(
      `INSERT INTO user_accounts (id, identity_id, account_type, login_identifier, login_identifier_norm, status, activated_at)
       VALUES ($1, $2, 'human', $3, $3, 'active', now())`,
      [accountId, identityId, `${code}_${accountId.slice(0, 8)}`],
    );
    await tx.query(
      `INSERT INTO tenant_memberships (tenant_id, id, identity_id, account_id, membership_type, status)
       VALUES ($1, $2, $3, $4, 'employee', 'active')`,
      [resolvedTenant, membershipId, identityId, accountId],
    );
  });
  return { tenantId: resolvedTenant, identityId, accountId, membershipId };
}

async function grantPlatformAdmin(ctx: DbSpecContext, identityId: string): Promise<string> {
  const id = randomUUID();
  await ctx.asSuperuser(null, (tx) =>
    tx.query(
      `INSERT INTO platform_role_assignments (id, identity_id, role_id, status) VALUES ($1, $2, $3, 'active')`,
      [id, identityId, PLATFORM_ADMIN_ROLE_ID],
    ),
  );
  return id;
}

export default defineDbSpec('m02-rbac', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new RbacEmitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new RbacRepository();
  const roles = new RoleService(db, authz, emitter, repo);
  const sod = new SodService(db, authz, emitter, repo);
  const assignments = new AssignmentService(db, authz, emitter, sod, repo);
  const catalogue = new CatalogueService(db, authz, repo);
  const resolver = new PermissionResolver(db, repo);

  // A fully-privileged tenant context — the permission set the boundary WOULD resolve for a platform admin.
  const admin = await seedActor(ctx, 'rbac_admin');
  const ALL = [
    'rbac.permission.view',
    'rbac.role.view',
    'rbac.role.create',
    'rbac.role.edit',
    'rbac.role.activate',
    'rbac.role.suspend',
    'rbac.role.retire',
    'rbac.assignment.view',
    'rbac.assignment.grant',
    'rbac.assignment.revoke',
    'rbac.sod.view',
    'rbac.sod.manage',
    'identity.registry.view',
    'identity.registry.close',
    'tenant.registry.approve',
    'tenant.registry.create',
  ];
  const adminCtx = (perms: readonly string[] = ALL): RequestContext => ({
    tenantId: admin.tenantId,
    userId: admin.identityId,
    correlationId: randomUUID(),
    permissions: perms,
  });

  // --- resolution from persistent platform assignments ---------------------------------------------
  {
    await grantPlatformAdmin(ctx, admin.identityId);
    const resolved = await resolver.resolve({ identityId: admin.identityId, correlationId: randomUUID() });
    t.ok(
      resolved.includes('rbac.role.create'),
      'a platform_admin assignment resolves the full permission set',
    );
    t.ok(resolved.includes('identity.registry.view'), 'including permissions owned by other modules');

    const scoped = await resolver.resolve({
      identityId: admin.identityId,
      tenantId: admin.tenantId,
      correlationId: randomUUID(),
    });
    t.ok(
      scoped.includes('rbac.role.create'),
      'platform permissions are carried into a tenant-scoped resolve too',
    );
  }

  // --- tenant-role resolution + isolation ----------------------------------------------------------
  {
    const user = await seedActor(ctx, 'rbac_user', admin.tenantId);
    // Create + activate a tenant role granting identity.registry.view, then assign it to the user.
    const role = await roles.create(adminCtx(), admin.identityId, { code: 'viewer_role', name: 'Viewer' });
    await roles.applyAction(adminCtx(), admin.identityId, role.id, 'activate', {
      expectedVersion: role.version,
    });
    await roles.changePermissions(adminCtx(), admin.identityId, role.id, {
      add: ['identity.registry.view'],
      grantorPermissions: ALL,
    });
    await assignments.grant(adminCtx(), admin.identityId, {
      membershipId: user.membershipId,
      roleId: role.id,
      grantorPermissions: ALL,
    });

    const inTenant = await resolver.resolve({
      identityId: user.identityId,
      tenantId: admin.tenantId,
      correlationId: randomUUID(),
    });
    t.ok(inTenant.includes('identity.registry.view'), 'a tenant assignment resolves inside its own tenant');

    const otherTenant = randomUUID();
    await ctx.asSuperuser(null, (tx) =>
      tx.query(
        `INSERT INTO tenants (id, code, legal_name, tenant_type, status, activated_at) VALUES ($1, $2, $3, 'enterprise_customer', 'active', now())`,
        [otherTenant, `other_${otherTenant.slice(0, 8)}`, 'Other Ltd'],
      ),
    );
    const elsewhere = await resolver.resolve({
      identityId: user.identityId,
      tenantId: otherTenant,
      correlationId: randomUUID(),
    });
    t.ok(
      !elsewhere.includes('identity.registry.view'),
      'the same identity resolves NOTHING in a tenant it was not granted in — RLS isolates assignments',
    );
  }

  // --- immediate revocation (no cache) -------------------------------------------------------------
  {
    const revocable = await seedActor(ctx, 'rbac_revoke', admin.tenantId);
    const assignmentId = await grantPlatformAdmin(ctx, revocable.identityId);
    const before = await resolver.resolve({ identityId: revocable.identityId, correlationId: randomUUID() });
    t.ok(before.includes('rbac.role.create'), 'granted: the permission resolves');
    await ctx.asSuperuser(null, (tx) =>
      tx.query(`UPDATE platform_role_assignments SET status = 'revoked', revoked_at = now() WHERE id = $1`, [
        assignmentId,
      ]),
    );
    const after = await resolver.resolve({ identityId: revocable.identityId, correlationId: randomUUID() });
    t.ok(
      !after.includes('rbac.role.create'),
      'revoked: the very next resolve returns nothing — no stale cache',
    );
  }

  // --- the services enforce their permission -------------------------------------------------------
  {
    await t.rejects(
      roles.create(adminCtx([]), admin.identityId, { code: 'nope_role', name: 'Nope' }),
      'RoleService.create refuses a caller who does not hold rbac.role.create (default deny)',
    );
    await t.rejects(
      catalogue.listPermissions({
        tenantId: admin.tenantId,
        userId: admin.identityId,
        correlationId: randomUUID(),
        permissions: [],
      }),
      'the catalogue refuses a caller who does not hold rbac.permission.view',
    );
  }

  // --- anti-escalation: you cannot grant a permission you do not hold ------------------------------
  {
    const role = await roles.create(adminCtx(), admin.identityId, { code: 'escalation_role', name: 'Esc' });
    let forbidden = false;
    try {
      // Holds rbac.role.edit, but NOT identity.registry.close — so it may not add it.
      await roles.changePermissions(adminCtx(['rbac.role.edit']), admin.identityId, role.id, {
        add: ['identity.registry.close'],
        grantorPermissions: ['rbac.role.edit'],
      });
    } catch (e: unknown) {
      forbidden = e instanceof ProblemError && e.status === 403;
    }
    t.ok(forbidden, 'adding a permission the grantor does not hold is a 403 — no self-escalation');
  }

  // --- SoD blocks a conflicting grant at grant time ------------------------------------------------
  {
    const subject = await seedActor(ctx, 'rbac_sod', admin.tenantId);
    // Two roles whose permissions are the two halves of a seeded global maker/checker SoD rule.
    const approver = await roles.create(adminCtx(), admin.identityId, {
      code: 'approver_role',
      name: 'Approver',
    });
    await roles.applyAction(adminCtx(), admin.identityId, approver.id, 'activate', {
      expectedVersion: approver.version,
    });
    await roles.changePermissions(adminCtx(), admin.identityId, approver.id, {
      add: ['tenant.registry.approve'],
      grantorPermissions: ALL,
    });

    const creator = await roles.create(adminCtx(), admin.identityId, {
      code: 'creator_role',
      name: 'Creator',
    });
    await roles.applyAction(adminCtx(), admin.identityId, creator.id, 'activate', {
      expectedVersion: creator.version,
    });
    await roles.changePermissions(adminCtx(), admin.identityId, creator.id, {
      add: ['tenant.registry.create'],
      grantorPermissions: ALL,
    });

    await assignments.grant(adminCtx(), admin.identityId, {
      membershipId: subject.membershipId,
      roleId: approver.id,
      grantorPermissions: ALL,
    });
    let conflict = false;
    try {
      await assignments.grant(adminCtx(), admin.identityId, {
        membershipId: subject.membershipId,
        roleId: creator.id,
        grantorPermissions: ALL,
      });
    } catch (e: unknown) {
      conflict = e instanceof ProblemError && e.status === 409;
    }
    t.ok(conflict, 'granting the second half of a maker/checker pair is blocked by SoD (409)');
  }

  // --- a system role is immutable ------------------------------------------------------------------
  {
    let immutable = false;
    try {
      await roles.update(adminCtx(), admin.identityId, PLATFORM_ADMIN_ROLE_ID, {
        expectedVersion: 1,
        name: 'hijacked',
      });
    } catch (e: unknown) {
      immutable = e instanceof ProblemError && e.status === 409;
    }
    t.ok(immutable, 'editing the immutable platform_admin system role is refused (409)');
  }
});
