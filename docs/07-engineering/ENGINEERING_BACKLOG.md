# Engineering Backlog

Organised as epics by phase/module. Each item, when built, ships with permissions + events + audit codes + tests
and a manifest status update. Priorities: P0 (MVP must), P1 (fast follow), P2 (later/commercial).

## Epic 0 — Foundation (P0)
Stage 0 toolchain scaffold; m01 tenancy; m02 auth/RBAC; m03 audit; m06 status/workflow/SLA/timeline/outbox; m07
rules; m08 notify/escalation; m09 documents; m04 admin console. Acceptance: tenant isolation proven; audit spine
live; shared services reusable; DB-integration + smoke suites green.

## Epic 1 — Operational (P0)
m12 feedback (capture→escalate→review→close); m13 case (assign→activities→SLA→close). Acceptance: closed-loop
feedback; structured + free-text activities; cross-module events; SLA + escalation working.

## Epic 2 — Finance (P0 core, P2 posting)
m19 finance foundation; m15/m15a bank recon + matching; m20 GL recon; m21 journal (draft); m22 approval; m23
finance integration. Acceptance: decimal-safe; balanced journals; maker-checker; explainable matches; **no
posting in MVP**; no closure with unresolved required exceptions.

## Epic 3 — Legal (P1)
m14 legal matter; m16 litigation; m17 recovery; m18 legal docs. Acceptance: privilege + ethical walls; deadline
reminders + escalation; case→matter conversion. Read-only portfolio in MVP.

## Epic 4 — AI (P1)
m24 foundation; m25 operational AI; m26 legal AI; m27 finance AI; m28 copilot; m29 governance. Acceptance: human-
in-the-loop; confidence + citations; DLP; no controlled actions; no restricted data to unapproved providers.

## Epic 5 — Enterprise platform (P1/P2)
m30 platform; m31 studio; m32 analytics; m33–m37 integration; m38 automation; m39 commercial SaaS; m40 resilience;
m41 security/GRC; m42 certification. Acceptance: per-part release gates; boundary + conformance checks green.

## Epic 6 — Hardening (P0 for GA)
Live pentest, DR drills, load + chaos, real-data migration with Finance + Legal sign-off. CONDITIONAL-GO
conditions.
