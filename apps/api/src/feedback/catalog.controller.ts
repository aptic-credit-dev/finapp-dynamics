import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { CatalogService, M12_AUDIT_CODES, M12_PERMISSIONS } from '@finapp/m12-feedback';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { specView, categoryView, sourceSystemView } from './views.ts';

/**
 * Feedback catalog — source systems, categories, questionnaires and SLA policies, under `/api/v1/feedback`.
 * Questionnaires + SLA policies are versioned + immutable-after-publish. Permission enforced in CatalogService.
 */
interface ConfigBody {
  code?: unknown;
  name?: unknown;
  active?: unknown;
  defaultSentiment?: unknown;
}
interface SpecBody {
  code?: unknown;
  name?: unknown;
  scope?: unknown;
  spec?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
}

@Controller('feedback')
export class FeedbackCatalogController {
  private readonly service: CatalogService;
  private readonly actors: ActorContextFactory;
  constructor(service: CatalogService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M12_PERMISSIONS.sourceManage,
    auditCode: M12_AUDIT_CODES.sourceConfigured,
    description: 'Configure a feedback source system.',
  })
  @Post('source-systems')
  async setSource(@Body() b: ConfigBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'configure source system (m12)');
    await this.service.setSourceSystem(s.ctx, s.actor.identityId, {
      code: requireString(b.code, 'code', s.correlationId),
      name: requireString(b.name, 'name', s.correlationId),
      active: b.active !== false,
    });
    return { ok: true };
  }
  @Get('source-systems')
  async listSources(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list source systems (m12)');
    return { sourceSystems: (await this.service.listSourceSystems(s.ctx)).map(sourceSystemView) };
  }

  @Endpoint({
    permission: M12_PERMISSIONS.categoryManage,
    auditCode: M12_AUDIT_CODES.categoryConfigured,
    description: 'Configure a feedback category.',
  })
  @Post('categories')
  async setCategory(@Body() b: ConfigBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'configure category (m12)');
    await this.service.setCategory(s.ctx, s.actor.identityId, {
      code: requireString(b.code, 'code', s.correlationId),
      name: requireString(b.name, 'name', s.correlationId),
      ...(typeof b.defaultSentiment === 'string' ? { defaultSentiment: b.defaultSentiment } : {}),
      active: b.active !== false,
    });
    return { ok: true };
  }
  @Get('categories')
  async listCategories(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list categories (m12)');
    return { categories: (await this.service.listCategories(s.ctx)).map(categoryView) };
  }

  @Endpoint({
    permission: M12_PERMISSIONS.questionnaireManage,
    auditCode: M12_AUDIT_CODES.questionnaireCreated,
    description: 'Create a draft questionnaire.',
  })
  @Post('questionnaires')
  async createQuestionnaire(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create questionnaire (m12)');
    return specView(
      await this.service.createQuestionnaire(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.questionnaireManage,
    auditCode: M12_AUDIT_CODES.questionnaireCreated,
    description: 'Validate a questionnaire.',
  })
  @Post('questionnaires/:id/validate')
  async validateQ(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate questionnaire (m12)');
    return specView(
      await this.service.validateQuestionnaire(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.questionnaireManage,
    auditCode: M12_AUDIT_CODES.questionnairePublished,
    description: 'Publish a questionnaire.',
  })
  @Post('questionnaires/:id/publish')
  async publishQ(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish questionnaire (m12)');
    return specView(
      await this.service.publishQuestionnaire(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.questionnaireManage,
    auditCode: M12_AUDIT_CODES.questionnairePublished,
    description: 'Activate a questionnaire.',
  })
  @Post('questionnaires/:id/activate')
  async activateQ(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate questionnaire (m12)');
    return specView(
      await this.service.activateQuestionnaire(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('questionnaires')
  async listQuestionnaires(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list questionnaires (m12)');
    return { questionnaires: (await this.service.listQuestionnaires(s.ctx)).map(specView) };
  }
  @Get('questionnaires/:id')
  async getQ(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get questionnaire (m12)');
    return specView(await this.service.getQuestionnaire(s.ctx, id));
  }

  @Endpoint({
    permission: M12_PERMISSIONS.slaPolicyManage,
    auditCode: M12_AUDIT_CODES.questionnaireCreated,
    description: 'Create a draft SLA policy.',
  })
  @Post('sla-policies')
  async createSla(@Body() b: SpecBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create sla policy (m12)');
    return specView(
      await this.service.createSlaPolicy(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', s.correlationId),
        name: requireString(b.name, 'name', s.correlationId),
        ...(typeof b.scope === 'string' ? { scope: b.scope } : {}),
        spec: b.spec,
      }),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.slaPolicyManage,
    auditCode: M12_AUDIT_CODES.questionnaireCreated,
    description: 'Validate an SLA policy.',
  })
  @Post('sla-policies/:id/validate')
  async validateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate sla policy (m12)');
    return specView(
      await this.service.validateSlaPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.slaPolicyManage,
    auditCode: M12_AUDIT_CODES.slaPolicyPublished,
    description: 'Publish an SLA policy.',
  })
  @Post('sla-policies/:id/publish')
  async publishSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'publish sla policy (m12)');
    return specView(
      await this.service.publishSlaPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M12_PERMISSIONS.slaPolicyManage,
    auditCode: M12_AUDIT_CODES.slaPolicyPublished,
    description: 'Activate an SLA policy.',
  })
  @Post('sla-policies/:id/activate')
  async activateSla(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate sla policy (m12)');
    return specView(
      await this.service.activateSlaPolicy(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('sla-policies')
  async listSlaPolicies(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list sla policies (m12)');
    return { slaPolicies: (await this.service.listSlaPolicies(s.ctx)).map(specView) };
  }
  @Get('sla-policies/:id')
  async getSla(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get sla policy (m12)');
    return specView(await this.service.getSlaPolicy(s.ctx, id));
  }
}
