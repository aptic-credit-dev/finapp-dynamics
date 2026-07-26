# Stage 2.4 — M08 Notifications & Escalation — Readiness

**Verdict: GO** (build proceeded on the certified Stage 2.3 baseline `f5b06d7`, PR #15 merged and verified).

## Dependencies already available

- **kernel** — `DB` (ambient tenant tx), `AUDIT`, `AUTHZ`, `OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02** — real RBAC (`RbacAuthz`) reading `ctx.permissions`; the `permissions` catalogue m08 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single durable outbox; m08 publishes `notification.lifecycle` through it. ✅
- Test harness (`defineSuite`/`defineDbSpec`), migrate tool (m08 already in `module-order`), conformance. ✅

## Integration points

- **AUDIT/AUTHZ/DB/OUTBOX** consumed via kernel tokens; bound once in `PlatformModule`. m08 binds none.
- **m06/m07** trigger notifications/escalations via events/contracts (no import cycle). Downstream fan-out on
  escalation advance is a documented hook.
- API mounted in `AppModule` as `NotifyModule` under `/api/v1/notifications`.

## Assumptions

- No real notification provider is configured in this repo → deterministic test doubles only; unconfigured
  channels fail safe (Framework Only). Real adapters are a later responsibility.
- Recipient directory data (org chart, manager chains) is owned by later modules → recipients are declarative
  refs resolved by a port; m08 invents no organizational data.

## Risks & mitigations

- **Injection via templates** → structural impossibility: substitution-only rendering, no eval/host access (ADR-040).
- **SSRF via webhooks** → https-only + private/loopback/metadata host denial; no arbitrary fetcher (ADR-038).
- **Dual-write / lost dispatch** → request + dispatch intent + audit + event commit in one tx; retries are
  lease-guarded and idempotent (ADR-043).
- **Sensitive data accumulation** → audit/events/evidence carry ids/hashes/status only (ADR-041).
- **Retry storms** → bounded `maxAttempts` + capped backoff; non-retryable categories stop immediately.

## Exclusions (verified out of scope)

No m09/m12/m13/finance/reconciliation/AI implementation; no marketing/campaign/CRM/dialer; no real provider SDK
or credentials; no arbitrary email/webhook; no organizational-directory ownership; no standing dispatcher worker.

## Acceptance gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs · API
specs · RLS · permissions · audit · events · outbox · idempotency · concurrency · safe-template negatives ·
cross-tenant · contamination. All green locally (PostgreSQL 15.2); PostgreSQL 16 CI is authoritative.
