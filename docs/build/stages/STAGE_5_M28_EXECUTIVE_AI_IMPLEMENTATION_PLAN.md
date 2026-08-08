# Stage 5 — M28 Executive AI — Implementation Plan

Ordered, reviewable units (as committed):

1. **Architecture / ADRs / GAP-4** — ADR-111 (read-only/cited/masked + GAP-4), ADR-112 (M24 gateway + M32 deferral +
   read-only ports + citations-as-references); naming-map GAP-4 resolution (`ai.*` for `/copilot`); stage docs.
2. **Migrations / domain** — `0001_executive_ai.sql` (7 tables, RLS FORCE, `tenant_isolation`, governance CHECKs,
   `ai.copilot.*` permission seed), `0002_grant_application_role.sql` (no DELETE; append-only ledgers INSERT+SELECT);
   pure `domain.ts` (classifications, scope, intent classes, lifecycles, read-only gate, injection screen, citation gate,
   entitlement/masking model, reason codes).
3. **Read ports / gateway / services** — `gateway.ts` (`M24CopilotGateway`), `ports.ts` (cross-domain read ports +
   `ExecutiveAnalyticsPort` + deterministic doubles + fail-closed unavailable port), `repository.ts`, `emit.ts`,
   `errors.ts`, `permissions.ts`, `audit-codes.ts`, and services (`config`, `session`, `summary`, `query`, `response`,
   `feedback`).
4. **API** — `apps/api/src/copilot/*` controllers (sessions, queries, feedback, config, capabilities) + views + module;
   wired into `AppModule`.
5. **Tests** — pure smoke, package DB spec, services DB spec, HTTP API DB spec.
6. **Registries / manifest / docs** — permission-registry (`ai.copilot.*`), audit-code-registry (`AI_COPILOT_*`, count
   732→741), implementation-manifest (m28 → implemented), module-registry (status), README, stage docs.

## Key design decisions

- **Query/response are mutable lifecycle aggregates** (optimistic-locked, single transition choke point); the immutable
  evidence is the append-only `copilot_citation` / `copilot_feedback` / `copilot_idempotency` ledgers + the m03 audit
  spine + M24's own request/output history. This keeps the module at the 7-table baseline without a separate history
  table, matching the m27 mutable-aggregate pattern.
- **The question is handed to M24 only as a transient DLP/generation sample** (M24 never persists it) so DLP scans the
  real input; the copilot itself stores only an opaque M09 `question_ref`. This makes DLP fail-closed genuinely testable
  while preserving privacy.
- **Fixture read ports key their evidence to a real, seeded, grantable entitlement (`ai.copilot.read`)** so the masking
  pipeline runs against genuine RBAC in the integration tests; the arbitrary-permission intersection logic is proven
  directly against `evaluateEntitlement`/`maskEvidence` in the pure suite.
