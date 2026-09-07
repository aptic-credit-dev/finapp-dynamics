# Stage 7 — B11 SSH Lockdown Certification (Recovered Staging Host)

> Certifies the host SSH-lockdown commissioning control (previously deferred in
> `STAGE_7_TIER1_EVIDENCE_INDEX.md` §2 as "not changed — key-only lockdown belongs in the governed
> commissioning window") as **EXECUTED and behaviourally VERIFIED** on the recovered staging host.
> This is an infrastructure/commissioning evidence record only. It changes no application source, database,
> migration, secret, or deployment configuration, issues no production GO, and does not alter the M42 decision.

- **Control:** B11 — host SSH lockdown (key-only; no root SSH; no password auth) + root password lock.
- **Host:** `vmi3515072` / `169.58.194.151` (recovered Stage-7 staging).
- **Verification timestamp:** `2026-09-07T13:06:49Z` (server UTC).
- **Verifier scope:** read-only confirmation + non-interactive behavioural tests. No SSH config was changed
  during verification (activation was performed earlier by the operator, evidence below).
- **Result: PASS.**

---

## 1. Status transition

| Field | Before | After |
| --- | --- | --- |
| B11 SSH lockdown | PARTIAL / OPEN (drop-in staged, sshd not reloaded — root + password auth still live) | **COMPLETE / PASS** (reload effective; root + password auth denied) |
| Root credential | usable during recovery | **locked** (operator evidence; see §4) |

## 2. Operator activation evidence (performed manually, prior to this verification)

Executed on `169.58.194.151` by the operator; results as reported:

- `sudo sshd -t && sudo systemctl reload ssh && sudo systemctl is-active ssh` → `active`
- `sudo passwd -l root && sudo passwd -S root` → `root L 2026-09-07 0 99999 7 -1` (`L` = password locked)
- deploy subsequently confirmed to log in via SSH and execute `sudo`.

No further SSH configuration changes were made during certification (per instruction: do not re-apply).

## 3. Behavioural tests — decisive evidence (fresh, independent connections)

Non-interactive `BatchMode=yes`, `ConnectTimeout=15`. No password prompted or printed. An authentication
rejection is the expected PASS for the negative tests.

| # | Test | Command (sanitized) | Observed | Result |
| --- | --- | --- | --- | --- |
| A | deploy key login | `ssh -o BatchMode=yes -o IdentitiesOnly=yes deploy@HOST 'whoami'` | `LOGIN_OK user=deploy` | **PASS** |
| B | direct root SSH (must reject) | `ssh -o BatchMode=yes root@HOST true` | `root@HOST: Permission denied (publickey).` | **PASS (rejected)** |
| C | password-only auth (must reject) | `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive -o NumberOfPasswordPrompts=0 deploy@HOST true` | `Permission denied (publickey).` | **PASS (rejected)** |
| D | pre-auth advertised methods | `ssh -v -o PreferredAuthentications=none nobody@HOST true` | `Authentications that can continue: publickey` | **PASS (publickey only)** |

Test D is the authoritative behavioural proof that `PasswordAuthentication` and `KbdInteractiveAuthentication`
are effectively **no** (only `publickey` is offered pre-auth); Test B proves `PermitRootLogin` is effectively
**no**.

## 4. Read-only effective-configuration confirmation

| Requirement | Method (read-only) | Result |
| --- | --- | --- |
| sshd syntax valid | operator `sshd -t` OK + service reloaded and `active` (invalid config would fail reload) | **VALID** |
| SSH service active | `systemctl is-active ssh` | `active` — **PASS** |
| Effective `PermitRootLogin` | behavioural Test B (root rejected) | **no (effective)** — **PASS** |
| Effective `PasswordAuthentication` | behavioural Tests C+D (password not offered) | **no (effective)** — **PASS** |
| Effective `PubkeyAuthentication` | behavioural Test A (deploy key accepted) | **yes (effective)** — **PASS** |
| SSH listening addresses/ports | `ss -tln` | `0.0.0.0:22`, `[::]:22` only; app ports remain `127.0.0.1` — **PASS** |
| deploy account available | Test A login | present, shell `/bin/bash` — **PASS** |
| deploy retains sudo | `id deploy` | `groups=…,27(sudo),…,988(docker)` — **PASS** |
| root password status | operator `passwd -S root` → `root L …` | **locked** — **PASS** (see limitation) |

### Drop-in precedence (no conflicting override)

`Include /etc/ssh/sshd_config.d/*.conf` is at line 12 of `/etc/ssh/sshd_config` — **before** the main file's
`PermitRootLogin yes` (line 42). sshd uses **first-value-wins**, and drop-ins are read in lexical order:

- `00-hardening.conf` (root:root 644) — `PermitRootLogin no` / `PasswordAuthentication no` /
  `KbdInteractiveAuthentication no` / `PubkeyAuthentication yes` → **first match wins for all four**.
- `50-cloud-init.conf` (root:root 600, not world-readable) and `60-cloudimg-settings.conf`
  (`PasswordAuthentication no`) sort **after** `00-hardening.conf` and cannot override it.

Behavioural Test D (only `publickey` advertised) confirms **no included config overrides the lockdown**.

## 5. Auth-log evidence

The `deploy` account is not in `adm`/`systemd-journal`, so `/var/log/auth.log` and the `ssh` unit journal are
not readable without elevation, and none were exposed. Per the "minimum evidence / no sensitive log contents"
requirement, the **behavioural rejections in §3 (root and password denied on live connections)** are recorded as
the authoritative substitute for log scraping. No usernames, source IPs, or credentials from logs are reproduced
here.

## 6. Limitations (honest scope)

- `sshd -t` and `sshd -T` require root; they were not independently re-run during certification (no sudo held
  post-recovery). Effective settings are proven **behaviourally** (§3), which is stronger than reading config
  text, and corroborated by service-active-after-reload.
- Root password `L` status rests on **operator evidence**; `/etc/shadow` and `passwd -S` need root and were not
  re-read. The security outcome is independently proven regardless: with password auth globally disabled and root
  SSH denied, **no interactive root login path exists** even setting the lock aside.
- Security patching for this host was separately assessed (0 security-pocket updates pending;
  `apt-check = 19;0`; no `reboot-required`). Not re-run here.

## 7. Certification

- **B11 SSH lockdown — CLOSED / PASS.**
- **B11 deploy-account recovery — CLOSED.**
- **B11 host-key reconciliation — CLOSED** (on-host ED25519 `SHA256:9SFrQmNvL/OgloQzYpH/+lN4dmTMUCOXqmM9KkEuD58`).
- **B11 root credential remediation — CLOSED** (root password locked; no root/password login path).
- **B11 security patching — CLOSED for identified security updates** (0 pending).
- **B11 overall — CLOSED / PASS.**

Preserved and unchanged by this certification:

- Frozen application baseline `59a894dc4248567611a8ac5baac622f7b7cbf890`.
- **M42 = NO_GO** (independent Stage-6/certification decision; not affected by B11).
- All other Stage-7 exit criteria (pen-test execution, cross-host DR drill, acceptance-grade load/chaos,
  real-data migration) remain `requires_review`.

B11 closing does **not** constitute production readiness or a Stage-7 GO.
