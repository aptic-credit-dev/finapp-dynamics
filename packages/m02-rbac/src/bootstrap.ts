import { ProblemError, type Db, type SystemContext } from '@finapp/kernel';
import { RbacRepository } from './repository.ts';
import { type RbacEmitter } from './emit.ts';
import { RBAC_AUDIT_CODES } from './audit-codes.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOTSTRAP_ENV = 'FINAPP_BOOTSTRAP_ADMIN_ACCOUNT';
export const PLATFORM_ADMIN_ROLE_CODE = 'platform_admin';

export interface BootstrapResult {
  readonly provisioned: boolean;
  readonly reason: string;
}

/**
 * First-administrator bootstrap (ADR-020). Grants the immutable `platform_admin` system role to a configured
 * EXISTING account reference — no password, no bypass secret. Idempotent (a second run is a no-op),
 * environment-gated, auditable. Fails closed in production when configuration is invalid; a dev/test run
 * with no configuration is a documented no-op so the app still starts locally.
 *
 * This is the ONLY channel that mints the first admin — it cannot be reached from an ordinary API request,
 * and it cannot create arbitrary repeated admins (idempotent on the one configured account).
 */
export class BootstrapService {
  private readonly db: Db;
  private readonly emitter: RbacEmitter;
  private readonly repo: RbacRepository;

  constructor(db: Db, emitter: RbacEmitter, repo: RbacRepository = new RbacRepository()) {
    this.db = db;
    this.emitter = emitter;
    this.repo = repo;
  }

  async run(correlationId: string, env: NodeJS.ProcessEnv = process.env): Promise<BootstrapResult> {
    const accountId = env[BOOTSTRAP_ENV];
    const isProduction = env['NODE_ENV'] === 'production';

    if (accountId === undefined || accountId.trim() === '') {
      if (isProduction) {
        throw new Error(`${BOOTSTRAP_ENV} is required in production — the platform cannot start without a bootstrap administrator (ADR-020).`);
      }
      return { provisioned: false, reason: 'no bootstrap account configured (dev/test no-op)' };
    }
    if (!UUID.test(accountId)) {
      throw new Error(`${BOOTSTRAP_ENV} is malformed — expected an account id (ADR-020).`);
    }

    const sys: SystemContext = { reason: 'bootstrap platform administrator (m02-rbac)', correlationId };
    return this.db.withSystem(sys, async (tx): Promise<BootstrapResult> => {
      const account = await this.repo.findAccountForBootstrap(tx, accountId);
      // Fail closed: a missing/inactive account or identity is not silently skipped in production — a
      // misconfigured bootstrap must be visible, not swallowed.
      if (account === null) throw failClosed(isProduction, 'bootstrap account does not exist', correlationId);
      if (account.account_status !== 'active') throw failClosed(isProduction, 'bootstrap account is not active', correlationId);
      if (account.identity_status !== 'active') throw failClosed(isProduction, 'bootstrap identity is not active', correlationId);

      const role = await this.repo.findSystemRoleByCode(tx, PLATFORM_ADMIN_ROLE_CODE);
      if (role === null) throw new Error('platform_admin system role is missing — the RBAC migration did not seed it.');

      if (await this.repo.platformAssignmentExists(tx, account.identity_id, role.id)) {
        return { provisioned: false, reason: 'platform administrator already provisioned (idempotent no-op)' };
      }

      const assignment = await this.repo.insertPlatformAssignment(tx, {
        identityId: account.identity_id, roleId: role.id, grantedBy: null, justification: 'ADR-020 bootstrap',
      });
      await this.repo.appendAssignmentHistory(tx, { tenantId: null, assignmentId: assignment.id, kind: 'platform', fromStatus: null, toStatus: 'active', action: 'grant', reason: 'bootstrap', correlationId, changedBy: null });
      await this.emitter.recordAudit(tx, sys, { code: RBAC_AUDIT_CODES.bootstrapProvisioned, entityType: 'account', entityId: accountId, detail: { roleId: role.id } });
      await this.emitter.publish(tx, 'BootstrapAdminProvisioned', null, correlationId, null, { accountId, roleId: role.id });
      return { provisioned: true, reason: 'platform administrator provisioned' };
    });
  }
}

function failClosed(isProduction: boolean, detail: string, correlationId: string): Error {
  if (isProduction) return new Error(`Bootstrap failed closed: ${detail} (ADR-020).`);
  return new ProblemError({ type: 'https://finapp.dynamics/problems/validation', title: 'Bad Request', status: 400, detail, correlationId });
}
