# Phase 7 — Vertical Solutions Foundation

Phase 7 builds industry/vertical business solutions **on top of** the live, stable horizontal platform.

**Two gates (ADR-133, 2026-08-23).** The Phase-7 dependency is split — refined, not removed:

- **Implementation-commencement gate (met now under CONDITIONAL_GO):** vertical-solution **implementation MAY
  commence in parallel** with the remaining Stage-7 closure items. This lets the reference vertical + UI be built
  while Stage-7 release blockers are still tracked.
- **Production-release gate (UNCHANGED):** **no Stage-8 vertical may be RELEASED to production** until the platform
  has an issued GO (or a CONDITIONAL GO within its deadlines), the pilot has completed its monitoring window with no
  open critical/blocking defect, live migration + rollback have been executed and validated for at least one
  production tenant with **Finance + Legal sign-off**, **DR failover** has been drilled against approved RPO/RTO,
  and **penetration testing** has cleared with no release-blocking finding — sealed by the **M42 governed GO**.

Implementation commencing does not declare Stage 7 complete and is not a production GO. Each Stage-8 module still
follows the per-module governance cadence (`documented → approved_for_build`) and enters the m42 certification
matrix before release; the frontend stack is OPEN_QUESTIONS #17 (a product-owner decision).

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
