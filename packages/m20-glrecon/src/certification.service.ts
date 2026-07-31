/**
 * CertificationService — balance certification. A certification snapshots the calculated vs source balance, the exact
 * variance (INTEGER MINOR UNITS), and the counts of unresolved exceptions + open reconciling items for a run. A
 * balance with open blocking exceptions/items may ONLY be certified through a PRIVILEGED override
 * (gl_reconciliation.certification.override) that requires a reason (fail closed, DB-enforced). Every mutation runs
 * inside `db.withTenant` with audit + a glrecon.lifecycle event in the same transaction. m20 certifies a
 * reconciliation; it never posts a journal or writes to the GL.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import { M20_PERMISSIONS } from './permissions.ts';
import { M20_AUDIT_CODES } from './audit-codes.ts';
import { checkCertificationTransition } from './domain/lifecycles.ts';
import { badRequest } from './errors.ts';
import { GlreconRepository, type GlCertificationRow, type GlCertificationHistoryRow } from './repository.ts';
import type { M20Emitter } from './emit.ts';

export class CertificationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M20Emitter;
  private readonly repo: GlreconRepository;
  constructor(db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository = new GlreconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: GlreconLifecycleEventType,
    payload: GlreconLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }

  async createCertification(
    ctx: RequestContext,
    actor: string | null,
    runId: string,
  ): Promise<GlCertificationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.certificationCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.findRun(tx, runId);
      if (run === null) throw ProblemError.notFound('Run not found.', ctx.correlationId);
      const balances = await this.repo.listRunBalancesByRun(tx, runId);
      const latest = balances[balances.length - 1];
      const calculated = latest !== undefined ? Number(latest.calculated_closing_minor) : 0;
      const source = latest?.source_closing_minor != null ? Number(latest.source_closing_minor) : calculated;
      const variance = source - calculated;
      const unresolved = await this.repo.countOpenRequiredExceptions(tx, runId);
      const openItems = await this.repo.countOpenItems(tx, runId);
      const cert = await this.repo.insertCertification(tx, {
        tenantId: ctx.tenantId,
        runId,
        glAccountId: run.gl_account_id,
        periodStart: run.period_start,
        periodEnd: run.period_end,
        currencyRef: null,
        calculatedBalanceMinor: calculated,
        sourceBalanceMinor: source,
        varianceMinor: variance,
        unresolvedExceptionCount: unresolved,
        openItemCount: openItems,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertCertificationHistory(tx, {
        tenantId: ctx.tenantId,
        certificationId: cert.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: 'certification drafted',
        isOverride: false,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.certificationCreated,
        entityType: 'gl_certification',
        entityId: cert.id,
        detail: { unresolved, openItems },
      });
      return cert;
    });
  }

  async certifyBalance(
    ctx: RequestContext,
    actor: string | null,
    certificationId: string,
    expectedVersion: number,
    opts: { override?: boolean; overrideReason?: string | null },
  ): Promise<GlCertificationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.certificationCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const cert = await this.repo.findCertification(tx, certificationId);
      if (cert === null) throw ProblemError.notFound('Certification not found.', ctx.correlationId);
      const check = checkCertificationTransition(cert.status, 'certified');
      if (!check.ok) throw ProblemError.conflict(`Cannot certify from ${cert.status}.`, ctx.correlationId);

      const hasBlockers = cert.unresolved_exception_count > 0 || cert.open_item_count > 0;
      const override = opts.override === true;
      if (hasBlockers && !override)
        throw ProblemError.conflict(
          `Cannot certify: ${String(cert.unresolved_exception_count)} open exception(s) and ${String(cert.open_item_count)} open item(s). A privileged override with a reason is required.`,
          ctx.correlationId,
        );
      if (override) {
        // Certifying over open blockers is a privileged, reason-bearing override (fail closed).
        await this.authz.require(ctx, M20_PERMISSIONS.certificationOverride);
        if (opts.overrideReason == null || opts.overrideReason.trim() === '')
          throw badRequest('An override requires a reason.', ctx.correlationId);
      }
      const certified = await this.repo.decideCertification(tx, {
        id: certificationId,
        expectedVersion,
        toStatus: 'certified',
        isOverride: override,
        overrideReason: override ? (opts.overrideReason ?? null) : null,
        certifiedBy: actor,
        by: actor,
      });
      if (certified === null)
        throw ProblemError.conflict(
          'Certification modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.repo.insertCertificationHistory(tx, {
        tenantId: ctx.tenantId,
        certificationId,
        fromStatus: 'draft',
        toStatus: 'certified',
        reason: override ? (opts.overrideReason ?? 'override') : 'certified',
        isOverride: override,
        by: actor,
        correlationId: ctx.correlationId,
      });
      if (override) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M20_AUDIT_CODES.certificationOverridden,
          entityType: 'gl_certification',
          entityId: certificationId,
          ...(opts.overrideReason != null ? { reason: opts.overrideReason } : {}),
          detail: {
            unresolved: cert.unresolved_exception_count,
            openItems: cert.open_item_count,
          },
        });
        await this.publish(tx, ctx, actor, 'CertificationOverridden', {
          recordId: certificationId,
          recordType: 'certification',
          runId: cert.run_id,
          toStatus: 'certified',
          reasonCode: 'override',
        });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.certificationCreated,
        entityType: 'gl_certification',
        entityId: certificationId,
        detail: { override },
      });
      await this.publish(tx, ctx, actor, 'BalanceCertified', {
        recordId: certificationId,
        recordType: 'certification',
        runId: cert.run_id,
        balanceVarianceMinor: cert.variance_minor,
        toStatus: 'certified',
      });
      return certified;
    });
  }

  async rejectCertification(
    ctx: RequestContext,
    actor: string | null,
    certificationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlCertificationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.certificationCreate);
    return this.db.withTenant(ctx, async (tx) => {
      const cert = await this.repo.findCertification(tx, certificationId);
      if (cert === null) throw ProblemError.notFound('Certification not found.', ctx.correlationId);
      const check = checkCertificationTransition(cert.status, 'rejected');
      if (!check.ok) throw ProblemError.conflict(`Cannot reject from ${cert.status}.`, ctx.correlationId);
      const rejected = await this.repo.decideCertification(tx, {
        id: certificationId,
        expectedVersion,
        toStatus: 'rejected',
        isOverride: false,
        overrideReason: null,
        certifiedBy: null,
        by: actor,
      });
      if (rejected === null)
        throw ProblemError.conflict(
          'Certification modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.repo.insertCertificationHistory(tx, {
        tenantId: ctx.tenantId,
        certificationId,
        fromStatus: 'draft',
        toStatus: 'rejected',
        reason,
        isOverride: false,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.certificationRejected,
        entityType: 'gl_certification',
        entityId: certificationId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'CertificationRejected', {
        recordId: certificationId,
        recordType: 'certification',
        runId: cert.run_id,
        toStatus: 'rejected',
      });
      return rejected;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getCertification(ctx: RequestContext, id: string): Promise<GlCertificationRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.certificationRead);
    return this.db.withTenant(ctx, async (tx) => {
      const cert = await this.repo.findCertification(tx, id);
      if (cert === null) throw ProblemError.notFound('Certification not found.', ctx.correlationId);
      return cert;
    });
  }
  async listCertifications(ctx: RequestContext, runId: string): Promise<GlCertificationRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.certificationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCertificationsByRun(tx, runId));
  }
  async listCertificationHistory(
    ctx: RequestContext,
    certificationId: string,
  ): Promise<GlCertificationHistoryRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.certificationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCertificationHistory(tx, certificationId));
  }
}
