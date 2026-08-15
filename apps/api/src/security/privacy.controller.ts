import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { GovernanceService, M41_PERMISSIONS, M41_AUDIT_CODES } from '@finapp/m41-security';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope } from '../identity/http.ts';
import { privacyClassificationView } from './views.ts';

/**
 * Data classification + privacy processing records under `/api/v1/privacy`. Privacy records are bounded evidence over an OPAQUE
 * subject reference — never raw personal data. Reads carry no `@Endpoint`.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' && Number.isInteger(v) ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('privacy')
export class PrivacyController {
  private readonly governance: GovernanceService;
  private readonly actors: ActorContextFactory;
  constructor(governance: GovernanceService, actors: ActorContextFactory) {
    this.governance = governance;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.privacyPolicyManage,
    auditCode: M41_AUDIT_CODES.privacyClassificationSet,
    description: 'Set a data classification (level + retention).',
  })
  @Post('classifications')
  async setClassification(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set classification (m41)');
    const c = await this.governance.setClassification(s.ctx, {
      classificationKey: requireString(b['classificationKey'], 'classificationKey', s.correlationId),
      level: requireString(b['level'], 'level', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optNum(b['retentionDays'], 'retentionDays'),
    });
    return privacyClassificationView(c);
  }

  @Endpoint({
    permission: M41_PERMISSIONS.privacyRecordManage,
    auditCode: M41_AUDIT_CODES.privacyRecordAdded,
    description: 'Record a privacy processing/control event (opaque subject ref; no personal data).',
  })
  @Post('records')
  async recordEvent(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'record privacy event (m41)');
    return this.governance.recordPrivacyEvent(s.ctx, {
      subjectRef: requireString(b['subjectRef'], 'subjectRef', s.correlationId),
      action: requireString(b['action'], 'action', s.correlationId),
      ...optStr(b['classification'], 'classification'),
      ...optStr(b['reasonCode'], 'reasonCode'),
    });
  }
}
