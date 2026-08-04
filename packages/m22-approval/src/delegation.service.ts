/**
 * DelegationService — grants and revokes delegated CHECKER authority (a delegator lets a delegate act on their behalf
 * for a subject_type+scope within a window). A delegate can never be the delegator (DB CHECK), and a delegated approver
 * can NEVER launder Segregation of Duties — that is enforced where decisions land (DecisionService consults the SoD
 * engine with the delegator). This service only manages the grant lifecycle (active -> revoked/expired). Every mutation
 * is privileged, audited, and emits `approval.lifecycle`.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M22_PERMISSIONS } from './permissions.ts';
import { M22_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { checkDelegationTransition } from './domain/lifecycles.ts';
import { isSubjectType } from './domain/vocab.ts';
import { ApprovalRepository, type ApprovalDelegationRow } from './repository.ts';
import type { M22Emitter } from './emit.ts';

export class DelegationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M22Emitter;
  private readonly repo: ApprovalRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M22Emitter,
    repo: ApprovalRepository = new ApprovalRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async grantDelegation(
    ctx: RequestContext,
    actor: string | null,
    input: {
      delegator: string;
      delegate: string;
      subjectType: string;
      scope?: string;
      reason?: string | null;
      endsAt?: string | null;
    },
  ): Promise<ApprovalDelegationRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.delegationManage);
    if (input.delegator.trim() === '' || input.delegate.trim() === '')
      throw badRequest('a delegator and delegate are required.', ctx.correlationId);
    if (input.delegator === input.delegate)
      throw badRequest('a delegate cannot be the delegator (self-delegation).', ctx.correlationId);
    if (!isSubjectType(input.subjectType)) throw badRequest('unknown subject type.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertDelegation(tx, {
        tenantId: ctx.tenantId,
        delegator: input.delegator,
        delegate: input.delegate,
        subjectType: input.subjectType,
        scope: input.scope ?? 'default',
        reason: input.reason ?? null,
        endsAt: input.endsAt ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertDelegationHistory(tx, {
        tenantId: ctx.tenantId,
        delegationId: row.id,
        fromStatus: null,
        toStatus: 'active',
        reason: input.reason ?? null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.delegationGranted,
        entityType: 'approval_delegation',
        entityId: row.id,
        detail: { subjectType: row.subject_type },
      });
      await this.emitter.publish(tx, {
        type: 'Delegated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: row.id,
          recordType: 'delegation',
          delegationRef: row.id,
          subjectType: row.subject_type,
          toStatus: 'active',
        },
      });
      return row;
    });
  }

  async revokeDelegation(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ApprovalDelegationRow> {
    await this.authz.require(ctx, M22_PERMISSIONS.delegationManage);
    if (reason.trim() === '') throw badRequest('a revocation reason is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const deleg = await this.repo.findDelegation(tx, id);
      if (deleg === null) throw ProblemError.notFound('Delegation not found.', ctx.correlationId);
      const t = checkDelegationTransition(deleg.status, 'revoked');
      if (!t.ok) throw badRequest(`A ${deleg.status} delegation cannot be revoked.`, ctx.correlationId);
      const updated = await this.repo.setDelegationStatus(tx, {
        id,
        expectedVersion,
        status: 'revoked',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Delegation modified concurrently.', ctx.correlationId);
      await this.repo.insertDelegationHistory(tx, {
        tenantId: ctx.tenantId,
        delegationId: id,
        fromStatus: deleg.status,
        toStatus: 'revoked',
        reason,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M22_AUDIT_CODES.delegationRevoked,
        entityType: 'approval_delegation',
        entityId: id,
        detail: { reason },
      });
      await this.emitter.publish(tx, {
        type: 'DelegationRevoked',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recordId: id, recordType: 'delegation', delegationRef: id, toStatus: 'revoked' },
      });
      return updated;
    });
  }

  async listDelegations(ctx: RequestContext, delegate?: string): Promise<ApprovalDelegationRow[]> {
    await this.authz.require(ctx, M22_PERMISSIONS.delegationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDelegations(tx, delegate));
  }
}
