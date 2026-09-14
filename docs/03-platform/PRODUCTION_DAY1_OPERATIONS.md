# Production Day-1 Operations

> Day-1 operating instructions for the Aptic Dynamics platform (frozen candidate
> `b26d4675fafc9b55b616f41319f191e9f6fb6269`): production data handling, user onboarding, go-live communication
> templates, and the post-launch monitoring schedule. Planning-only: no real data, no user, and no production action
> is authorised here; every human sign-off is a blank field.

## 1. Production data-handling rules

- **No synthetic or staging data in production.** The production database is fresh PG16 with no staging/synthetic
  rows. Never copy `.env.staging`; never reuse staging DB, keys, passwords, cookies, or seeded accounts.
- **Real data only after authorisation.** Real tenant data may enter production only after Legal/DPA approval
  (gate G9), the Kenya-DPA region ruling, and a recorded real-data migration authorization with CFO + Legal
  sign-off (gate G4). Until then no real data is loaded.
- **PII handling.** The platform stores opaque subject references and holds no PII columns by design; keep it that
  way. Any real-data intake must preserve that invariant and route through the approved migration path.
- **Least privilege.** The app connects as a non-superuser role (`finapp_app`, NOBYPASSRLS, non-owner) under
  transaction-local tenant context with FORCE RLS. Grant human operators the minimum roles required for Day-1
  duties; no standing superuser access for routine operations.
- **Audit everything.** Every mutating route is an audited endpoint with a permission; the audit hash-chain must
  stay intact. No controlled action bypasses audit, and no security event disappears silently.
- **Maker-checker / SoD.** Finance and other controlled actions require an approver who is not the requester.
  Never provision one identity that can both create and approve a controlled action.

## 2. Day-1 user onboarding

Provision only the personas required for the **enabled Day-1 modules** (the approved Day-1 scope); disabled modules
return 403 and stay hidden from navigation, failing closed on both entitlement (nav) and RBAC (API). No staging or
seed accounts are used — production admins are operator-provisioned via the bootstrap admin.

| Persona | Purpose (Day-1 enabled modules only) | Roles/permissions (least privilege) | SoD note | Provisioned by (appointee) | Signature |
|---|---|---|---|---|---|
| Tenant administrator | Manage the pilot tenant's users and settings | admin scope for enabled modules only | must not also approve own controlled actions | | |
| Maker | Create/submit controlled actions | maker permissions for enabled modules | distinct identity from checker | | |
| Checker / approver | Approve controlled actions | approver permissions | must not be the requester | | |
| Read-only / viewer | Review and reporting | read scope only | n/a | | |

Onboarding preserves maker-checker and SoD: every controlled action has a distinct maker and checker, and
entitlement plus RBAC both gate access. Provisioning is recorded and audited.

## 3. Go-live communication templates

Fill-in templates. The Communications Lead owns accuracy; no message asserts a state that has not been verified.

### 3.1 Internal go-live notice (template)

```
Subject: [Aptic Dynamics] Production go-live — <UTC timestamp>

Status: LIVE / IN PROGRESS
Release SHA: b26d4675fafc9b55b616f41319f191e9f6fb6269
Enabled Day-1 modules: <list>
Verification: health <PASS/PENDING>, SLOs <within/observed>, audit-chain <intact/PENDING>
Incident Commander: <appointee>   Rollback authority: <appointee>
Next checkpoint: <T+1h UTC>
```

### 3.2 User go-live notice (template)

```
Subject: <Product> is now available

What: <Product> is live for <tenant/persona scope>.
Available now: <enabled Day-1 modules>.
Getting started: <access instructions / support contact>.
Support: <L1 contact> during <coverage window>.
```

### 3.3 Incident / rollback notice (template)

```
Subject: [Aptic Dynamics] Service <incident/rollback> — <UTC timestamp>

Severity: <SEV1..SEV4>
Impact: <who/what is affected>
Status: <investigating / mitigating / rolled back / resolved>
Action taken: <summary; if rollback, prev SHA + whether snapshot restore was required>
Next update: <UTC time per cadence>
Owner (Incident Commander): <appointee>
```

## 4. Post-launch monitoring schedule

Checkpoints after go-live (T+0 = cutover completion). Each verifies the items below and is signed off; blank until
executed. Verification uses the monitoring stack and the SLO targets (availability ≥ 99.9%, p95 ≤ 200 ms,
p99 ≤ 500 ms, error rate ≤ 0.5%, RPO ≤ 5 min).

| Checkpoint | What to verify | Signed by (appointee) | Date/UTC | Signature |
|---|---|---|---|---|
| T+0 (cutover complete) | health 200, container healthchecks, DB reachable via app role, FORCE RLS active, login + CSRF/Secure cookies, module entitlement (enabled reachable / disabled 403), smoke transaction + audit event, alerts armed | | | |
| T+1h | SLO metrics within target, error rate ≤ 0.5%, no auth anomalies, backup job scheduled, replication lag < 5 min | | | |
| T+24h | first backup succeeded + `pg_verifybackup`, audit-chain intact over the window, resource saturation nominal, no unresolved SEV1/SEV2 | | | |
| T+72h | sustained SLO compliance, backup/restore point confirmed, on-call rotation exercised, no open rollback trigger; COO/Ops stability acceptance | | | |

## Governance

Governance: STAGING/PLANNING only; M42 NO_GO; Stage-7 unchanged; no production action.
