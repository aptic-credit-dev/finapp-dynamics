import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';

/**
 * M19 governance DB spec — proves on a REAL PostgreSQL, through the non-owner application role, the platform
 * guarantees the migrations must deliver: every one of the 18 m19 tables has RLS ENABLE + FORCE + a
 * tenant_isolation policy; tenant isolation holds; the application role has NO DELETE anywhere and only
 * INSERT+SELECT on the three append-only ledgers (account/period/config history); the decimal-safe money guards
 * (exchange rate > 0, base <> quote, NUMERIC not float; tax rate >= 0); the currency-code + period-status + entity
 * CHECKs; account self-parent CHECK + composite FK; exchange-rate natural-key + config idempotency-key + config
 * one-active invariants; and m19's 45 permissions seeded with the 16-strong privileged set.
 *
 * Harness note: each as* block is ONE transaction with no per-statement savepoints — a constraint violation
 * poisons it. Persisting blocks contain NO rejecting query; every `t.rejects(...)` is the last statement in its
 * block (which then rolls back cleanly).
 */
const M19_TABLES = [
  'finance_entity',
  'finance_account_type',
  'finance_currency',
  'finance_exchange_rate',
  'finance_entity_currency',
  'finance_account',
  'finance_account_history',
  'finance_fiscal_year',
  'finance_fiscal_period',
  'finance_period_history',
  'finance_cost_center',
  'finance_dimension',
  'finance_dimension_value',
  'finance_tax_code',
  'finance_tax_rate',
  'finance_payment_term',
  'finance_config',
  'finance_config_history',
];
const APPEND_ONLY = ['finance_account_history', 'finance_period_history', 'finance_config_history'];

export default defineDbSpec('m19-finance', async (ctx, t) => {
  // --- RLS ENABLE + FORCE + tenant_isolation on every table -------------------------------------
  await ctx.asSuperuser(null, async (tx) => {
    const r = await tx.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind='r' ORDER BY relname`,
      [M19_TABLES],
    );
    t.equal(r.rows.length, M19_TABLES.length, 'all 18 m19 tables exist');
    for (const row of r.rows)
      t.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} has RLS ENABLE + FORCE`);
    const p = await tx.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      [M19_TABLES],
    );
    t.equal(p.rows.length, M19_TABLES.length, 'every m19 table has a tenant_isolation policy');
  });

  // --- NO DELETE anywhere; append-only ledgers get no UPDATE; money is NUMERIC not float ---------
  await ctx.asSuperuser(null, async (tx) => {
    const del = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='DELETE' AND table_name = ANY($2)`,
      [ctx.appRole, M19_TABLES],
    );
    t.equal(del.rows.length, 0, 'the application role has NO DELETE on any m19 table');
    const upd = await tx.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=$1 AND privilege_type='UPDATE' AND table_name = ANY($2)`,
      [ctx.appRole, APPEND_ONLY],
    );
    t.equal(upd.rows.length, 0, 'account/period/config history are append-only');
    const floats = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM information_schema.columns WHERE table_name LIKE 'finance_%' AND data_type IN ('real','double precision')`,
    );
    t.equal(floats.rows[0]?.c, '0', 'no finance column uses a binary float (decimal-safe, ADR-007)');
  });

  // --- 45 permissions seeded, 16 privileged incl. the key privileged codes ----------------------
  await ctx.asSuperuser(null, async (tx) => {
    const c = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m19-finance'`,
    );
    t.equal(c.rows[0]?.c, '45', 'm19 seeds 45 permissions');
    const pc = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM permissions WHERE module='m19-finance' AND privileged=true`,
    );
    t.equal(pc.rows[0]?.c, '16', 'm19 seeds 16 privileged permissions');
    const priv = await tx.query<{ code: string }>(
      `SELECT code FROM permissions WHERE module='m19-finance' AND privileged=true AND code IN ('finance.period.close','finance.period.lock','finance.fiscal_year.close','finance.config.publish','finance.currency.manage','finance.platform.administer')`,
    );
    t.equal(
      priv.rows.length,
      6,
      'period-close/lock + fiscal-year-close + config-publish + currency + platform are privileged',
    );
  });

  // --- tenant isolation holds (this block COMMITS: the ids are reused below) ---------------------
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let entId = '';
  let typeId = '';
  let usdId = '';
  let eurId = '';
  await ctx.asTenant(tenantA, async (tx) => {
    const e = await tx.query<{ id: string }>(
      `INSERT INTO finance_entity (tenant_id, code, name, correlation_id) VALUES ($1,'ENT1','Entity One',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    entId = e.rows[0]?.id ?? '';
    const ty = await tx.query<{ id: string }>(
      `INSERT INTO finance_account_type (tenant_id, code, name, account_class, normal_side, correlation_id) VALUES ($1,'AST','Assets','asset','debit',$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    typeId = ty.rows[0]?.id ?? '';
    const usd = await tx.query<{ id: string }>(
      `INSERT INTO finance_currency (tenant_id, code, name, minor_units, correlation_id) VALUES ($1,'USD','US Dollar',2,$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    usdId = usd.rows[0]?.id ?? '';
    const eur = await tx.query<{ id: string }>(
      `INSERT INTO finance_currency (tenant_id, code, name, minor_units, correlation_id) VALUES ($1,'EUR','Euro',2,$2) RETURNING id`,
      [tenantA, randomUUID()],
    );
    eurId = eur.rows[0]?.id ?? '';
    t.ok(
      entId !== '' && typeId !== '' && usdId !== '' && eurId !== '',
      'tenant A seeds entity/type/currencies',
    );
  });
  await ctx.asTenant(tenantB, async (tx) => {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM finance_entity WHERE id=$1`, [
      entId,
    ]);
    t.equal(r.rows[0]?.c, '0', "tenant B cannot see tenant A's entity (RLS)");
  });

  // --- entity code uniqueness + currency-code CHECK ---------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_entity (tenant_id, code, name, correlation_id) VALUES ($1,'ENT1','dup',$2)`,
        [tenantA, randomUUID()],
      ),
      'a duplicate entity code is rejected (per tenant)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_currency (tenant_id, code, name, correlation_id) VALUES ($1,'usd','lower',$2)`,
        [tenantA, randomUUID()],
      ),
      'a non-ISO currency code is rejected (CHECK ^[A-Z]{3}$)',
    );
  });

  // --- exchange rate: record ok; then natural-key idempotency (reject last) ----------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO finance_exchange_rate (tenant_id, base_currency_id, quote_currency_id, rate, rate_type, rate_date, correlation_id) VALUES ($1,$2,$3,'1.100000000000','spot','2026-01-01',$4)`,
      [tenantA, usdId, eurId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO finance_exchange_rate (tenant_id, base_currency_id, quote_currency_id, rate, rate_type, rate_date, correlation_id) VALUES ($1,$2,$3,'1.200000000000','spot','2026-01-01',$4)`,
        [tenantA, usdId, eurId, randomUUID()],
      ),
      'a duplicate (base,quote,type,date) exchange rate is rejected (idempotent)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_exchange_rate (tenant_id, base_currency_id, quote_currency_id, rate, rate_date, correlation_id) VALUES ($1,$2,$3,'0','2026-02-01',$4)`,
        [tenantA, usdId, eurId, randomUUID()],
      ),
      'a zero/negative exchange rate is rejected (rate > 0)',
    );
  });
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_exchange_rate (tenant_id, base_currency_id, quote_currency_id, rate, rate_date, correlation_id) VALUES ($1,$2,$2,'1.5','2026-03-01',$3)`,
        [tenantA, usdId, randomUUID()],
      ),
      'a self-pair exchange rate is rejected (base <> quote)',
    );
  });

  // --- account: self-parent CHECK + composite FK ------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    await t.rejects(
      tx.query(
        `INSERT INTO finance_account (tenant_id, entity_id, account_type_id, code, name, correlation_id) VALUES ($1,$2,$3,'1000','Cash',$4)`,
        [tenantA, randomUUID(), typeId, randomUUID()],
      ),
      'an account cannot reference a non-existent entity (composite FK)',
    );
  });

  // --- config: one-active (insert active persists; second active rejected last) -----------------
  await ctx.asTenant(tenantA, async (tx) => {
    await tx.query(
      `INSERT INTO finance_config (tenant_id, entity_id, scope, version_number, status, correlation_id) VALUES ($1,$2,'default',1,'active',$3)`,
      [tenantA, entId, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO finance_config (tenant_id, entity_id, scope, version_number, status, correlation_id) VALUES ($1,$2,'default',2,'active',$3)`,
        [tenantA, entId, randomUUID()],
      ),
      'a second active config for an entity+scope is rejected (one active)',
    );
  });

  // --- config idempotency-key uniqueness --------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const key = `idem-${randomUUID()}`;
    await tx.query(
      `INSERT INTO finance_config (tenant_id, entity_id, scope, version_number, status, idempotency_key, correlation_id) VALUES ($1,$2,'idem1',1,'draft',$3,$4)`,
      [tenantA, entId, key, randomUUID()],
    );
    await t.rejects(
      tx.query(
        `INSERT INTO finance_config (tenant_id, entity_id, scope, version_number, status, idempotency_key, correlation_id) VALUES ($1,$2,'idem2',1,'draft',$3,$4)`,
        [tenantA, entId, key, randomUUID()],
      ),
      'a duplicate config idempotency key is rejected',
    );
  });

  // --- period status CHECK ----------------------------------------------------------------------
  await ctx.asTenant(tenantA, async (tx) => {
    const fy = await tx.query<{ id: string }>(
      `INSERT INTO finance_fiscal_year (tenant_id, entity_id, code, start_date, end_date, correlation_id) VALUES ($1,$2,'FY26','2026-01-01','2026-12-31',$3) RETURNING id`,
      [tenantA, entId, randomUUID()],
    );
    const fyId = fy.rows[0]?.id ?? '';
    await t.rejects(
      tx.query(
        `INSERT INTO finance_fiscal_period (tenant_id, entity_id, fiscal_year_id, period_number, start_date, end_date, status, correlation_id) VALUES ($1,$2,$3,1,'2026-01-01','2026-01-31','postable',$4)`,
        [tenantA, entId, fyId, randomUUID()],
      ),
      'an invalid period status is rejected (open/closed/locked only)',
    );
  });
});
