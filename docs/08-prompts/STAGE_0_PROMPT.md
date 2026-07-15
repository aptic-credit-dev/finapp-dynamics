# Stage 0 Prompt — Repository & Toolchain Foundation

Scaffold the Finapp Dynamics monorepo with **no business logic**. Deliver only the toolchain every later module
depends on.

Build:
1. Monorepo layout: `packages/` (kernel, contracts, and empty module placeholders per the manifest), `apps/api`
   (NestJS bootstrap), `apps/web` (shell only), `tools/` (migration runner + test-suite runner).
2. TypeScript project references, strict config, lint + format.
3. The migration runner with an ordered module list and the tenant-context/RLS conventions documented (a sample
   migration proving RLS FORCE + `tenant_isolation` on a throwaway table, then removed).
4. The kernel: DI tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`), `RequestContext`, `ProblemError`, the `@Endpoint`
   decorator (permission + auditCode), and the ambient-transaction `Db` interface (`withTenant`, `withSystem`).
5. The contracts package with an empty typed event union ready to append to.
6. CI skeleton: a smoke lane (runs PURE suites) and a DB lane (runs integration specs, skipped without
   `DATABASE_URL`).
7. The test harness pattern (PURE smoke runner + a DB-integration spec template).

Acceptance: `npm run build` clean; lint clean; the sample migration applies + the RLS convention is proven; CI
skeleton runs green with zero suites; no business tables, routes, permissions, events, or audit codes yet. Update
the manifest (Stage 0 → implemented) and commit. Then request approval for Stage 1.
