# Post-Stage 0 Merge — Stage 1 Branch Alignment and Final Readiness

**Readiness report** · Created 2026-07-15 · **Updated 2026-07-15 (Stage 0 merged; alignment completed)**
Task: verification, branch alignment and tag governance only. No Stage 1 implementation.

## Verdict: GO for Stage 1 implementation

Stage 0 is merged, certified on PostgreSQL 16, and `feature/stage-1-saas-foundation` is aligned exactly
to `main` with zero divergence and no Stage 1 code.

**One condition remains and it does not block Stage 1 work:** branch protection on `main` is **not
enabled** (`"protected": false`, confirmed via the GitHub API). It is required before Stage 1 *merges*.
The compromised PAT also still needs revoking — unrelated to Stage 1 readiness, but still open.

> **Supersedes the previous revision of this file.** That revision recorded a NO-GO because `main` did
> not contain Stage 0 and no pull request existed. Both have since been resolved: PR #1 was opened,
> passed both CI lanes, and merged. The realignment refused then is completed now, and — because the
> merge preserved history — it required **no reset and no force push**.

---

## 1. Repository and remote state

| Check | Result |
|---|---|
| Repository | ✅ Finapp Dynamics, `C:/Users/HP/dev/finapp-dynamics` |
| Remote | ✅ `https://github.com/aptic-credit-dev/finapp-dynamics.git` — **credential-free** |
| Working tree | ✅ clean (0 uncommitted) |
| Merge / rebase / cherry-pick in progress | ✅ none |
| Repository visibility | ⚠️ **public** — see §8/R3 |
| Default branch | `main` |

## 2. Stage 0 pull request and merge method

| Item | Value |
|---|---|
| Pull request | **#1** — *Stage 0: Repository and toolchain foundation* |
| Base ← head | `main` ← `feature/stage-0-foundation` |
| State | **closed, merged: true** |
| **Merge method** | **True merge commit** |
| Merge commit | **`eb54903`** — *Merge pull request #1 from aptic-credit-dev/feature/stage-0-foundation* |
| Parents | `cf79043` (previous main) + `e2cde7f` (PR head) — **2 parents** |

**How the method was determined, not assumed:** `eb54903` has two parents, and every original Stage 0
commit (`1a3795c`, `6b7692d`, `8e55cdf`, `f5e56ce`, `2fee15e`, `e2cde7f`) is an ancestor of `main`. A
squash merge would have produced one parent and one new commit with no original SHAs reachable; a rebase
merge would have produced rewritten SHAs and no merge commit. Neither is the case.

This matters directly: because the original commits survive, `stage-0-complete` (`8e55cdf`) is still
reachable from `main`, and the Stage 1 alignment reduces to a fast-forward (§5).

## 3. Final `main` commit

**`eb54903`**

`main`'s tree is `198bba4…`, **byte-identical** to `origin/feature/stage-0-foundation`'s tree. The merge
took everything; nothing was dropped.

> **Correction to an intermediate finding.** During this task an early check reported
> `.github/workflows/ci.yml` as ABSENT from `main`. **That was a false negative in the check, not a
> defect in the repository.** Git Bash's MSYS path conversion mangled the argument
> `origin/main:.github/workflows/ci.yml` into `origin\main;.github\workflows\ci.yml`, so `git cat-file`
> failed on a malformed object name. Confirmed present by `git ls-tree`, by `git show` with
> `MSYS_NO_PATHCONV=1`, and conclusively by the identical tree SHAs above. The workflow on `main` is the
> corrected version: no `github.event_name == 'push'` gate, `postgres:16` pinned, and both the
> `DATABASE_URL` guard and the `Assert PostgreSQL 16` step present.

## 4. CI results and PostgreSQL certification

**Both lanes passed, on the pull request and on `main`.** Evidence read from the GitHub API (the
repository is public, so no credential was used):

| Run | Event | Head | Smoke lane | DB lane |
|---|---|---|---|---|
| `29410674628` | **`pull_request`** | `e2cde7f` (PR #1 head) | ✅ PASS | ✅ **PASS** |
| `29410735376` | `push` | `eb54903` (`main`) | ✅ PASS | ✅ **PASS** |

### PostgreSQL version certified: **16** ✅

The DB lane's steps on `main` (run `29410735376`), all `success`:

```text
  ok  Initialize containers
  ok  Run npm ci
  ok  Run npm run build
  ok  Assert the database lane can actually run     <- DATABASE_URL non-empty + pg_isready
  ok  Assert PostgreSQL 16                          <- server_version_num asserted 16.x
  ok  Migrations (dry run — ordering and checksums)
  ok  Migrations
  ok  DB integration specs                          <- the RLS convention proof
```

This is the certification that did not exist in every previous report. Three things worth stating
plainly:

1. **The RLS convention is now proven on PostgreSQL 16**, not only on the local 15.2 it was originally
   developed against. The long-standing caveat is discharged.
2. **`Assert PostgreSQL 16` passed**, so the version is asserted from `server_version_num` rather than
   inferred from the `postgres:16` image tag. The claim is checkable, not merely plausible.
3. **The DB lane ran on a `pull_request` event** — run `29410674628`. That was impossible before commit
   `2fee15e` removed the `if: github.event_name == 'push'` gate. The fix is confirmed working in
   practice, and `DB lane` is now safe to mark as a required status check.

## 5. Stage 1 branch alignment

| Item | Value |
|---|---|
| **Old commit** | **`8e55cdf`** (`chore(stage-0): finalize repository baseline` — the `stage-0-complete` target) |
| **Final commit** | **`eb54903`** (== `origin/main`) |
| **Alignment method** | **Fast-forward merge** (`git merge --ff-only origin/main`), pushed non-force |
| Reset used | ❌ **No** |
| Force push used | ❌ **No** (not even `--force-with-lease`) |
| History rewritten | ❌ **No** |

### Why fast-forward rather than the offered reset

The task permitted a controlled `reset --hard` + `--force-with-lease`. **It was not needed, so it was
not used.** Because Stage 0 merged with a true merge commit, `8e55cdf` is an **ancestor** of `eb54903`:

```text
  git merge-base --is-ancestor origin/feature/stage-1-saas-foundation origin/main  -> YES
  git rev-list --left-right --count origin/main...origin/feature/stage-1-saas-foundation  ->  5  0
```

Five commits on `main` that Stage 1 lacked; **zero** unique commits on Stage 1. That is the definition of
a fast-forward. A reset would have reached the same commit by rewriting the branch and force-pushing —
same destination, strictly more risk and a rewritten ref for no benefit. The safest method that achieves
the objective is the one that changes nothing it does not have to.

Preconditions were proven before acting: no unique Stage 1 implementation; `main` contains all approved
Stage 0 files (identical trees); the target commit is `origin/main` verified live; and the old head
`8e55cdf` remains permanently recoverable via the unmoved `stage-0-complete` tag.

## 6. Alignment verification

```text
$ git rev-list --left-right --count origin/main...feature/stage-1-saas-foundation
0       0

$ git diff --stat origin/main...feature/stage-1-saas-foundation
(no output — no file differences)
```

| Check | Expected | Actual |
|---|---|---|
| Commits ahead / behind | `0 0` | ✅ **`0 0`** |
| File differences | none | ✅ **none** |
| Remote `feature/stage-1-saas-foundation` | == `origin/main` | ✅ `eb54903` |

### No Stage 1 implementation exists

| Check | Result |
|---|---|
| Business `.ts` outside `kernel`/`contracts` | ✅ **0** |
| Migrations (`packages/*/migrations/*.sql`) | ✅ **0** |
| `DomainEvent` union | ✅ still `never` (line 22, `packages/contracts/src/events.ts`) |
| `DOMAIN_EVENT_FAMILIES` | ✅ still `[]` |
| `@Endpoint(...)` applications (business routes) | ✅ **0** |
| Kernel tokens bound in `AppModule` | ✅ **0** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` still deliberately unbound |
| Permissions / audit codes added | ✅ none |

### The branch now carries the final governance state

Confirmed present on the aligned branch: the CI DB-lane fix (no push-only gate), and both governance
reports under `docs/build/stages/`. This is what the alignment was for — before it, Stage 1 sat at the
pre-governance tag and lacked the CI correction.

### Baseline verification on the aligned branch

| Gate | Result |
|---|---|
| `npm install` | ✅ 0 vulnerabilities |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ clean |
| `npm run format:check` | ✅ clean |
| `npm run test:smoke` | ✅ **3 suites / 73 assertions passing** |

## 7. Tag governance

| Tag | Target | Represents | Action |
|---|---|---|---|
| **`stage-0-complete`** | `8e55cdf` | The **original verified toolchain baseline**. Predates the CI correction and the governance reports. | ✅ **Not moved, not replaced, not force-updated** |
| **`stage-0-governed-complete`** | **`eb54903`** | The **complete governed Stage 0 state**: reviewed, merged via PR #1, and certified green on PostgreSQL 16. | ✅ **Created (annotated) and pushed without force** |

Both are annotated, both are on the remote, and the two answer different questions on purpose: what the
toolchain looked like when it was first proven, versus what was actually approved and certified.

`stage-0-governed-complete` was created only after confirming all four required preconditions — Stage 0
merged (PR #1 → `eb54903`), CI passed, PostgreSQL 16 passed (`Assert PostgreSQL 16`), and the tag points
at the final approved `main` commit. In the previous revision this tag was **refused**, because at that
point none of those were true and the tag would have asserted a review and a certification that had
never happened.

## 8. Branch-protection status

**❌ NOT ENABLED. `main` is unprotected.**

Confirmed from GitHub, not inferred:

```text
GET /repos/aptic-credit-dev/finapp-dynamics/branches/main  ->  "protected": false
GET .../branches/main/protection                           ->  HTTP 401 (needs admin auth)
```

This is now the **only** governance item outstanding, and the blocker that previously prevented it is
gone: required status checks can only be selected once GitHub has observed a workflow run, and both
`Smoke lane` and `DB lane` have now run and passed twice. **They are selectable today.**

Exact remaining manual action — a repository admin, at
`https://github.com/aptic-credit-dev/finapp-dynamics/settings/branches`, per
`docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` §7:

| Setting | Value |
|---|---|
| Require a pull request before merging | On |
| Required approvals | 1 minimum |
| Dismiss stale approvals on new commits | On |
| Require conversation resolution | On |
| Required status checks | **`Smoke lane`** *and* **`DB lane`** (both now selectable) |
| Require branches up to date before merging | On |
| Require linear history | On |
| Block force pushes | On |
| Block branch deletion | On |
| Restrict direct pushes | On |
| Do not allow bypassing (include administrators) | On |
| Require signed commits | Off for now |

## 9. Commands and checks performed

Verification: `git fetch --all --tags --prune`, `git status --short --branch`, `git remote -v` +
credential-free assertion, in-progress-operation probes, `git log --oneline --decorate --graph --all`,
`git ls-remote origin` (live).

Merge determination: `git rev-list --parents -n 1 origin/main` (parent count),
`git merge-base --is-ancestor` for each Stage 0 commit, `git rev-parse origin/main^{tree}` vs
`origin/feature/stage-0-foundation^{tree}`, `git ls-tree -r origin/main`, `git show` with
`MSYS_NO_PATHCONV=1`.

CI evidence (unauthenticated, public repo): `GET /pulls/1`, `GET /commits/{sha}/check-runs` for
`e2cde7f` and `eb54903`, `GET /actions/runs`, `GET /actions/runs/{id}/jobs` (per-step conclusions),
`GET /branches/main`, `GET /repos/...` (visibility).

Divergence: `git rev-list --left-right --count`, `git diff --stat`, `git merge-base --is-ancestor`
(fast-forward eligibility).

Alignment: `git switch main`, `git pull --ff-only origin main`, `git switch
feature/stage-1-saas-foundation`, `git merge --ff-only origin/main`, `git push origin
feature/stage-1-saas-foundation` (non-force).

Tags: `git tag -a stage-0-governed-complete eb54903`, `git push origin stage-0-governed-complete`
(non-force), plus assertions that `stage-0-complete` still resolves to `8e55cdf`.

Baseline: `npm install`, `npm run verify`, `npm run format:check`, Stage 1 absence checks.

**Not run:** `git reset --hard`, `git push --force`, `git push --force-with-lease`, tag deletion or
re-pointing.

## 10. Remaining risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **The compromised PAT (`ghp_0jL…`) is still not confirmed revoked** | **High** | Revoke at `github.com/settings/tokens`. Unchanged across three reports. Write access was restored by granting `wacherakelvin` rights, which does not revoke the leaked token; the symptom is gone while the exposure is not. Not verifiable from here. |
| R2 | `main` is unprotected while Stage 1 development begins | **Medium–High** | §8. `wacherakelvin` has write access and nothing mechanically prevents a direct push to `main`, a force push, or a branch deletion. Both required checks are now selectable — the last excuse for deferring this is gone. |
| R3 | The repository is **public** | Medium | `"visibility": "public"`. The full enterprise architecture, ADRs, security/GRC posture, DB conventions and threat reasoning for a financial platform are world-readable. This may be deliberate; if it is not, it is worth deciding explicitly rather than by default. No credential is exposed by it. |
| R4 | A future auth failure is "fixed" by re-embedding a token in the remote URL | **High** | Prohibited — that is exactly how the original exposure happened. Use GCM or SSH. |
| R5 | Stage 1 merges without review because protection is off | Medium | R2. |
| R6 | Frontend stack decided implicitly by the first UI commit | Low (now) | `OPEN_QUESTIONS.md` #17; needs an ADR before Stage 2. |
| R7 | `develop` does not exist though `README.md` describes a trunk-based flow using it | Low | Create and protect it, or update `README.md` to match reality. The CI workflow already references it. |

## 11. Recommendation

### GO for Stage 1 implementation

`feature/stage-1-saas-foundation` is at `eb54903`, identical to `origin/main`, and Stage 1 (m01-tenant →
m02 → m03 → m06 → m07 → m08 → m09 → m04) may begin on it.

Satisfied:

- ✅ Stage 0 merged into `main` via PR #1 (true merge commit `eb54903`; original history preserved)
- ✅ **Both CI lanes green on the PR and on `main`**
- ✅ **PostgreSQL 16 certified** — `Assert PostgreSQL 16` passed; the RLS convention is proven on the
  targeted version, discharging the 15.2 caveat carried since Stage 0
- ✅ DB lane confirmed running on `pull_request` events — the gate fix works in practice
- ✅ Stage 1 aligned by fast-forward: **`0 0`**, no file differences, no reset, no force, no rewrite
- ✅ Stage 1 carries the final CI and governance state
- ✅ No Stage 1 implementation exists (0 business sources, 0 migrations, empty event union, unbound
  kernel tokens)
- ✅ Baseline green on the aligned branch (build, lint, format, smoke 3 suites / 73 assertions)
- ✅ `stage-0-complete` preserved at `8e55cdf`; `stage-0-governed-complete` created at `eb54903`
- ✅ Remote credential-free; no credential in any commit

Outstanding — neither blocks starting Stage 1:

| # | Action | Owner | Required by |
|---|---|---|---|
| **A1** | **Revoke the compromised PAT** | Repository owner | **Immediately** — independent of Stage 1 |
| **A2** | **Enable branch protection on `main`** (both checks now selectable) | Repository admin | **Before Stage 1 merges.** Do it now — nothing is waiting on it any more. |
| A3 | Decide repository visibility (R3) | Repository owner | At convenience |
| A4 | Decide the `develop` branch (R7) | Engineering lead | Before Stage 1 merges |
| A5 | Decide the frontend stack | Product/engineering | Before Stage 2 |

This is a **GO**, not a CONDITIONAL GO, because every condition that previously gated *starting* Stage 1
is discharged: the baseline is merged, certified on PostgreSQL 16, tagged, aligned, and green. A2 gates
the **merge** of Stage 1, not its start, and it can now be completed at any time.

**Stage 1 must not merge to `main` until A2 is done** — otherwise the certified DB lane it depends on is
advisory rather than enforced.
