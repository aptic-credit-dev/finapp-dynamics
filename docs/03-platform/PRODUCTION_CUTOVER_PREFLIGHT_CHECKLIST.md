# Production Cutover Preflight Checklist (PREPARED — NOT ACTIVATED)

> Shared-host in-place cutover configuration for candidate `dad369e1be68304dbf6c54c1abd0b3796b1df0de`. **PREPARED
> ONLY — nothing here is activated.** The Contabo host `169.58.194.151` is **still staging** and must not be
> described or run as production while M42 is `NO_GO`. **No DNS change** (Cloudflare already points to the origin).
> This checklist is gated behind the mandatory stop condition (all gates accepted + M42 changed by Patrick Maina +
> explicit `APPROVED — EXECUTE PRODUCTION CUTOVER`). Supplements `INPLACE_STAGING_TO_PRODUCTION_PROMOTION_PLAN.md`
> Phase 3 and `PRODUCTION_CUTOVER_RUNBOOK.md`.

## 1. Cutover configuration (to APPLY at cutover — not now)

| # | Setting | Target value | Current (staging, read-only audit) | Verified at cutover |
|---|---|---|---|---|
| 1 | Release SHA (pinned) | `dad369e…` (exact reviewed main) | `223fd1c` (stale) | ☐ |
| 2 | `NODE_ENV` | `production` | `staging` | ☐ |
| 3 | `FINAPP_COOKIE_SECURE` | `true` | `false` | ☐ |
| 4 | `FINAPP_ALLOWED_ORIGINS` | `https://dynamics.finappay.co.ke` | `http://localhost:3000` | ☐ |
| 5 | `DATABASE_APP_ROLE` | `finapp_app` (non-superuser) | `finapp_app` ✔ | ☐ |
| 6 | Clean production DB init | fresh DB; 84 migrations; prod tenant + admin via private operator procedure | synthetic `finapp_staging` (discard) | ☐ |
| 7 | Fresh production-only secrets | newly generated, entered privately; staging rotated/revoked | staging secrets present | ☐ |
| 8 | OpenBao binding | dedicated prod OpenBao bound (`FINAPP_OPENBAO_ADDR` set) | empty (unbound) | ☐ (G5) |
| 9 | Staging banner + project-name removal | production web build; project renamed | 3 web files reference "staging" | ☐ |
| 10 | Day-1 RBAC / entitlement allow-list | only approved-module perms granted | n/a | ☐ (preflight probe) |
| 11 | Disabled modules/subflows inaccessible | nav-hidden + API 403 | proven on synthetic | ☐ (preflight probe) |
| 12 | Cloudflare cache purge | purge after origin 443 live | n/a | ☐ |
| 13 | TLS / HSTS + reverse proxy | 443 terminator + HSTS validated | only :22 public; no 443 origin | ☐ |
| 14 | Rollback bundle + decision checkpoint | pre-cutover encrypted dump + image digests off-host; T+90 checkpoint | pattern exists | ☐ |

**DNS:** unchanged — Cloudflare already targets `169.58.194.151`. Cutover requires **cache purge only**, no DNS edit.

## 2. Machine-verifiable Day-1 isolation preflight (at cutover)

Run against the production DB under the non-superuser role — the merged, passing probe:

```
DATABASE_APP_ROLE=finapp_app DATABASE_URL=<prod> npm run test:db
```

Requires **`day1-isolation (production Day-1 scope)` = 0 failed** (11 assertions: 401 anon; enabled `cases.case.read`
→ 200; disabled journals/litigation/analytics → 403; `x-permissions`/`x-actor-id` grant nothing; positive control
200; `debt_recovery` entitled:false; cross-tenant refused). Plus a production role-grant audit confirming Day-1 roles
hold only approved-module permissions.

## 3. Preconditions before this checklist may be executed (all mandatory)

1. G1 independently accepted. 2. G2 cross-host DR independently accepted. 3. G4 accepted or formally approved N/A.
4. G5 OpenBao requirement accepted. 5. EU cross-border ruling signed (Mwangi + Muchina + Maina). 6. All other
applicable gates accepted. 7. **M42 formally changed from `NO_GO` by Patrick Maina.** 8. Patrick Maina issues exactly
`APPROVED — EXECUTE PRODUCTION CUTOVER`.

If any is missing → **do not activate**; the host stays staging.

## Governance

Prepared configuration only. Nothing applied; host remains staging; no DNS change; **M42 `NO_GO`.**
