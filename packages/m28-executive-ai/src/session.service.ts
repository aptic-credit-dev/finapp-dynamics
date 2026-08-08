/**
 * CopilotSessionService — an executive assistant session (a bounded conversation scope). A 'platform'-scoped session
 * requires the privileged ai.copilot.platform permission (a tenant-scoped query permission can NEVER grant platform
 * scope). A confidential/restricted session requires ai.copilot.sensitive. Sessions hold NO business data — only opaque
 * labels + counters. Every creation is authorized (default deny), idempotency-keyed and audited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M28_PERMISSIONS } from './permissions.ts';
import { M28_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { governanceForbidden } from './errors.ts';
import {
  isDataClassification,
  isScopeLevel,
  isSensitiveClassification,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import { ExecutiveAiRepository, type SessionRow } from './repository.ts';
import type { M28Emitter } from './emit.ts';

export class CopilotSessionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M28Emitter;
  private readonly repo: ExecutiveAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M28Emitter,
    repo: ExecutiveAiRepository = new ExecutiveAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async createSession(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scopeLevel?: string;
      subjectLabel?: string | null;
      classification?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<SessionRow> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotQuery);
    const scopeLevel = input.scopeLevel ?? 'tenant';
    if (!isScopeLevel(scopeLevel)) throw badRequest('unknown scope level.', ctx.correlationId);
    const classification = input.classification ?? 'internal';
    if (!isDataClassification(classification))
      throw badRequest('unknown data classification.', ctx.correlationId);
    // Platform scope + sensitive classification each require their own dedicated privileged permission (default deny).
    if (scopeLevel === 'platform') await this.authz.require(ctx, M28_PERMISSIONS.copilotPlatform);
    if (isSensitiveClassification(classification)) {
      if (!ctx.permissions.includes(M28_PERMISSIONS.copilotSensitive))
        throw governanceForbidden(REASON_CODES.notEntitled, ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findSessionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const session = await this.repo.insertSession(tx, {
        tenantId: ctx.tenantId,
        scopeLevel,
        subjectLabel: input.subjectLabel ?? null,
        classification,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.sessionCreated,
        entityType: 'copilot_session',
        entityId: session.id,
        detail: { scopeLevel, classification },
      });
      return session;
    });
  }

  async getSession(ctx: RequestContext, id: string): Promise<SessionRow> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    const session = await this.db.withTenant(ctx, (tx) => this.repo.findSession(tx, id));
    if (session === null) throw ProblemError.notFound('Session not found.', ctx.correlationId);
    return session;
  }

  async listSessions(ctx: RequestContext, page: { limit?: number; offset?: number }): Promise<SessionRow[]> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    const p = clampPage(page.limit, page.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listSessions(tx, p.limit, p.offset));
  }
}
