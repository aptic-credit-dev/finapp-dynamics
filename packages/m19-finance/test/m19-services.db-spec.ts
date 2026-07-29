import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { FINANCE_LIFECYCLE_FAMILY } from '@finapp/contracts';
import {
  M19Emitter,
  FinanceRepository,
  CatalogService,
  ChartService,
  CalendarService,
  ConfigService,
  M19_AUDIT_CODES,
  ALL_M19_PERMISSIONS,
} from '@finapp/m19-finance';

/**
 * M19 services DB spec — proves the finance FOUNDATION engine END TO END on a REAL PostgreSQL and enforces
 * governance: accounting entities + reference data; DECIMAL-SAFE FX rates (exact string preserved, idempotent
 * natural key, zero/negative rejected) and tax rates; the chart-of-accounts lifecycle (draft → active ↔ inactive →
 * archived, postable only while active, append-only history); the fiscal calendar (fiscal-year + period open →
 * closed ↔ reopen → locked[terminal], the "no posting into a closed period" gate); versioned finance configuration
 * (immutable-after-publish, one active per entity+scope, idempotency-keyed, supersession); optimistic-concurrency
 * CAS; audit (FIN_) + finance.lifecycle events with NO monetary amounts in any payload; and cross-tenant RLS.
 */
export default defineDbSpec('m19-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M19Emitter(audit, outbox);
  const repo = new FinanceRepository();
  const catalog = new CatalogService(db, authz, emitter, repo);
  const chart = new ChartService(db, authz, emitter, repo);
  const calendar = new CalendarService(db, authz, emitter, repo);
  const config = new ConfigService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const actor = randomUUID();
  const mk = (permissions: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId: actor,
    correlationId: randomUUID(),
    permissions: [...permissions],
  });
  const full = mk(ALL_M19_PERMISSIONS);
  const noPerm = mk([]);

  // --- entity + reference data ------------------------------------------------------------------
  await t.rejects(
    catalog.registerEntity(noPerm, actor, { code: 'X', name: 'X' }),
    'registering an entity requires the manage permission (default deny)',
  );
  const entity = await catalog.registerEntity(full, actor, {
    code: 'ACME',
    name: 'Acme Ltd',
    functionalCurrencyCode: 'USD',
  });
  t.equal(entity.status, 'active', 'a new entity is active');
  const entityU = await catalog.updateEntity(full, actor, entity.id, {
    expectedVersion: entity.version,
    name: 'Acme Limited',
  });
  t.equal(entityU.version, entity.version + 1, 'entity update bumps the optimistic-lock version');
  await t.rejects(
    catalog.updateEntity(full, actor, entity.id, { expectedVersion: entity.version, name: 'stale' }),
    'a stale expectedVersion is rejected (optimistic concurrency / CAS)',
  );
  const deact = await catalog.deactivateEntity(full, actor, entity.id, entityU.version);
  t.equal(deact.status, 'inactive', 'entity deactivates');
  await catalog.activateEntity(full, actor, entity.id, deact.version);

  const assetType = await catalog.registerAccountType(full, actor, {
    code: 'AST',
    name: 'Assets',
    accountClass: 'asset',
  });
  t.equal(assetType.normal_side, 'debit', 'an asset account type is debit-normal');
  await t.rejects(
    catalog.registerAccountType(full, actor, { code: 'BAD', name: 'Bad', accountClass: 'nonsense' }),
    'an invalid account class is rejected',
  );

  const usd = await catalog.registerCurrency(full, actor, { code: 'USD', name: 'US Dollar', minorUnits: 2 });
  const eur = await catalog.registerCurrency(full, actor, { code: 'EUR', name: 'Euro', minorUnits: 2 });
  await t.rejects(
    catalog.registerCurrency(full, actor, { code: 'usd', name: 'lower' }),
    'a non-ISO currency code is rejected',
  );
  await t.rejects(
    catalog.registerCurrency(full, actor, { code: 'USD', name: 'dup' }),
    'a duplicate currency code is rejected',
  );

  // --- DECIMAL-SAFE exchange rate: exact string preserved + idempotent + reject zero -------------
  const rate1 = await catalog.recordExchangeRate(full, actor, {
    baseCurrencyId: usd.id,
    quoteCurrencyId: eur.id,
    rate: '1.234567891234',
    rateDate: '2026-01-01',
  });
  t.equal(
    rate1.rate,
    '1.234567891234',
    'the exact-decimal FX rate is preserved verbatim (no float rounding)',
  );
  const rate1b = await catalog.recordExchangeRate(full, actor, {
    baseCurrencyId: usd.id,
    quoteCurrencyId: eur.id,
    rate: '9.999999999999',
    rateDate: '2026-01-01',
  });
  t.equal(
    rate1b.id,
    rate1.id,
    'recording the same (base,quote,type,date) rate is idempotent (returns the same row)',
  );
  await t.rejects(
    catalog.recordExchangeRate(full, actor, {
      baseCurrencyId: usd.id,
      quoteCurrencyId: eur.id,
      rate: '0',
      rateDate: '2026-02-01',
    }),
    'a zero exchange rate is rejected (must be positive exact decimal)',
  );
  await t.rejects(
    catalog.recordExchangeRate(full, actor, {
      baseCurrencyId: usd.id,
      quoteCurrencyId: usd.id,
      rate: '1.5',
      rateDate: '2026-02-01',
    }),
    'a self-pair exchange rate is rejected',
  );
  await catalog.configureEntityCurrency(full, actor, {
    entityId: entity.id,
    currencyId: usd.id,
    currencyRole: 'functional',
  });

  const cc = await catalog.createCostCenter(full, actor, { entityId: entity.id, code: 'CC1', name: 'Ops' });
  const ccArchived = await catalog.archiveCostCenter(full, actor, cc.id, cc.version);
  t.equal(ccArchived.status, 'archived', 'a cost centre archives (no delete)');
  const dim = await catalog.registerDimension(full, actor, {
    entityId: entity.id,
    code: 'PROJ',
    name: 'Project',
    kind: 'project',
  });
  await catalog.addDimensionValue(full, actor, dim.id, { code: 'P1', name: 'Project One' });
  const taxCode = await catalog.registerTaxCode(full, actor, {
    entityId: entity.id,
    code: 'VAT16',
    name: 'VAT 16%',
    taxType: 'vat',
  });
  const taxRate = await catalog.addTaxRate(full, actor, taxCode.id, {
    ratePercent: '16.000000',
    effectiveFrom: '2026-01-01',
  });
  t.equal(taxRate.rate_percent, '16.000000', 'the exact-decimal tax rate is preserved verbatim');
  await catalog.registerPaymentTerm(full, actor, {
    code: 'NET30',
    name: 'Net 30',
    basis: 'net_days',
    netDays: 30,
  });

  // --- chart of accounts lifecycle --------------------------------------------------------------
  await t.rejects(
    chart.createAccount(full, actor, {
      entityId: randomUUID(),
      accountTypeId: assetType.id,
      code: '1000',
      name: 'Cash',
    }),
    'an account cannot reference a non-existent entity (clean not-found)',
  );
  const account = await chart.createAccount(full, actor, {
    entityId: entity.id,
    accountTypeId: assetType.id,
    code: '1000',
    name: 'Cash',
    currencyId: usd.id,
  });
  t.equal(account.status, 'draft', 'a new account is draft');
  const active = await chart.activateAccount(full, actor, account.id, account.version);
  t.equal(active.status, 'active', 'account draft -> active');
  const inactive = await chart.deactivateAccount(full, actor, account.id, active.version);
  t.equal(inactive.status, 'inactive', 'account active -> inactive');
  const reactivated = await chart.activateAccount(full, actor, account.id, inactive.version);
  const archived = await chart.archiveAccount(full, actor, account.id, reactivated.version);
  t.equal(archived.status, 'archived', 'account -> archived (terminal)');
  await t.rejects(
    chart.activateAccount(full, actor, account.id, archived.version),
    'an archived account cannot be reactivated (terminal)',
  );
  const history = await chart.listAccountHistory(full, account.id);
  t.ok(history.length >= 4, 'the append-only account history accumulates each transition');

  // --- fiscal calendar (the posting gate) -------------------------------------------------------
  const fy = await calendar.createFiscalYear(full, actor, {
    entityId: entity.id,
    code: 'FY26',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  });
  const period = await calendar.createPeriod(full, actor, fy.id, {
    periodNumber: 1,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });
  t.equal(period.status, 'open', 'a new period is open (postable)');
  const closed = await calendar.closePeriod(full, actor, period.id, period.version);
  t.equal(closed.status, 'closed', 'period open -> closed (posting blocked)');
  const reopened = await calendar.reopenPeriod(full, actor, period.id, closed.version);
  t.equal(reopened.status, 'open', 'period closed -> reopened');
  const locked = await calendar.lockPeriod(full, actor, period.id, reopened.version);
  t.equal(locked.status, 'locked', 'period -> locked (sealed)');
  await t.rejects(
    calendar.reopenPeriod(full, actor, period.id, locked.version),
    'a locked period cannot be reopened (terminal)',
  );
  const fyClosed = await calendar.closeFiscalYear(full, actor, fy.id, fy.version);
  t.equal(fyClosed.status, 'closed', 'fiscal year closes');
  await calendar.reopenFiscalYear(full, actor, fy.id, fyClosed.version);
  const periodHist = await calendar.listPeriodHistory(full, period.id);
  t.ok(periodHist.length >= 3, 'the append-only period history accumulates each transition');

  // --- versioned config: immutable-after-publish, one-active, idempotency, supersession ----------
  const cfg = await config.createConfig(full, actor, {
    entityId: entity.id,
    scope: 'default',
    settings: { defaultCurrency: 'USD' },
    idempotencyKey: 'cfg-1',
  });
  const cfgDup = await config.createConfig(full, actor, {
    entityId: entity.id,
    scope: 'default',
    idempotencyKey: 'cfg-1',
  });
  t.equal(cfgDup.id, cfg.id, 'creating a config with the same idempotency key returns the same row');
  const cfgEdited = await config.updateDraft(full, actor, cfg.id, {
    expectedVersion: cfg.version,
    settings: { defaultCurrency: 'EUR' },
  });
  const published = await config.publishConfig(full, actor, cfgEdited.id, cfgEdited.version);
  t.equal(published.status, 'active', 'a draft config publishes to active');
  t.ok(published.content_hash !== null, 'publishing freezes a content hash');
  await t.rejects(
    config.updateDraft(full, actor, cfg.id, { expectedVersion: published.version, settings: { x: 1 } }),
    'a published config is immutable (edit rejected)',
  );
  const cfg2 = await config.createConfig(full, actor, {
    entityId: entity.id,
    scope: 'default',
    settings: {},
  });
  await t.rejects(
    config.publishConfig(full, actor, cfg2.id, cfg2.version),
    'a second active config for an entity+scope is rejected (one active)',
  );
  const sup = await config.supersedeConfig(full, actor, published.id, {
    expectedVersion: published.version,
    settings: { defaultCurrency: 'GBP' },
  });
  t.equal(sup.prior.status, 'superseded', 'the prior config becomes superseded');
  t.equal(sup.successor.status, 'active', 'the successor config becomes active');
  t.ok(
    sup.successor.version_number > published.version_number,
    'supersession creates a higher version_number (next available)',
  );

  // --- audit + events: FIN_ codes fired; finance.lifecycle family; NO amounts in payloads --------
  const auditCodes = new Set<string>(audit.entries.map((e) => e.code));
  for (const code of [
    M19_AUDIT_CODES.entityRegistered,
    M19_AUDIT_CODES.accountTypeRegistered,
    M19_AUDIT_CODES.currencyRegistered,
    M19_AUDIT_CODES.exchangeRateRecorded,
    M19_AUDIT_CODES.accountCreated,
    M19_AUDIT_CODES.accountActivated,
    M19_AUDIT_CODES.accountArchived,
    M19_AUDIT_CODES.fiscalYearCreated,
    M19_AUDIT_CODES.periodOpened,
    M19_AUDIT_CODES.periodClosed,
    M19_AUDIT_CODES.periodLocked,
    M19_AUDIT_CODES.configCreated,
    M19_AUDIT_CODES.configPublished,
    M19_AUDIT_CODES.configSuperseded,
    M19_AUDIT_CODES.taxRateAdded,
  ]) {
    t.ok(auditCodes.has(code), `audit code ${code} is emitted`);
  }
  t.ok(
    audit.entries.every((e) => e.code.startsWith('FIN_')),
    'every recorded audit code is a FIN_ code',
  );
  t.ok(
    outbox.events.every((e) => e.family === FINANCE_LIFECYCLE_FAMILY),
    'every event flows on the finance.lifecycle family (one outbox)',
  );
  const eventBlob = JSON.stringify(outbox.events);
  const auditBlob = JSON.stringify(audit.entries);
  t.ok(
    !/"amount"|"balance"|"debit"|"credit"/.test(eventBlob),
    'no event payload carries a monetary amount/balance (ADR-007)',
  );
  t.ok(!/"amount"|"balance"/.test(auditBlob), 'no audit payload carries a monetary amount/balance');
  t.ok(eventBlob.includes('"finance.lifecycle"'), 'events are finance.lifecycle');

  // --- cross-tenant isolation (RLS) -------------------------------------------------------------
  const foreign: RequestContext = { ...mk(ALL_M19_PERMISSIONS), tenantId: randomUUID() };
  const foreignEntities = await catalog.listEntities(foreign);
  t.equal(foreignEntities.length, 0, "another tenant sees none of this tenant's entities (RLS)");
  await t.rejects(
    chart.getAccount(foreign, account.id),
    "another tenant cannot read this tenant's account (RLS)",
  );
  await t.rejects(
    config.getConfig(foreign, published.id),
    "another tenant cannot read this tenant's config (RLS)",
  );
});
