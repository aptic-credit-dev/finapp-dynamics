import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M39Emitter,
  SaasRepository,
  PlanService,
  SubscriptionService,
  EntitlementQuotaService,
  BillingService,
  UnavailableFeatureControl,
  UnavailableBillingProvider,
  type FeatureControlPort,
  type BillingProviderPort,
} from '@finapp/m39-saas';
import { ActorModule } from '../actor/actor.module.ts';
import { SaasCatalogController } from './saas-catalog.controller.ts';
import { SaasSubscriptionController } from './saas-subscription.controller.ts';

/**
 * `/api/v1/saas` (m39). The governed commercial-SaaS layer: plans + versions + entitlements + quotas + subscriptions + usage +
 * billing. m39 owns the commercial state; it consumes m30 feature flags through a fail-closed `FeatureControlPort` (default
 * `UnavailableFeatureControl` -> a feature is treated as NOT enabled, so the RBAC∧entitlement∧flag stack denies until m30 is
 * wired) and would settle billing through a fail-closed `BillingProviderPort` (default `UnavailableBillingProvider` -> nothing
 * collected; billing is modelled internally, OPEN_QUESTIONS #2). m39 owns no outbox — it publishes subscription/usage/billing
 * .lifecycle through the ONE m06 outbox. It posts no journal and holds no secret value.
 */
export const M39_FEATURE_CONTROL = Symbol.for('finapp.m39.feature-control');
export const M39_BILLING_PROVIDER = Symbol.for('finapp.m39.billing-provider');

@Module({
  imports: [ActorModule],
  controllers: [SaasCatalogController, SaasSubscriptionController],
  providers: [
    { provide: SaasRepository, useFactory: () => new SaasRepository() },
    {
      provide: M39Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M39Emitter(audit, outbox),
    },
    // Fail-closed defaults until m30 (feature) and the real billing provider (m41-era) are wired.
    { provide: M39_FEATURE_CONTROL, useFactory: () => new UnavailableFeatureControl() },
    { provide: M39_BILLING_PROVIDER, useFactory: () => new UnavailableBillingProvider() },
    {
      provide: PlanService,
      inject: [DB, AUTHZ, M39Emitter, SaasRepository],
      useFactory: (db: Db, authz: Authz, emitter: M39Emitter, repo: SaasRepository) =>
        new PlanService(db, authz, emitter, repo),
    },
    {
      provide: SubscriptionService,
      inject: [DB, AUTHZ, M39Emitter, SaasRepository],
      useFactory: (db: Db, authz: Authz, emitter: M39Emitter, repo: SaasRepository) =>
        new SubscriptionService(db, authz, emitter, repo),
    },
    {
      provide: EntitlementQuotaService,
      inject: [DB, AUTHZ, M39Emitter, M39_FEATURE_CONTROL, SaasRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M39Emitter,
        feature: FeatureControlPort,
        repo: SaasRepository,
      ) => new EntitlementQuotaService(db, authz, emitter, feature, repo),
    },
    {
      provide: BillingService,
      inject: [DB, AUTHZ, M39Emitter, M39_BILLING_PROVIDER, SaasRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M39Emitter,
        provider: BillingProviderPort,
        repo: SaasRepository,
      ) => new BillingService(db, authz, emitter, provider, repo),
    },
  ],
  exports: [EntitlementQuotaService],
})
export class SaasModule {}
