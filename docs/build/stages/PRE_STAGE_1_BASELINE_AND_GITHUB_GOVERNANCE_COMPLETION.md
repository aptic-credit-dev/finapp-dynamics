# Pre-Stage 1 — Stage 0 Baseline, GitHub Security and Branch Governance

**Completion report** · Date: 2026-07-15 · Task: repository governance and security only (no Stage 1
implementation).

## Verdict: CONDITIONAL GO

Stage 1 may begin **locally**. Nothing can reach GitHub yet: the configured Git identity does not have
write access to the repository, and the credential that previously provided it was a Personal Access
Token embedded in the remote URL, which is compromised and has been removed. See §19 and §27.

No secret was ever committed. No history was rewritten. All Stage 0 commits are preserved.

---

## 1. Repository root

`C:/Users/HP/dev/finapp-dynamics`

## 2. Initial branch

`feature/stage-0-foundation`

## 3. Initial commit

`6b7692d` — *chore: normalise line endings to LF via .gitattributes*

## 4. Working-tree status

Clean at start (no uncommitted changes, no untracked non-ignored files). No merge, rebase, cherry-pick
or bisect in progress. HEAD attached to a branch, not detached.

Clean at end.

## 5. Stage 0 verification results

Re-run in this task against the current tree:

| Gate | Command | Result |
|---|---|---|
| Install | `npm install` | 0 vulnerabilities |
| Lint | `npm run lint` | **clean** |
| Build | `npm run build` | **clean** |
| Format | `npm run format:check` | **clean** |
| Smoke lane | `npm run test:smoke` | **3 suites / 73 assertions passing** |
| Whitespace / conflict markers | `git diff --check` | **clean** |

Re-verified a second time after the `.gitignore` change in §23. Still clean.

## 6. PostgreSQL version used for local DB verification

**PostgreSQL 15.2** — and **not re-run in this task**, deliberately.

The RLS convention proof (`tools/migrate/test/rls-convention.db-spec.ts`, 1 spec / 26 assertions) was
executed in the previous session against PostgreSQL 15.2, the only server available on this machine
(binaries bundled with an unrelated application at `C:\ZKBioTime\pgsql\bin`). Docker Desktop is
installed but its daemon is not running, and nothing listens on 5432. There is no PostgreSQL 16 on this
machine.

Per the task instruction, PostgreSQL 15 was **not** substituted again as certification. RLS FORCE, the
`tenant_isolation` policy, and composite-FK semantics are identical on 15 and 16, so the earlier proof
is real — but it is not the certification the platform targets.

## 7. PostgreSQL 16 CI status

**Configured, never run.**

`.github/workflows/ci.yml` line 45 pins `image: postgres:16` for the `db` job. The workflow has never
executed, because nothing has ever been pushed to the remote from this repository state.

**The first successful `postgres:16` DB-lane run is a hard precondition for merging Stage 1 to `main`.**

⚠️ **Defect found in the DB lane's trigger.** The `db` job is gated `if: github.event_name == 'push'`,
so it does **not** run on pull requests. Two consequences:

- Marking `DB lane` a required status check as-is would block every PR forever on a check that can never
  report.
- An RLS regression introduced in a PR is caught only *after* merge.

Not changed unilaterally — it is a CI policy decision. Both options are written up in
`docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` §2.

## 8. Secret-scan summary

| Scope | Patterns | Result |
|---|---|---|
| All commits, all refs (`git rev-list --all`) | `ghp_`, `github_pat_`, `gho_/ghs_/ghu_/ghr_` | **0 matches** |
| All commits, all refs | private keys, `Authorization: Bearer`, `AKIA…`, `xox[baprs]-` | **0 matches** |
| Tracked working tree | GitHub tokens, AWS keys, private keys | **0 matches** |
| Untracked, non-ignored files | — | none exist |
| `.env` on disk | — | does not exist; `.env` is not tracked |
| CI workflow / docs | hardcoded credentials | none |
| Local `.git/config` | `ghp_…` | **1 match — see §9** |

Three files matched a broad `password=` / connection-string pattern. All three were inspected and are
**benign, not credentials**:

| File | Match | Assessment |
|---|---|---|
| `.env.example` | `postgres://finapp:finapp@localhost:5432/finapp_dev` | Placeholder in an example file, localhost, no real credential. |
| `.github/workflows/ci.yml` | `POSTGRES_PASSWORD: finapp` | Password of an ephemeral GitHub Actions service container, reachable only from that job. Standard practice. |
| `packages/kernel/test/kernel.smoke.ts` | `password=hunter2` | Deliberate test fixture. The assertion proves `ProblemError.toJSON()` never serialises `cause` to the wire — i.e. it is the test that stops secrets leaking. |

## 9. Token-bearing remote found?

**Yes.** `origin` was configured as:

```text
https://ghp_****REDACTED****@github.com/aptic-credit-dev/finapp-dynamics.git
```

The token was present in **local `.git/config` only**. `.git/` is never tracked by Git.

## 10. Was the remote sanitized?

**Yes.**

```text
before: https://****REDACTED****@github.com/aptic-credit-dev/finapp-dynamics.git
after:  https://github.com/aptic-credit-dev/finapp-dynamics.git
```

Owner and repository were derived from the existing remote, not invented. Verified afterwards: the
remote contains no `@`, no PAT, no username/password, no query-string credentials. Residual token
references in `.git/config`: **0**.

## 11. Was a token committed?

**No — confirmed, not assumed.**

- Matches across every commit on every ref: **0**
- Matches in the tracked working tree: **0**
- Matches in local `.git/config` before sanitisation: 1 (now 0)

**Therefore no history rewrite was required, and none was performed.** All Stage 0 commits are preserved
byte-for-byte. This is the difference between a config problem and a NO-GO security blocker, and it is
firmly the former.

⚠️ The token must still be treated as **compromised**: a copy of it sat in
`C:\Windows\System32\finapp-dynamics\.git\config` (deleted 2026-07-15). `System32` is readable by every
local account on the machine. Removing it from the URL does not un-expose it. **It must be revoked.**

## 12. Current credential-helper status

| Item | Status |
|---|---|
| `credential.helper` (local) | `manager` — Git Credential Manager |
| `credential.helper` (global) | not set |
| GitHub CLI (`gh`) | **not installed** (not auto-installed — outside approved conventions) |
| SSH keys | `~/.ssh/id_rsa` exists, but `ssh -T git@github.com` → **Permission denied (publickey)**. The key is not registered with GitHub. |
| Configured Git identity | `wacherakelvin <kellyviny605@gmail.com>` |
| GitHub **read** access | ✅ works — `git ls-remote` succeeds non-interactively via GCM |
| GitHub **write** access | ❌ **403 — `Permission to aptic-credit-dev/finapp-dynamics.git denied to wacherakelvin`** |

**Root cause.** The embedded PAT *was* the working write credential. With it removed, Git falls back to
the GCM-stored identity `wacherakelvin`, which can read but not write `aptic-credit-dev/finapp-dynamics`.
The token was not re-added: it is compromised, and reuse is explicitly prohibited.

## 13. Stage 0 branch push status

**❌ BLOCKED — not pushed.**

```text
$ git push -u origin feature/stage-0-foundation
remote: Permission to aptic-credit-dev/finapp-dynamics.git denied to wacherakelvin.
fatal: ... The requested URL returned error: 403
```

No force push was attempted. Verified afterwards: the remote has **0** `stage-0` branches — the failed
push left no partial state.

## 14. Stage 0 tag name and commit

| | |
|---|---|
| Tag | `stage-0-complete` (annotated) |
| Commit | **`8e55cdf`** — *chore(stage-0): finalize repository baseline* |
| Pre-existing? | No — verified absent locally and on the remote before creation |
| Points at verified HEAD? | ✅ asserted programmatically (`tag^{commit}` == `HEAD`) |

The tag message records the verification results and the PostgreSQL 15.2-vs-16 caveat.

## 15. Tag push status

**❌ BLOCKED — not pushed.** Same 403 as §13.

## 16. Default branch status

| | |
|---|---|
| Default branch | `main` |
| `main` at | `cf79043` — *Complete handover package* |
| `origin/main` at | `cf79043` (identical) |
| Stage 0 merged into `main`? | **No** |
| Stage 0 ahead of `main` by | 3 commits (`1a3795c`, `6b7692d`, `8e55cdf`) |

`main` was **not** fast-forwarded or merged. The repository's approved strategy (`README.md`) requires a
reviewed pull request, and this task does not authorize bypassing it.

## 17. Pull-request status

**Not created.** Two independent blockers:

1. `gh` is not installed, and installing it was not approved.
2. Even with `gh`, a PR needs the source branch on the remote — and the push is 403-blocked (§13).

The PR must be opened manually once §19.1–19.2 are resolved. Suggested content is in §19.4.

## 18. Branch-protection status

**PENDING MANUAL CONFIGURATION.** `main` is currently **unprotected**.

Protection rules are not reachable through plain `git`, and `gh` is unavailable. Full specification —
required checks, PR requirements, force-push and deletion policy, admin bypass, and step-by-step GitHub
UI instructions — is in **`docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md`**.

No existing protection was weakened (there is none to weaken). No claim of active protection is made.

## 19. Required manual GitHub actions

Ordered. 19.1 and 19.2 are blocking.

### 19.1 — Revoke the compromised PAT · Owner: repository owner · **Immediately**

Go to `https://github.com/settings/tokens` (on the account that issued it — the URL suggests
`aptic-credit-dev`) and **revoke** the token beginning `ghp_0jL…`.

*Why:* a copy sat in world-readable `C:\Windows\System32\finapp-dynamics\.git\config`. Assume it leaked.
It grants whatever scopes it was created with, to anyone who had local access to that machine.
*Mitigation until done:* the token is no longer in this repository's config, and the local SSH key has
no GitHub access — but that does not protect against anyone who already copied it.
*Note:* GCM may have cached this same token. If pushes start failing with a credential prompt after
revocation, that is expected — re-authenticate per 19.2.

### 19.2 — Restore write access without an embedded token · Owner: repository owner · **Before any push**

Pick one:

- **(a) Grant `wacherakelvin` write access** to `aptic-credit-dev/finapp-dynamics`
  (Settings → Collaborators). Simplest if that is the intended committer identity. Note the configured
  Git identity is `wacherakelvin <kellyviny605@gmail.com>` — confirm that is who should author Stage 1.
- **(b) Authenticate as an account that already has write access.** Create a *new* fine-grained PAT
  (Contents: Read and write) and let **Git Credential Manager** store it when prompted. **Do not put it
  in the remote URL.** Clear the stale entry first:
  `git credential-manager erase` (or remove `git:https://github.com` in Windows Credential Manager).
- **(c) Use SSH.** Add `~/.ssh/id_rsa.pub` to the account with write access, then
  `git remote set-url origin git@github.com:aptic-credit-dev/finapp-dynamics.git`. Verify with
  `ssh -T git@github.com`.

*Verify:* `git push --dry-run origin feature/stage-0-foundation` exits 0.

### 19.3 — Push the branch and tag · Owner: engineer · After 19.2

```bash
git push -u origin feature/stage-0-foundation
git push origin stage-0-complete
git push -u origin feature/stage-1-saas-foundation   # optional; currently identical to the tag
```

No force. Confirm remote HEAD matches local `8e55cdf`.

### 19.4 — Open the Stage 0 pull request · Owner: engineer · After 19.3

Title: `Stage 0: Repository and toolchain foundation`

Body should cover: monorepo scaffolding (npm workspaces, TS project references); kernel (DI tokens,
RequestContext, ProblemError, `@Endpoint`, ambient-transaction `Db`); contracts (empty typed event
union); migration runner and test harness; the RLS convention proof; CI; the Stage 0 verification
results (§5); the **PostgreSQL 16 CI requirement** (§7); and the undecided frontend stack
(`OPEN_QUESTIONS.md` #17).

### 19.5 — Configure branch protection · Owner: repository admin · After the first CI run

Follow `docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md`. Required checks only become selectable
after CI has run once, so this necessarily follows 19.4.

### 19.6 — Decide the DB-lane trigger · Owner: engineering lead · Before requiring the check

See §7 and the recommendation doc §2. Recommended: make the DB lane run on pull requests, then require
it.

### 19.7 — Confirm the first `postgres:16` DB-lane run · Owner: engineer · **Before merging Stage 1**

Non-negotiable. Stage 1 creates the first real tenant tables that depend on the RLS convention.

## 20. Stage 1 branch name

`feature/stage-1-saas-foundation`

## 21. Stage 1 branch base commit

**`8e55cdf`** — created directly from the `stage-0-complete` tag
(`git switch -c feature/stage-1-saas-foundation stage-0-complete`).

Asserted: `HEAD` == `stage-0-complete^{commit}`, and `git diff stage-0-complete..HEAD` is **empty** —
the branch contains no Stage 1 code. No pre-existing Stage 1 branch was found or overwritten.

## 22. Stage 1 branch push status

**❌ BLOCKED** — same 403 (§13). Exists locally only.

## 23. Files created or modified

Created (2):

| File | Purpose |
|---|---|
| `docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` | Branch-protection specification, pending manual application |
| `docs/build/stages/PRE_STAGE_1_BASELINE_AND_GITHUB_GOVERNANCE_COMPLETION.md` | This report |

Modified (1):

| File | Change |
|---|---|
| `.gitignore` | Re-include `docs/build/` |

**Why `.gitignore` changed.** The existing `build/` pattern matches a directory named `build` at *any*
depth, so it silently ignored `docs/build/` — the stage build records. The governance documents this
task is required to produce would have appeared to exist locally while being invisible to Git and
unable to reach GitHub. `docs/build/` is now explicitly re-included; `dist/`, `out/` and
`node_modules/` were verified to remain ignored.

**No application code, CI behaviour, manifest or architecture document was modified by this task.**

Commits added to `feature/stage-0-foundation`:

- `8e55cdf` — `chore(stage-0): finalize repository baseline` (branch-protection doc + `.gitignore` fix)
- one further commit adding this report (created after the tag — see §25).

## 24. Commands and checks performed

Read-only verification: `pwd`, `git rev-parse --show-toplevel`, `git status --short --branch`,
`git branch --show-current`, `git branch -a`, `git log --oneline --decorate -10`, `git remote -v`,
`git tag --list`, in-progress-operation probes, detached-HEAD probe.

Secret scanning: `git grep -I -l -E <patterns> $(git rev-list --all)` (token, private-key, bearer, AWS,
Slack patterns), tracked-tree grep, `git ls-files --others --exclude-standard`,
`git ls-files --error-unmatch .env`, targeted inspection of every pattern match.

Remote: `git config --get remote.origin.url` (redacted), `git remote set-url origin <clean>`,
`git remote -v`, credential-free assertion.

Auth: `git config --get credential.helper`, `ssh -T git@github.com`, `git ls-remote --heads origin`,
`git push --dry-run`.

Quality gates: `npm install`, `npm run verify`, `npm run format:check`, `git diff --check`.

Baseline: `git tag -a stage-0-complete`, `git show --no-patch --decorate stage-0-complete`,
tag-equals-HEAD assertion, `git switch -c feature/stage-1-saas-foundation stage-0-complete`,
base-equality and empty-diff assertions.

Push attempts (all non-force, all 403): branch, tag.

## 25. Known limitations

1. **Nothing reached GitHub.** Branch, tag and PR are local only. The remote is unchanged at `cf79043`.
2. **The DB lane was not re-run in this task**, by instruction — no PostgreSQL 16 is available, and
   PostgreSQL 15 was not to be substituted again as certification.
3. **PostgreSQL 16 has never run**, locally or in CI. The RLS convention's authoritative confirmation
   does not yet exist.
4. **Branch protection is documented, not active.** `main` is currently unprotected.
5. **`gh` is not installed**, so PR creation and protection configuration could not be automated.
6. **This report post-dates the tag.** `stage-0-complete` points at `8e55cdf`, which contains the
   branch-protection recommendation but not this report — a report cannot describe the push and tag
   results from inside the commit it describes. `feature/stage-1-saas-foundation` is branched from the
   tag and therefore does not carry this report; it will arrive there when Stage 0 merges to `main` and
   Stage 1 syncs. The tag points at the verified toolchain baseline, which is what it should mark.
7. **The GCM-cached credential is opaque.** It may be the compromised PAT. If so, revoking it (19.1)
   will break the cached read access until re-authentication (19.2) — expected, not a regression.
8. **`develop` does not exist** on the remote, though `README.md` describes a trunk-based flow using it.
   Not created — out of scope for this task.

## 26. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | The compromised PAT is not revoked and is used by a third party | **High** | 19.1, immediately. Exposure is real: it sat in world-readable `System32`. Removing it from the config does not un-expose it. |
| R2 | Stage 1 work accumulates locally with no remote backup | **Medium** | 19.2 + 19.3 before Stage 1 begins in earnest. Until then the baseline exists on exactly one machine, and the tag is the only marker of it. |
| R3 | Stage 1 merges without a `postgres:16` DB-lane run | **Medium–High** | 19.7. Stage 1 creates the first real tenant tables; the RLS convention is the thing keeping tenants apart, and it has only ever been proved on 15.2. |
| R4 | `DB lane` marked required while it never runs on PRs | Medium | §7 and the recommendation doc §2 — decide the trigger before requiring the check, or every PR deadlocks. |
| R5 | `main` stays unprotected and Stage 1 is pushed directly to it | Medium | 19.5. Until then only convention protects `main`. |
| R6 | Someone "fixes" the 403 by re-embedding a token in the remote URL | **High** | Explicitly prohibited. This is exactly how the current exposure happened. Use GCM or SSH (19.2). |
| R7 | Frontend stack decided implicitly by the first UI commit | Low (now) | `OPEN_QUESTIONS.md` #17; needs an owner and an ADR before Stage 2. |

## 27. Recommendation

### CONDITIONAL GO

**Stage 1 (`m01-tenant`) may begin locally on `feature/stage-1-saas-foundation`, which is verified to be
based exactly on the `stage-0-complete` baseline.**

Satisfied:

- ✅ Stage 0 gates pass (build, lint, format, smoke — re-verified twice)
- ✅ Working tree clean; all Stage 0 commits preserved; no history rewritten
- ✅ The insecure remote is removed and verified credential-free
- ✅ No credential exists in any commit — confirmed across all refs, not assumed
- ✅ `stage-0-complete` exists and provably points at the verified HEAD
- ✅ The Stage 1 branch exists from the correct baseline, with no Stage 1 code
- ✅ Branch protection has an approved manual action plan
- ✅ No unresolved *security blocker in the repository* (the token was never committed)

Outstanding conditions — each with owner, action and deadline in §19:

| # | Condition | Owner | Required by |
|---|---|---|---|
| C1 | Revoke the compromised PAT (19.1) | Repository owner | **Immediately** |
| C2 | Restore write access without an embedded token (19.2) | Repository owner | Before any push |
| C3 | Push branch + tag (19.3) | Engineer | Before Stage 1 work is worth protecting |
| C4 | Open the Stage 0 PR (19.4) | Engineer | Before merging Stage 0 |
| C5 | Configure branch protection (19.5) | Repository admin | After the first CI run |
| C6 | Decide the DB-lane trigger (19.6) | Engineering lead | Before requiring the check |
| C7 | First successful `postgres:16` DB-lane run (19.7) | Engineer | **Before merging Stage 1 to `main`** |

**Not GO**, because the baseline is not recoverable off this machine: the whole point of this task was a
*protected and recoverable* baseline, and a branch and tag that exist on one laptop are neither. C1 and
C2 are the blocking pair.

**Not NO-GO**, because every NO-GO trigger was checked and none is present: no credential was committed,
history is intact and unrewritten, Stage 0 verification passes, the baseline commit is identified and
tagged, the working tree has no unexplained changes, the remote points at the correct repository, and no
Stage 0 commits are missing.

**Do not merge Stage 1 to `main` until C7 has passed.**
