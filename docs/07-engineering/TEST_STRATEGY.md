# Test Strategy

## Layers
- **PURE smoke suites** — framework-free tests of each module's deterministic safety core (state machines,
  gates, scoring, decision engines). Run with `node --experimental-strip-types`. The reference baseline has 37
  suites; the full baseline is the sum of their passing assertions.
- **DB-integration specs** — per-module specs against PostgreSQL proving tenant isolation, controlled-action
  gates, idempotency, and audit. Skipped when `DATABASE_URL` is absent; run in the CI DB lane.
- **Conformance suite** — platform-wide structural checks (RLS FORCE coverage, single outbox, boundary rules).
- **Contract tests** — shared-service contracts, module APIs, domain events, connectors, AI providers, mobile
  sync, billing, security events.
- **Security / performance / chaos / UAT** — enterprise-scale attack paths, load, resilience, and business
  acceptance (Phase 6 + hardening).

## Rules
Every module ships with tests. Every mutating route is audited and covered. The full baseline + conformance must
be green before a commit. A new module must not reduce the baseline. Money paths are tested for balance +
decimal-safety; AI paths for human-in-the-loop + no restricted-data leakage.

## CI lanes
A fast **smoke lane** (all PURE suites + conformance) on every PR; a **DB lane** (integration specs) on merges to
`develop`. Production deployment requires both plus the release gates.
