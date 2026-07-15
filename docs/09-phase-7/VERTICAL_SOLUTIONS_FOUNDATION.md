# Phase 7 — Vertical Solutions Foundation

Phase 7 builds industry/vertical business solutions **on top of** the live, stable horizontal platform. It begins
only after the platform has an issued GO (or a CONDITIONAL GO within its deadlines), the pilot has completed its
monitoring window with no open critical/blocking defect, live migration + rollback have been executed and
validated for at least one production tenant with Finance + Legal sign-off, DR failover has been drilled against
approved RPO/RTO, and penetration testing has cleared with no release-blocking finding.

## Rules for every vertical
- Register its commercial surface through the 6F entitlement engine (plans/add-ons/quotas).
- Emit through the single m06 transactional outbox.
- Declare its offline-restricted actions for the 6G mobile/offline gate.
- Classify its data and map its controls into the 6H GRC catalogue; register its processing activities for
  privacy.
- Enter the certification matrix (m42) as an operational-modules or dedicated vertical domain and pass its
  aspects before release.
- **Introduce no** second tenant model, entitlement engine, sync engine, outbox, key store, or security control
  plane — inherit all shared services.

## What a vertical may add
Its own tables (RLS FORCE), business validation, workflows/rules (configured, not bypassing controls), reports,
AI prompts (governed), and connectors (framework → sandbox → certified) — always through the approved platform
seams.
