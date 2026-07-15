# m32-analytics — Reporting & Analytics Builder (6C)

**Placeholder. No code yet.** This directory reserves the module's location so that the manifest,
the migration order, and the repository agree on where it lands.

|                  |                                                 |
| ---------------- | ----------------------------------------------- |
| Module code      | `m32-analytics`                                 |
| Build stage      | 6 (docs/07-engineering/BUILD_SEQUENCE.md)       |
| Phase            | 6                                               |
| MVP              | false                                           |
| Status           | `documented` (manifests/module-registry.yaml)   |
| Reference tables | 42 — the baseline a rebuilt module should reach |

## Before building this module

1. Confirm stage 6 is `approved_for_build` in `manifests/implementation-manifest.yaml`.
   Never start an unapproved stage.
2. Read the module's spec in `docs/04-modules/`, `docs/03-platform/`, or `docs/05-ai/`.
3. Check `manifests/naming-map.yaml` for this module's API prefix, permission namespace, event
   family, and audit prefix. Those four axes are named differently on purpose and no rule derives
   one from another.
4. Consume shared services through their DI tokens (`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`). Never add a
   second implementation of a shared service, and never read another module's tables.

## What ships with the code

Permissions, domain events, audit codes, a PURE smoke suite, a DB-integration spec, updated docs, and
an updated manifest — in the same change as the module (CLAUDE.md).

Tenant-scoped tables copy the convention proved by `tools/migrate/samples/rls_convention_sample.sql`:
RLS FORCE, a `tenant_isolation` policy, composite `(tenant_id, id)` keys, and composite foreign keys.
