# Shared Operational Services

One implementation each, reused by every module (see SHARED_SERVICE_OWNERSHIP.md).

## Status engine (m06)
Per-entity state machines; transitions are permissioned and audited; invalid transitions are refused (409).

## Workflow / BPM (m06)
Configurable, versioned workflows with stages, owners, assignment, SLA timers, escalation, approvals, exception
paths, and active-instance migration. Cannot bypass module permissions, financial/legal controls, tenant
isolation, approvals, or DLP.

## SLA & timeline (m06)
SLA timers respect business calendars; the activity timeline stores structured headlines and free-text
descriptions (including extracted text from documents/emails).

## Rules (m07)
Versioned, explainable rules + decision tables; matching, escalation, classification, approval, SLA,
notification, and AI-confidence-threshold rules; tenant-configurable with approval + audit.

## Notifications & escalation (m08)
Email, SMS, WhatsApp-ready, in-app, dashboard alerts; templates; escalation triggers on SLA breach / status /
unresolved items / legal deadlines / reconciliation exceptions; notification audit.

## Documents (m09)
Upload/download/preview, categories, tagging, classification, versioning, access control, linking to any business
record, OCR + AI-extraction readiness, retention, legal hold, tenant isolation.

## Transactional outbox (m06)
The single event-delivery path: events published in-transaction with the state change; idempotent consumers;
dead-letter + replay.
