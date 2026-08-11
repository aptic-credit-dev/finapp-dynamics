import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M35Emitter,
  DevportalRepository,
  AppService,
  ProductService,
  SubscriptionService,
  CatalogSourceAdapter,
  UnavailableUsageQuota,
  type CatalogSourcePort,
  type UsageQuotaPort,
} from '@finapp/m35-devportal';
import {
  ListingService,
  M34Emitter,
  MarketplaceRepository,
  M33ConnectorRegistryAdapter,
  type ConnectorRegistryPort,
} from '@finapp/m34-marketplace';
import { ConnectorService, IntegrationRepository, M33Emitter } from '@finapp/m33-integration';
import { ActorModule } from '../actor/actor.module.ts';
import { DevportalAppsController } from './apps.controller.ts';
import { DevportalProductsController } from './products.controller.ts';
import { DevportalSubscriptionsController } from './subscriptions.controller.ts';

/**
 * `/api/v1/developer` (m35). The governed developer portal + API-gateway facade — developer apps, API credentials, published
 * API products and app subscriptions (public exposure). It CONSUMES m34/m33 BY CONTRACT: `CatalogSourceAdapter` wraps m34's
 * read-only `ListingService.getListing` and m33's `ConnectorService.getConnector` to check a product's source is PUBLISHED
 * upstream before it is published (m35 owns no connector/marketplace engine and reads no m33/m34 table). QUOTAS are m39-saas's:
 * m39 is UNBUILT, so the `UsageQuotaPort` binds to `UnavailableUsageQuota` — a PUBLIC subscription FAILS CLOSED (denied) until
 * m39 is built. m35 owns no quota/metering engine.
 */
export const M35_CATALOG_SOURCE = Symbol.for('finapp.m35.catalog-source');
export const M35_USAGE_QUOTA = Symbol.for('finapp.m35.usage-quota');
const M34_CONNECTOR_REGISTRY = Symbol.for('finapp.m35.m34-connector-registry');

@Module({
  imports: [ActorModule],
  controllers: [DevportalAppsController, DevportalProductsController, DevportalSubscriptionsController],
  providers: [
    { provide: DevportalRepository, useFactory: () => new DevportalRepository() },
    {
      provide: M35Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M35Emitter(audit, outbox),
    },
    // m33 read contract (connector sources) + m34 read contract (marketplace sources), consumed read-only by contract.
    { provide: IntegrationRepository, useFactory: () => new IntegrationRepository() },
    {
      provide: M33Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M33Emitter(audit, outbox),
    },
    {
      provide: ConnectorService,
      inject: [DB, AUTHZ, M33Emitter, IntegrationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M33Emitter, repo: IntegrationRepository) =>
        new ConnectorService(db, authz, emitter, repo),
    },
    { provide: MarketplaceRepository, useFactory: () => new MarketplaceRepository() },
    {
      provide: M34Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M34Emitter(audit, outbox),
    },
    {
      provide: M34_CONNECTOR_REGISTRY,
      inject: [ConnectorService],
      useFactory: (connectors: ConnectorService) => new M33ConnectorRegistryAdapter(connectors),
    },
    {
      provide: ListingService,
      inject: [DB, AUTHZ, M34Emitter, M34_CONNECTOR_REGISTRY, MarketplaceRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M34Emitter,
        registry: ConnectorRegistryPort,
        repo: MarketplaceRepository,
      ) => new ListingService(db, authz, emitter, registry, repo),
    },
    {
      provide: M35_CATALOG_SOURCE,
      inject: [ListingService, ConnectorService],
      useFactory: (listings: ListingService, connectors: ConnectorService) =>
        new CatalogSourceAdapter(listings, connectors),
    },
    // m39-saas is UNBUILT — public exposure fails closed behind the quota port until it is built.
    { provide: M35_USAGE_QUOTA, useFactory: () => new UnavailableUsageQuota() },
    {
      provide: AppService,
      inject: [DB, AUTHZ, M35Emitter, DevportalRepository],
      useFactory: (db: Db, authz: Authz, emitter: M35Emitter, repo: DevportalRepository) =>
        new AppService(db, authz, emitter, repo),
    },
    {
      provide: ProductService,
      inject: [DB, AUTHZ, M35Emitter, M35_CATALOG_SOURCE, DevportalRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M35Emitter,
        sources: CatalogSourcePort,
        repo: DevportalRepository,
      ) => new ProductService(db, authz, emitter, sources, repo),
    },
    {
      provide: SubscriptionService,
      inject: [DB, AUTHZ, M35Emitter, M35_USAGE_QUOTA, DevportalRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M35Emitter,
        quota: UsageQuotaPort,
        repo: DevportalRepository,
      ) => new SubscriptionService(db, authz, emitter, quota, repo),
    },
  ],
})
export class DevportalModule {}
