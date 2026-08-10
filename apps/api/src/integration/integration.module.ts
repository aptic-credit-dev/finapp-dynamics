import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M33Emitter,
  IntegrationRepository,
  ConnectorService,
  ConnectionService,
  RunService,
  M33IntegrationCapabilityCatalog,
  FrameworkConnectorRuntime,
  type ConnectorRuntimePort,
} from '@finapp/m33-integration';
import { ActorModule } from '../actor/actor.module.ts';
import { IntegrationConnectorsController } from './connectors.controller.ts';
import { IntegrationConnectionsController } from './connections.controller.ts';

/**
 * `/api/v1/integration` (m33). The governed Integration Foundation — connector SDK/registry, connection management, and a
 * FRAMEWORK-ONLY connector runtime. The runtime is a DETERMINISTIC offline double (real runtimes / production credentials
 * wire in behind the fail-closed port later; no network egress here). `M33IntegrationCapabilityCatalog` is the real
 * implementation of m31's IntegrationCapabilityCatalogPort (the connector service is its availability provider).
 */
export const M33_CONNECTOR_RUNTIME = Symbol.for('finapp.m33.connector-runtime');

@Module({
  imports: [ActorModule],
  controllers: [IntegrationConnectorsController, IntegrationConnectionsController],
  providers: [
    { provide: IntegrationRepository, useFactory: () => new IntegrationRepository() },
    {
      provide: M33Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M33Emitter(audit, outbox),
    },
    { provide: M33_CONNECTOR_RUNTIME, useFactory: () => new FrameworkConnectorRuntime() },
    {
      provide: ConnectorService,
      inject: [DB, AUTHZ, M33Emitter, IntegrationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M33Emitter, repo: IntegrationRepository) =>
        new ConnectorService(db, authz, emitter, repo),
    },
    {
      provide: ConnectionService,
      inject: [DB, AUTHZ, M33Emitter, IntegrationRepository],
      useFactory: (db: Db, authz: Authz, emitter: M33Emitter, repo: IntegrationRepository) =>
        new ConnectionService(db, authz, emitter, repo),
    },
    {
      provide: RunService,
      inject: [DB, AUTHZ, M33Emitter, M33_CONNECTOR_RUNTIME, IntegrationRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M33Emitter,
        runtime: ConnectorRuntimePort,
        repo: IntegrationRepository,
      ) => new RunService(db, authz, emitter, runtime, repo),
    },
    {
      provide: M33IntegrationCapabilityCatalog,
      inject: [ConnectorService],
      useFactory: (connectors: ConnectorService) => new M33IntegrationCapabilityCatalog(connectors),
    },
  ],
  exports: [M33IntegrationCapabilityCatalog],
})
export class IntegrationModule {}
