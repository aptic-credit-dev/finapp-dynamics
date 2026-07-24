/**
 * DefinitionService — authoring lifecycle for workflow definitions (ADR-021/022). Every mutating method
 * enforces its permission server-side (default deny, the single choke point), runs inside `db.withTenant`,
 * records audit + (for publish) an outbox event in the SAME transaction, and is optimistic-lock guarded.
 * Publishing freezes the spec; a published version is never edited.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M06_PERMISSIONS } from './permissions.ts';
import { M06_AUDIT_CODES } from './audit-codes.ts';
import { validateDefinition } from './domain/validator.ts';
import { checkDefinitionTransition, type DefinitionAction } from './domain/lifecycles.ts';
import { WorkflowRepository, type DefinitionRow, type VersionRow } from './repository.ts';
import { type M06Emitter } from './emit.ts';
import { invalidDefinition } from './errors.ts';

function specCode(spec: unknown): string | null {
  if (typeof spec === 'object' && spec !== null && 'code' in spec) {
    const code = spec.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export class DefinitionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M06Emitter;
  private readonly repo: WorkflowRepository;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M06Emitter,
    repo: WorkflowRepository = new WorkflowRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Create a definition and its first DRAFT version from a supplied spec. */
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name: string; description?: string | null; spec: unknown },
  ): Promise<{ definition: DefinitionRow; version: VersionRow }> {
    await this.authz.require(ctx, M06_PERMISSIONS.definitionCreate);
    if (specCode(input.spec) !== input.code) {
      throw invalidDefinition(
        [{ path: 'code', code: 'CODE_MISMATCH', message: 'spec.code must equal the definition code' }],
        ctx.correlationId,
      );
    }
    return this.db.withTenant(ctx, async (tx) => {
      const definition = await this.repo.insertDefinition(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        createdBy: actor,
      });
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        definitionId: definition.id,
        versionNumber: 1,
        spec: input.spec,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.definitionCreated,
        entityType: 'workflow_definition',
        entityId: definition.id,
        detail: { code: input.code },
      });
      return { definition, version };
    });
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    action: DefinitionAction,
    permission: string,
    auditCode: string,
    reason: string | null,
  ): Promise<VersionRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.findVersion(tx, versionId);
      if (version === null) throw ProblemError.notFound('Workflow version not found.', ctx.correlationId);

      // Validation runs at the VALIDATE step over the frozen-to-be spec.
      if (action === 'validate') {
        const result = validateDefinition(version.spec);
        if (!result.ok) throw invalidDefinition(result.errors, ctx.correlationId);
      }

      const check = checkDefinitionTransition(version.status as never, action);
      if (!check.ok)
        throw ProblemError.conflict(`Invalid definition transition: ${check.reason}`, ctx.correlationId);

      const contentHash =
        action === 'publish' ? createHash('sha256').update(JSON.stringify(version.spec)).digest('hex') : null;

      const updated = await this.repo.updateVersionStatus(tx, {
        id: versionId,
        expectedVersion,
        toStatus: check.to,
        contentHash,
        publishedBy: action === 'publish' ? actor : null,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Workflow version was modified concurrently (stale version).',
          ctx.correlationId,
        );

      if (action === 'activate') {
        // Exactly one ACTIVE version per definition: retire any prior active first would violate the partial
        // unique index during the swap, so retire others AFTER this one activated is impossible — instead we
        // retired-then-activated: here we retire the OTHER active versions (this row is already ACTIVE only if
        // no other was; the partial unique index enforces it). Retire the previously-active sibling if present.
        await tx.query(
          `UPDATE workflow_definition_version SET status = 'RETIRED', version = version + 1
           WHERE definition_id = $1 AND status = 'ACTIVE' AND id <> $2`,
          [updated.definition_id, versionId],
        );
      }

      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'workflow_definition_version',
        entityId: versionId,
        ...(reason !== null ? { reason } : {}),
        detail: { toStatus: check.to },
      });

      if (action === 'publish') {
        await this.emitter.publish(tx, {
          type: 'WorkflowDefinitionPublished',
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            definitionId: updated.definition_id,
            versionId,
            versionNumber: updated.version_number,
            code: specCode(version.spec) ?? '',
          },
        });
      }
      return updated;
    });
  }

  async newVersion(
    ctx: RequestContext,
    actor: string | null,
    definitionId: string,
    spec: unknown,
  ): Promise<VersionRow> {
    await this.authz.require(ctx, M06_PERMISSIONS.definitionEdit);
    return this.db.withTenant(ctx, async (tx) => {
      const definition = await this.repo.findDefinition(tx, definitionId);
      if (definition === null)
        throw ProblemError.notFound('Workflow definition not found.', ctx.correlationId);
      const maxRow = await tx.query<{ n: number }>(
        `SELECT COALESCE(MAX(version_number), 0)::int AS n FROM workflow_definition_version WHERE definition_id = $1`,
        [definitionId],
      );
      const nextNumber = (maxRow.rows[0]?.n ?? 0) + 1;
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        definitionId,
        versionNumber: nextNumber,
        spec,
        createdBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.definitionUpdated,
        entityType: 'workflow_definition_version',
        entityId: version.id,
        detail: { versionNumber: nextNumber },
      });
      return version;
    });
  }

  validate(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ): Promise<VersionRow> {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'validate',
      M06_PERMISSIONS.definitionValidate,
      M06_AUDIT_CODES.definitionValidated,
      null,
    );
  }

  publish(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ): Promise<VersionRow> {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'publish',
      M06_PERMISSIONS.definitionPublish,
      M06_AUDIT_CODES.definitionPublished,
      null,
    );
  }

  activate(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ): Promise<VersionRow> {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'activate',
      M06_PERMISSIONS.definitionActivate,
      M06_AUDIT_CODES.definitionActivated,
      null,
    );
  }

  retire(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<VersionRow> {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'retire',
      M06_PERMISSIONS.definitionRetire,
      M06_AUDIT_CODES.definitionRetired,
      reason,
    );
  }

  async view(ctx: RequestContext, versionId: string): Promise<VersionRow | null> {
    await this.authz.require(ctx, M06_PERMISSIONS.definitionView);
    return this.db.withTenant(ctx, (tx) => this.repo.findVersion(tx, versionId));
  }
}
