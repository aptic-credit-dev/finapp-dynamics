import { defineSuite } from '@finapp/test-runner';
import {
  FINANCE_LIMITS,
  FinanceError,
  ACCOUNT_CLASSES,
  isAccountClass,
  normalSideOf,
  BALANCE_SIDES,
  isBalanceSide,
  ENTITY_STATUSES,
  isEntityStatus,
  ACCOUNT_STATUSES,
  isAccountStatus,
  FISCAL_YEAR_STATUSES,
  isFiscalYearStatus,
  PERIOD_STATUSES,
  isPeriodStatus,
  isPeriodPostable,
  CURRENCY_STATUSES,
  isCurrencyStatus,
  RATE_TYPES,
  isRateType,
  ENTITY_CURRENCY_ROLES,
  isEntityCurrencyRole,
  COST_CENTER_STATUSES,
  isCostCenterStatus,
  DIMENSION_KINDS,
  isDimensionKind,
  TAX_TYPES,
  isTaxType,
  PAYMENT_TERM_BASES,
  isPaymentTermBasis,
  checkAccountTransition,
  isAccountTerminal,
  isAccountPostable,
  checkPeriodTransition,
  isPeriodTerminal,
  checkFiscalYearTransition,
  CONFIG_STATUSES,
  checkConfigTransition,
  isConfigFrozen,
  isConfigActive,
  isDecimalString,
  isZeroDecimal,
  isPositiveDecimal,
  isValidRate,
  isValidPercentage,
  isCurrencyCode,
  isMinorUnits,
  formatFinanceNumber,
  isValidFinanceNumber,
  contentHashOf,
  canonicalJson,
  SystemClock,
  FixedClock,
  ALL_M19_PERMISSIONS,
  M19_PRIVILEGED_PERMISSIONS,
  ALL_M19_AUDIT_CODES,
  FIN_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m19-finance', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(ACCOUNT_CLASSES.length, 5, 'five account classes');
  t.ok(
    isAccountClass('asset') && isAccountClass('expense') && !isAccountClass('vibes'),
    'account class recognized',
  );
  t.equal(normalSideOf('asset'), 'debit', 'assets are debit-normal');
  t.equal(normalSideOf('expense'), 'debit', 'expenses are debit-normal');
  t.equal(normalSideOf('liability'), 'credit', 'liabilities are credit-normal');
  t.equal(normalSideOf('equity'), 'credit', 'equity is credit-normal');
  t.equal(normalSideOf('income'), 'credit', 'income is credit-normal');
  t.equal(BALANCE_SIDES.length, 2, 'two balance sides');
  t.ok(
    isBalanceSide('debit') && isBalanceSide('credit') && !isBalanceSide('sideways'),
    'balance side recognized',
  );
  t.equal(ENTITY_STATUSES.length, 3, 'three entity statuses');
  t.ok(isEntityStatus('active') && !isEntityStatus('zombie'), 'entity status recognized');
  t.equal(ACCOUNT_STATUSES.length, 4, 'four account statuses');
  t.ok(
    isAccountStatus('draft') && isAccountStatus('archived') && !isAccountStatus('haunted'),
    'account status recognized',
  );
  t.equal(FISCAL_YEAR_STATUSES.length, 2, 'two fiscal-year statuses');
  t.ok(
    isFiscalYearStatus('open') && isFiscalYearStatus('closed') && !isFiscalYearStatus('ajar'),
    'fiscal-year status recognized',
  );
  t.equal(PERIOD_STATUSES.length, 3, 'three period statuses');
  t.ok(
    isPeriodStatus('open') && isPeriodStatus('locked') && !isPeriodStatus('quantum'),
    'period status recognized',
  );
  t.ok(
    isPeriodPostable('open') && !isPeriodPostable('closed') && !isPeriodPostable('locked'),
    'only open periods are postable',
  );
  t.equal(CURRENCY_STATUSES.length, 2, 'two currency statuses');
  t.ok(isCurrencyStatus('active') && !isCurrencyStatus('crypto'), 'currency status recognized');
  t.equal(RATE_TYPES.length, 5, 'five rate types');
  t.ok(isRateType('spot') && isRateType('closing') && !isRateType('guess'), 'rate type recognized');
  t.equal(ENTITY_CURRENCY_ROLES.length, 3, 'three entity-currency roles');
  t.ok(
    isEntityCurrencyRole('functional') && !isEntityCurrencyRole('imaginary'),
    'entity-currency role recognized',
  );
  t.equal(COST_CENTER_STATUSES.length, 3, 'three cost-centre statuses');
  t.ok(isCostCenterStatus('active') && !isCostCenterStatus('vibes'), 'cost-centre status recognized');
  t.equal(DIMENSION_KINDS.length, 6, 'six dimension kinds');
  t.ok(
    isDimensionKind('project') && isDimensionKind('custom') && !isDimensionKind('mood'),
    'dimension kind recognized',
  );
  t.equal(TAX_TYPES.length, 7, 'seven tax types');
  t.ok(isTaxType('vat') && isTaxType('withholding') && !isTaxType('bribe'), 'tax type recognized');
  t.equal(PAYMENT_TERM_BASES.length, 4, 'four payment-term bases');
  t.ok(
    isPaymentTermBasis('net_days') && isPaymentTermBasis('immediate') && !isPaymentTermBasis('whenever'),
    'payment-term basis recognized',
  );
  t.ok(new FinanceError('X', 'y') instanceof Error, 'FinanceError is an Error');
  t.equal(FINANCE_LIMITS.maxSearchLimit, 200, 'search bounded');

  // --- lifecycles -------------------------------------------------------------------------------
  t.ok(checkAccountTransition('draft', 'active').ok, 'account draft -> active ok');
  t.ok(checkAccountTransition('active', 'inactive').ok, 'account active -> inactive ok');
  t.ok(checkAccountTransition('active', 'archived').ok, 'account active -> archived ok');
  t.ok(!checkAccountTransition('archived', 'active').ok, 'account archived is terminal');
  t.ok(isAccountTerminal('archived') && !isAccountTerminal('active'), 'account terminal check');
  t.ok(
    isAccountPostable('active') && !isAccountPostable('draft') && !isAccountPostable('inactive'),
    'only active accounts postable',
  );
  t.ok(checkPeriodTransition('open', 'closed').ok, 'period open -> closed ok');
  t.ok(checkPeriodTransition('closed', 'open').ok, 'period closed -> reopen ok');
  t.ok(
    checkPeriodTransition('open', 'locked').ok && checkPeriodTransition('closed', 'locked').ok,
    'period -> locked ok',
  );
  t.ok(!checkPeriodTransition('locked', 'open').ok, 'period locked is terminal');
  t.ok(isPeriodTerminal('locked') && !isPeriodTerminal('closed'), 'period terminal check');
  t.ok(
    checkFiscalYearTransition('open', 'closed').ok && checkFiscalYearTransition('closed', 'open').ok,
    'fiscal year close/reopen ok',
  );
  t.equal(CONFIG_STATUSES.length, 4, 'four config statuses');
  t.ok(checkConfigTransition('draft', 'active').ok, 'config draft -> active ok');
  t.ok(checkConfigTransition('active', 'superseded').ok, 'config active -> superseded ok');
  t.ok(!checkConfigTransition('draft', 'superseded').ok, 'config draft -> superseded rejected');
  t.ok(
    isConfigFrozen('active') && isConfigFrozen('superseded') && !isConfigFrozen('draft'),
    'config frozen after publish',
  );
  t.ok(isConfigActive('active') && !isConfigActive('draft'), 'config active check');

  // --- decimal-safe money (NO float) ------------------------------------------------------------
  t.ok(
    isDecimalString('123.45') && isDecimalString('-0.001') && isDecimalString('0'),
    'canonical decimals accepted',
  );
  t.ok(
    !isDecimalString('1.2.3') && !isDecimalString('abc') && !isDecimalString('1e5') && !isDecimalString(1.5),
    'malformed / float / number rejected',
  );
  t.ok(isZeroDecimal('0') && isZeroDecimal('-0.00') && !isZeroDecimal('0.01'), 'zero decimal detected');
  t.ok(
    isPositiveDecimal('0.01') && !isPositiveDecimal('0') && !isPositiveDecimal('-1'),
    'positive decimal detected',
  );
  t.ok(
    isValidRate('1.234567') &&
      isValidRate('0.5') &&
      !isValidRate('0') &&
      !isValidRate('-1') &&
      !isValidRate('1e3'),
    'FX rate must be positive exact decimal',
  );
  t.ok(
    isValidPercentage('16') && isValidPercentage('0') && isValidPercentage('7.5') && !isValidPercentage('-1'),
    'tax percentage non-negative exact decimal',
  );
  t.ok(
    isCurrencyCode('USD') && isCurrencyCode('KES') && !isCurrencyCode('usd') && !isCurrencyCode('DOLLAR'),
    'ISO currency code shape',
  );
  t.ok(
    isMinorUnits(2) && isMinorUnits(0) && !isMinorUnits(7) && !isMinorUnits(2.5),
    'minor units bounded integer',
  );

  // --- finance number + hash + clock ------------------------------------------------------------
  t.ok(
    isValidFinanceNumber(formatFinanceNumber('0123456789abcdef-0000')),
    'formatted finance number is valid',
  );
  t.equal(formatFinanceNumber('0123456789ab'), 'FIN-0123456789ab', 'finance number format is deterministic');
  t.ok(
    !isValidFinanceNumber('FIN-XYZ') && !isValidFinanceNumber('nope'),
    'malformed finance number rejected',
  );
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'content hash is key-order independent',
  );
  t.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}', 'canonical json sorts keys');
  t.ok(new SystemClock().now() > 0, 'system clock returns epoch ms');
  const fixed = new FixedClock(1_700_000_000_000);
  fixed.advance(1000);
  t.equal(fixed.now(), 1_700_000_001_000, 'fixed clock advances deterministically');

  // --- permissions + audit codes ----------------------------------------------------------------
  t.equal(ALL_M19_PERMISSIONS.length, 45, 'forty-five permissions');
  t.equal(M19_PRIVILEGED_PERMISSIONS.length, 16, 'sixteen privileged permissions');
  t.ok(
    ALL_M19_PERMISSIONS.every((p) => p.startsWith('finance.') && p.split('.').length === 3),
    'permissions are three-segment finance.*',
  );
  t.equal(ALL_M19_AUDIT_CODES.length, 34, 'thirty-four audit codes');
  t.ok(
    ALL_M19_AUDIT_CODES.every((c) => c.startsWith(FIN_AUDIT_PREFIX) && c.split('_').length >= 3),
    'audit codes are FIN_ prefixed with >= 3 segments',
  );
  t.equal(new Set(ALL_M19_AUDIT_CODES).size, ALL_M19_AUDIT_CODES.length, 'audit codes unique');
});
