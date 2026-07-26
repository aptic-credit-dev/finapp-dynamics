# Stage 3.1 — M12 Enterprise Feedback Management — Implementation Plan

Grounded in the m07/m08/m09 pattern. Built on `feature/stage-3-1-m12-feedback` from certified `6aa47442`.

## Sequence (as built)

1. **contracts** — `feedback.lifecycle` family (24 event types, version 1); wired into the `DomainEvent` union +
   `DOMAIN_EVENT_FAMILIES`; contracts smoke bumped one family.
2. **package skeleton + vocabularies** — `packages/m12-feedback` (package.json, tsconfig, root + apps/api refs);
   37 `feedback.*` permissions (privileged `feedback.customer_contact.read` + `feedback.platform.administer`);
   35 `FEEDBACK_*` audit codes.
3. **PURE domain** — limits + vocab (channels, sentiments, severities, feedback types, root-cause categories);
   feedback + spec lifecycles (15 feedback states); questionnaire spec + answer validation + deterministic
   CSAT/NPS score normalization; SLA policy spec + deterministic clock-driven SLA math; closure eligibility gate
   (machine-readable reason codes); duplicate/related matching; content-hash util.
4. **clock + adapter ports** — `Clock` (`SystemClock` + `FixedClock`) so SLA math is deterministic;
   `SourceSystemAdapter` normalizing external transactions, deterministic doubles only.
5. **migrations** — `0001_feedback.sql` (15 tables, RLS ENABLE+FORCE, composite keys/FKs, one-active versioned
   specs + ingestion/record/handoff idempotency + single-winner queue claim + append-only ledgers, permission
   seed) and `0002_grant_application_role.sql` (NO DELETE anywhere; the append-only ledgers INSERT+SELECT only).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS on `version`, unique-constraint claims for the
   queue + pending handoff, append-only inserts); `M12Emitter` (audit m03 + m06 outbox in the business tx).
7. **services** — Catalog (configurable sources/categories + versioned questionnaires/SLA policies), Feedback
   (ingestion, queue claim, full record lifecycle capture→classify→assign→resolve→close with CSAT/NPS), Records
   (SLA tracking, escalation, M13 case handoff, duplicate/related linking); index.
8. **API** — `apps/api/src/feedback` (views with redaction + 3 controllers + module binding Framework-Only
   clock/adapter); wired into `AppModule`.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true`;
   manifest m12 → implemented + `certification_3_1`; finalize `certification_2_5`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + maker-checker),
    api-spec (HTTP + redaction).
11. **docs** — README, architecture/readiness/plan/completion, ADR-052…056.

## Design choices

- **15 tables** (module-registry reference baseline is fewer; the enterprise scope — configurable sources +
  categories, versioned questionnaires + SLA policies, ingestion, the core record, answers, queue, contact +
  assignment ledgers, activity, resolution, SLA instance, case handoff, relationships — justifies 15; documented).
- Questionnaires, categories and closure criteria are **declarative data**; complex decisioning delegates to m07
  rules (ADR-053). Sentiment/severity/classification are human/rule-driven fields, not AI outputs.
- SLA math is **deterministic** via an injected `Clock` port (no ambient `Date.now`, ADR-054); timer dispatch and
  escalation delegate to m06/m08.
- Maker-checker on resolution (submitter ≠ approver); optimistic concurrency (`version` + `WHERE version=$expected`);
  idempotency on ingestion, record creation and case handoff via unique constraints.
- Customer contact + narrative are sensitive: redacted on read behind `feedback.customer_contact.read`, never in
  events/audit (ADR-055).
- **M13 case handoff is a deferred framework hook** (port + pending record + versioned event) — no case table, no
  second escalation engine (ADR-056). Real external source adapters are deferred behind the port (documented).

## Verification

Every gate actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Counts recorded in
the completion report.
