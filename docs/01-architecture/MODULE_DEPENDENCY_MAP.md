# Module Dependency Map

Modules depend only on the shared spine and their declared upstreams — never on a peer's tables. Cross-module
interaction is via contracts + events.

## Foundation (no business upstreams)
- `kernel`, `contracts` → depended on by everything.
- `m01-tenant` → tenancy; depended on by all tenant-scoped modules.
- `m02-identity` → auth/RBAC; depends on kernel, m01.
- `m03-audit` → audit spine; depends on kernel, m01.
- `m06-workflow` → status/workflow/SLA/timeline/outbox; depends on kernel, m01, m03.
- `m07-rules`, `m08-notify`, `m09-docs` → depend on kernel, m01, m03, m06.

## Business modules (Phases 2–4)
- `m12-feedback` → m02, m03, m06, m08, m09.
- `m13-case` → m02, m03, m06, m08, m09 (+ consumes feedback events).
- `m14-legal` → m02, m03, m06, m09, m13 (case→matter conversion via events).
- `m16-litigation` → m14. `m17-recovery` → m14, m16. `m18-legaldocs` → m09, m14.
- `m19-finance` → m02, m03, m06. `m15-recon`/`m15a-matching` → m19. `m20-glrecon` → m19.
  `m21-journal` → m19, m20, m22-approval. `m22-approval` → m06 (workflow). `m23-finance-integration` → m19–m22.

## AI (Phase 5)
- `m24-ai-foundation` → m02, m03, m06 (gateway/registries/RAG).
- `m25-operational-ai` → m24 + feedback/case. `m26-legal-ai` → m24 + legal. `m27-finance-ai` → m24 + finance.
- `m28-executive-ai` → m24 + reporting/analytics. `m29-ai-governance` → m24.

## Enterprise platform (Phase 6)
- `m30-platform` (6A) → foundation. `m31-studio` (6B) → m06, m07, m30. `m32-analytics` (6C) → m30.
- `m33-integration`→`m34-marketplace`→`m35-devportal`→`m36-events`→`m37-govrelease` (6D chain) → m30.
- `m38-automation` (6E) → m06, m33, m30. `m39-saas` (6F) → m01, m02, m30.
- `m40-resilience` (6G) → m30. `m41-security` (6H) → m02, m06, m08, m30, m39.
- `m42-certification` (6I) → m02, m03, m06, m30, m37, m39, m41 (assesses all).

## Rule
A static boundary check must block any unauthorized cross-module database access. A module reads/writes only its
own tables; everything else is a contract call or an event.
