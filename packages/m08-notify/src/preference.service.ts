/**
 * PreferenceService — user notification preferences and destination suppression (prompt §E10). A user may set,
 * per channel, an opt-in flag, a self-suppression flag, and quiet hours; an administrator may hard-suppress a
 * destination (bounce/complaint). Mandatory categories bypass all of this in the domain layer — a preference
 * can never silence a security or legal notification. Every change is permissioned and audited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M08_PERMISSIONS } from './permissions.ts';
import { M08_AUDIT_CODES } from './audit-codes.ts';
import { isChannel } from './domain/channels.ts';
import { NotifyRepository, type PreferenceRow } from './repository.ts';
import type { M08Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

interface QuietHoursInput {
  startMinute: number;
  endMinute: number;
}

function validQuietHours(q: unknown): q is QuietHoursInput {
  if (typeof q !== 'object' || q === null) return false;
  const o = q as Record<string, unknown>;
  return (
    typeof o['startMinute'] === 'number' &&
    typeof o['endMinute'] === 'number' &&
    o['startMinute'] >= 0 &&
    o['startMinute'] < 1440 &&
    o['endMinute'] >= 0 &&
    o['endMinute'] < 1440
  );
}

export class PreferenceService {
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

  /** Set a user's per-channel preference. */
  async setPreference(
    ctx: RequestContext,
    actor: string | null,
    input: { subjectId: string; channel: string; optIn: boolean; suppressed: boolean; quietHours?: unknown },
  ): Promise<PreferenceRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.preferenceUpdate);
    if (!isChannel(input.channel)) throw badRequest('invalid channel', ctx.correlationId);
    if (input.quietHours !== undefined && input.quietHours !== null && !validQuietHours(input.quietHours)) {
      throw badRequest('invalid quietHours', ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.upsertSubjectPreference(tx, {
        tenantId: ctx.tenantId,
        subjectId: input.subjectId,
        channel: input.channel,
        optIn: input.optIn,
        suppressed: input.suppressed,
        quietHours: input.quietHours ?? null,
        updatedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.preferenceChanged,
        entityType: 'notification_preference',
        entityId: row.id,
        detail: { subjectId: input.subjectId, channel: input.channel, optIn: input.optIn },
      });
      return row;
    });
  }

  /** Administratively suppress (or un-suppress) a destination on a channel. */
  async setSuppression(
    ctx: RequestContext,
    actor: string | null,
    input: { destination: string; channel: string; suppressed: boolean; reason?: string | null },
  ): Promise<PreferenceRow> {
    await this.authz.require(ctx, M08_PERMISSIONS.suppressionManage);
    if (!isChannel(input.channel)) throw badRequest('invalid channel', ctx.correlationId);
    if (input.destination.trim() === '') throw badRequest('destination is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.upsertDestinationSuppression(tx, {
        tenantId: ctx.tenantId,
        destination: input.destination,
        channel: input.channel,
        suppressed: input.suppressed,
        reason: input.reason ?? null,
        updatedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M08_AUDIT_CODES.preferenceChanged,
        entityType: 'notification_preference',
        entityId: row.id,
        detail: { channel: input.channel, suppressed: input.suppressed },
      });
      return row;
    });
  }

  async listForSubject(ctx: RequestContext, subjectId: string): Promise<PreferenceRow[]> {
    await this.authz.require(ctx, M08_PERMISSIONS.preferenceView);
    return this.db.withTenant(ctx, (tx) => this.repo.listPreferences(tx, subjectId));
  }
}
