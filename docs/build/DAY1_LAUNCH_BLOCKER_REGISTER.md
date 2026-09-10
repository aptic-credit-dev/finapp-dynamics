# Day-1 Launch-Blocker Register

> Companion to `INTEGRATED_MODULE_ACCEPTANCE_REPORT.md`. Distinguishes **genuine Day-1 blockers** from
> **deferred** and **external-integration** items. A module is **not** a blocker merely because an optional
> post-launch capability is absent. Evidence base: baseline (smoke 8,082/0), DB integration lane 98/3,093/0 on the
> non-superuser role, and a full source-confirmed web-wiring trace against the merged tree (`a824879`).
>
> M42 remains `NO_GO`; Stage-7 G1–G4 unchanged. This register does not override ADR-130/131, M42, or the Stage-7
> gates.

## A. Genuine Day-1 blockers (must be resolved before launch)

| # | Blocker | Type | Status | Evidence / notes |
|---|---|---|---|---|
| B1 | **Authenticated human browser acceptance not yet performed** | Process / acceptance gate | **OPEN (only true gate)** | Backend + wiring proven; the assistant cannot handle credentials and had no renderable browser. Resolve by executing `HUMAN_BROWSER_ACCEPTANCE_EVIDENCE.md` and signing off each module. This is **not** a code defect. |

**Code defects that block Day-1: NONE demonstrated.** No reproduced UI/client/API/domain/schema/seed defect was
found in the merged code. Every DAY-1 CRITICAL and DAY-1 SUPPORTING workflow is backend-proven and UI-wired.

## B. Deferred — NOT required for Day 1 (post-launch)

| # | Item | Module | Why not Day-1 |
|---|---|---|---|
| D1 | Split / many-to-many reconciliation matching | M20 | Exact 1:1 manual match + reconciling items cover Day-1; multi-line needs a new unmatched-line read endpoint + builder. Write side is safe (exact-balance). |
| D2 | Taxonomy **edit** UI (`updateTaxonomy` client-only) | M18 | Create + retire are wired; taxonomy is reference data — recreate/retire suffices for Day-1. |
| D3 | Notification **version-authoring** UI (`newNotifTemplateVersion` client-only) | M08 | Template create + version validate/publish/activate/retire are wired; explicit new-version authoring is a convenience. |
| D4 | Dataset-edit/retire + report validate/review/publish **backend** | M32 | Dataset/metric/report **create** + metric maker-checker lifecycle are wired; editing definitions is post-launch. |
| D5 | Module config / master-data edit surfaces (m19 cost-centre/dimension/tax/fx; m21 journal-type/reason-codes; m22 policy/config; m08 escalation admin) | M08/M19/M21/M22 | Operational workflows work with seeded reference data; admin-of-reference-data is post-launch. |
| D6 | M39 usage/overrides/**billing writes** | M39 | Append-only evidence / administered via maker-checker elsewhere — read-only by policy for Day-1. |
| D7 | M17 party **edit**; deadline **complete/waive**; audited **contact-reveal** event | M17 | Party correction = remove+re-add (wired); deadlines extend (wired); contact is already redacted on read. Bounded follow-ups; only promote to Day-1 if browser acceptance proves they block real operation (they do not, per the wired workflows). |

## C. External-integration dependent (needs a real external contract; honestly surfaced, not broken)

| # | Item | Module | Day-1 handling |
|---|---|---|---|
| E1 | Document **byte upload/download** (object store) | M09 | Metadata create + lifecycle work; UI states byte storage is unavailable. Communicate to users. |
| E2 | Notification **external delivery** (email/SMS/webhook provider) | M08 | Templates are content metadata only; no delivery claim. Communicate. |
| E3 | Reconciliation **source-file ingestion** (storage/import contract) | M20 | Structured GL rows only; no file-upload control shown. Communicate. |
| E4 | Analytics **non-Feedback adapters** (pending m33) | M32 | Feedback adapter + governed query work. |
| E5 | **Statutory legal-deadline calculation** (approved rules) | M17 | Deliberately not implemented — deadlines are authorised user-entered dates; UI says so. |

## D. Documentation drift corrected by this audit (not defects)

| # | Item | Correction |
|---|---|---|
| X1 | M18 lifecycle verbs "validate / activate / retire" for templates & clauses | These verbs do **not** exist. Actual lifecycle: **submit → approve → publish → withdraw (+ supersede)**; maker-checker = submit(maker)+approve(checker). Earlier checklists using the wrong verbs are documentation drift; the lifecycle itself is fully wired. |
| X2 | `MODULE_CRUD_LIFECYCLE_MATRIX.md` §B stale `MISSING*` rows | Several rows (m02 identity/role edit, m09 create, m13 triage, m17 create/advance/capture, m18 template/clause/taxonomy, m19 entity/period, m20 run/match/item/certify, m21 header-edit, m22 delegation, m28 export, m32 authoring, m08 template) were wired across Tier-1 + Waves 1–4 and are corrected in the matrix update accompanying this audit. |

## E. Blocker-closure decision
- **Day-1 code blockers:** 0.
- **Open acceptance gate:** 1 (B1 — human browser sign-off).
- **Deferred:** 7 groups (D1–D7) — none block Day-1.
- **External dependencies:** 5 (E1–E5) — communicate as operational limitations.

**Consequence:** `TECHNICAL MODULE CONDITIONAL GO` — the only condition is closing B1 via the operator runbook.
