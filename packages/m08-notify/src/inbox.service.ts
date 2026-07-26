/**
 * InboxService — the in-app inbox read surface (prompt §E11). A recipient lists and marks-read their OWN
 * notifications; RLS plus an explicit `recipient_id` predicate mean a caller can never see or mutate another
 * user's inbox, even within the same tenant. Inbox rows are created by the notification dispatch path (in-app
 * channel), not here. Mark-read is optimistic-lock guarded and only affects the owning recipient's unread row.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M08_PERMISSIONS } from './permissions.ts';
import { M08_AUDIT_CODES } from './audit-codes.ts';
import { NotifyRepository, type InboxRow } from './repository.ts';
import type { M08Emitter } from './emit.ts';

export class InboxService {
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

  /** List the caller's own inbox (recipient is the authenticated actor, never a caller-supplied id). */
  async list(
    ctx: RequestContext,
    recipientId: string,
    opts: { status?: string | null; limit?: number; offset?: number } = {},
  ): Promise<InboxRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.inboxView);
    const status = opts.status ?? null;
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listInbox(tx, recipientId, status, Math.min(opts.limit ?? 50, 200), opts.offset ?? 0),
    );
  }

  /** Mark one of the caller's own unread inbox rows read. */
  async markRead(
    ctx: RequestContext,
    recipientId: string,
    id: string,
    expectedVersion: number,
  ): Promise<InboxRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.inboxManage);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findInbox(tx, id);
      if (existing?.recipient_id !== recipientId)
        throw ProblemError.notFound('Inbox notification not found.', ctx.correlationId);
      const updated = await this.repo.markInboxRead(tx, id, recipientId, expectedVersion);
      if (updated === null)
        throw ProblemError.conflict(
          'Inbox notification was already read or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.inboxRead,
        entityType: 'inbox_notification',
        entityId: id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'InboxNotificationRead',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        payload: { id, recipientId, severity: updated.severity, status: 'read' },
      });
      return updated;
    });
  }
}
