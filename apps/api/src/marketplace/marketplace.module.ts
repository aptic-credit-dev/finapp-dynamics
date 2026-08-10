import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M34Emitter,
  MarketplaceRepository,
  ListingService,
  InstallationService,
  M33ConnectorRegistryAdapter,
  type ConnectorRegistryPort,
} from '@finapp/m34-marketplace';
import { ConnectorService, IntegrationRepository, M33Emitter } from '@finapp/m33-integration';
import { ActorModule } from '../actor/actor.module.ts';
import { MarketplaceListingsController } from './listings.controller.ts';
import { MarketplaceInstallationsController } from './installations.controller.ts';

/**
 * `/api/v1/connectors` (m34). The governed connector marketplace over m33's connectors — listings, installations, consent
 * and upgrades. It CONSUMES m33 by contract: `M33ConnectorRegistryAdapter` wraps m33's `ConnectorService.getConnector`
 * (read-only) to check a connector is PUBLISHED before a listing is published / an installation is activated. m34 owns no
 * connector engine and never executes a connector.
 */
export const M34_CONNECTOR_REGISTRY = Symbol.for('finapp.m34.connector-registry');

@Module({
  imports: [ActorModule],
  controllers: [MarketplaceListingsController, MarketplaceInstallationsController],
  providers: [
    { provide: MarketplaceRepository, useFactory: () => new MarketplaceRepository() },
    {
      provide: M34Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M34Emitter(audit, outbox),
    },
    // m33 read contract the marketplace consumes (read-only connector lookup).
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
      provide: InstallationService,
      inject: [DB, AUTHZ, M34Emitter, M34_CONNECTOR_REGISTRY, MarketplaceRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M34Emitter,
        registry: ConnectorRegistryPort,
        repo: MarketplaceRepository,
      ) => new InstallationService(db, authz, emitter, registry, repo),
    },
  ],
})
export class MarketplaceModule {}
