/**
 * TemplateService — authoring + versioning + lifecycle for notification templates (ADR-039). Every mutating
 * method enforces its permission server-side (default deny, the single choke point), runs inside
 * `db.withTenant`, records audit + a notification.lifecycle outbox event in the SAME transaction, and is
 * optimistic-lock guarded. Validation runs at the VALIDATE step over the to-be-frozen spec; publishing freezes
 * the content hash and a published version's spec is NEVER edited — a change is a new version. Lifecycle
 * transitions go through the PURE `checkTemplateTransition` choke point.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M08_PERMISSIONS } from './permissions.ts';
import { M08_AUDIT_CODES } from './audit-codes.ts';
import { validateTemplateSpec } from './domain/template.ts';
import { checkTemplateTransition, type TemplateAction } from './domain/lifecycles.ts';
import { isChannel } from './domain/channels.ts';
import { contentHashOf } from './hash.ts';
import { NotifyRepository, type TemplateRow, type TemplateVersionRow } from './repository.ts';
import type { M08Emitter } from './emit.ts';
import { badRequest, invalidTemplate } from './errors.ts';

function specField(spec: unknown, field: string): string | null {
  if (typeof spec === 'object' && spec !== null && field in spec) {
    const v = (spec as Record<string, unknown>)[field];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

export class TemplateService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M08Emitter;
  private readonly repo: NotifyRepository;

  constructor(db: Db, authz: Authz, emitter: M08Emitter, repo: NotifyRepository = new NotifyRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Create a template and its first DRAFT version from a supplied spec. */
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: { key: string; name: string; description?: string | null; scope?: string; spec: unknown },
  ): Promise<{ template: TemplateRow; version: TemplateVersionRow }> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateAuthor);
    if (specField(input.spec, 'code') !== input.key) {
      throw badRequest('spec.code must equal the template key', ctx.correlationId);
    }
    const channel = specField(input.spec, 'channel');
    if (channel === null || !isChannel(channel)) {
      throw badRequest('spec.channel must be a valid channel', ctx.correlationId);
    }
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform') {
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    }
    if (scope === 'platform') await this.authz.require(ctx, M08_PERMISSIONS.platformAdminister);

    return this.db.withTenant(ctx, async (tx) => {
      const template = await this.repo.insertTemplate(tx, {
        tenantId: ctx.tenantId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        channel,
        scope,
        createdBy: actor,
      });
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        templateId: template.id,
        versionNumber: 1,
        spec: input.spec,
        notes: null,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.templateCreated,
        entityType: 'notification_template',
        entityId: template.id,
        detail: { key: input.key, channel, scope },
      });
      await this.emitter.publish(tx, {
        type: 'TemplateCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          templateId: template.id,
          versionId: version.id,
          versionNumber: 1,
          code: input.key,
          channel,
        },
      });
      return { template, version };
    });
  }

  /** Rename / re-describe a template (metadata only; never touches version content). */
  async update(
    ctx: RequestContext,
    actor: string | null,
    templateId: string,
    input: { expectedVersion: number; name: string; description?: string | null },
  ): Promise<TemplateRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findTemplate(tx, templateId);
      if (existing === null) throw ProblemError.notFound('Template not found.', ctx.correlationId);
      const updated = await this.repo.updateTemplate(tx, {
        id: templateId,
        expectedVersion: input.expectedVersion,
        name: input.name,
        description: input.description ?? null,
        updatedBy: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Template was modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.templateUpdated,
        entityType: 'notification_template',
        entityId: templateId,
        detail: { name: input.name },
      });
      return updated;
    });
  }

  /** Author a NEW DRAFT version of an existing template from a fresh spec (published ones stay frozen). */
  async newVersion(
    ctx: RequestContext,
    actor: string | null,
    templateId: string,
    spec: unknown,
    notes: string | null = null,
  ): Promise<TemplateVersionRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const template = await this.repo.findTemplate(tx, templateId);
      if (template === null) throw ProblemError.notFound('Template not found.', ctx.correlationId);
      if (specField(spec, 'code') !== template.key) {
        throw badRequest('spec.code must equal the template key', ctx.correlationId);
      }
      const nextNumber = await this.repo.nextVersionNumber(tx, templateId);
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        templateId,
        versionNumber: nextNumber,
        spec,
        notes,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.versionCreated,
        entityType: 'notification_template_version',
        entityId: version.id,
        detail: { versionNumber: nextNumber },
      });
      return version;
    });
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    action: TemplateAction,
    permission: string,
    auditCode: string,
    eventType: 'TemplatePublished' | 'TemplateActivated' | 'TemplateRetired' | null,
    reason: string | null,
  ): Promise<TemplateVersionRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.findVersion(tx, versionId);
      if (version === null) throw ProblemError.notFound('Template version not found.', ctx.correlationId);

      if (action === 'validate') {
        const result = validateTemplateSpec(version.spec);
        if (!result.ok) {
          await this.emitter.recordAudit(tx, ctx, {
            code: M08_AUDIT_CODES.templateValidationFailed,
            entityType: 'notification_template_version',
            entityId: versionId,
            detail: { problems: result.errors.length },
          });
          throw invalidTemplate(result.errors, ctx.correlationId);
        }
      }

      const check = checkTemplateTransition(version.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid template transition: ${check.reason ?? ''}`, ctx.correlationId);

      const contentHash = action === 'publish' ? contentHashOf(version.spec) : null;
      const updated = await this.repo.updateVersionStatus(tx, {
        id: versionId,
        expectedVersion,
        toStatus: check.to,
        contentHash,
        publishedBy: action === 'publish' ? actor : null,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Template version was modified concurrently (stale version).',
          ctx.correlationId,
        );

      // Exactly one ACTIVE version per template — retire the prior active sibling in the same tx.
      if (action === 'activate') {
        await this.repo.retireActiveVersions(tx, updated.template_id, versionId);
      }

      if (action === 'validate') {
        await this.emitter.recordAudit(tx, ctx, {
          code: M08_AUDIT_CODES.templateValidated,
          entityType: 'notification_template_version',
          entityId: versionId,
          detail: { toStatus: check.to },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: auditCode,
          entityType: 'notification_template_version',
          entityId: versionId,
          ...(reason !== null ? { reason } : {}),
          detail: { toStatus: check.to },
        });
      }

      if (eventType !== null) {
        await this.emitter.publish(tx, {
          type: eventType,
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            templateId: updated.template_id,
            versionId,
            versionNumber: updated.version_number,
            code: specField(version.spec, 'code') ?? '',
            fromStatus: version.status,
            toStatus: check.to,
            ...(reason !== null ? { reason } : {}),
          },
        });
      }
      return updated;
    });
  }

  validate(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'validate',
      M08_PERMISSIONS.templateValidate,
      M08_AUDIT_CODES.templateValidated,
      null,
      null,
    );
  }
  publish(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'publish',
      M08_PERMISSIONS.templatePublish,
      M08_AUDIT_CODES.versionPublished,
      'TemplatePublished',
      null,
    );
  }
  activate(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'activate',
      M08_PERMISSIONS.templateActivate,
      M08_AUDIT_CODES.versionActivated,
      'TemplateActivated',
      null,
    );
  }
  retire(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    reason: string | null = null,
  ) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'retire',
      M08_PERMISSIONS.templateRetire,
      M08_AUDIT_CODES.versionRetired,
      'TemplateRetired',
      reason,
    );
  }

  // --- reads (view permission) ------------------------------------------------------------------
  async get(ctx: RequestContext, templateId: string): Promise<TemplateRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findTemplate(tx, templateId));
    if (row === null) throw ProblemError.notFound('Template not found.', ctx.correlationId);
    return row;
  }
  async list(ctx: RequestContext): Promise<TemplateRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateView);
    return this.db.withTenant(ctx, (tx) => this.repo.listTemplates(tx));
  }
  async getVersion(ctx: RequestContext, versionId: string): Promise<TemplateVersionRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findVersion(tx, versionId));
    if (row === null) throw ProblemError.notFound('Template version not found.', ctx.correlationId);
    return row;
  }
  async listVersions(ctx: RequestContext, templateId: string): Promise<TemplateVersionRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.templateView);
    return this.db.withTenant(ctx, (tx) => this.repo.listVersions(tx, templateId));
  }
}
