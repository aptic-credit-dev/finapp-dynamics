# User Journeys (core)

## Feedback → closure (closed loop)
Capture (manual or transaction-triggered) → classify + sentiment → positive: acknowledge + close; negative:
escalate to HOD/responsible officer → resolve → closure approval → customer follow-up → dashboards updated. Every
step audited; SLA timers run; escalation fires on breach.

## Case lifecycle
Create (or auto-create from escalated feedback) → assign owner → add activities (structured headline + free-text,
including extracted text from documents/emails) → attach documents → track SLA → escalate/review → close. Cases
can convert to Legal Matters via events.

## Legal matter (read-only in MVP)
View matter portfolio → deadlines (mentions, hearings, filing) → linked documents → advocate assignment. Write
paths (create/convert/file) are post-MVP and gated by privilege + ethical walls.

## Bank/GL reconciliation
Ingest bank statement (CSV/Excel/PDF) + GL (upload or API) → run matching (exact/probable/split; 1:1, 1:many,
many:1, many:many) → review exceptions with colour-coded status → group/tick split items → generate reports. AI
suggests matches with confidence; humans confirm.

## Journal (draft-only in MVP)
Reconciliation/operation produces a journal recommendation → draft created (balanced, decimal-safe) → routed to
approval (maker-checker) → **stops at approved draft in MVP** (posting to core systems is post-MVP).

## Executive briefing
Executive opens the copilot/dashboard → governed AI summarises feedback trends, case/SLA status, legal deadlines,
and reconciliation exceptions with citations → executive drills into source records. AI never acts.
