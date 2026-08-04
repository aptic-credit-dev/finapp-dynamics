import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  ApprovalRepository,
  CatalogService,
  RequestService,
  DecisionService,
  DelegationService,
  EscalationService,
  M22Emitter,
} from '@finapp/m22-approval';
import { ActorModule } from '../actor/actor.module.ts';
import { ApprovalCatalogController } from './catalog.controller.ts';
import { ApprovalRequestController } from './request.controller.ts';
import { ApprovalDecisionController } from './decision.controller.ts';
import { ApprovalDelegationController } from './delegation.controller.ts';

/**
 * M22-approval wiring — the FINANCE APPROVAL WORKFLOW (Stage 3, maker-checker + SoD): approval policies/config/reason
 * codes, the request lifecycle, the decision choke point (approve/reject/return/abstain/escalate/override), delegations
 * and deterministic escalation — all under `/api/v1/approvals`.
 *
 * It binds NO kernel token. `DB`, `AUTHZ`, `AUDIT` and `OUTBOX` come from the global `PlatformModule`; re-binding any
 * here would be a duplicate shared service. m22 owns NO outbox — every `approval.lifecycle` event flows through the one
 * `M22Emitter` over the `OUTBOX` that m06 owns — and NO workflow / timer / notification engine (it reuses m06 + m08 by
 * opaque reference). It owns only its own tables; it owns no journals (m21), chart of accounts/periods (m19) or
 * integration/posting (m23) — those are referenced by opaque id. It NEVER approves on behalf of a human and NEVER
 * posts; it releases the approval reference downstream posting is gated on.
 */
@Module({
  imports: [ActorModule],
  controllers: [
    ApprovalCatalogController,
    ApprovalRequestController,
    ApprovalDecisionController,
    ApprovalDelegationController,
  ],
  providers: [
    { provide: ApprovalRepository, useFactory: () => new ApprovalRepository() },
    {
      provide: M22Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M22Emitter(audit, outbox),
    },
    {
      provide: CatalogService,
      inject: [DB, AUTHZ, M22Emitter, ApprovalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M22Emitter, repo: ApprovalRepository) =>
        new CatalogService(db, authz, emitter, repo),
    },
    {
      provide: RequestService,
      inject: [DB, AUTHZ, M22Emitter, ApprovalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M22Emitter, repo: ApprovalRepository) =>
        new RequestService(db, authz, emitter, repo),
    },
    {
      provide: DecisionService,
      inject: [DB, AUTHZ, M22Emitter, ApprovalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M22Emitter, repo: ApprovalRepository) =>
        new DecisionService(db, authz, emitter, repo),
    },
    {
      provide: DelegationService,
      inject: [DB, AUTHZ, M22Emitter, ApprovalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M22Emitter, repo: ApprovalRepository) =>
        new DelegationService(db, authz, emitter, repo),
    },
    {
      provide: EscalationService,
      inject: [DB, AUTHZ, M22Emitter, ApprovalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M22Emitter, repo: ApprovalRepository) =>
        new EscalationService(db, authz, emitter, repo),
    },
  ],
})
export class ApprovalsModule {}
