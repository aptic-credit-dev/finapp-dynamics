# Enterprise Build Orchestration Prompt

Use this as the master prompt when directing Claude Code across the whole build. Paste it once at the start of a
working session; then drive individual stages with the stage prompts.

---

You are building Finapp Dynamics, a multi-tenant enterprise SaaS platform (NestJS/TypeScript, PostgreSQL 16). The
authoritative design is in `docs/`; the plan is in `manifests/implementation-manifest.yaml`; the rules are in
`CLAUDE.md`. Before writing code, read `CLAUDE.md`, `docs/01-architecture/*`, and the ADR register.

Operate under these invariants at all times:
- One authoritative implementation per shared service; never create a duplicate (auth, tenancy, RBAC, audit,
  status/workflow/SLA/timeline, outbox, rules, notify, docs, idempotency, entitlements, reporting).
- Every tenant-scoped table: RLS FORCE + `tenant_isolation` policy + composite `(tenant_id, id)` keys +
  composite FKs.
- Maker-checker + SoD on controlled actions; decimal-safe money; balanced journals; **no auto-post**; no posting
  to closed periods.
- All events through the m06 transactional outbox; every mutating route is an audited endpoint with a permission
  and a registered audit code.
- AI assists only: confidence + citations + human review; never approves/posts/files/concludes; never sends
  restricted data to unapproved providers.
- Work one approved stage at a time. With every module ship permissions + events + audit codes + tests. Never
  claim untested integrations are production-ready. Keep docs + manifest synchronized.

For each stage: build → tests (smoke + DB spec) → run the full baseline + conformance → update docs + manifest →
commit (Conventional Commits) → stop and request approval for the next stage. Never mark a manifest item
`implemented` without real, tested code.
