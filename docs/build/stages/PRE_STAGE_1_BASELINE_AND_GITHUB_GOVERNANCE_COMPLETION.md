# Pre-Stage 1 — Stage 0 Baseline, GitHub Security and Branch Governance

**Completion report** · Created 2026-07-15 · **Updated 2026-07-15 (write-access blocker resolved)**
Task: repository governance and security only. No Stage 1 implementation.

## Verdict: CONDITIONAL GO

**Stage 0 is baselined on GitHub and Stage 1 may begin.** The write-access blocker is resolved: the
branch, tag and Stage 1 branch are all pushed and verified against the remote. The baseline is now
recoverable off this machine, which was the point of the task.

Three conditions remain, none blocking the *start* of Stage 1:

- **The compromised PAT still needs revoking** (C1) — write access was restored by granting the existing
  identity access, which does **not** revoke the leaked token. See §12 and §26/R1.
- `main` is **still unprotected** (C4) — protection needs a repository admin.
- The **`postgres:16` DB lane has never run** (C5) — it triggers on the first pull request. **Stage 1
  must not merge to `main` until it passes.**

No secret was ever committed. No history was rewritten. All Stage 0 commits are preserved.

---

## Change log for this update

| Item | Before | Now |
|---|---|---|
| Write access | ❌ 403 for `wacherakelvin` | ✅ verified |
| Stage 0 branch push | ❌ blocked | ✅ pushed, verified |
| Tag push | ❌ blocked | ✅ pushed, verified |
| Stage 1 branch push | ❌ blocked | ✅ pushed, verified |
| DB lane on pull requests | ❌ never ran (`if: github.event_name == 'push'`) | ✅ gate removed + fail-closed guards added |
| Branch protection | pending | pending (unchanged — needs an admin) |
| PAT revoked | unknown | **still outstanding** |

---

## 1. Repository root

`C:/Users/HP/dev/finapp-dynamics`

## 2. Active GitHub identity

| Item | Value |
|---|---|
| Commit author identity | `wacherakelvin <kellyviny605@gmail.com>` |
| Authenticating GitHub account | **`wacherakelvin`** (reported by Git Credential Manager; only the `username` field was read — the secret was never accessed or displayed) |
| Credential helper | `manager` (Git Credential Manager) |
| GitHub CLI | **not installed** (not auto-installed — outside approved conventions) |
| SSH | `~/.ssh/id_rsa` exists but is **not** registered with GitHub (`ssh -T git@github.com` → `Permission denied (publickey)`). Unused; HTTPS + GCM is the working path. |

## 3. Write-access verification

**✅ Verified — write access now works.**

```text
$ git push --dry-run origin feature/stage-0-foundation
To https://github.com/aptic-credit-dev/finapp-dynamics.git
 * [new branch]      feature/stage-0-foundation -> feature/stage-0-foundation
```

Previously this returned:
`remote: Permission to aptic-credit-dev/finapp-dynamics.git denied to wacherakelvin` (HTTP 403).

Confirmed by a non-destructive dry run **before** any real push, then by three successful pushes and a
read-back of the remote refs (§6).

⚠️ **The resolution appears to be option (a) — `wacherakelvin` was granted write access on the
repository.** The authenticating account is unchanged. That fixes access but does **not** revoke the
compromised PAT, which is a separate action and still outstanding (C1).

## 4. Remote status

**✅ Credential-free, unchanged from the previous report.**

```text
origin  https://github.com/aptic-credit-dev/finapp-dynamics.git (fetch)
origin  https://github.com/aptic-credit-dev/finapp-dynamics.git (push)
```

Asserted: no `@`, no `ghp_`/`github_pat_`, no username/password, no query-string credentials. No token
was re-introduced to make the push work.

## 5. Working-tree status

Clean throughout. No merge, rebase, cherry-pick or bisect in progress. HEAD attached, not detached.
`git diff --check` clean.

## 6. Push status and remote verification

All three pushed **without force**. Remote refs read back from GitHub and asserted against local:

| Ref | Remote commit | Status |
|---|---|---|
| `refs/heads/feature/stage-0-foundation` | `2fee15e` | ✅ matches local HEAD |
| `refs/heads/feature/stage-1-saas-foundation` | `8e55cdf` | ✅ matches local |
| `refs/tags/stage-0-complete` (tag object) | `6eb49df` | ✅ annotated tag |
| `refs/tags/stage-0-complete^{}` (dereferenced) | `8e55cdf` | ✅ points at the verified Stage 0 commit |

`main` on the remote is unchanged at `cf79043`.

Note the Stage 0 branch advanced to `2fee15e` after the CI correction (§8), which is *after* the tag.
That is intended: `stage-0-complete` marks the verified toolchain baseline, and the CI fix and the
reports are governance work layered on top. Stage 1 is branched from the tag, so it carries the baseline
and not the paperwork.

## 7. Baseline integrity

| Check | Result |
|---|---|
| `stage-0-complete` is an annotated tag | ✅ `objecttype: tag` |
| Tag → `8e55cdf` (*chore(stage-0): finalize repository baseline*) | ✅ |
| `feature/stage-1-saas-foundation` == `stage-0-complete^{commit}` | ✅ identical commit |
| `git diff stage-0-complete..feature/stage-1-saas-foundation` | ✅ **empty — no Stage 1 code** |
| Business `.ts` files outside `kernel`/`contracts` | ✅ **0** |
| Migrations present (`packages/*/migrations/*.sql`) | ✅ **0** |
| Stage 0 commits preserved | ✅ all 5, none rewritten |

## 8. CI workflow correction

**Problem.** The `db` job was gated `if: github.event_name == 'push'`, so it never ran on a pull
request. Two consequences: the DB lane is the only thing that proves tenant isolation, so an RLS
regression was caught only *after* merge; and marking `DB lane` a required check would have blocked
every PR forever on a check that could not report.

**Fix** (commit `2fee15e`, `fix(ci): run the PostgreSQL 16 database lane on pull requests too`):

1. **Gate removed.** The lane now runs on pull requests *and* pushes to `main`/`develop`. Verified by
   parsing the workflow: `jobs.db` has no `if` key; triggers are `['pull_request', 'push']`.
2. **Fail-closed guard added.** `npm run test:db` deliberately *skips and reports green* when
   `DATABASE_URL` is absent — correct as a default (contributors and the smoke lane need no database),
   but a hazard in the one lane whose job is to prove RLS. The lane now fails if `DATABASE_URL` is
   empty and waits for the service container to be ready, so "green" can never quietly mean "never ran".
3. **Version assertion added.** The lane asserts `server_version_num` is 16.x rather than trusting the
   `postgres:16` image tag, so its log is real evidence of the version it certified against. This is
   what makes the "PostgreSQL 16" claim checkable — the Stage 0 RLS proof was only ever run locally on
   15.2.

**The test itself is unchanged and was not weakened.** It now runs strictly more often, with stricter
preconditions.

`postgres:16` remains pinned. `docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` §2 was updated:
the caveat is resolved, Option A applied, and **both** lanes are now specified as required checks.

## 9. Test results (after the CI change)

| Gate | Command | Result |
|---|---|---|
| Workflow YAML parses | `yaml.safe_load` | ✅ jobs `smoke`, `db`; `db` has no `if` gate |
| Format | `npm run format:check` | ✅ clean |
| Lint | `npm run lint` | ✅ clean |
| Build | `npm run build` | ✅ clean |
| Smoke lane | `npm run test:smoke` | ✅ **3 suites / 73 assertions passing** |
| Whitespace / conflict markers | `git diff --check` | ✅ clean |

**DB lane: not run locally.** Unchanged from the previous report and deliberate — there is no
PostgreSQL 16 on this machine (Docker daemon not running; only PostgreSQL 15.2 binaries exist locally),
and PostgreSQL 15 was not to be substituted again as certification. The RLS convention proof
(1 spec / 26 assertions) was previously green on **PostgreSQL 15.2**. CI on `postgres:16` is now the
authoritative confirmation and has **not yet run** (§10).

## 10. Pull-request status

**PREPARED, NOT CREATED.**

Two reasons it was not created programmatically:

1. `gh` is not installed, and installing it was not approved.
2. Creating it through the raw REST API would require handling the PAT directly in a shell command —
   prohibited by this task's safety rules. The credential was not extracted.

**Open it here (prefilled, no credentials in the link):**

```text
https://github.com/aptic-credit-dev/finapp-dynamics/compare/main...feature/stage-0-foundation?expand=1
```

- **Title:** `Stage 0: Repository and toolchain foundation`
- **Base:** `main` ← **Head:** `feature/stage-0-foundation`
- **Scope:** 5 commits, 108 files changed (+5,470 / −42)

Suggested body:

> Stage 0 per `docs/08-prompts/STAGE_0_PROMPT.md`. Toolchain only — **no business tables, routes,
> permissions, events or audit codes.**
>
> - **Monorepo** — npm workspaces (`packages/{kernel,contracts}`, `apps/{api,web}`,
>   `tools/{migrate,test-runner}`), TypeScript project references, type-aware ESLint + Prettier,
>   README placeholders for all 43 business modules.
> - **Kernel** — DI tokens (`DB`/`AUDIT`/`AUTHZ`/`OUTBOX`, declared but intentionally unbound until
>   their owning modules exist), `RequestContext`/`SystemContext`, `ProblemError` (RFC 9457),
>   `@Endpoint(permission, auditCode)`, ambient-transaction `Db` (`withTenant`/`withSystem`).
> - **Contracts** — the typed domain-event union, deliberately empty (`never`) at Stage 0.
> - **Migration runner** — dependency-ordered, checksummed and immutable, idempotent, atomic per
>   migration, advisory-locked.
> - **Test harness** — framework-free PURE runner (runs off source, no build step) + DB integration
>   lane (skips without `DATABASE_URL`).
> - **RLS proof** — the tenant-isolation convention is applied to throwaway tables, proven through a
>   non-owner role, then removed. It surfaced two real defects, both fixed and documented in
>   `docs/07-engineering/DATABASE_CONVENTIONS.md`: the policy requires
>   `NULLIF(current_setting('app.tenant_id', true), '')` (a transaction-local GUC reverts to `''`, not
>   NULL, so on a pooled connection the policy raised instead of matching zero rows); and RLS FORCE does
>   not constrain a superuser, only the table owner.
> - **CI** — smoke lane + `postgres:16` DB lane, now running on pull requests as well as pushes.
>
> **Verification:** build / lint / format clean; smoke 3 suites / 73 assertions; API boots,
> `GET /api/v1/health` → 200, unrouted paths → 404 as `application/problem+json`.
>
> ⚠️ **The RLS proof ran locally on PostgreSQL 15.2** (the only server on the build machine). This PR
> should produce the **first `postgres:16` DB-lane run** — that run is the authoritative confirmation
> and is a **hard precondition for merging Stage 1**.
>
> **Open decision:** the frontend stack is undecided, so `apps/web` is a framework-free shell
> (`OPEN_QUESTIONS.md` #17).

**Not merged.** The repository's approved strategy (`README.md`) requires a reviewed pull request, and
this task does not authorize automatic merging.

**Opening this PR is what triggers the first CI run.** Nothing has run yet: `push` events are scoped to
`main`/`develop`, so pushing feature branches triggered nothing, and the `pull_request` event will fire
both lanes for the first time. Required status checks cannot be selected in GitHub until a run exists —
so the PR must precede branch protection (§11).

## 11. Branch-protection status

**PENDING MANUAL CONFIGURATION — `main` is currently UNPROTECTED.**

Not configurable from here: protection rules are unreachable through plain `git`, and `gh` is not
installed. No protection was weakened (there is none). No claim of active protection is made.

Full specification in **`docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md`**, updated in this task.
Required settings for `main`, as requested:

| Setting | Value |
|---|---|
| Pull request required before merging | **On** |
| Required approvals | **1** minimum |
| Dismiss stale approvals on new commits | On |
| Require conversation resolution | On |
| Required status checks | **`Smoke lane`** *and* **`DB lane`** (the PostgreSQL 16 test) |
| Require branches up to date before merging | On |
| PostgreSQL 16 test required | **Yes — `DB lane`**, now safe to require after the §8 fix |
| Require linear history | On (matches the squash-merge strategy) |
| Force pushes | **Blocked** |
| Branch deletion | **Blocked** |
| Direct pushes | **Restricted** — no direct pushers; everything via reviewed PR |
| Administrator bypass | **Off** (include administrators) — an admin who can both write and approve is the maker-checker hole ADR-007 forbids elsewhere |
| Signed commits | Off for now — turning it on before every contributor has working keys blocks all merges |

**Ordering constraint:** GitHub only offers checks it has actually seen, so the checks cannot be marked
required until the PR (§10) has run CI once.

## 12. Security status

| Item | Status |
|---|---|
| Token in committed history | ✅ **0 matches across every commit on every ref** — re-confirmed |
| Token in tracked working tree | ✅ 0 matches |
| Token in `.git/config` | ✅ 0 (removed; not re-introduced to enable the push) |
| Remote URL | ✅ credential-free |
| History rewritten | ✅ No — and none was needed |
| Stage 0 commits preserved | ✅ All |
| **Compromised PAT revoked** | ❌ **OUTSTANDING — see C1** |

The token beginning `ghp_0jL…` was embedded in the remote URL and a copy sat in
`C:\Windows\System32\finapp-dynamics\.git\config` (deleted 2026-07-15). `System32` is readable by every
local account on that machine, so the token must be treated as leaked. **Restoring write access by
granting `wacherakelvin` repository access does not revoke it.** It remains live until explicitly
revoked on GitHub.

## 13. Files created or modified in this update

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | DB-lane gate removed; fail-closed `DATABASE_URL` guard + PostgreSQL 16 version assertion added |
| `docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` | Caveat resolved (Option A applied); both lanes required; checklist updated |
| `docs/build/stages/PRE_STAGE_1_BASELINE_AND_GITHUB_GOVERNANCE_COMPLETION.md` | This report |

**No application code, manifest, or architecture document was modified.** No Stage 1 implementation:
no `m01-tenant`, authentication, RBAC, audit, APIs, migrations or business functionality.

Commits on `feature/stage-0-foundation`:

| Commit | Message |
|---|---|
| `1a3795c` | `feat(stage-0): scaffold monorepo, kernel, migration runner, and test harness` |
| `6b7692d` | `chore: normalise line endings to LF via .gitattributes` |
| `8e55cdf` | `chore(stage-0): finalize repository baseline` ← **`stage-0-complete`** |
| `f5e56ce` | `docs(stage-0): add pre-Stage 1 baseline and GitHub governance report` |
| `2fee15e` | `fix(ci): run the PostgreSQL 16 database lane on pull requests too` |

## 14. Remaining manual actions

### C1 — Revoke the compromised PAT · Owner: repository owner · **Immediately** · **Not done**

`https://github.com/settings/tokens` on the issuing account → revoke the token beginning `ghp_0jL…`.

*Why it is still open:* write access was restored by granting `wacherakelvin` access, which does not
touch the leaked token. It remains valid, with whatever scopes it was issued with, to anyone who had
local access to that machine.
*Mitigation:* it is no longer in this repository's configuration. That limits future accidental reuse;
it does nothing about a copy already taken.
*Note:* GCM may have cached this same token. If pushes start prompting after revocation, that is
expected — re-authenticate with a new credential. **Do not put it back in the remote URL** (see R6).

### C2 — Open the Stage 0 pull request · Owner: engineer · Next

Use the link in §10. This triggers the first CI run, which C4 and C5 both depend on.

### C3 — Review and merge Stage 0 · Owner: reviewer · After C2 and green CI

Not automatic. Squash-merge per `README.md`.

### C4 — Configure branch protection on `main` · Owner: repository admin · After the first CI run

Follow `docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` §7. Add **both** `Smoke lane` and
`DB lane` as required checks.

### C5 — Confirm the first successful `postgres:16` DB-lane run · Owner: engineer · **Before merging Stage 1**

Non-negotiable. Stage 1 creates the first real tenant tables that depend on the RLS convention, and that
convention has only ever been proved on PostgreSQL 15.2. The PR in C2 should produce this run; check the
**Assert PostgreSQL 16** step's log for `server_version_num=16xxxx`.

### C6 — Decide the `develop` branch · Owner: engineering lead · Before Stage 1 merges

`README.md` describes a trunk-based flow with a long-lived `develop`, which does not exist on the
remote. Either create and protect it, or update `README.md` to match reality. Low urgency; the CI
workflow already references it.

### C7 — Decide the frontend stack · Owner: product/engineering · Before Stage 2

`OPEN_QUESTIONS.md` #17. Needs an ADR.

## 15. Known limitations

1. **PostgreSQL 16 has still never run** — locally or in CI. The authoritative confirmation of the RLS
   convention does not yet exist. It should appear on the first PR.
2. **The DB lane's guards are unproven in CI.** The `DATABASE_URL` check and the version assertion are
   straightforward shell, and the workflow parses, but they have not executed — CI has never run. If the
   first PR run fails inside those steps, that is where to look.
3. **Branch protection is documented, not active.** `main` is unprotected right now.
4. **`gh` is not installed**, so PR creation and protection configuration remain manual.
5. **This report post-dates the tag.** `stage-0-complete` → `8e55cdf` does not contain this report or
   the CI fix. Intended: the tag marks the verified toolchain baseline, not the governance paperwork.
   Stage 1, branched from the tag, will receive both when Stage 0 merges to `main` and Stage 1 syncs.
6. **The GCM-cached credential is opaque.** It may be the compromised PAT (§12).
7. **`develop` does not exist** on the remote (C6).

## 16. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | The compromised PAT is never revoked and is used by a third party | **High** | **C1, immediately.** Highest residual risk in this report. Access being restored makes it *easy to forget* — the symptom that prompted the work is gone while the exposure is not. |
| R2 | Stage 1 merges without a `postgres:16` DB-lane run | **Medium–High** | C5. Stage 1 creates the first tenant tables; RLS is the only thing keeping tenants apart and it has only been proved on 15.2. |
| R3 | `main` stays unprotected and Stage 1 is pushed directly to it | Medium | C4. `wacherakelvin` now has write access and nothing mechanically prevents a direct push to `main`. Only convention protects it today. |
| R4 | Someone "fixes" a future auth failure by re-embedding a token in the remote URL | **High** | Explicitly prohibited — this is exactly how the current exposure happened. Use GCM or SSH. |
| R5 | Stage 0 PR merges without the DB lane green | Medium | C4 makes it mechanical rather than a matter of discipline. |
| R6 | Frontend stack decided implicitly by the first UI commit | Low (now) | C7, before Stage 2. |

## 17. Final recommendation

### CONDITIONAL GO

**Stage 1 (`m01-tenant`) may begin on `feature/stage-1-saas-foundation`** — verified to be based exactly
on `stage-0-complete`, containing no Stage 1 code, and now backed up on GitHub.

Satisfied:

- ✅ Stage 0 gates pass (build, lint, format, smoke — re-verified after the CI change)
- ✅ Working tree clean; all Stage 0 commits preserved; no history rewritten
- ✅ Remote is credential-free and stayed that way through the pushes
- ✅ No credential in any commit — confirmed across all refs
- ✅ Write access verified before pushing
- ✅ Stage 0 branch, `stage-0-complete`, and the Stage 1 branch are pushed and verified against the remote
- ✅ The CI DB-lane defect is fixed, and the lane is now strictly stronger
- ✅ Branch protection has a complete, approved manual action plan
- ✅ No unresolved security blocker *in the repository*

Outstanding conditions:

| # | Condition | Owner | Required by |
|---|---|---|---|
| C1 | **Revoke the compromised PAT** | Repository owner | **Immediately** |
| C2 | Open the Stage 0 pull request | Engineer | Next — it triggers the first CI run |
| C3 | Review and merge Stage 0 | Reviewer | After green CI |
| C4 | Configure branch protection on `main` | Repository admin | After the first CI run |
| C5 | **First successful `postgres:16` DB-lane run** | Engineer | **Before merging Stage 1 to `main`** |
| C6 | Decide the `develop` branch | Engineering lead | Before Stage 1 merges |
| C7 | Decide the frontend stack | Product/engineering | Before Stage 2 |

**Not GO**, because two governance outcomes this task exists to produce are not in place: `main` is
unprotected, and the PostgreSQL 16 lane — the authoritative proof of the tenant isolation everything
else rests on — has never run. Both depend on a pull request that only a human can open from here.

**Not NO-GO**: every NO-GO trigger was checked and none is present. No credential was committed; history
is intact; Stage 0 verification passes; the baseline is identified, tagged, and pushed; the working tree
has no unexplained changes; the remote is correct; no Stage 0 commits are missing; and the tag points at
the intended commit.

**Do not merge Stage 1 to `main` until C5 has passed.**
