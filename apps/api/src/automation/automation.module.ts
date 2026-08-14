import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M38Emitter,
  AutomationRepository,
  AutomationService,
  ExtensionService,
  UnavailableCapabilityInvoker,
  EmptyTimerScheduler,
  type CapabilityInvokerPort,
  type TimerSchedulerPort,
} from '@finapp/m38-automation';
import { ActorModule } from '../actor/actor.module.ts';
import { AutomationController } from './automation.controller.ts';
import { ExtensionsController } from './extensions.controller.ts';

/**
 * `/api/v1/automation` + `/api/v1/extensions` (m38). The governed scheduler/automation/extension framework. m06 owns THE
 * durable timer + THE outbox; m38 owns none — it composes m06's timer through `EmptyTimerScheduler` (fail-closed default;
 * the real m06 scheduler drops in) and executes registered capabilities through `UnavailableCapabilityInvoker` (framework-only,
 * fail-closed default -> durable BLOCKED; no arbitrary code). A real invoker (dispatched through registered capabilities to
 * owning-module contracts) drops in behind the port when proven.
 */
export const M38_CAPABILITY_INVOKER = Symbol.for('finapp.m38.capability-invoker');
export const M38_TIMER_SCHEDULER = Symbol.for('finapp.m38.timer-scheduler');

@Module({
  imports: [ActorModule],
  controllers: [AutomationController, ExtensionsController],
  providers: [
    { provide: AutomationRepository, useFactory: () => new AutomationRepository() },
    {
      provide: M38Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M38Emitter(audit, outbox),
    },
    // Execution is framework-only / fail-closed until a real capability-invoker + the m06 scheduler are wired.
    { provide: M38_CAPABILITY_INVOKER, useFactory: () => new UnavailableCapabilityInvoker() },
    { provide: M38_TIMER_SCHEDULER, useFactory: () => new EmptyTimerScheduler() },
    {
      provide: AutomationService,
      inject: [DB, AUTHZ, M38Emitter, M38_CAPABILITY_INVOKER, M38_TIMER_SCHEDULER, AutomationRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M38Emitter,
        invoker: CapabilityInvokerPort,
        timer: TimerSchedulerPort,
        repo: AutomationRepository,
      ) => new AutomationService(db, authz, emitter, invoker, timer, repo),
    },
    {
      provide: ExtensionService,
      inject: [DB, AUTHZ, M38Emitter, AutomationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M38Emitter, repo: AutomationRepository) =>
        new ExtensionService(db, authz, emitter, repo),
    },
  ],
})
export class AutomationModule {}
