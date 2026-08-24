/**
 * GovernanceService — GRC (control catalogue + assessments), PRIVACY (data classification + processing records) and SOC
 * (security incidents). GRC evidence does NOT duplicate m03 audit or m42 certification (m42 may consume m41 evidence by
 * contract); privacy records are bounded evidence over an OPAQUE subject reference — never raw personal data. All evidence is
 * append-only. Every mutation authorizes a `grc.*` / `privacy.*` / `security.*` permission (default deny) and is audited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M41_PERMISSIONS } from './permissions.ts';
import { M41_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, notFound } from './errors.ts';
import { isPlatformScope, GRC_FRAMEWORKS, CLASSIFICATIONS } from './domain.ts';
import {
  SecurityRepository,
  type GrcControlRow,
  type GrcControlListRow,
  type GrcAssessmentListRow,
  type PrivacyClassificationRow,
  type PrivacyClassificationListRow,
  type PrivacyRecordListRow,
  type IncidentListRow,
} from './repository.ts';
import type { M41Emitter } from './emit.ts';

export class GovernanceService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M41Emitter;
  private readonly repo: SecurityRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M41Emitter,
    repo: SecurityRepository = new SecurityRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M41_PERMISSIONS.administer);
  }

  // ---- GRC ----
  async defineControl(
    ctx: RequestContext,
    input: { scope?: string; controlKey: string; framework: string; title: string },
  ): Promise<GrcControlRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.grcControlManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!(GRC_FRAMEWORKS as readonly string[]).includes(input.framework))
      throw badRequest('unknown framework.', ctx.correlationId);
    if (!input.controlKey || !input.title)
      throw badRequest('controlKey and title are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const control = await this.repo.insertGrcControl(tx, {
        tenantId: ctx.tenantId,
        scope,
        controlKey: input.controlKey,
        framework: input.framework,
        title: input.title,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.grcControlDefined,
        entityType: 'grc_control',
        entityId: control.id,
        detail: { controlKey: input.controlKey, framework: input.framework },
      });
      return control;
    });
  }

  async recordAssessment(
    ctx: RequestContext,
    controlId: string,
    input: { status: string; evidenceRef?: string | null; reasonCode?: string | null },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M41_PERMISSIONS.grcAssessmentRecord);
    if (!['compliant', 'non_compliant', 'partial', 'not_assessed'].includes(input.status))
      throw badRequest('unknown status.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const control = await this.repo.getGrcControl(tx, controlId);
      if (!control) throw notFound('control not found.', ctx.correlationId);
      const row = await this.repo.insertGrcAssessment(tx, {
        tenantId: ctx.tenantId,
        controlId,
        status: input.status,
        evidenceRef: input.evidenceRef ?? null,
        reasonCode: input.reasonCode ?? null,
        assessedBy: ctx.userId ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.grcAssessmentRecorded,
        entityType: 'grc_assessment',
        entityId: row.id,
        detail: { controlId, status: input.status },
      });
      await this.emitter.publishGrc(tx, 'ControlAssessed', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: row.id, recordType: 'grc_assessment', toState: input.status },
      });
      return { id: row.id };
    });
  }

  // ---- GRC read surface (permission-gated, RLS-scoped, read-only/no audit) ----
  async listControls(ctx: RequestContext): Promise<GrcControlListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.grcControlRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listGrcControls(tx));
  }
  async listAssessments(ctx: RequestContext, controlId: string): Promise<GrcAssessmentListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.grcControlRead);
    return this.db.withTenant(ctx, async (tx) => {
      const control = await this.repo.getGrcControl(tx, controlId);
      if (!control) throw notFound('control not found.', ctx.correlationId);
      return this.repo.listGrcAssessments(tx, controlId);
    });
  }

  // ---- Privacy ----
  async setClassification(
    ctx: RequestContext,
    input: { scope?: string; classificationKey: string; level: string; retentionDays?: number | null },
  ): Promise<PrivacyClassificationRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.privacyPolicyManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!(CLASSIFICATIONS as readonly string[]).includes(input.level))
      throw badRequest('unknown level.', ctx.correlationId);
    if (input.retentionDays != null && (!Number.isInteger(input.retentionDays) || input.retentionDays < 0))
      throw badRequest('retentionDays must be a non-negative integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const cls = await this.repo.insertPrivacyClassification(tx, {
        tenantId: ctx.tenantId,
        scope,
        classificationKey: input.classificationKey,
        level: input.level,
        retentionDays: input.retentionDays ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.privacyClassificationSet,
        entityType: 'privacy_classification',
        entityId: cls.id,
        detail: { classificationKey: input.classificationKey, level: input.level },
      });
      await this.emitter.publishPrivacy(tx, 'ClassificationSet', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: cls.id, classification: input.level },
      });
      return cls;
    });
  }

  /** Record a bounded privacy processing/control event over an OPAQUE subject reference — never raw personal data. */
  async recordPrivacyEvent(
    ctx: RequestContext,
    input: {
      subjectRef: string;
      action: string;
      classification?: string | null;
      reasonCode?: string | null;
      evidenceRef?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M41_PERMISSIONS.privacyRecordManage);
    if (!input.subjectRef) throw badRequest('subjectRef is required.', ctx.correlationId);
    if (!['process', 'mask', 'redact', 'retain', 'erase_request', 'access_request'].includes(input.action))
      throw badRequest('unknown privacy action.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertPrivacyRecord(tx, {
        tenantId: ctx.tenantId,
        subjectRef: input.subjectRef,
        classification: input.classification ?? null,
        action: input.action,
        reasonCode: input.reasonCode ?? null,
        evidenceRef: input.evidenceRef ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.privacyRecordAdded,
        entityType: 'privacy_record',
        entityId: row.id,
        detail: { action: input.action },
      });
      await this.emitter.publishPrivacy(tx, 'PrivacyRecordAdded', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: row.id, reasonCode: input.action },
      });
      return { id: row.id };
    });
  }

  // ---- SOC ----
  async recordIncident(
    ctx: RequestContext,
    input: {
      incidentKey: string;
      severity?: string;
      category: string;
      reasonCode?: string | null;
      evidenceRef?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M41_PERMISSIONS.dlpManage);
    if (!input.incidentKey || !input.category)
      throw badRequest('incidentKey and category are required.', ctx.correlationId);
    const severity = input.severity ?? 'low';
    if (!['low', 'medium', 'high', 'critical'].includes(severity))
      throw badRequest('unknown severity.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertIncident(tx, {
        tenantId: ctx.tenantId,
        incidentKey: input.incidentKey,
        severity,
        category: input.category,
        reasonCode: input.reasonCode ?? null,
        evidenceRef: input.evidenceRef ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.incidentRecorded,
        entityType: 'security_incident',
        entityId: row.id,
        detail: { severity, category: input.category },
      });
      await this.emitter.publishSoc(tx, 'IncidentRecorded', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: row.id, recordType: 'incident', reasonCode: severity },
      });
      return { id: row.id };
    });
  }

  // ---- Privacy + SOC READ surface (permission-gated, RLS-scoped, read-only/no audit). Privacy records and
  // incidents are append-only evidence — list-only. Privacy records expose only an OPAQUE subject reference,
  // never raw personal data, so surfacing them is not protected-PII access and emits no access audit. ----
  async listPrivacyClassifications(ctx: RequestContext): Promise<PrivacyClassificationListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.privacyPolicyRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPrivacyClassifications(tx));
  }
  async getPrivacyClassification(ctx: RequestContext, id: string): Promise<PrivacyClassificationListRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.privacyPolicyRead);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.getPrivacyClassification(tx, id);
      if (!row) throw notFound('classification not found.', ctx.correlationId);
      return row;
    });
  }
  async listPrivacyRecords(ctx: RequestContext, limit = 200): Promise<PrivacyRecordListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.privacyPolicyRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPrivacyRecords(tx, limit));
  }
  async listIncidents(ctx: RequestContext): Promise<IncidentListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.dlpRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listIncidents(tx));
  }
  async getIncident(ctx: RequestContext, id: string): Promise<IncidentListRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.dlpRead);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.getIncident(tx, id);
      if (!row) throw notFound('incident not found.', ctx.correlationId);
      return row;
    });
  }
}
