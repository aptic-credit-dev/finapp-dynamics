# Stage 3 — M21 Journal Engine: Implementation Plan

**Module:** `m21-journal` · **Branch:** `feature/stage-3-m21-journal` · **Baseline:** `88b0549` (PR #43).

## Sequencing (reviewable commits)

1. **Contracts & registries** — `journal.lifecycle` + `posting_request.lifecycle` contract files + union wiring;
   permission/audit/event/naming/api/module/implementation manifests. Conformance stays green.
2. **Migrations & domain** — package scaffold; `0001_journal.sql` (permission seed + 18 tables + invariant CHECKs)
   + `0002_grant_application_role.sql`; permissions, audit codes, domain vocab/limits/lifecycles, the pure
   validation+balance engine, ports, errors.
3. **Repository & services** — parameterized SQL with optimistic-lock CAS; emitter (two families); catalog,
   recommendation, draft, validation, posting services; barrel `index.ts`.
4. **API** — NestJS controllers (catalog, recommendation, draft, posting) under `/api/v1/journals`; views;
   module wiring into `app.module.ts`.
5. **Tests** — PURE smoke; governance DB spec; services DB spec; HTTP API DB spec.
6. **Docs/ADRs/manifest** — ADR-091…096; architecture + this plan + completion; README; manifest evidence.

## Boundary rules honoured

- One authoritative implementation of each shared service consumed via DI tokens (`DB`/`AUDIT`/`AUTHZ`/`OUTBOX`).
- No second outbox; every event on the m06 outbox.
- No FK into m19/m20/m22; opaque ids only. No reads of other modules' tables.
- Maker-checker/SoD preserved; no autopost; no closed-period posting; no duplicate posting; balanced-before-post.
- Decimal-safe money (bigint minor units, string on the wire); forward-only migrations; no historical edits.

## Quality gates (run from clean)

`format` → `lint` → `build` → `test:smoke` (incl. conformance) → `migrate --dry-run` → `migrate` →
`test:db` (governance + services + API specs) → contamination scan. No control weakened to reach green.
