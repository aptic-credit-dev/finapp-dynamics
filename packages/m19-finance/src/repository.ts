/**
 * M19 repository — ALL SQL for the finance operations FOUNDATION. Every query is parameterized; every mutating
 * UPDATE is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale/losing command changes zero
 * rows and the caller reacts (single-winner). Queries carry NO tenant_id predicate: RLS FORCE is the isolation
 * guarantee. All methods take the caller's `Tx` so the row write, its append-only history, audit and outbox commit
 * atomically. Account/period/config history are append-only (INSERT + SELECT). Exchange rates and config are
 * IDEMPOTENT (the natural-key unique index `finance_exchange_rate_key`; the partial `finance_config_idem_key`).
 * Config is PUBLISHABLE: a published (active) version is immutable — a change is a NEW version (supersession),
 * content_hash frozen at publish. m19 owns only `finance_*`; it NEVER reads another module's tables. Exact-decimal
 * columns — rate numeric(30,12), rate_percent numeric(9,6) — are read and written as STRINGS and NEVER parsed into
 * a binary float (ADR-007, CLAUDE.md money rule). The foundation carries no monetary amounts or balances.
 */
import type { Tx } from '@finapp/kernel';

// --- row types (raw DB shape; snake_case columns as SELECTed) -----------------------------------
export interface EntityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parent_entity_id: string | null;
  readonly functional_currency_code: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface AccountTypeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly account_class: string;
  readonly normal_side: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly correlation_id: string;
}

export interface CurrencyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly minor_units: number;
  readonly symbol: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface ExchangeRateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly base_currency_id: string;
  readonly quote_currency_id: string;
  /** EXACT decimal — read/written as a STRING, never a float (ADR-007). */
  readonly rate: string;
  readonly rate_type: string;
  readonly rate_date: string;
  readonly source: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface EntityCurrencyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly currency_id: string;
  readonly currency_role: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface AccountRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly account_type_id: string;
  readonly parent_account_id: string | null;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly currency_id: string | null;
  readonly postable: boolean;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface AccountHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly account_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface FiscalYearRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly code: string;
  readonly name: string | null;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface FiscalPeriodRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly fiscal_year_id: string;
  readonly period_number: number;
  readonly name: string | null;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: string;
  readonly closed_at: string | null;
  readonly locked_at: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface PeriodHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly period_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface CostCenterRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly code: string;
  readonly name: string;
  readonly parent_cost_center_id: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface DimensionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface DimensionValueRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly dimension_id: string;
  readonly code: string;
  readonly name: string;
  readonly parent_value_id: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface TaxCodeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly code: string;
  readonly name: string;
  readonly tax_type: string;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface TaxRateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly tax_code_id: string;
  /** EXACT decimal percentage — read/written as a STRING, never a float (ADR-007). */
  readonly rate_percent: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface PaymentTermRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly basis: string;
  readonly net_days: number | null;
  readonly day_of_month: number | null;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface ConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly status: string;
  readonly settings: unknown;
  readonly content_hash: string | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly published_at: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface ConfigHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly config_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

// --- column projections (kept in one place so SELECT/INSERT/UPDATE stay in lock-step) ------------
const ENTITY_COLS =
  'tenant_id, id, code, name, parent_entity_id, functional_currency_code, description, status, version, correlation_id';
const ACCOUNT_TYPE_COLS =
  'tenant_id, id, code, name, account_class, normal_side, description, active, version, correlation_id';
const CURRENCY_COLS = 'tenant_id, id, code, name, minor_units, symbol, status, version, correlation_id';
const EXCHANGE_RATE_COLS =
  'tenant_id, id, base_currency_id, quote_currency_id, rate::text AS rate, rate_type, rate_date::text AS rate_date, source, version, correlation_id';
const ENTITY_CURRENCY_COLS = 'tenant_id, id, entity_id, currency_id, currency_role, version, correlation_id';
const ACCOUNT_COLS =
  'tenant_id, id, entity_id, account_type_id, parent_account_id, code, name, description, currency_id, postable, status, version, correlation_id';
const ACCOUNT_HISTORY_COLS =
  'tenant_id, id, account_id, from_status, to_status, reason, reason_code, by_user, correlation_id';
const FISCAL_YEAR_COLS =
  'tenant_id, id, entity_id, code, name, start_date::text AS start_date, end_date::text AS end_date, status, version, correlation_id';
const FISCAL_PERIOD_COLS =
  'tenant_id, id, entity_id, fiscal_year_id, period_number, name, start_date::text AS start_date, end_date::text AS end_date, status, closed_at, locked_at, version, correlation_id';
const PERIOD_HISTORY_COLS =
  'tenant_id, id, period_id, from_status, to_status, reason, reason_code, by_user, correlation_id';
const COST_CENTER_COLS =
  'tenant_id, id, entity_id, code, name, parent_cost_center_id, description, status, version, correlation_id';
const DIMENSION_COLS = 'tenant_id, id, entity_id, code, name, kind, status, version, correlation_id';
const DIMENSION_VALUE_COLS =
  'tenant_id, id, dimension_id, code, name, parent_value_id, status, version, correlation_id';
const TAX_CODE_COLS =
  'tenant_id, id, entity_id, code, name, tax_type, description, status, version, correlation_id';
const TAX_RATE_COLS =
  'tenant_id, id, tax_code_id, rate_percent::text AS rate_percent, effective_from::text AS effective_from, effective_to::text AS effective_to, version, correlation_id';
const PAYMENT_TERM_COLS =
  'tenant_id, id, code, name, basis, net_days, day_of_month, description, status, version, correlation_id';
const CONFIG_COLS =
  'tenant_id, id, entity_id, scope, version_number, status, settings, content_hash, supersedes_id, superseded_by_id, submitted_by, submitted_at, published_at, idempotency_key, version, correlation_id';
const CONFIG_HISTORY_COLS =
  'tenant_id, id, config_id, from_status, to_status, reason, by_user, correlation_id';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m19 repository: expected a row from ${what}`);
  return row;
}

export class FinanceRepository {
  // --- accounting entity ------------------------------------------------------------------------
  async insertEntity(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string;
      parentEntityId: string | null;
      functionalCurrencyCode: string | null;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EntityRow> {
    const r = await tx.query<EntityRow>(
      `INSERT INTO finance_entity (tenant_id, code, name, parent_entity_id, functional_currency_code, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${ENTITY_COLS}`,
      [
        i.tenantId,
        i.code,
        i.name,
        i.parentEntityId,
        i.functionalCurrencyCode,
        i.description,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert entity');
  }
  async findEntity(tx: Tx, id: string): Promise<EntityRow | null> {
    const r = await tx.query<EntityRow>(`SELECT ${ENTITY_COLS} FROM finance_entity WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findEntityByCode(tx: Tx, code: string): Promise<EntityRow | null> {
    const r = await tx.query<EntityRow>(`SELECT ${ENTITY_COLS} FROM finance_entity WHERE code=$1`, [code]);
    return r.rows[0] ?? null;
  }
  async updateEntity(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      parentEntityId: string | null;
      functionalCurrencyCode: string | null;
      description: string | null;
      by: string | null;
    },
  ): Promise<EntityRow | null> {
    const r = await tx.query<EntityRow>(
      `UPDATE finance_entity SET name=COALESCE($3,name), parent_entity_id=COALESCE($4,parent_entity_id), functional_currency_code=COALESCE($5,functional_currency_code), description=COALESCE($6,description), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ENTITY_COLS}`,
      [i.id, i.expectedVersion, i.name, i.parentEntityId, i.functionalCurrencyCode, i.description, i.by],
    );
    return r.rows[0] ?? null;
  }
  async transitionEntity(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<EntityRow | null> {
    const r = await tx.query<EntityRow>(
      `UPDATE finance_entity SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ENTITY_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listEntities(tx: Tx, status?: string): Promise<EntityRow[]> {
    const r = await tx.query<EntityRow>(
      `SELECT ${ENTITY_COLS} FROM finance_entity WHERE ($1::text IS NULL OR status=$1) ORDER BY code`,
      [status ?? null],
    );
    return r.rows;
  }

  // --- account type -----------------------------------------------------------------------------
  async insertAccountType(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string;
      accountClass: string;
      normalSide: string;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AccountTypeRow> {
    const r = await tx.query<AccountTypeRow>(
      `INSERT INTO finance_account_type (tenant_id, code, name, account_class, normal_side, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${ACCOUNT_TYPE_COLS}`,
      [i.tenantId, i.code, i.name, i.accountClass, i.normalSide, i.description, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert account type');
  }
  async findAccountType(tx: Tx, id: string): Promise<AccountTypeRow | null> {
    const r = await tx.query<AccountTypeRow>(
      `SELECT ${ACCOUNT_TYPE_COLS} FROM finance_account_type WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updateAccountType(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      description: string | null;
      active: boolean | null;
      by: string | null;
    },
  ): Promise<AccountTypeRow | null> {
    const r = await tx.query<AccountTypeRow>(
      `UPDATE finance_account_type SET name=COALESCE($3,name), description=COALESCE($4,description), active=COALESCE($5,active), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ACCOUNT_TYPE_COLS}`,
      [i.id, i.expectedVersion, i.name, i.description, i.active, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listAccountTypes(tx: Tx): Promise<AccountTypeRow[]> {
    const r = await tx.query<AccountTypeRow>(
      `SELECT ${ACCOUNT_TYPE_COLS} FROM finance_account_type WHERE active=true ORDER BY code`,
    );
    return r.rows;
  }

  // --- currency ---------------------------------------------------------------------------------
  async insertCurrency(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string;
      minorUnits: number;
      symbol: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CurrencyRow> {
    const r = await tx.query<CurrencyRow>(
      `INSERT INTO finance_currency (tenant_id, code, name, minor_units, symbol, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${CURRENCY_COLS}`,
      [i.tenantId, i.code, i.name, i.minorUnits, i.symbol, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert currency');
  }
  async findCurrency(tx: Tx, id: string): Promise<CurrencyRow | null> {
    const r = await tx.query<CurrencyRow>(`SELECT ${CURRENCY_COLS} FROM finance_currency WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findCurrencyByCode(tx: Tx, code: string): Promise<CurrencyRow | null> {
    const r = await tx.query<CurrencyRow>(`SELECT ${CURRENCY_COLS} FROM finance_currency WHERE code=$1`, [
      code,
    ]);
    return r.rows[0] ?? null;
  }
  async updateCurrency(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      symbol: string | null;
      minorUnits: number | null;
      by: string | null;
    },
  ): Promise<CurrencyRow | null> {
    const r = await tx.query<CurrencyRow>(
      `UPDATE finance_currency SET name=COALESCE($3,name), symbol=COALESCE($4,symbol), minor_units=COALESCE($5,minor_units), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CURRENCY_COLS}`,
      [i.id, i.expectedVersion, i.name, i.symbol, i.minorUnits, i.by],
    );
    return r.rows[0] ?? null;
  }
  async setCurrencyStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<CurrencyRow | null> {
    const r = await tx.query<CurrencyRow>(
      `UPDATE finance_currency SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CURRENCY_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listCurrencies(tx: Tx, status?: string): Promise<CurrencyRow[]> {
    const r = await tx.query<CurrencyRow>(
      `SELECT ${CURRENCY_COLS} FROM finance_currency WHERE ($1::text IS NULL OR status=$1) ORDER BY code`,
      [status ?? null],
    );
    return r.rows;
  }

  // --- exchange rate (exact decimal STRING; idempotent on the natural key) -----------------------
  async insertExchangeRate(
    tx: Tx,
    i: {
      tenantId: string;
      baseCurrencyId: string;
      quoteCurrencyId: string;
      rate: string;
      rateType: string;
      rateDate: string;
      source: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ExchangeRateRow> {
    const r = await tx.query<ExchangeRateRow>(
      `INSERT INTO finance_exchange_rate (tenant_id, base_currency_id, quote_currency_id, rate, rate_type, rate_date, source, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4::numeric,$5,$6::date,$7,$8,$9,$9) RETURNING ${EXCHANGE_RATE_COLS}`,
      [
        i.tenantId,
        i.baseCurrencyId,
        i.quoteCurrencyId,
        i.rate,
        i.rateType,
        i.rateDate,
        i.source,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert exchange rate');
  }
  /** Idempotency lookup on the natural key `finance_exchange_rate_key` (base, quote, type, date). */
  async findExchangeRateByKey(
    tx: Tx,
    i: { baseCurrencyId: string; quoteCurrencyId: string; rateType: string; rateDate: string },
  ): Promise<ExchangeRateRow | null> {
    const r = await tx.query<ExchangeRateRow>(
      `SELECT ${EXCHANGE_RATE_COLS} FROM finance_exchange_rate WHERE base_currency_id=$1 AND quote_currency_id=$2 AND rate_type=$3 AND rate_date=$4::date`,
      [i.baseCurrencyId, i.quoteCurrencyId, i.rateType, i.rateDate],
    );
    return r.rows[0] ?? null;
  }
  async listExchangeRates(
    tx: Tx,
    i: { baseCurrencyId?: string; quoteCurrencyId?: string; rateType?: string },
  ): Promise<ExchangeRateRow[]> {
    const r = await tx.query<ExchangeRateRow>(
      `SELECT ${EXCHANGE_RATE_COLS} FROM finance_exchange_rate WHERE ($1::uuid IS NULL OR base_currency_id=$1) AND ($2::uuid IS NULL OR quote_currency_id=$2) AND ($3::text IS NULL OR rate_type=$3) ORDER BY rate_date DESC`,
      [i.baseCurrencyId ?? null, i.quoteCurrencyId ?? null, i.rateType ?? null],
    );
    return r.rows;
  }

  // --- entity currency configuration ------------------------------------------------------------
  async insertEntityCurrency(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      currencyId: string;
      currencyRole: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EntityCurrencyRow> {
    const r = await tx.query<EntityCurrencyRow>(
      `INSERT INTO finance_entity_currency (tenant_id, entity_id, currency_id, currency_role, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${ENTITY_CURRENCY_COLS}`,
      [i.tenantId, i.entityId, i.currencyId, i.currencyRole, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert entity currency');
  }
  async findEntityCurrencyByKey(
    tx: Tx,
    i: { entityId: string; currencyId: string; currencyRole: string },
  ): Promise<EntityCurrencyRow | null> {
    const r = await tx.query<EntityCurrencyRow>(
      `SELECT ${ENTITY_CURRENCY_COLS} FROM finance_entity_currency WHERE entity_id=$1 AND currency_id=$2 AND currency_role=$3`,
      [i.entityId, i.currencyId, i.currencyRole],
    );
    return r.rows[0] ?? null;
  }
  async listEntityCurrencies(tx: Tx, entityId: string): Promise<EntityCurrencyRow[]> {
    const r = await tx.query<EntityCurrencyRow>(
      `SELECT ${ENTITY_CURRENCY_COLS} FROM finance_entity_currency WHERE entity_id=$1 ORDER BY currency_role`,
      [entityId],
    );
    return r.rows;
  }

  // --- ledger account ---------------------------------------------------------------------------
  async insertAccount(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      accountTypeId: string;
      parentAccountId: string | null;
      code: string;
      name: string;
      description: string | null;
      currencyId: string | null;
      postable: boolean;
      status: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AccountRow> {
    const r = await tx.query<AccountRow>(
      `INSERT INTO finance_account (tenant_id, entity_id, account_type_id, parent_account_id, code, name, description, currency_id, postable, status, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${ACCOUNT_COLS}`,
      [
        i.tenantId,
        i.entityId,
        i.accountTypeId,
        i.parentAccountId,
        i.code,
        i.name,
        i.description,
        i.currencyId,
        i.postable,
        i.status,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert account');
  }
  async findAccount(tx: Tx, id: string): Promise<AccountRow | null> {
    const r = await tx.query<AccountRow>(`SELECT ${ACCOUNT_COLS} FROM finance_account WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  /** Content patch — draft/active only (see the service; the DB has no status guard here). CAS on version. */
  async updateAccount(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      description: string | null;
      accountTypeId: string | null;
      parentAccountId: string | null;
      currencyId: string | null;
      postable: boolean | null;
      by: string | null;
    },
  ): Promise<AccountRow | null> {
    const r = await tx.query<AccountRow>(
      `UPDATE finance_account SET name=COALESCE($3,name), description=COALESCE($4,description), account_type_id=COALESCE($5,account_type_id), parent_account_id=COALESCE($6,parent_account_id), currency_id=COALESCE($7,currency_id), postable=COALESCE($8,postable), updated_by=$9, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('draft','active') RETURNING ${ACCOUNT_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.name,
        i.description,
        i.accountTypeId,
        i.parentAccountId,
        i.currencyId,
        i.postable,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async transitionAccount(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<AccountRow | null> {
    const r = await tx.query<AccountRow>(
      `UPDATE finance_account SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ACCOUNT_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listAccounts(tx: Tx, i: { entityId?: string; status?: string }): Promise<AccountRow[]> {
    const r = await tx.query<AccountRow>(
      `SELECT ${ACCOUNT_COLS} FROM finance_account WHERE ($1::uuid IS NULL OR entity_id=$1) AND ($2::text IS NULL OR status=$2) ORDER BY code`,
      [i.entityId ?? null, i.status ?? null],
    );
    return r.rows;
  }
  async insertAccountHistory(
    tx: Tx,
    i: {
      tenantId: string;
      accountId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO finance_account_history (tenant_id, account_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.accountId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listAccountHistory(tx: Tx, accountId: string): Promise<AccountHistoryRow[]> {
    const r = await tx.query<AccountHistoryRow>(
      `SELECT ${ACCOUNT_HISTORY_COLS} FROM finance_account_history WHERE account_id=$1 ORDER BY created_at`,
      [accountId],
    );
    return r.rows;
  }

  // --- fiscal year ------------------------------------------------------------------------------
  async insertFiscalYear(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      code: string;
      name: string | null;
      startDate: string;
      endDate: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FiscalYearRow> {
    const r = await tx.query<FiscalYearRow>(
      `INSERT INTO finance_fiscal_year (tenant_id, entity_id, code, name, start_date, end_date, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$8) RETURNING ${FISCAL_YEAR_COLS}`,
      [i.tenantId, i.entityId, i.code, i.name, i.startDate, i.endDate, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert fiscal year');
  }
  async findFiscalYear(tx: Tx, id: string): Promise<FiscalYearRow | null> {
    const r = await tx.query<FiscalYearRow>(
      `SELECT ${FISCAL_YEAR_COLS} FROM finance_fiscal_year WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async transitionFiscalYear(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<FiscalYearRow | null> {
    const r = await tx.query<FiscalYearRow>(
      `UPDATE finance_fiscal_year SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${FISCAL_YEAR_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listFiscalYears(tx: Tx, entityId: string): Promise<FiscalYearRow[]> {
    const r = await tx.query<FiscalYearRow>(
      `SELECT ${FISCAL_YEAR_COLS} FROM finance_fiscal_year WHERE entity_id=$1 ORDER BY start_date DESC`,
      [entityId],
    );
    return r.rows;
  }

  // --- accounting period (postability gate) -----------------------------------------------------
  async insertFiscalPeriod(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      fiscalYearId: string;
      periodNumber: number;
      name: string | null;
      startDate: string;
      endDate: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FiscalPeriodRow> {
    const r = await tx.query<FiscalPeriodRow>(
      `INSERT INTO finance_fiscal_period (tenant_id, entity_id, fiscal_year_id, period_number, name, start_date, end_date, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$9) RETURNING ${FISCAL_PERIOD_COLS}`,
      [
        i.tenantId,
        i.entityId,
        i.fiscalYearId,
        i.periodNumber,
        i.name,
        i.startDate,
        i.endDate,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert fiscal period');
  }
  async findFiscalPeriod(tx: Tx, id: string): Promise<FiscalPeriodRow | null> {
    const r = await tx.query<FiscalPeriodRow>(
      `SELECT ${FISCAL_PERIOD_COLS} FROM finance_fiscal_period WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** Status transition; stamps closed_at / locked_at when moving to those states. CAS on version. */
  async transitionPeriod(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<FiscalPeriodRow | null> {
    const r = await tx.query<FiscalPeriodRow>(
      `UPDATE finance_fiscal_period SET
         status=$3,
         closed_at=CASE WHEN $3='closed' THEN now() WHEN $3='open' THEN NULL ELSE closed_at END,
         locked_at=CASE WHEN $3='locked' THEN now() ELSE locked_at END,
         updated_by=$4, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${FISCAL_PERIOD_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listFiscalPeriods(tx: Tx, fiscalYearId: string): Promise<FiscalPeriodRow[]> {
    const r = await tx.query<FiscalPeriodRow>(
      `SELECT ${FISCAL_PERIOD_COLS} FROM finance_fiscal_period WHERE fiscal_year_id=$1 ORDER BY period_number`,
      [fiscalYearId],
    );
    return r.rows;
  }
  async insertPeriodHistory(
    tx: Tx,
    i: {
      tenantId: string;
      periodId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO finance_period_history (tenant_id, period_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.periodId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listPeriodHistory(tx: Tx, periodId: string): Promise<PeriodHistoryRow[]> {
    const r = await tx.query<PeriodHistoryRow>(
      `SELECT ${PERIOD_HISTORY_COLS} FROM finance_period_history WHERE period_id=$1 ORDER BY created_at`,
      [periodId],
    );
    return r.rows;
  }

  // --- cost centre ------------------------------------------------------------------------------
  async insertCostCenter(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      code: string;
      name: string;
      parentCostCenterId: string | null;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CostCenterRow> {
    const r = await tx.query<CostCenterRow>(
      `INSERT INTO finance_cost_center (tenant_id, entity_id, code, name, parent_cost_center_id, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${COST_CENTER_COLS}`,
      [i.tenantId, i.entityId, i.code, i.name, i.parentCostCenterId, i.description, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert cost center');
  }
  async findCostCenter(tx: Tx, id: string): Promise<CostCenterRow | null> {
    const r = await tx.query<CostCenterRow>(
      `SELECT ${COST_CENTER_COLS} FROM finance_cost_center WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updateCostCenter(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      parentCostCenterId: string | null;
      description: string | null;
      by: string | null;
    },
  ): Promise<CostCenterRow | null> {
    const r = await tx.query<CostCenterRow>(
      `UPDATE finance_cost_center SET name=COALESCE($3,name), parent_cost_center_id=COALESCE($4,parent_cost_center_id), description=COALESCE($5,description), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status <> 'archived' RETURNING ${COST_CENTER_COLS}`,
      [i.id, i.expectedVersion, i.name, i.parentCostCenterId, i.description, i.by],
    );
    return r.rows[0] ?? null;
  }
  async setCostCenterStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<CostCenterRow | null> {
    const r = await tx.query<CostCenterRow>(
      `UPDATE finance_cost_center SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${COST_CENTER_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listCostCenters(tx: Tx, i: { entityId?: string; status?: string }): Promise<CostCenterRow[]> {
    const r = await tx.query<CostCenterRow>(
      `SELECT ${COST_CENTER_COLS} FROM finance_cost_center WHERE ($1::uuid IS NULL OR entity_id=$1) AND ($2::text IS NULL OR status=$2) ORDER BY code`,
      [i.entityId ?? null, i.status ?? null],
    );
    return r.rows;
  }

  // --- analytical dimension + values ------------------------------------------------------------
  async insertDimension(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      code: string;
      name: string;
      kind: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DimensionRow> {
    const r = await tx.query<DimensionRow>(
      `INSERT INTO finance_dimension (tenant_id, entity_id, code, name, kind, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${DIMENSION_COLS}`,
      [i.tenantId, i.entityId, i.code, i.name, i.kind, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert dimension');
  }
  async findDimension(tx: Tx, id: string): Promise<DimensionRow | null> {
    const r = await tx.query<DimensionRow>(`SELECT ${DIMENSION_COLS} FROM finance_dimension WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async listDimensions(tx: Tx, entityId: string): Promise<DimensionRow[]> {
    const r = await tx.query<DimensionRow>(
      `SELECT ${DIMENSION_COLS} FROM finance_dimension WHERE entity_id=$1 ORDER BY code`,
      [entityId],
    );
    return r.rows;
  }
  async insertDimensionValue(
    tx: Tx,
    i: {
      tenantId: string;
      dimensionId: string;
      code: string;
      name: string;
      parentValueId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DimensionValueRow> {
    const r = await tx.query<DimensionValueRow>(
      `INSERT INTO finance_dimension_value (tenant_id, dimension_id, code, name, parent_value_id, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${DIMENSION_VALUE_COLS}`,
      [i.tenantId, i.dimensionId, i.code, i.name, i.parentValueId, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert dimension value');
  }
  async listDimensionValues(tx: Tx, dimensionId: string): Promise<DimensionValueRow[]> {
    const r = await tx.query<DimensionValueRow>(
      `SELECT ${DIMENSION_VALUE_COLS} FROM finance_dimension_value WHERE dimension_id=$1 ORDER BY code`,
      [dimensionId],
    );
    return r.rows;
  }

  // --- tax code + rates -------------------------------------------------------------------------
  async insertTaxCode(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      code: string;
      name: string;
      taxType: string;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<TaxCodeRow> {
    const r = await tx.query<TaxCodeRow>(
      `INSERT INTO finance_tax_code (tenant_id, entity_id, code, name, tax_type, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${TAX_CODE_COLS}`,
      [i.tenantId, i.entityId, i.code, i.name, i.taxType, i.description, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert tax code');
  }
  async findTaxCode(tx: Tx, id: string): Promise<TaxCodeRow | null> {
    const r = await tx.query<TaxCodeRow>(`SELECT ${TAX_CODE_COLS} FROM finance_tax_code WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async updateTaxCode(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      description: string | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<TaxCodeRow | null> {
    const r = await tx.query<TaxCodeRow>(
      `UPDATE finance_tax_code SET name=COALESCE($3,name), description=COALESCE($4,description), status=COALESCE($5,status), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${TAX_CODE_COLS}`,
      [i.id, i.expectedVersion, i.name, i.description, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listTaxCodes(tx: Tx, entityId: string): Promise<TaxCodeRow[]> {
    const r = await tx.query<TaxCodeRow>(
      `SELECT ${TAX_CODE_COLS} FROM finance_tax_code WHERE entity_id=$1 ORDER BY code`,
      [entityId],
    );
    return r.rows;
  }
  async insertTaxRate(
    tx: Tx,
    i: {
      tenantId: string;
      taxCodeId: string;
      ratePercent: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<TaxRateRow> {
    const r = await tx.query<TaxRateRow>(
      `INSERT INTO finance_tax_rate (tenant_id, tax_code_id, rate_percent, effective_from, effective_to, correlation_id, created_by) VALUES ($1,$2,$3::numeric,$4::date,$5::date,$6,$7) RETURNING ${TAX_RATE_COLS}`,
      [i.tenantId, i.taxCodeId, i.ratePercent, i.effectiveFrom, i.effectiveTo, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert tax rate');
  }
  async listTaxRates(tx: Tx, taxCodeId: string): Promise<TaxRateRow[]> {
    const r = await tx.query<TaxRateRow>(
      `SELECT ${TAX_RATE_COLS} FROM finance_tax_rate WHERE tax_code_id=$1 ORDER BY effective_from DESC`,
      [taxCodeId],
    );
    return r.rows;
  }

  // --- payment term -----------------------------------------------------------------------------
  async insertPaymentTerm(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string;
      basis: string;
      netDays: number | null;
      dayOfMonth: number | null;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PaymentTermRow> {
    const r = await tx.query<PaymentTermRow>(
      `INSERT INTO finance_payment_term (tenant_id, code, name, basis, net_days, day_of_month, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${PAYMENT_TERM_COLS}`,
      [i.tenantId, i.code, i.name, i.basis, i.netDays, i.dayOfMonth, i.description, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert payment term');
  }
  async findPaymentTerm(tx: Tx, id: string): Promise<PaymentTermRow | null> {
    const r = await tx.query<PaymentTermRow>(
      `SELECT ${PAYMENT_TERM_COLS} FROM finance_payment_term WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updatePaymentTerm(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      netDays: number | null;
      dayOfMonth: number | null;
      description: string | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<PaymentTermRow | null> {
    const r = await tx.query<PaymentTermRow>(
      `UPDATE finance_payment_term SET name=COALESCE($3,name), net_days=COALESCE($4,net_days), day_of_month=COALESCE($5,day_of_month), description=COALESCE($6,description), status=COALESCE($7,status), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PAYMENT_TERM_COLS}`,
      [i.id, i.expectedVersion, i.name, i.netDays, i.dayOfMonth, i.description, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listPaymentTerms(tx: Tx, status?: string): Promise<PaymentTermRow[]> {
    const r = await tx.query<PaymentTermRow>(
      `SELECT ${PAYMENT_TERM_COLS} FROM finance_payment_term WHERE ($1::text IS NULL OR status=$1) ORDER BY code`,
      [status ?? null],
    );
    return r.rows;
  }

  // --- finance configuration (versioned; immutable-after-publish; idempotency-keyed) ------------
  async insertConfig(
    tx: Tx,
    i: {
      tenantId: string;
      entityId: string;
      scope: string;
      versionNumber: number;
      settings: unknown;
      supersedesId: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ConfigRow> {
    const r = await tx.query<ConfigRow>(
      `INSERT INTO finance_config (tenant_id, entity_id, scope, version_number, settings, supersedes_id, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$9) RETURNING ${CONFIG_COLS}`,
      [
        i.tenantId,
        i.entityId,
        i.scope,
        i.versionNumber,
        JSON.stringify(i.settings ?? {}),
        i.supersedesId,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfig(tx: Tx, id: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM finance_config WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM finance_config WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async findActiveConfig(tx: Tx, entityId: string, scope: string): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM finance_config WHERE entity_id=$1 AND scope=$2 AND status='active'`,
      [entityId, scope],
    );
    return r.rows[0] ?? null;
  }
  async nextConfigVersion(tx: Tx, entityId: string, scope: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM finance_config WHERE entity_id=$1 AND scope=$2`,
      [entityId, scope],
    );
    return firstRow(r.rows, 'next config version').next;
  }
  /** Content patch — draft only (published config is immutable). CAS on version. */
  async updateConfigDraft(
    tx: Tx,
    i: { id: string; expectedVersion: number; settings: unknown; by: string | null },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE finance_config SET settings=$3::jsonb, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='draft' RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, JSON.stringify(i.settings ?? {}), i.by],
    );
    return r.rows[0] ?? null;
  }
  /**
   * The single config lifecycle-transition UPDATE. CAS on version. `contentHash` freezes at publish;
   * `supersededById` links a prior version to its successor; published_at stamps when moving to 'active'.
   */
  async transitionConfig(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash?: string | null;
      supersededById?: string | null;
      submittedBy?: string | null;
      by: string | null;
    },
  ): Promise<ConfigRow | null> {
    const r = await tx.query<ConfigRow>(
      `UPDATE finance_config SET
         status=$3,
         content_hash=COALESCE($4,content_hash),
         superseded_by_id=COALESCE($5,superseded_by_id),
         submitted_by=COALESCE($6,submitted_by), submitted_at=CASE WHEN $6::uuid IS NOT NULL THEN now() ELSE submitted_at END,
         published_at=CASE WHEN $3='active' THEN now() ELSE published_at END,
         updated_by=$7, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.toStatus,
        i.contentHash ?? null,
        i.supersededById ?? null,
        i.submittedBy ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx, i: { entityId: string; scope?: string }): Promise<ConfigRow[]> {
    const r = await tx.query<ConfigRow>(
      `SELECT ${CONFIG_COLS} FROM finance_config WHERE entity_id=$1 AND ($2::text IS NULL OR scope=$2) ORDER BY scope, version_number DESC`,
      [i.entityId, i.scope ?? null],
    );
    return r.rows;
  }
  async insertConfigHistory(
    tx: Tx,
    i: {
      tenantId: string;
      configId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO finance_config_history (tenant_id, config_id, from_status, to_status, reason, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.configId, i.fromStatus, i.toStatus, i.reason, i.by, i.correlationId],
    );
  }
  async listConfigHistory(tx: Tx, configId: string): Promise<ConfigHistoryRow[]> {
    const r = await tx.query<ConfigHistoryRow>(
      `SELECT ${CONFIG_HISTORY_COLS} FROM finance_config_history WHERE config_id=$1 ORDER BY created_at`,
      [configId],
    );
    return r.rows;
  }
}
