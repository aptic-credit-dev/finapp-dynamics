import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { InboxService, PreferenceService, M08_AUDIT_CODES, M08_PERMISSIONS } from '@finapp/m08-notify';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { preferenceView, inboxView } from './views.ts';

/**
 * The self-service inbox + preferences surface, under `/api/v1/notifications`. A caller reads and marks-read
 * their OWN inbox (recipient is the authenticated actor, never a supplied id) and sets their OWN channel
 * preferences. Destination suppression is an administrative action under a separate permission.
 */

interface PreferenceBody {
  channel?: unknown;
  optIn?: unknown;
  suppressed?: unknown;
  quietHours?: unknown;
}
interface SuppressionBody {
  destination?: unknown;
  channel?: unknown;
  suppressed?: unknown;
  reason?: unknown;
}
interface ReadBody {
  expectedVersion?: unknown;
}

@Controller('notifications')
export class InboxPreferencesController {
  private readonly inbox: InboxService;
  private readonly preferences: PreferenceService;
  private readonly actors: ActorContextFactory;
  constructor(inbox: InboxService, preferences: PreferenceService, actors: ActorContextFactory) {
    this.inbox = inbox;
    this.preferences = preferences;
    this.actors = actors;
  }

  // --- inbox ------------------------------------------------------------------------------------
  @Get('inbox')
  async listInbox(@Headers() headers: Record<string, string>, @Query('status') status?: string) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'list inbox (m08)'));
    const rows = await this.inbox.list(scoped.ctx, scoped.actor.identityId, {
      ...(typeof status === 'string' ? { status } : {}),
    });
    return { inbox: rows.map(inboxView) };
  }

  @Endpoint({
    permission: M08_PERMISSIONS.inboxManage,
    auditCode: M08_AUDIT_CODES.inboxRead,
    description: 'Mark one of the caller’s own inbox notifications read.',
  })
  @Post('inbox/:id/read')
  async markRead(
    @Param('id') id: string,
    @Body() body: ReadBody,
    @Headers() headers: Record<string, string>,
  ) {
    const scoped = requireTenantScope(await this.actors.forRequest(headers, 'mark inbox read (m08)'));
    const row = await this.inbox.markRead(
      scoped.ctx,
      scoped.actor.identityId,
      id,
      requireVersion(body.expectedVersion, scoped.correlationId),
    );
    return inboxView(row);
  }

  // --- preferences ------------------------------------------------------------------------------
  @Endpoint({
    permission: M08_PERMISSIONS.preferenceUpdate,
    auditCode: M08_AUDIT_CODES.preferenceChanged,
    description: 'Set the caller’s per-channel notification preference.',
  })
  @Post('preferences')
  async setPreference(@Body() body: PreferenceBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'set notification preference (m08)'),
    );
    const cid = scoped.correlationId;
    const row = await this.preferences.setPreference(scoped.ctx, scoped.actor.identityId, {
      subjectId: scoped.actor.identityId,
      channel: requireString(body.channel, 'channel', cid),
      optIn: body.optIn !== false,
      suppressed: body.suppressed === true,
      ...(body.quietHours !== undefined ? { quietHours: body.quietHours } : {}),
    });
    return preferenceView(row);
  }

  @Endpoint({
    permission: M08_PERMISSIONS.suppressionManage,
    auditCode: M08_AUDIT_CODES.preferenceChanged,
    description: 'Administratively suppress or un-suppress a destination.',
  })
  @Post('suppressions')
  async setSuppression(@Body() body: SuppressionBody, @Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'set destination suppression (m08)'),
    );
    const cid = scoped.correlationId;
    const row = await this.preferences.setSuppression(scoped.ctx, scoped.actor.identityId, {
      destination: requireString(body.destination, 'destination', cid),
      channel: requireString(body.channel, 'channel', cid),
      suppressed: body.suppressed !== false,
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    });
    return preferenceView(row);
  }

  @Get('preferences')
  async listPreferences(@Headers() headers: Record<string, string>) {
    const scoped = requireTenantScope(
      await this.actors.forRequest(headers, 'list notification preferences (m08)'),
    );
    const rows = await this.preferences.listForSubject(scoped.ctx, scoped.actor.identityId);
    return { preferences: rows.map(preferenceView) };
  }
}
