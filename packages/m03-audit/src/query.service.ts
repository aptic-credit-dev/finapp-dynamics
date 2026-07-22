import { ProblemError, type Authz, type Db, type RequestContext, type SystemContext } from '@finapp/kernel';
import { AuditRepository, type AuditEventRow, type AuditQueryFilter } from './repository.ts';
import { AuditService } from './audit.service.ts';
import { verifyChain, type ChainVerification } from './integrity.ts';
import { AUDIT_PERMISSIONS } from './permissions.ts';
import { AUDIT_AUDIT_CODES } from './audit-codes.ts';

/** The caller's proven context — tenant or platform — always carrying its resolved permissions. */
type AuthorizedContext = RequestContext | (SystemContext & { readonly permissions: readonly string[] });

const MAX_LIMIT = 200;

/**
 * Authorized read/investigation over the audit spine. Enforces the `audit.*` permissions in the service
 * (matching every other module), keeps tenant reads RLS-bounded, and gates cross-tenant/platform reads
 * behind the SEPARATE `audit.platform.view` grant. Exports and integrity checks are themselves audited —
 * the watchers are watched.
 */
export class AuditQueryService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: AuditService;
  private readonly repo: AuditRepository;

  constructor(db: Db, authz: Authz, audit: AuditService, repo: AuditRepository = new AuditRepository()) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.repo = repo;
  }

  /** One event by id, within the caller's tenant (RLS) unless they hold platform view. */
  async getEvent(ctx: RequestContext, id: string): Promise<AuditEventRow> {
    await this.authz.require(ctx, AUDIT_PERMISSIONS.eventView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findById(tx, id));
    if (row === null) throw ProblemError.notFound('Audit event not found.', ctx.correlationId);
    return row;
  }

  /** Search the caller's OWN tenant's events (RLS-bounded). */
  async searchTenant(
    ctx: RequestContext,
    filter: Omit<AuditQueryFilter, 'limit' | 'offset' | 'platform'> & { limit?: number; offset?: number },
  ): Promise<AuditEventRow[]> {
    await this.authz.require(ctx, AUDIT_PERMISSIONS.eventSearch);
    const f = bound(filter);
    return this.db.withTenant(ctx, (tx) => this.repo.search(tx, f));
  }

  /** Search PLATFORM (tenant-less) events. Requires the separate platform grant; runs under system escape. */
  async searchPlatform(
    ctx: AuthorizedContext,
    filter: Omit<AuditQueryFilter, 'limit' | 'offset' | 'platform'> & { limit?: number; offset?: number },
  ): Promise<AuditEventRow[]> {
    await this.authz.require(ctx, AUDIT_PERMISSIONS.platformView);
    const f = { ...bound(filter), platform: true };
    return this.db.withSystem(
      { reason: 'audit platform search (m03)', correlationId: ctx.correlationId },
      (tx) => this.repo.search(tx, f),
    );
  }

  /** Export a tenant's matching events, and RECORD the export as its own audit event. */
  async exportTenant(
    ctx: RequestContext,
    filter: Omit<AuditQueryFilter, 'limit' | 'offset' | 'platform'> & { limit?: number; offset?: number },
  ): Promise<AuditEventRow[]> {
    await this.authz.require(ctx, AUDIT_PERMISSIONS.eventExport);
    const f = bound(filter);
    const rows = await this.db.withTenant(ctx, (tx) => this.repo.search(tx, f));
    // The export IS an audited event (the watchers are watched). Its own persistence must not mask the
    // export result, so a recording failure escalates rather than being swallowed.
    await this.audit.recordSuccess(ctx, {
      code: AUDIT_AUDIT_CODES.eventExported,
      category: 'export',
      resourceType: 'audit_export',
      resourceId: ctx.tenantId,
      detail: { returned: rows.length },
    });
    return rows;
  }

  /**
   * Verifies a scope's hash chain. A tenant caller may verify only its OWN chain (RLS-bounded); verifying
   * another tenant's chain or the PLATFORM chain requires the separate platform grant. Detects any in-place
   * edit, deletion, or reordering of stored rows, and records the verification outcome.
   */
  async verifyScope(ctx: AuthorizedContext, scopeKey: string): Promise<ChainVerification> {
    await this.authz.require(ctx, AUDIT_PERMISSIONS.integrityVerify);
    const ownTenantScope = 'tenantId' in ctx && typeof ctx.tenantId === 'string' && scopeKey === ctx.tenantId;

    let rows: AuditEventRow[];
    if (ownTenantScope) {
      rows = await this.db.withTenant(ctx, (tx) => this.repo.scopeChain(tx, scopeKey));
    } else {
      await this.authz.require(ctx, AUDIT_PERMISSIONS.platformView);
      rows = await this.db.withSystem(
        { reason: 'audit integrity verify (m03)', correlationId: ctx.correlationId },
        (tx) => this.repo.scopeChain(tx, scopeKey),
      );
    }
    const result = verifyChain(rows.map((r) => AuditService.hashableOf(r)));
    await this.audit.recordSuccess(ctx, {
      code: result.ok ? AUDIT_AUDIT_CODES.integrityVerified : AUDIT_AUDIT_CODES.integrityFailed,
      category: 'security_event',
      resourceType: 'audit_chain',
      resourceId: scopeKey,
      detail: {
        ok: result.ok,
        checked: result.checked,
        brokenAtSeq: result.brokenAtSeq,
        reason: result.reason,
      },
    });
    return result;
  }
}

function bound(filter: { limit?: number; offset?: number } & Record<string, unknown>): AuditQueryFilter {
  const { limit, offset, ...rest } = filter;
  return {
    ...(rest as Omit<AuditQueryFilter, 'limit' | 'offset'>),
    limit: Math.min(Math.max(limit ?? 50, 1), MAX_LIMIT),
    offset: Math.max(offset ?? 0, 0),
  };
}
