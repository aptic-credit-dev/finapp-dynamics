import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { M24Emitter, AiRepository } from '@finapp/m24-ai-foundation';
import {
  ExecutiveAiRepository,
  M28Emitter,
  M24CopilotGateway,
  ExecutiveSummaryService,
  CopilotConfigurationService,
  CopilotSessionService,
  CopilotQueryService,
  CopilotResponseService,
  CopilotFeedbackService,
} from '@finapp/m28-executive-ai';
import { ActorModule } from '../actor/actor.module.ts';
import { CopilotSessionsController } from './sessions.controller.ts';
import { CopilotQueriesController } from './queries.controller.ts';
import { CopilotFeedbackController } from './feedback.controller.ts';
import { CopilotConfigController } from './config.controller.ts';
import { CopilotCapabilitiesController } from './capabilities.controller.ts';

/** DI tokens for the m28 gateway building blocks (bound to the m24 governed pipeline BY CONTRACT). */
const M28_AI_GATEWAY = Symbol.for('finapp.m28.aiGateway');
const M28_SUMMARIES = Symbol.for('finapp.m28.summaries');

/**
 * M28 Executive-Copilot wiring — a READ-ONLY, CITED, RLS-MASKED executive assistant under `/api/v1/copilot`. It binds
 * NO kernel token: `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding any here would
 * be a duplicate shared service. m28 owns NO outbox — the AI request/output lifecycle flows through the one m06 `OUTBOX`
 * via the M24 pipeline (`M24Emitter`), which the copilot consumes BY CONTRACT through `M24CopilotGateway` (routing/DLP/
 * confidence/citations live in m24, never duplicated/bypassed). The UNBUILT m32 analytics is deferred behind a
 * read-only port with deterministic doubles inside `ExecutiveSummaryService`. Every route authorizes an `ai.copilot.*`
 * permission (GAP-4 resolved) and audits under the shared `AI_` prefix. The copilot NEVER mutates a business record.
 */
@Module({
  imports: [ActorModule],
  controllers: [
    CopilotSessionsController,
    CopilotQueriesController,
    CopilotFeedbackController,
    CopilotConfigController,
    CopilotCapabilitiesController,
  ],
  providers: [
    { provide: ExecutiveAiRepository, useFactory: () => new ExecutiveAiRepository() },
    { provide: M28Emitter, inject: [AUDIT], useFactory: (audit: Audit) => new M28Emitter(audit) },
    {
      // The M24 governed pipeline, consumed BY CONTRACT. Publishes ai.*_lifecycle through the ONE m06 outbox.
      provide: M28_AI_GATEWAY,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new M24CopilotGateway(db, authz, new M24Emitter(audit, outbox), new AiRepository()),
    },
    { provide: M28_SUMMARIES, useFactory: () => new ExecutiveSummaryService() },
    {
      provide: CopilotConfigurationService,
      inject: [DB, AUTHZ, M28Emitter, ExecutiveAiRepository],
      useFactory: (db: Db, authz: Authz, emitter: M28Emitter, repo: ExecutiveAiRepository) =>
        new CopilotConfigurationService(db, authz, emitter, repo),
    },
    {
      provide: CopilotSessionService,
      inject: [DB, AUTHZ, M28Emitter, ExecutiveAiRepository],
      useFactory: (db: Db, authz: Authz, emitter: M28Emitter, repo: ExecutiveAiRepository) =>
        new CopilotSessionService(db, authz, emitter, repo),
    },
    {
      provide: CopilotQueryService,
      inject: [DB, AUTHZ, M28Emitter, M28_AI_GATEWAY, M28_SUMMARIES, ExecutiveAiRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M28Emitter,
        gateway: M24CopilotGateway,
        summaries: ExecutiveSummaryService,
        repo: ExecutiveAiRepository,
      ) => new CopilotQueryService(db, authz, emitter, gateway, summaries, repo),
    },
    {
      provide: CopilotResponseService,
      inject: [DB, AUTHZ, M28Emitter, ExecutiveAiRepository],
      useFactory: (db: Db, authz: Authz, emitter: M28Emitter, repo: ExecutiveAiRepository) =>
        new CopilotResponseService(db, authz, emitter, repo),
    },
    {
      provide: CopilotFeedbackService,
      inject: [DB, AUTHZ, M28Emitter, ExecutiveAiRepository],
      useFactory: (db: Db, authz: Authz, emitter: M28Emitter, repo: ExecutiveAiRepository) =>
        new CopilotFeedbackService(db, authz, emitter, repo),
    },
  ],
})
export class CopilotModule {}
