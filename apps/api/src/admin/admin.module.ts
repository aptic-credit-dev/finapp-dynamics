import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { AdminRepository, AdminOperationService, TenantAdminService } from '@finapp/m04-admin';
import { TenantService } from '@finapp/m01-tenant';
import { ActorModule } from '../actor/actor.module.ts';
import { AdminConsoleController } from './admin-console.controller.ts';
import { AdminTenantController } from './admin-tenant.controller.ts';

/**
 * M04-admin wiring — the ADMIN CONSOLE (Stage 1, ORCHESTRATION ONLY) under `/api/v1/admin`. It binds NO kernel token:
 * `DB`, `AUTHZ`, `AUDIT`, `OUTBOX` come from the global `PlatformModule` (re-binding any would be a duplicate shared
 * service). `AdminOperationService` owns the M04 console tables; `TenantAdminService` orchestrates the m01
 * `TenantService` (constructed here from the same shared tokens) — M04 owns NO outbox, NO event family, and NO
 * duplicate engine; it calls the owning module's public service, which enforces its own permission/audit/transaction.
 * The remaining admin areas (identity, RBAC, workflow, rules, notifications, audit) follow this identical delegated
 * pattern and are exposed as the console grows; their orchestration services already ship in `@finapp/m04-admin`.
 */
@Module({
  imports: [ActorModule],
  controllers: [AdminConsoleController, AdminTenantController],
  providers: [
    { provide: AdminRepository, useFactory: () => new AdminRepository() },
    {
      provide: AdminOperationService,
      inject: [DB, AUTHZ, AUDIT, AdminRepository],
      useFactory: (db: Db, authz: Authz, audit: Audit, repo: AdminRepository) =>
        new AdminOperationService(db, authz, audit, repo),
    },
    {
      provide: TenantService,
      inject: [DB, AUTHZ, AUDIT, OUTBOX],
      useFactory: (db: Db, authz: Authz, audit: Audit, outbox: Outbox<DomainEvent>) =>
        new TenantService(db, authz, audit, outbox),
    },
    {
      provide: TenantAdminService,
      inject: [AUTHZ, TenantService, AdminOperationService],
      useFactory: (authz: Authz, tenants: TenantService, ops: AdminOperationService) =>
        new TenantAdminService(authz, tenants, ops),
    },
  ],
})
export class AdminModule {}
