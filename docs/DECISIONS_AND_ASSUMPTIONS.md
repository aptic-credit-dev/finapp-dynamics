# Decisions & Assumptions

This records the **approved architectural decisions**, the **conflicts resolved** during consolidation (latest
approved decision wins), and the **working assumptions** the design rests on. Where a conversation contained an
earlier instruction that was later superseded, only the final decision is carried forward.

## Approved decisions (authoritative)

1. **SaaS-first, multi-tenant from day one.** Every business record is tenant-aware. Tenant isolation is enforced
   at the database with RLS FORCE + `tenant_isolation` policies and composite `(tenant_id, id)` keys, not only in
   application code.
2. **Modular monolith for MVP, service-extractable later.** A single deployable with strict module boundaries
   (each module owns its tables and exposes contracts/events) rather than microservices up front. Boundaries are
   drawn so services can be extracted without redesign.
3. **One authoritative implementation per shared service.** Auth, tenant resolution, RBAC, audit, status,
   workflow, rules, SLA, timeline, escalation, notifications, documents, the transactional outbox, secrets,
   idempotency, entitlements, usage metering, and reporting each exist exactly once. No duplicates.
4. **Transactional Outbox for all domain events**, owned by `m06-workflow`. No second delivery path.
5. **Audit-first.** Every sensitive/controlled action writes an audit entry against a single registry; audit
   codes are registered (unregistered codes fail CI); audit history is append-only and tamper-evident.
6. **AI is assistive, never authoritative.** AI recommends with confidence + citations and human review; it never
   approves, posts, files, or reaches a legal conclusion, and never sends restricted data to unapproved
   providers.
7. **Finance controls are absolute.** Decimal-safe money, balanced journals, maker-checker + SoD, no auto-post,
   no posting to closed periods, no duplicate posting, no reconciliation closure with unresolved required
   exceptions.
8. **Legal privilege + ethical walls** are enforced; unauthorized users cannot infer privileged matter data.
9. **API-first with `/api/v1/*` paths.** All external access goes through the approved API gateway; all
   integrations through the approved integration platform.
10. **Deny-by-default security posture** (Zero Trust over RBAC), server-side DLP, no raw key storage,
    time-bound privileged access + risk acceptance, immutable published policies.
11. **Release is gated.** A formal GO / CONDITIONAL GO / NO-GO is required; a GO needs all role sign-offs; no
    self-sign-off of one's own assessed domain; issued decisions are immutable.

## Conflicts resolved during consolidation

| Topic | Earlier instruction | Superseding decision (applied) |
|---|---|---|
| Soft delete | `deleted_at` / `deleted_by` columns | Status columns + `removed_at` / `removed_by` (compatible with RLS FORCE; append-only intent) |
| Global templates | Provision via `tenant_id NULL` | Provision per tenant (a `NULL` tenant is incompatible with RLS FORCE) |
| API paths | Mixed/unspecified | Standardised on `/api/v1/*` |
| Escalation-to-team | Full feature in MVP | Deferred; a P2 seam is reserved |
| Audit event naming | PascalCase event names | `SCREAMING_SNAKE` registry codes |
| AI autonomy | Occasional "auto" phrasing | AI never executes controlled actions; human-in-the-loop required |
| Reconciliation palette | Five-colour law only | Extended with three reserved tones (dark-green exact, orange exception, purple escalated), mapped once |

## Working assumptions (validate with a business owner)

- Primary jurisdiction is Kenya (Kenya Data Protection Act applies; ISO 27001 / SOC 2 / GDPR treated as
  readiness targets, not claimed certifications).
- Initial tenant is an internal Aptic/Finapp tenant; external commercial tenants follow after the pilot.
- Core external systems to integrate: ERPNext, ApticOne, Imarisha, AutoBonds, BimaPro, ApticPay, M-Pesa, plus
  email/SMS/WhatsApp gateways — initially read-only or sandbox.
- PostgreSQL 16 is the system of record; the reference implementation is NestJS/TypeScript.
- Money is represented decimal-safe (minor units / exact decimal); no floating point anywhere in finance paths.
