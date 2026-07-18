/**
 * The order migrations are applied in.
 *
 * This is docs/07-engineering/BUILD_SEQUENCE.md expressed as data. It is dependency order, not
 * alphabetical: m01 owns the tenants table every composite FK points at, so it must exist before any
 * tenant-scoped table; m03 owns the audit spine; m06 owns the one outbox (ADR-004).
 *
 * A module appears here before it has any migrations — that is fine and expected. Modules land stage by
 * stage; the runner skips a module with no migrations directory. Never reorder to fix a failure: a
 * migration that needs an earlier module's table means the dependency is wrong, not the order.
 */

export interface ModuleStage {
  readonly stage: number;
  readonly name: string;
  readonly modules: readonly string[];
}

export const MIGRATION_ORDER: readonly ModuleStage[] = [
  // Stage 0 owns no tables. kernel/contracts are code-only, by design (manifests/naming-map.yaml).
  { stage: 0, name: 'Toolchain', modules: [] },
  {
    stage: 1,
    name: 'SaaS foundation',
    modules: [
      'm01-tenant',
      'm02-identity',
      'm02-auth',
      'm03-audit',
      'm06-workflow',
      'm07-rules',
      'm08-notify',
      'm09-docs',
      'm04-admin',
      'm05-hub',
      'm10-report',
    ],
  },
  { stage: 2, name: 'Operational', modules: ['m12-feedback', 'm13-case'] },
  {
    stage: 3,
    name: 'Finance',
    modules: [
      'm19-finance',
      'm15-recon',
      'm15a-matching',
      'm20-glrecon',
      'm21-journal',
      'm22-approval',
      'm23-finance-integration',
    ],
  },
  { stage: 4, name: 'Legal', modules: ['m14-legal', 'm16-litigation', 'm17-recovery', 'm18-legaldocs'] },
  {
    stage: 5,
    name: 'AI',
    modules: [
      'm11-ai',
      'm24-ai-foundation',
      'm25-operational-ai',
      'm26-legal-ai',
      'm27-finance-ai',
      'm28-executive-ai',
      'm29-ai-governance',
    ],
  },
  {
    stage: 6,
    name: 'Enterprise platform',
    modules: [
      'm30-platform',
      'm31-studio',
      'm32-analytics',
      'm33-integration',
      'm34-marketplace',
      'm35-devportal',
      'm36-events',
      'm37-govrelease',
      'm38-automation',
      'm39-saas',
      'm40-resilience',
      'm41-security',
      'm42-certification',
    ],
  },
];

/** The flat ordered module list. */
export function orderedModules(): readonly string[] {
  return MIGRATION_ORDER.flatMap((stage) => stage.modules);
}

/** Position of a module in the order, or -1 if it is not a known module. */
export function moduleRank(module: string): number {
  return orderedModules().indexOf(module);
}
