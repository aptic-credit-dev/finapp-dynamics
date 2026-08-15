import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { HealthController } from './health.controller.ts';
import { PlatformModule } from './platform.module.ts';
import { TenantModule } from './tenant/tenant.module.ts';
import { IdentityModule } from './identity/identity.module.ts';
import { RbacModule } from './rbac/rbac.module.ts';
import { AuditModule } from './audit/audit.module.ts';
import { WorkflowModule } from './workflow/workflow.module.ts';
import { RulesModule } from './rules/rules.module.ts';
import { NotifyModule } from './notify/notify.module.ts';
import { DocumentsModule } from './documents/documents.module.ts';
import { FeedbackModule } from './feedback/feedback.module.ts';
import { CasesModule } from './cases/cases.module.ts';
import { LegalModule } from './legal/legal.module.ts';
import { LitigationModule } from './litigation/litigation.module.ts';
import { RecoveryModule } from './recovery/recovery.module.ts';
import { LegaldocsModule } from './legaldocs/legaldocs.module.ts';
import { FinanceModule } from './finance/finance.module.ts';
import { ReconciliationModule } from './reconciliation/reconciliation.module.ts';
import { GlReconciliationModule } from './gl-reconciliation/gl-reconciliation.module.ts';
import { JournalsModule } from './journals/journals.module.ts';
import { ApprovalsModule } from './approvals/approvals.module.ts';
import { AdminModule } from './admin/admin.module.ts';
import { CopilotModule } from './copilot/copilot.module.ts';
import { AnalyticsModule } from './analytics/analytics.module.ts';
import { IntegrationModule } from './integration/integration.module.ts';
import { MarketplaceModule } from './marketplace/marketplace.module.ts';
import { DevportalModule } from './devportal/devportal.module.ts';
import { EventsModule } from './events/events.module.ts';
import { ReleasesModule } from './releases/releases.module.ts';
import { AutomationModule } from './automation/automation.module.ts';
import { SaasModule } from './saas/saas.module.ts';
import { ResilienceModule } from './resilience/resilience.module.ts';
import { SecurityModule } from './security/security.module.ts';
import { AuthModule } from './auth/auth.module.ts';
import { CsrfMiddleware } from './auth/csrf.middleware.ts';

/**
 * The composition root.
 *
 * Stage 0 bound no kernel tokens. Stage 1A bound them inside `TenantModule`. Stage 1B separates the two
 * concerns that had been sharing a file:
 *
 *   PlatformModule  — the shared services, bound ONCE for the process (@Global).
 *   ActorModule     — who is acting. Imported by both feature modules; imports neither.
 *   TenantModule    — m01. Now a consumer of the actor boundary rather than a builder of context.
 *   IdentityModule  — m02. The identity registry, accounts and tenant membership.
 *
 * The graph is acyclic and stays that way by construction: feature modules depend on `ActorModule`, never
 * on each other. M01 and M02 meet only at `TenantContextResolver` — m01's contract, called by m02 — so
 * m01 never reads an m02 table and m02 never re-implements m01's tenant rules.
 *
 * Stage 1C adds AuthModule (login/sessions) and a global CSRF guard for state-changing cookie-authenticated
 * requests. The API requires a database at boot (`DATABASE_URL`); in production the auth config must be safe
 * or it refuses to start (see auth/config.ts).
 *
 * Stage 1D adds RbacModule — roles, assignments, SoD and the permission catalogue under `/api/v1/rbac`. It
 * is the OWNER of `AUTHZ` (bound to `RbacAuthz` in PlatformModule); every module's permission checks now run
 * against persistent role assignments, not a header.
 *
 * Stage 2.3 adds RulesModule — the versioned, explainable decision-rules engine under `/api/v1/rules`. Like
 * WorkflowModule it binds no kernel token and publishes through the one outbox m06 owns.
 *
 * Stage 2.4 adds NotifyModule — generic multi-tenant notifications + escalation under `/api/v1/notifications`.
 * Same posture: it binds no kernel token and publishes notification.lifecycle through the one m06 outbox.
 *
 * Stage 2.5 adds DocumentsModule — enterprise document & records management under `/api/v1/documents`. Same
 * posture: no kernel token, publishes document.lifecycle through the one m06 outbox; storage + scan are ports
 * bound to Framework-Only test doubles.
 *
 * Stage 3.1 adds FeedbackModule — the enterprise feedback platform under `/api/v1/feedback`. Same posture: no
 * kernel token, publishes feedback.lifecycle through the one m06 outbox. It reuses m06 workflow, m07 rules, m08
 * escalation/notifications and m09 documents; the SLA clock is a port. Case handoff to m13 is a pending record +
 * event only — m12 builds no case table and no second escalation engine.
 */
@Module({
  imports: [
    PlatformModule,
    TenantModule,
    IdentityModule,
    RbacModule,
    AuditModule,
    AuthModule,
    WorkflowModule,
    RulesModule,
    NotifyModule,
    DocumentsModule,
    FeedbackModule,
    CasesModule,
    LegalModule,
    LitigationModule,
    RecoveryModule,
    LegaldocsModule,
    FinanceModule,
    ReconciliationModule,
    GlReconciliationModule,
    JournalsModule,
    ApprovalsModule,
    AdminModule,
    CopilotModule,
    AnalyticsModule,
    IntegrationModule,
    MarketplaceModule,
    DevportalModule,
    EventsModule,
    ReleasesModule,
    AutomationModule,
    SaasModule,
    ResilienceModule,
    SecurityModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route: the middleware itself exempts safe methods and requests with no session cookie.
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
