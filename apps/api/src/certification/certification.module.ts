import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M42Emitter,
  CertificationRepository,
  ProgrammeService,
  DecisionService,
} from '@finapp/m42-certification';
import { ActorModule } from '../actor/actor.module.ts';
import { CertificationController } from './certification.controller.ts';
import { CertificationDecisionController } from './decision.controller.ts';

/**
 * `/api/v1/platform-certification` (m42) — the Stage-6 CLOSURE GATE. A governance runtime + evidence/closure layer: it RECORDS
 * certification programmes, assessments, findings, waivers, readiness, sign-offs, and issues a DENY-BY-DEFAULT
 * GO/CONDITIONAL_GO/NO_GO decision (ADR-012) + an immutable closure artifact. It ASSESSES M30-M41 by contract and EXECUTES
 * nothing. m42 owns no outbox — it publishes the certification.* families through the ONE m06 outbox. It duplicates no
 * audit/workflow/approval/security/analytics/scheduler/secrets engine.
 */
@Module({
  imports: [ActorModule],
  controllers: [CertificationController, CertificationDecisionController],
  providers: [
    { provide: CertificationRepository, useFactory: () => new CertificationRepository() },
    {
      provide: M42Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M42Emitter(audit, outbox),
    },
    {
      provide: ProgrammeService,
      inject: [DB, AUTHZ, M42Emitter, CertificationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M42Emitter, repo: CertificationRepository) =>
        new ProgrammeService(db, authz, emitter, repo),
    },
    {
      provide: DecisionService,
      inject: [DB, AUTHZ, M42Emitter, CertificationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M42Emitter, repo: CertificationRepository) =>
        new DecisionService(db, authz, emitter, repo),
    },
  ],
  exports: [ProgrammeService, DecisionService],
})
export class CertificationModule {}
