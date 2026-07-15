# Event Catalogue

81 domain-event families in the reference baseline, declared once in the contracts event union and published
through the single m06 transactional outbox. Consumers are idempotent; dead-letter + replay supported.

## Conventions
- One typed envelope per family; append to the union tail; version each payload (`v: 1`).
- Published in-transaction with the state change (exactly-once intent).
- Tenant + correlation context on every event; no cross-tenant subscription.

## Representative families
Feedback lifecycle; case lifecycle + case→matter conversion; legal/litigation/recovery lifecycles; finance
(reconciliation, journal, approval, posting-request) lifecycles; AI request/output lifecycles; integration
(connector, webhook, event-stream) lifecycles; automation + extension lifecycles; commercial SaaS (subscription,
usage, billing) lifecycles; security (identity, privileged, DLP, crypto, GRC, privacy, SOC) lifecycles; and
certification (programme, migration, UAT, pilot, release) lifecycles.

## Event certification requirements
Event codes, ownership, versions, schemas, retention, replay, ordering, consumer compatibility, idempotency,
dead-letters, metrics, audit. Tests cover duplicate/out-of-order/missing events, schema mismatch, consumer lag,
replay, offset reset, and cross-tenant subscription attempts.
