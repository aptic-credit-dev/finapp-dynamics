import { defineSuite } from '@finapp/test-runner';
import {
  compileExpression,
  ExpressionError,
  MAX_SOURCE_LENGTH,
  type WorkflowValue,
} from '../src/domain/expression.ts';

/**
 * ADR-024 expression language — PURE smoke suite. This is a security-critical sandbox, so the emphasis is
 * on abuse: every injection, host-object reach, and malformed input must be REJECTED, and every ambiguous
 * type must fail CLOSED. Correctness of the happy path is proven too, but the abuse cases carry the weight.
 */
export default defineSuite('m06-expression', (t) => {
  // Compile once, evaluate against an env — the common shape.
  const evalWith = (src: string, vars: readonly string[], env: Record<string, WorkflowValue>): boolean =>
    compileExpression(src, vars).evaluate(env);

  // --- valid: comparisons -------------------------------------------------------------------------
  t.equal(evalWith('amount > 100', ['amount'], { amount: 150 }), true, 'number > is true');
  t.equal(evalWith('amount > 100', ['amount'], { amount: 50 }), false, 'number > is false');
  t.equal(evalWith('amount >= 100', ['amount'], { amount: 100 }), true, '>= boundary');
  t.equal(evalWith('amount <= 100', ['amount'], { amount: 100 }), true, '<= boundary');
  t.equal(evalWith('amount < 100', ['amount'], { amount: 100 }), false, '< boundary');
  t.equal(evalWith("status == 'open'", ['status'], { status: 'open' }), true, 'string == equal');
  t.equal(evalWith("status != 'open'", ['status'], { status: 'closed' }), true, 'string != unequal');
  t.equal(evalWith('flag == true', ['flag'], { flag: true }), true, 'bool == true');
  t.equal(evalWith('flag == false', ['flag'], { flag: true }), false, 'bool == false');
  t.equal(evalWith('"a" < "b"', [], {}), true, 'string ordering lexicographic');

  // --- valid: logical combinations + precedence ----------------------------------------------------
  t.equal(evalWith('a && b', ['a', 'b'], { a: true, b: true }), true, '&& both true');
  t.equal(evalWith('a && b', ['a', 'b'], { a: true, b: false }), false, '&& one false');
  t.equal(evalWith('a || b', ['a', 'b'], { a: false, b: true }), true, '|| one true');
  t.equal(evalWith('!a', ['a'], { a: false }), true, 'not false is true');
  t.equal(evalWith('!!a', ['a'], { a: true }), true, 'double negation');
  t.equal(
    evalWith('a && b || c', ['a', 'b', 'c'], { a: false, b: true, c: true }),
    true,
    '&& binds tighter than ||',
  );
  t.equal(
    evalWith('a || b && c', ['a', 'b', 'c'], { a: true, b: false, c: false }),
    true,
    '|| short-circuits over &&',
  );
  t.equal(
    evalWith('(a || b) && c', ['a', 'b', 'c'], { a: true, b: false, c: false }),
    false,
    'parens override',
  );

  // --- valid: arithmetic + precedence --------------------------------------------------------------
  t.equal(evalWith('2 + 3 * 4 == 14', [], {}), true, '* before +');
  t.equal(evalWith('(2 + 3) * 4 == 20', [], {}), true, 'parens change arithmetic order');
  t.equal(evalWith('10 - 4 - 2 == 4', [], {}), true, 'subtraction left-associative');
  t.equal(evalWith('10 / 4 == 2.5', [], {}), true, 'decimal division');
  t.equal(evalWith('10 % 3 == 1', [], {}), true, 'modulo');
  t.equal(evalWith('-5 + 3 == -2', [], {}), true, 'unary minus');
  t.equal(evalWith('abs(-7) == 7', [], {}), true, 'abs of unary-minus literal');
  t.equal(evalWith('amount * 2 > 100', ['amount'], { amount: 60 }), true, 'arithmetic feeds comparison');

  // --- valid: membership (in) ----------------------------------------------------------------------
  t.equal(evalWith("status in ['open', 'closed']", ['status'], { status: 'open' }), true, 'in list hit');
  t.equal(evalWith("status in ['open', 'closed']", ['status'], { status: 'void' }), false, 'in list miss');
  t.equal(evalWith('n in [1, 2, 3]', ['n'], { n: 2 }), true, 'numeric in');
  t.equal(evalWith('n in []', ['n'], { n: 2 }), false, 'empty list membership is false');
  t.equal(evalWith("status in ['open']", ['status'], { status: 5 }), false, 'type-mismatched in is false');

  // --- valid: allow-listed functions ---------------------------------------------------------------
  t.equal(evalWith("lower(name) == 'acme'", ['name'], { name: 'ACME' }), true, 'lower()');
  t.equal(evalWith("upper(name) == 'ACME'", ['name'], { name: 'acme' }), true, 'upper()');
  t.equal(evalWith('len(name) == 4', ['name'], { name: 'acme' }), true, 'len()');
  t.equal(evalWith('isNull(x)', ['x'], { x: null }), true, 'isNull true');
  t.equal(evalWith('isNull(x)', ['x'], { x: 'v' }), false, 'isNull false');
  t.equal(
    evalWith("coalesce(x, 'fallback') == 'fallback'", ['x'], { x: null }),
    true,
    'coalesce takes fallback',
  );
  t.equal(
    evalWith("coalesce(x, 'fallback') == 'v'", ['x'], { x: 'v' }),
    true,
    'coalesce takes present value',
  );

  // --- valid: null handling ------------------------------------------------------------------------
  t.equal(evalWith('x == null', ['x'], { x: null }), true, 'null == null');
  t.equal(evalWith('x == null', ['x'], { x: 5 }), false, 'value == null is false');
  t.equal(evalWith('x != null', ['x'], { x: 5 }), true, 'value != null is true');
  t.equal(evalWith('x == null', ['x'], {}), true, 'absent declared variable reads as null');

  // --- unknown identifier is a compile error -------------------------------------------------------
  t.throws(() => compileExpression('ghost > 1', ['amount']), 'unknown identifier is rejected');
  t.throws(() => compileExpression('lower(ghost)', []), 'unknown identifier inside a call is rejected');

  // --- injection / abuse: every one must be REJECTED -----------------------------------------------
  t.throws(() => compileExpression("eval('x')", []), 'eval() is not an allow-listed function');
  t.throws(() => compileExpression("Function('return 1')()", []), 'Function constructor is rejected');
  t.throws(() => compileExpression("require('fs')", []), 'require() is rejected');
  t.throws(
    () => compileExpression('process.exit(1)', ['process']),
    'property access (process.exit) is rejected',
  );
  t.throws(() => compileExpression('a.b', ['a']), 'dot property access is rejected');
  t.throws(() => compileExpression("a['b']", ['a']), 'bracket indexing is rejected');
  t.throws(() => compileExpression('x = 5', ['x']), 'assignment is rejected');
  t.throws(() => compileExpression('1; DROP TABLE t', []), 'statement separator / SQL is rejected');
  t.throws(() => compileExpression('`backtick`', []), 'backtick template is rejected');
  t.throws(() => compileExpression('constructor', []), 'bare constructor is an unknown identifier');
  t.throws(() => compileExpression('__proto__ == 1', []), '__proto__ is an unknown identifier');
  t.throws(() => compileExpression('danger()', []), 'unknown function danger() is rejected');
  t.throws(() => compileExpression('a & b', ['a', 'b']), 'bitwise & is rejected');
  t.throws(() => compileExpression('a | b', ['a', 'b']), 'bitwise | is rejected');
  t.throws(() => compileExpression("['a'] == 1", []), 'list literal outside in is rejected');

  // --- malformed input -----------------------------------------------------------------------------
  t.throws(() => compileExpression("status == 'unterminated", ['status']), 'unterminated string is rejected');
  t.throws(() => compileExpression('(a && b', ['a', 'b']), 'unbalanced parens are rejected');
  t.throws(() => compileExpression('a && b)', ['a', 'b']), 'extra close paren is rejected');
  t.throws(() => compileExpression('', []), 'empty expression is rejected');
  t.throws(() => compileExpression('   ', []), 'whitespace-only expression is rejected');
  t.throws(() => compileExpression('1 + 1', []), 'non-boolean top-level (1 + 1) is rejected');
  t.throws(() => compileExpression("'just a string'", []), 'non-boolean top-level (string) is rejected');
  t.throws(() => compileExpression('a b', ['a', 'b']), 'two adjacent operands are rejected');

  // A bare variable is statically unknown, so the boolean guard triggers at evaluate time.
  t.throws(
    () => compileExpression('amount', ['amount']).evaluate({ amount: 5 }),
    'non-boolean var evaluates to error',
  );

  // --- fail-closed type checks at evaluate time ----------------------------------------------------
  t.throws(
    () => compileExpression('a < b', ['a', 'b']).evaluate({ a: 'x', b: 5 }),
    'ordering mixed types denies',
  );
  t.throws(
    () => compileExpression('a < b', ['a', 'b']).evaluate({ a: null, b: 5 }),
    'ordering with null denies',
  );
  t.throws(
    () => compileExpression('a + b', ['a', 'b']).evaluate({ a: 'x', b: 1 }),
    'arithmetic on non-number denies',
  );
  t.throws(
    () => compileExpression('a && b', ['a', 'b']).evaluate({ a: 1, b: true }),
    'logical on non-boolean denies',
  );
  t.throws(() => compileExpression('lower(x)', ['x']).evaluate({ x: 5 }), 'lower() on non-string denies');
  t.throws(
    () => compileExpression('abs(x) > 0', ['x']).evaluate({ x: 'nope' }),
    'abs() on non-number denies',
  );

  // --- limits --------------------------------------------------------------------------------------
  const overLong = 'a || '.repeat(MAX_SOURCE_LENGTH) + 'a';
  t.throws(() => compileExpression(overLong, ['a']), 'over-length source is rejected');
  const deep = '('.repeat(200) + 'a' + ')'.repeat(200);
  t.throws(() => compileExpression(deep, ['a']), 'over-deep nesting is rejected');
  const manyNodes = Array.from({ length: 300 }, () => 'a').join(' && ');
  t.throws(() => compileExpression(manyNodes, ['a']), 'over-many nodes is rejected');

  // --- division / modulo by zero fail closed -------------------------------------------------------
  t.throws(() => compileExpression('1 / x == 1', ['x']).evaluate({ x: 0 }), 'division by zero denies');
  t.throws(() => compileExpression('1 % x == 0', ['x']).evaluate({ x: 0 }), 'modulo by zero denies');

  // --- structured error surface --------------------------------------------------------------------
  let captured: unknown;
  try {
    compileExpression('ghost', []);
  } catch (e) {
    captured = e;
  }
  t.ok(captured instanceof ExpressionError, 'errors are ExpressionError instances');
  t.equal((captured as ExpressionError).code, 'UNKNOWN_IDENTIFIER', 'error carries a machine-readable code');
  t.ok(typeof (captured as ExpressionError).position === 'number', 'error carries a source position');

  // --- introspection: declared variables actually used ---------------------------------------------
  const compiled = compileExpression('a > 1 && b == c', ['a', 'b', 'c', 'unused']);
  t.deepEqual(
    [...compiled.variables],
    ['a', 'b', 'c'],
    'variables lists only referenced identifiers, sorted',
  );

  // --- determinism: same input + env -> same output ------------------------------------------------
  const det = compileExpression("amount > 100 && status in ['open', 'pending']", ['amount', 'status']);
  const env = { amount: 250, status: 'open' };
  const first = det.evaluate(env);
  const second = det.evaluate(env);
  t.equal(first, second, 'evaluate is deterministic across repeated calls');
  t.equal(first, true, 'deterministic result is the expected value');
  t.equal(det.evaluate({ amount: 10, status: 'open' }), false, 'same expression, different env, recomputed');
});
