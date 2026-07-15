# Case Management (m13)

## Purpose
Track internal cases, customer complaints, escalated feedback, operational issues, and departmental matters
through a governed lifecycle with SLA and audit. 18 reference tables.

## Capabilities
Case types/categories/priorities; assigned owners; activity updates (structured headline + free-text description,
including extracted text from court/legal documents, emails, letters, memos); case timelines; supporting
documents; internal notes + external correspondence; deadline tracking; escalation/review/closure workflows;
audit trails; conversion to Legal Matter.

## Lifecycle
created → assigned → in_progress (activities) → (escalated | in_review) → resolved → closed. Can convert to a
Legal Matter via events.

## Shared services
Status/workflow/SLA/timeline (m06), notifications/escalation (m08), documents (m09), audit, authz, outbox.
Consumes feedback-escalation events; emits case→matter conversion events.

## MVP
Creation, assignment, activities (structured + free-text), documents, SLA, escalation, closure, audit.
