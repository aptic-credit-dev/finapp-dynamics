# Stage 7 — M41 `SecretProviderPort` → OpenBao Adapter Implementation Plan

> The exact plan to bind **M41's `SecretProviderPort` to OpenBao** (ADR-132), preserving every ADR-128 control.
> **Decision for this increment: PLAN ONLY — implementation is intentionally NOT done here**, because a tested
> adapter requires a **live OpenBao instance + out-of-band credentials that do not yet exist**, and this repo does
> not add untested integration code or claim an untested integration works (CLAUDE.md). The plan is precise enough
> that implementation is mechanical once a staging instance is provided. **No secret value, token, or credential is
> created or committed.**

---

## 1. The seam (already in place — inspected, not changed)

- **Port:** `packages/m41-security/src/ports.ts` — `SecretProviderPort`:
  - `provision(ctx, { secretRef, algorithm }) → ProviderOutcome` (opaque `providerRef`, never material)
  - `resolveMetadata(ctx, providerRef) → ProviderMetadata` (availability only, never a value)
  - `destroy(ctx, providerRef) → ProviderOutcome`
- **Default:** `UnavailableSecretProvider` — every op fails closed (`reasonCode:'secret_provider_unavailable'`).
- **DI binding:** `M41_SECRET_PROVIDER` in `apps/api/src/security/security.module.ts`, currently
  `useFactory: () => new UnavailableSecretProvider()`. **Binding a real provider = swapping this one factory.**
- **Data-flow preserved:** `secretref:` (M30 seam) → M41 `SecretService` metadata/resolution → `SecretProviderPort`
  → provider. The adapter returns an **opaque provider ref**; M41 persists **only** that ref (no value column).

## 2. The adapter (specification — to implement once an instance exists)

New class `OpenBaoSecretProvider implements SecretProviderPort` (in `packages/m41-security/src/`), constructed with
an injected, pre-authenticated OpenBao client (base URL, CA, AppRole/JWT auth handler). Method mapping:

| Port method | OpenBao call(s) | Returns |
| --- | --- | --- |
| `provision(ctx, {secretRef, algorithm})` | ensure a transit key exists (`transit/keys/finapp-<env>`); write/version the ref in `kv/data/finapp/<env>/<path>` | `{ ok:true, providerRef:'transit/finapp-<env>:v<N>' \| 'kv/finapp/<env>/<path>#<version>' }` — **opaque path+version, never material** |
| `resolveMetadata(ctx, providerRef)` | `GET transit/keys/...` or `kv` metadata for the ref | `{ available:true, reasonCode:'material_available' }` (or `available:false` on any error) |
| `destroy(ctx, providerRef)` | `transit` key `min_decryption_version` advance / `kv` `destroy` of that version | `{ ok:true, reasonCode:'destroyed' }` |

**Hard invariants the adapter MUST hold (each maps to an ADR-128/CLAUDE.md control):**
- **Opaque ref only** — return a path/version string; **never** a secret value, ciphertext, or key material.
- **Fail closed** — any provider error/timeout/unavailable/partial → `{ ok:false, reasonCode:'secret_provider_unavailable' }`
  (identical shape to the default). Never a partial/empty success; never a fallback to a broader identity.
- **No secret in state/audit/event/log** — the adapter logs only opaque refs + reason codes; it puts no material in
  any M41 column, audit payload, domain event, or log line.
- **No home-grown crypto** — encryption/rotation are OpenBao **transit** operations (approved-algorithm allowlist);
  the adapter performs no crypto itself.
- **Maker-checker/SoD unchanged** — reveal remains M41's maker-checker flow returning metadata; AI/system actors
  never reveal material. The adapter adds no reveal path.
- **Machine identity** — auth via AppRole/JWT, short-TTL tokens, renewed by the client; **no static long-lived token**.

## 3. What must NOT change (explicit prohibitions — verified against current code)

- No secret-value / ciphertext / private-key **column** anywhere (enforced by
  `packages/m41-security/test/m41-security.db-spec.ts`) — the adapter touches no schema.
- No plaintext secret in PostgreSQL; no secret exposed through any API; no secret in logs.
- No bypass of maker-checker; no weakening of DLP (`DlpService`); no AI/system reveal.
- No change to the **M30 ↔ M41** ownership boundary (M30 owns the `secretref:` seam; M41 owns the real backend).

## 4. Tests required at implementation time (staging, with a live instance)

- **PURE smoke:** adapter maps outcomes to `ProviderOutcome`/`ProviderMetadata` correctly; **fail-closed on every
  error path** (unreachable host, auth failure, missing ref, partial response) → `secret_provider_unavailable`.
- **DB-integration:** the zero-secret-value-column invariant still holds after provision/rotate/destroy; M41
  persists only the opaque ref; reveal still returns metadata only.
- **Transition proof:** with the adapter bound in **staging**, prove `UnavailableSecretProvider` → available
  transition and a full provision → resolve → rotate → destroy lifecycle against the live staging OpenBao.

## 5. Governance status & the STOP decision

- **Authorised now:** ADR-131 permits a **staging** adapter (non-production, fail-closed default); ADR-132 selects
  **OpenBao**. So no *further* governance transition is required to implement a **staging** adapter — **the blocker
  is purely operational**: a reachable staging OpenBao instance + AppRole/JWT credentials + TLS CA (out-of-band).
- **STOP here (this increment):** implementing the adapter without a live instance would mean committing **untested**
  integration code and could not prove fail-closed→available — which this repo does not do. Therefore the adapter is
  **specified, not written**. It remains a **one-factory swap** in `security.module.ts` when the instance is
  delivered.
- **Production binding** stays gated on the **M42 governed GO** regardless of staging progress.

## 6. Exact inputs that unblock implementation (out-of-band; never committed)

1. Staging OpenBao **URL** (private network) + **TLS CA**.
2. API **AppRole `RoleID` + wrapped `SecretID`** (or JWT/OIDC config) + the **scoped ACL policy**.
3. The transit key name + KV path convention confirmed for `<env>=staging`.

On delivery, engineering (ADR-131) implements the adapter class + tests, binds it in **staging only**, proves the
transition + invariant, and records evidence. **No GO. No production binding. No Tier-2 self-certification.**
