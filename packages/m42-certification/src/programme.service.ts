/**
 * ProgrammeService — the certification PROGRAMME + its evidence intake: open a programme, record domain x aspect ASSESSMENTS,
 * raise/resolve FINDINGS, record migration/UAT/pilot/release READINESS, add opaque EVIDENCE references, and record role
 * SIGN-OFFS. All of this is governance STATE + EVIDENCE — M42 EXECUTES nothing (no migration/UAT/pilot/release is run here).
 * INDEPENDENCE (ADR-012): a sign-off requires a HUMAN signer (AI/system/automation refused) who did NOT assess that domain
 * (no self-sign-off of one's own assessed domain). Every mutation authorizes a `platform_certification.*` permission (default
 * deny) and is audited through m03 in the same transaction. Evidence is OPAQUE references only — never a secret/PII/raw body.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M42_PERMISSIONS } from './permissions.ts';
import { M42_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, notFound } from './errors.ts';
import {
  isPlatformScope,
  isHumanActor,
  clampPage,
  CERT_DOMAINS,
  CERT_ASPECTS,
  ASSESSMENT_STATUSES,
  FINDING_SEVERITIES,
  READINESS_KINDS,
  READINESS_RESULTS,
  REASON_CODES,
} from './domain.ts';
import {
  CertificationRepository,
  type ProgrammeRow,
  type AssessmentRow,
  type FindingRow,
  type ReadinessRow,
  type ClosureRow,
} from './repository.ts';

/** Read-only sign-off projection (role sign-offs on a programme; no secret/PII). */
export interface SignoffListRow {
  readonly role_key: string;
  readonly domain_key: string | null;
  readonly signed_by: string;
  readonly disposition: string;
}
import type { M42Emitter } from './emit.ts';

export class ProgrammeService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M42Emitter;
  private readonly repo: CertificationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M42Emitter,
    repo: CertificationRepository = new CertificationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M42_PERMISSIONS.administer);
  }
  private async loadProgramme(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    ctx: RequestContext,
    id: string,
  ): Promise<ProgrammeRow> {
    const p = await this.repo.getProgramme(tx, id);
    if (!p) throw notFound('programme not found.', ctx.correlationId);
    return p;
  }

  async openProgramme(
    ctx: RequestContext,
    input: { scope?: string; programmeKey: string; stageKey: string; title: string },
  ): Promise<ProgrammeRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.programmeManage);
    const scope = input.scope ?? 'platform';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!input.programmeKey || !input.stageKey || !input.title)
      throw badRequest('programmeKey, stageKey and title are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.repo.insertProgramme(tx, {
        tenantId: ctx.tenantId,
        scope,
        programmeKey: input.programmeKey,
        stageKey: input.stageKey,
        title: input.title,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.programmeOpened,
        entityType: 'certification_programme',
        entityId: p.id,
        detail: { scope, stageKey: input.stageKey },
      });
      await this.emitter.publishProgramme(tx, 'ProgrammeOpened', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: p.id, recordType: 'programme' },
      });
      return p;
    });
  }

  async recordAssessment(
    ctx: RequestContext,
    input: {
      programmeId: string;
      domainKey: string;
      aspectKey: string;
      status: string;
      evidenceRef?: string | null;
      reasonCode?: string | null;
    },
  ): Promise<AssessmentRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.assessmentManage);
    if (!(CERT_DOMAINS as readonly string[]).includes(input.domainKey))
      throw badRequest('unknown domain.', ctx.correlationId);
    if (!(CERT_ASPECTS as readonly string[]).includes(input.aspectKey))
      throw badRequest('unknown aspect.', ctx.correlationId);
    if (!(ASSESSMENT_STATUSES as readonly string[]).includes(input.status))
      throw badRequest('unknown status.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.loadProgramme(tx, ctx, input.programmeId);
      const a = await this.repo.upsertAssessment(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        domainKey: input.domainKey,
        aspectKey: input.aspectKey,
        status: input.status,
        evidenceRef: input.evidenceRef ?? null,
        reasonCode: input.reasonCode ?? null,
        assessedBy: ctx.userId ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.assessmentRecorded,
        entityType: 'certification_assessment',
        entityId: a.id,
        detail: { domainKey: input.domainKey, aspectKey: input.aspectKey, status: input.status },
      });
      await this.emitter.publishProgramme(tx, 'AssessmentRecorded', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          recordId: a.id,
          recordType: 'assessment',
          domainKey: input.domainKey,
          aspectKey: input.aspectKey,
          reasonCode: input.status,
        },
      });
      return a;
    });
  }

  async raiseFinding(
    ctx: RequestContext,
    input: {
      programmeId: string;
      domainKey: string;
      aspectKey?: string | null;
      severity: string;
      title: string;
      evidenceRef?: string | null;
      ownerRef?: string | null;
      reasonCode?: string | null;
    },
  ): Promise<FindingRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.findingManage);
    if (!(CERT_DOMAINS as readonly string[]).includes(input.domainKey))
      throw badRequest('unknown domain.', ctx.correlationId);
    if (!(FINDING_SEVERITIES as readonly string[]).includes(input.severity))
      throw badRequest('unknown severity.', ctx.correlationId);
    if (!input.title) throw badRequest('a finding title is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.loadProgramme(tx, ctx, input.programmeId);
      const f = await this.repo.insertFinding(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        domainKey: input.domainKey,
        aspectKey: input.aspectKey ?? null,
        severity: input.severity,
        title: input.title,
        evidenceRef: input.evidenceRef ?? null,
        ownerRef: input.ownerRef ?? null,
        reasonCode: input.reasonCode ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.findingRaised,
        entityType: 'certification_finding',
        entityId: f.id,
        detail: { domainKey: input.domainKey, severity: input.severity },
      });
      await this.emitter.publishProgramme(tx, 'FindingRaised', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          recordId: f.id,
          recordType: 'finding',
          domainKey: input.domainKey,
          reasonCode: input.severity,
        },
      });
      return f;
    });
  }

  async resolveFinding(ctx: RequestContext, findingId: string, expectedVersion: number): Promise<FindingRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.findingManage);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.getFinding(tx, findingId);
      if (!existing) throw notFound('finding not found.', ctx.correlationId);
      const updated = await this.repo.updateFindingStatus(
        tx,
        findingId,
        expectedVersion,
        'resolved',
        ctx.userId ?? null,
      );
      if (!updated)
        throw badRequest('the finding was modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        subjectKind: 'finding',
        subjectId: existing.programme_id,
        fromState: existing.status,
        toState: 'resolved',
        actor: ctx.userId ?? null,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.findingResolved,
        entityType: 'certification_finding',
        entityId: findingId,
        detail: { severity: existing.severity },
      });
      return updated;
    });
  }

  async recordReadiness(
    ctx: RequestContext,
    input: {
      programmeId: string;
      kind: string;
      refKey: string;
      planRef?: string | null;
      evidenceRef?: string | null;
      rollbackRef?: string | null;
      result: string;
      signedOff?: boolean;
      reasonCode?: string | null;
    },
  ): Promise<ReadinessRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.assessmentManage);
    if (!(READINESS_KINDS as readonly string[]).includes(input.kind))
      throw badRequest('unknown readiness kind.', ctx.correlationId);
    if (!(READINESS_RESULTS as readonly string[]).includes(input.result))
      throw badRequest('unknown readiness result.', ctx.correlationId);
    if (!input.refKey) throw badRequest('a readiness ref is required.', ctx.correlationId);
    // UAT and release sign-off must be human (ADR-012); a system/AI actor can never sign off readiness.
    const signedOffBy = input.signedOff ? (ctx.userId ?? null) : null;
    if (input.signedOff && !isHumanActor(signedOffBy))
      throw governanceForbidden(REASON_CODES.notHumanActor, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.loadProgramme(tx, ctx, input.programmeId);
      const r = await this.repo.upsertReadiness(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        kind: input.kind,
        refKey: input.refKey,
        planRef: input.planRef ?? null,
        evidenceRef: input.evidenceRef ?? null,
        rollbackRef: input.rollbackRef ?? null,
        result: input.result,
        signedOffBy,
        reasonCode: input.reasonCode ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      const code =
        input.kind === 'migration'
          ? M42_AUDIT_CODES.migrationRecorded
          : input.kind === 'uat'
            ? M42_AUDIT_CODES.uatRecorded
            : input.kind === 'pilot'
              ? M42_AUDIT_CODES.pilotRecorded
              : M42_AUDIT_CODES.releaseRecorded;
      await this.emitter.recordAudit(tx, ctx, {
        code,
        entityType: 'certification_readiness',
        entityId: r.id,
        detail: { kind: input.kind, result: input.result },
      });
      const payload = { recordId: r.id, recordType: 'readiness', reasonCode: input.result };
      const pub = {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload,
      };
      if (input.kind === 'migration')
        await this.emitter.publishMigration(tx, 'MigrationEvidenceRecorded', pub);
      else if (input.kind === 'uat') await this.emitter.publishUat(tx, 'UatRecorded', pub);
      else if (input.kind === 'pilot') await this.emitter.publishPilot(tx, 'PilotRecorded', pub);
      else await this.emitter.publishRelease(tx, 'ReleaseReadinessRecorded', pub);
      return r;
    });
  }

  async addEvidence(
    ctx: RequestContext,
    input: {
      programmeId: string;
      subjectKind: string;
      subjectId?: string | null;
      evidenceKind: string;
      evidenceRef: string;
      shaRef?: string | null;
      reasonCode?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M42_PERMISSIONS.assessmentManage);
    if (!input.subjectKind || !input.evidenceKind || !input.evidenceRef)
      throw badRequest('subjectKind, evidenceKind and evidenceRef are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.loadProgramme(tx, ctx, input.programmeId);
      const e = await this.repo.insertEvidence(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId ?? null,
        evidenceKind: input.evidenceKind,
        evidenceRef: input.evidenceRef,
        shaRef: input.shaRef ?? null,
        reasonCode: input.reasonCode ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.evidenceAdded,
        entityType: 'certification_evidence',
        entityId: e.id,
        detail: { evidenceKind: input.evidenceKind },
      });
      return e;
    });
  }

  /** Record a role SIGN-OFF. INDEPENDENCE: a human signer; a signer may NOT sign off a domain they assessed (self-sign). */
  async recordSignoff(
    ctx: RequestContext,
    signedBy: string,
    input: {
      programmeId: string;
      roleKey: string;
      domainKey?: string | null;
      disposition?: string;
      reasonCode?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M42_PERMISSIONS.signoffApprove);
    if (!input.roleKey) throw badRequest('a role is required.', ctx.correlationId);
    const disposition = input.disposition ?? 'approve';
    if (disposition !== 'approve' && disposition !== 'reject')
      throw badRequest('unknown disposition.', ctx.correlationId);
    if (!isHumanActor(signedBy)) throw governanceForbidden(REASON_CODES.notHumanActor, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.loadProgramme(tx, ctx, input.programmeId);
      // No self-sign-off of one's own assessed domain (ADR-012).
      if (input.domainKey) {
        const assessments = await this.repo.listAssessments(tx, input.programmeId);
        if (assessments.some((a) => a.domain_key === input.domainKey && a.assessed_by === signedBy)) {
          await this.emitter.recordAudit(tx, ctx, {
            code: M42_AUDIT_CODES.sodBlocked,
            entityType: 'certification_signoff',
            entityId: input.programmeId,
            detail: { reasonCode: REASON_CODES.selfSignOwnDomain, domainKey: input.domainKey },
          });
          throw governanceForbidden(REASON_CODES.selfSignOwnDomain, ctx.correlationId);
        }
      }
      const s = await this.repo.insertSignoff(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        roleKey: input.roleKey,
        domainKey: input.domainKey ?? null,
        signedBy,
        disposition,
        reasonCode: input.reasonCode ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.signoffRecorded,
        entityType: 'certification_signoff',
        entityId: s.id,
        detail: { roleKey: input.roleKey, disposition },
      });
      return s;
    });
  }

  async getProgramme(ctx: RequestContext, id: string): Promise<ProgrammeRow | null> {
    await this.authz.require(ctx, M42_PERMISSIONS.programmeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getProgramme(tx, id));
  }
  async listProgrammes(ctx: RequestContext, page?: number, size?: number): Promise<ProgrammeRow[]> {
    await this.authz.require(ctx, M42_PERMISSIONS.programmeRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listProgrammes(tx, limit, offset));
  }

  // ---- READ MODEL (evidence console: assessments / findings / readiness / sign-offs / closure) ----
  // All read-only, RLS-scoped, permission-gated (no audit on reads). Bounded projections — opaque evidence refs
  // only, never a raw body/secret/PII. These back the Stage-8 read-only certification console; the mutating intake
  // (record/resolve/sign-off) and the DERIVED decision/closure stay API/evidence-driven (deny-by-default unchanged).
  async listAssessments(ctx: RequestContext, programmeId: string): Promise<AssessmentRow[]> {
    await this.authz.require(ctx, M42_PERMISSIONS.assessmentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAssessments(tx, programmeId));
  }
  async listFindings(ctx: RequestContext, programmeId: string): Promise<FindingRow[]> {
    await this.authz.require(ctx, M42_PERMISSIONS.findingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listFindings(tx, programmeId));
  }
  async listReadiness(ctx: RequestContext, programmeId: string): Promise<ReadinessRow[]> {
    await this.authz.require(ctx, M42_PERMISSIONS.assessmentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReadiness(tx, programmeId));
  }
  async listSignoffs(ctx: RequestContext, programmeId: string): Promise<SignoffListRow[]> {
    await this.authz.require(ctx, M42_PERMISSIONS.programmeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSignoffs(tx, programmeId));
  }
  async getClosure(ctx: RequestContext, programmeId: string): Promise<ClosureRow | null> {
    await this.authz.require(ctx, M42_PERMISSIONS.programmeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getClosure(tx, programmeId));
  }
}
