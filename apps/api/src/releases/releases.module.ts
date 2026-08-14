import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M37Emitter,
  GovreleaseRepository,
  ArtifactService,
  ReleaseService,
  ArtifactRegistryAdapter,
  type ArtifactRegistryPort,
} from '@finapp/m37-govrelease';
import {
  ListingService,
  M34Emitter,
  MarketplaceRepository,
  M33ConnectorRegistryAdapter,
  type ConnectorRegistryPort,
} from '@finapp/m34-marketplace';
import { ConnectorService, IntegrationRepository, M33Emitter } from '@finapp/m33-integration';
import { ActorModule } from '../actor/actor.module.ts';
import { GovreleaseArtifactsController } from './artifacts.controller.ts';
import { GovreleaseReleasesController } from './releases.controller.ts';

/**
 * `/api/v1/releases` (m37). The governed integration governance/QA/release layer. It CONSUMES m33/m34 BY CONTRACT:
 * `ArtifactRegistryAdapter` wraps m33's read-only `ConnectorService.getConnector` and m34's `ListingService.getListing` to
 * check an artifact is RELEASABLE (published) in its owning module before a release is requested — m37 owns no connector/
 * marketplace engine, reads no m33/m34 table, and executes no release. m06 remains the ONE outbox.
 */
export const M37_ARTIFACT_REGISTRY = Symbol.for('finapp.m37.artifact-registry');
const M34_CONNECTOR_REGISTRY = Symbol.for('finapp.m37.m34-connector-registry');

@Module({
  imports: [ActorModule],
  controllers: [GovreleaseArtifactsController, GovreleaseReleasesController],
  providers: [
    { provide: GovreleaseRepository, useFactory: () => new GovreleaseRepository() },
    {
      provide: M37Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M37Emitter(audit, outbox),
    },
    // m33 read contract (connector artifacts) + m34 read contract (marketplace artifacts), consumed read-only by contract.
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
      provide: M37_ARTIFACT_REGISTRY,
      inject: [ConnectorService, ListingService],
      useFactory: (connectors: ConnectorService, listings: ListingService) =>
        new ArtifactRegistryAdapter(connectors, listings),
    },
    {
      provide: ArtifactService,
      inject: [DB, AUTHZ, M37Emitter, GovreleaseRepository],
      useFactory: (db: Db, authz: Authz, emitter: M37Emitter, repo: GovreleaseRepository) =>
        new ArtifactService(db, authz, emitter, repo),
    },
    {
      provide: ReleaseService,
      inject: [DB, AUTHZ, M37Emitter, M37_ARTIFACT_REGISTRY, GovreleaseRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M37Emitter,
        registry: ArtifactRegistryPort,
        repo: GovreleaseRepository,
      ) => new ReleaseService(db, authz, emitter, registry, repo),
    },
  ],
})
export class ReleasesModule {}
