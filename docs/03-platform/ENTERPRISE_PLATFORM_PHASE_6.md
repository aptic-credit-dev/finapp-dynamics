# Enterprise Platform (Phase 6)

The horizontal platform every domain reuses. Designed and reference-implemented across 6A–6I.

| Part | Module | Scope | Reference tables |
|---|---|---|---|
| 6A | m30-platform | Platform foundation: metadata, config, feature flags, secrets seam | 26 |
| 6B | m31-studio | Workflow/BPM/Forms/Rules Studio | 25 |
| 6C | m32-analytics | Reporting, dashboards, enterprise analytics builder (semantic datasets, RLS, masking) | 42 |
| 6D-1 | m33-integration | Integration foundation: connector SDK/registry, connection + secret manager, runtime | 38 |
| 6D-2 | m34-marketplace | Connector marketplace, installations, consent, upgrades | 25 |
| 6D-3 | m35-devportal | Public APIs + developer portal | 18 |
| 6D-4 | m36-events | Webhooks + event streaming | 34 |
| 6D-5 | m37-govrelease | Integration governance, QA & release | 12 |
| 6E | m38-automation | Scheduler, automation, extension framework (trust tiers, isolation) | 44 |
| 6F | m39-saas | Tenant admin, billing, white-labelling, commercial SaaS | 72 |
| 6G | m40-resilience | Mobile, offline, observability, backup, business continuity | 20 |
| 6H | m41-security | Enterprise security, privacy, compliance & GRC | 79 |
| 6I | m42-certification | Enterprise integration, certification & production release | 43 |

## Key guarantees
Configurable-but-safe workflows/rules; row-level security + masking in analytics; approved integration platform +
API gateway for all external access; registered capabilities for automations and registered extension points for
extensions (no arbitrary code, no direct DB access, no approval/SoD bypass); commercial SaaS with immutable
invoices + idempotent usage; mobile/offline that blocks offline finalisation of high-risk actions; and a security
control plane that governs posture without replacing the authoritative controls.

## Certification (6I)
The final gate assesses 12 domains × 8 aspects, gates on blocking defects, requires validated migrations + tested
rollbacks + checkpoint-complete cutovers + UAT sign-off + operational readiness, and runs a deny-by-default
GO/CONDITIONAL-GO/NO-GO engine. Reference outcome: GO (conditional on live-infrastructure hardening).

### Certification (6I) — implementation status (Stage 6I, ADR-129)

Delivered on `feature/stage-6-m42-certification`: the Stage-6 **closure gate** as a governance runtime + evidence/closure
layer — **13** governed `certification_` tables (5 mutable aggregates + 8 append-only ledgers) reconciled from the 43-table
reference baseline. M42 RECORDS certification **programmes**, the **12 domains (M30-M41) × 8 aspects** assessment matrix,
**findings**, **waivers**, **migration/UAT/pilot/release readiness**, opaque **evidence** references and role **sign-offs**, and
issues the **GO/CONDITIONAL_GO/NO_GO** decision + an immutable Stage-6 **closure** artifact.

**The verdict is DERIVED, never set.** `evaluateCertificationDecision` computes the outcome deny-by-default from governed
evidence — a missing/failed assessment, a critical open finding, a missing/failed mandatory readiness, or a missing/rejected
mandatory sign-off BLOCKS a GO ⇒ NO_GO; bounded approved residual conditions ⇒ CONDITIONAL_GO; otherwise GO. **Independence
(ADR-012):** a GO needs all mandatory role sign-offs; no self-sign-off of one's own assessed domain; requester ≠ certifier;
AI/system/automation never self-certify; an issued decision + closure are immutable (a correction is a new decision).

**M42 executes nothing** — migration/UAT/pilot/release records are EVIDENCE, not runners; M37 owns release promotion and the
owning modules own runtime. It ASSESSES M30-M41 by contract (opaque evidence refs; reads no owning-module private table) and
DUPLICATES no audit/workflow/approval/security/analytics/outbox/scheduler/secrets engine. A waiver cannot override an absolute
control; an expired waiver stops satisfying the gate. Evidence is opaque references only (no secret/credential/full-log/raw-body/
PII). Surface: `/api/v1/platform-certification`; `platform_certification.*` (12 perms, 4 privileged); `CERT_` audit (18 codes);
5 `certification.*` families (10 types) through the one m06 outbox. **Stage-7 live-infrastructure hardening (pen test / DR drill
/ load+chaos / real data migration) is CONDITIONAL** — M42 issues CONDITIONAL_GO with explicit, bounded, owned, time-bound
conditions; it never fabricates full production readiness. See ADR-129 and `manifests/implementation-manifest.yaml`
(`implementation_6_m42`).
