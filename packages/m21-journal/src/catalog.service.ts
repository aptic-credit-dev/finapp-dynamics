/**
 * CatalogService — the journal engine's CONFIGURABLE reference data: journal types (versioned, one active per code),
 * engine config (versioned, immutable-after-publish, one active per scope, idempotency-keyed) and the validation
 * reason-code registry. Nothing Aptic-/Kenya-specific: types/config are tenant-configurable. Every mutation is
 * permission-gated (default deny), audited through m03, and (for the published spec) publishes journal.lifecycle on
 * the ONE m06 outbox. It never touches a draft, approves, or posts.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M21_PERMISSIONS } from './permissions.ts';
import { M21_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isJournalTypeKind } from './domain/limits.ts';
import { checkSpecTransition, isSpecFrozen } from './domain/lifecycles.ts';
import {
  JournalRepository,
  type JournalConfigRow,
  type JournalReasonCodeRow,
  type JournalTypeRow,
} from './repository.ts';
import type { M21Emitter } from './emit.ts';

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M21Emitter;
  private readonly repo: JournalRepository;
  constructor(db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository = new JournalRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  // --- journal type ---------------------------------------------------------------------------
  async createType(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name?: string | null; kind?: string; requiresBalance?: boolean },
  ): Promise<JournalTypeRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.typeManage);
    if (input.code.trim() === '') throw badRequest('code is required.', ctx.correlationId);
    const kind = input.kind ?? 'standard';
    if (!isJournalTypeKind(kind)) throw badRequest('unknown journal type kind.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertType(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name ?? null,
        kind,
        requiresBalance: input.requiresBalance ?? true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.typeCreated,
        entityType: 'journal_type',
        entityId: row.id,
        detail: { kind },
      });
      await this.emitter.publishJournal(tx, {
        type: 'JournalTypeCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recordId: row.id, recordType: 'journal_type', journalType: input.code, isDraft: true },
      });
      return row;
    });
  }
  async publishType(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<JournalTypeRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.typeManage);
    return this.db.withTenant(ctx, async (tx) => {
      const type = await this.repo.findType(tx, id);
      if (type === null) throw ProblemError.notFound('Journal type not found.', ctx.correlationId);
      const t = checkSpecTransition(type.status, 'active');
      if (!t.ok) throw badRequest(`Cannot publish a ${type.status} type.`, ctx.correlationId);
      const updated = await this.repo.setTypeStatus(tx, { id, expectedVersion, status: 'active', by: actor });
      if (updated === null)
        throw ProblemError.conflict('Journal type modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.typeUpdated,
        entityType: 'journal_type',
        entityId: id,
        detail: { toStatus: 'active' },
      });
      return updated;
    });
  }
  async getType(ctx: RequestContext, id: string): Promise<JournalTypeRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.typeRead);
    return this.db.withTenant(ctx, async (tx) => {
      const t = await this.repo.findType(tx, id);
      if (t === null) throw ProblemError.notFound('Journal type not found.', ctx.correlationId);
      return t;
    });
  }
  async listTypes(ctx: RequestContext): Promise<JournalTypeRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.typeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTypes(tx));
  }

  // --- journal config -------------------------------------------------------------------------
  async createConfig(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      name?: string | null;
      maxLines?: number;
      allowManualDraft?: boolean;
      idempotencyKey?: string | null;
    },
  ): Promise<JournalConfigRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.configManage);
    const maxLines = input.maxLines ?? 1000;
    if (!Number.isInteger(maxLines) || maxLines <= 0)
      throw badRequest('maxLines must be a positive integer.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing; // idempotent create
      }
      const row = await this.repo.insertConfig(tx, {
        tenantId: ctx.tenantId,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        maxLines,
        allowManualDraft: input.allowManualDraft ?? true,
        contentHash: null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.configCreated,
        entityType: 'journal_config',
        entityId: row.id,
        detail: { scope: row.scope },
      });
      return row;
    });
  }
  async publishConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<JournalConfigRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.configPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const cfg = await this.repo.findConfig(tx, id);
      if (cfg === null) throw ProblemError.notFound('Journal config not found.', ctx.correlationId);
      if (isSpecFrozen(cfg.status))
        throw badRequest(`A ${cfg.status} config is immutable — create a new version.`, ctx.correlationId);
      const t = checkSpecTransition(cfg.status, 'active');
      if (!t.ok) throw badRequest(`Cannot publish a ${cfg.status} config.`, ctx.correlationId);
      const updated = await this.repo.setConfigStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Journal config modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.configPublished,
        entityType: 'journal_config',
        entityId: id,
        detail: { scope: updated.scope },
      });
      await this.emitter.publishJournal(tx, {
        type: 'JournalConfigPublished',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { recordId: id, recordType: 'journal_config', toStatus: 'active', isDraft: true },
      });
      return updated;
    });
  }
  async getConfig(ctx: RequestContext, id: string): Promise<JournalConfigRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findConfig(tx, id);
      if (c === null) throw ProblemError.notFound('Journal config not found.', ctx.correlationId);
      return c;
    });
  }
  async listConfigs(ctx: RequestContext): Promise<JournalConfigRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx));
  }

  // --- reason code registry -------------------------------------------------------------------
  async registerReasonCode(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; category: string; severity: string; description?: string | null },
  ): Promise<JournalReasonCodeRow> {
    await this.authz.require(ctx, M21_PERMISSIONS.reasonCodeManage);
    if (input.code.trim() === '') throw badRequest('code is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertReasonCode(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        category: input.category,
        severity: input.severity,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.reasonCodeRegistered,
        entityType: 'journal_reason_code',
        entityId: row.id,
        detail: { category: input.category },
      });
      return row;
    });
  }
  async listReasonCodes(ctx: RequestContext): Promise<JournalReasonCodeRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.reasonCodeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReasonCodes(tx));
  }
}
