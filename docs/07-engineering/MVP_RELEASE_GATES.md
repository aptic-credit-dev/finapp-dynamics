# MVP Release Gates

A stage/release passes only when every gate is met. Mirrors the certification GO criteria, scoped to MVP.

## Functional
All MVP critical journeys pass; feedback closes the loop; cases carry structured + free-text activity;
reconciliation matches are explainable; journals never post without approval.

## Security & isolation
Tenant isolation passes across every module; auth + authz enforced server-side; no cross-tenant inference via
counts/timing/errors/metadata; no secret/key exposure; audit complete for every controlled action.

## Finance integrity
Decimal-safe; balanced journals; maker-checker + SoD; no auto-post; no posting to closed periods; no duplicate
posting; no closure with unresolved required exceptions.

## AI governance
AI outputs labelled + cited + human-reviewed; no AI-executed controlled action; no restricted data to unapproved
providers.

## Quality
Smoke + DB-integration suites green; boundary check passes (no cross-module DB access); no open critical/blocking
defect; docs + manifest synchronized.

## Operational
Monitoring + alerts for MVP-critical services; emergency suspension/kill switches present; runbooks for the MVP
services; rollback ready.

## Decision
A formal GO / CONDITIONAL GO / NO-GO recorded, with role sign-offs and no self-sign-off of one's own assessed
area. CONDITIONAL GO only with time-bound risk acceptances behind flags.
