/**
 * ADR-024 — Safe workflow condition expressions.
 *
 * A sandboxed, side-effect-free, interpreted boolean/arithmetic mini-language for workflow gateway
 * conditions. Source text is tokenized and parsed to an immutable AST, validated against a fixed set of
 * declared variables, and interpreted over a plain value environment. It is IMPOSSIBLE to execute
 * arbitrary code: there is no `eval`, no `Function` constructor, no `vm`, no property access, no indexing,
 * no host-object reach, and no I/O. The grammar has no loops and the parser guards its own recursion depth,
 * so evaluation always terminates and always fails CLOSED (any ambiguity throws {@link ExpressionError}).
 *
 * Pure TypeScript: runs under `node --experimental-strip-types` with no build and no imports.
 */

export type WorkflowValue = string | number | boolean | null;

/** A validated, executable expression. `evaluate` is deterministic and side-effect-free. */
export interface CompiledExpression {
  evaluate(env: Record<string, WorkflowValue>): boolean;
  readonly variables: readonly string[];
}

// ---------------------------------------------------------------------------------------------------
// Hard limits — bound DoS. Exceeding any of these is an ExpressionError.
// ---------------------------------------------------------------------------------------------------

export const MAX_SOURCE_LENGTH = 2000;
export const MAX_AST_NODES = 200;
export const MAX_IDENTIFIER_LENGTH = 64;
export const MAX_PARSE_DEPTH = 50;

export type ExpressionErrorCode =
  | 'SOURCE_TOO_LONG'
  | 'EMPTY'
  | 'UNEXPECTED_CHAR'
  | 'UNTERMINATED_STRING'
  | 'SYNTAX'
  | 'IDENTIFIER_TOO_LONG'
  | 'UNKNOWN_IDENTIFIER'
  | 'UNKNOWN_FUNCTION'
  | 'ARITY'
  | 'TYPE'
  | 'DIV_BY_ZERO'
  | 'NOT_BOOLEAN'
  | 'TOO_MANY_NODES'
  | 'TOO_DEEP';

/** Structured, fail-closed error carrying a machine-readable `code` and an optional source `position`. */
export class ExpressionError extends Error {
  readonly code: ExpressionErrorCode;
  readonly position?: number;

  constructor(code: ExpressionErrorCode, message: string, position?: number) {
    super(position === undefined ? `[${code}] ${message}` : `[${code}] ${message} (at ${position})`);
    this.name = 'ExpressionError';
    this.code = code;
    if (position !== undefined) this.position = position;
    // Keep `instanceof` working after transpilation/strip-types.
    Object.setPrototypeOf(this, ExpressionError.prototype);
  }
}

/** The complete allow-list of callable functions with their exact arity. Nothing else is callable. */
const FUNCTIONS: Readonly<Record<string, number>> = Object.freeze({
  lower: 1,
  upper: 1,
  len: 1,
  abs: 1,
  isNull: 1,
  coalesce: 2,
});

// ---------------------------------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------------------------------

type BinaryOp = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%';

type Node =
  | { readonly type: 'lit'; readonly value: WorkflowValue }
  | { readonly type: 'var'; readonly name: string }
  | { readonly type: 'unary'; readonly op: '!' | '-'; readonly operand: Node }
  | { readonly type: 'binary'; readonly op: BinaryOp; readonly left: Node; readonly right: Node }
  | { readonly type: 'in'; readonly left: Node; readonly list: readonly Node[] }
  | { readonly type: 'call'; readonly name: string; readonly args: readonly Node[] };

type StaticType = 'bool' | 'num' | 'str' | 'null' | 'unknown';

// ---------------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------------

type TokenKind = 'num' | 'str' | 'ident' | 'keyword' | 'op' | 'eof';

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly num?: number;
  readonly pos: number;
}

const KEYWORDS = new Set(['true', 'false', 'null', 'in']);
const TWO_CHAR_OPS = new Set(['&&', '||', '==', '!=', '<=', '>=']);
const ONE_CHAR_OPS = new Set(['!', '<', '>', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',']);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source.charAt(i);

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      i += 1;
      continue;
    }

    // string literal — single or double quoted, with \\ \' \" escapes only
    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i += 1;
      let out = '';
      let closed = false;
      while (i < n) {
        const c = source.charAt(i);
        if (c === '\\') {
          const next = source[i + 1];
          if (next === '\\' || next === "'" || next === '"') {
            out += next;
            i += 2;
            continue;
          }
          throw new ExpressionError('SYNTAX', `invalid string escape "\\${next ?? ''}"`, i);
        }
        if (c === quote) {
          closed = true;
          i += 1;
          break;
        }
        if (c === '\n' || c === '\r') {
          throw new ExpressionError('UNTERMINATED_STRING', 'string literal spans a newline', start);
        }
        out += c;
        i += 1;
      }
      if (!closed) throw new ExpressionError('UNTERMINATED_STRING', 'unterminated string literal', start);
      tokens.push({ kind: 'str', value: out, pos: start });
      continue;
    }

    // number literal — integer or decimal, no exponent, no leading/trailing dot
    if (isDigit(ch)) {
      const start = i;
      while (i < n && isDigit(source.charAt(i))) i += 1;
      if (i < n && source.charAt(i) === '.') {
        i += 1;
        if (i >= n || !isDigit(source.charAt(i))) {
          throw new ExpressionError('UNEXPECTED_CHAR', 'malformed number literal', start);
        }
        while (i < n && isDigit(source.charAt(i))) i += 1;
      }
      const raw = source.slice(start, i);
      tokens.push({ kind: 'num', value: raw, num: Number(raw), pos: start });
      continue;
    }

    // identifier or keyword
    if (isIdentStart(ch)) {
      const start = i;
      while (i < n && isIdentPart(source.charAt(i))) i += 1;
      const raw = source.slice(start, i);
      if (raw.length > MAX_IDENTIFIER_LENGTH) {
        throw new ExpressionError(
          'IDENTIFIER_TOO_LONG',
          `identifier exceeds ${MAX_IDENTIFIER_LENGTH} characters`,
          start,
        );
      }
      tokens.push({ kind: KEYWORDS.has(raw) ? 'keyword' : 'ident', value: raw, pos: start });
      continue;
    }

    // two-char operators
    if (i + 1 < n) {
      const two = source.slice(i, i + 2);
      if (TWO_CHAR_OPS.has(two)) {
        tokens.push({ kind: 'op', value: two, pos: i });
        i += 2;
        continue;
      }
    }

    // one-char operators / punctuation
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }

    // A lone '&' or '|' (not '&&'/'||'), or any other byte, is a hard reject.
    throw new ExpressionError('UNEXPECTED_CHAR', `unexpected character "${ch}"`, i);
  }

  tokens.push({ kind: 'eof', value: '<eof>', pos: n });
  return tokens;
}

// ---------------------------------------------------------------------------------------------------
// Parser — recursive descent, depth- and node-bounded
// ---------------------------------------------------------------------------------------------------

class Parser {
  private readonly tokens: Token[];
  private readonly declared: ReadonlySet<string>;
  private readonly used: Set<string>;
  private index: number;
  private nodeCount: number;
  private depth: number;

  constructor(tokens: Token[], declared: ReadonlySet<string>) {
    this.tokens = tokens;
    this.declared = declared;
    this.used = new Set<string>();
    this.index = 0;
    this.nodeCount = 0;
    this.depth = 0;
  }

  usedVariables(): string[] {
    return [...this.used];
  }

  private peek(): Token {
    const t = this.tokens[this.index];
    // The tokenizer always appends an 'eof' token and next() never advances past it, so this is defined;
    // guard rather than assert to satisfy the no-non-null-assertion rule and stay fail-closed.
    if (t === undefined) throw new ExpressionError('SYNTAX', 'unexpected end of expression');
    return t;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.index += 1;
    return t;
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t.kind === 'op' && t.value === value;
  }

  private isKeyword(value: string): boolean {
    const t = this.peek();
    return t.kind === 'keyword' && t.value === value;
  }

  private expectOp(value: string): void {
    if (!this.isOp(value)) {
      const t = this.peek();
      throw new ExpressionError('SYNTAX', `expected "${value}" but found "${t.value}"`, t.pos);
    }
    this.next();
  }

  private mk(node: Node): Node {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new ExpressionError('TOO_MANY_NODES', `expression exceeds ${MAX_AST_NODES} nodes`);
    }
    return node;
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new ExpressionError('TOO_DEEP', `expression nesting exceeds ${MAX_PARSE_DEPTH}`, this.peek().pos);
    }
  }

  private leave(): void {
    this.depth -= 1;
  }

  /** Entry point. Parses the whole token stream and rejects any trailing garbage. */
  parseProgram(): Node {
    if (this.peek().kind === 'eof') {
      throw new ExpressionError('EMPTY', 'empty expression');
    }
    const node = this.parseOr();
    const tail = this.peek();
    if (tail.kind !== 'eof') {
      throw new ExpressionError('SYNTAX', `unexpected trailing token "${tail.value}"`, tail.pos);
    }
    return node;
  }

  private parseOr(): Node {
    // The single re-entry point for grouping (parens), call args and list items — so guarding depth
    // here bounds every form of nesting, including `((((...))))` that produces almost no nodes.
    this.enter();
    try {
      let left = this.parseAnd();
      while (this.isOp('||')) {
        this.next();
        const right = this.parseAnd();
        left = this.mk({ type: 'binary', op: '||', left, right });
      }
      return left;
    } finally {
      this.leave();
    }
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isOp('&&')) {
      this.next();
      const right = this.parseNot();
      left = this.mk({ type: 'binary', op: '&&', left, right });
    }
    return left;
  }

  private parseNot(): Node {
    if (this.isOp('!')) {
      this.next();
      const operand = this.parseNot();
      return this.mk({ type: 'unary', op: '!', operand });
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseAdditive();

    if (this.isKeyword('in')) {
      this.next();
      const list = this.parseList();
      return this.mk({ type: 'in', left, list });
    }

    const t = this.peek();
    if (
      t.kind === 'op' &&
      (t.value === '==' ||
        t.value === '!=' ||
        t.value === '<' ||
        t.value === '<=' ||
        t.value === '>' ||
        t.value === '>=')
    ) {
      this.next();
      const right = this.parseAdditive();
      // Non-associative: a == b == c is a syntax error, caught as trailing token by parseProgram.
      return this.mk({ type: 'binary', op: t.value as BinaryOp, left, right });
    }

    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value as BinaryOp;
      const right = this.parseMultiplicative();
      left = this.mk({ type: 'binary', op, left, right });
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().value as BinaryOp;
      const right = this.parseUnary();
      left = this.mk({ type: 'binary', op, left, right });
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.isOp('-')) {
      this.next();
      const operand = this.parseUnary();
      return this.mk({ type: 'unary', op: '-', operand });
    }
    return this.parsePrimary();
  }

  private parseList(): Node[] {
    this.expectOp('[');
    const items: Node[] = [];
    if (!this.isOp(']')) {
      items.push(this.parseUnary());
      while (this.isOp(',')) {
        this.next();
        items.push(this.parseUnary());
      }
    }
    this.expectOp(']');
    return items;
  }

  private parsePrimary(): Node {
    const t = this.peek();

    if (t.kind === 'num') {
      this.next();
      return this.mk({ type: 'lit', value: t.num ?? Number(t.value) });
    }

    if (t.kind === 'str') {
      this.next();
      return this.mk({ type: 'lit', value: t.value });
    }

    if (t.kind === 'keyword') {
      if (t.value === 'true' || t.value === 'false') {
        this.next();
        return this.mk({ type: 'lit', value: t.value === 'true' });
      }
      if (t.value === 'null') {
        this.next();
        return this.mk({ type: 'lit', value: null });
      }
      // `in` here means a missing left operand.
      throw new ExpressionError('SYNTAX', `unexpected keyword "${t.value}"`, t.pos);
    }

    if (this.isOp('(')) {
      this.next();
      const inner = this.parseOr();
      this.expectOp(')');
      return inner;
    }

    if (t.kind === 'ident') {
      this.next();
      if (this.isOp('(')) {
        return this.parseCall(t.value, t.pos);
      }
      // A plain variable reference — must have been declared.
      if (!this.declared.has(t.value)) {
        throw new ExpressionError('UNKNOWN_IDENTIFIER', `unknown identifier "${t.value}"`, t.pos);
      }
      this.used.add(t.value);
      return this.mk({ type: 'var', name: t.value });
    }

    // `[` outside of an `in` list, a stray `)` / `]` / `,`, or eof all land here.
    throw new ExpressionError('SYNTAX', `unexpected token "${t.value}"`, t.pos);
  }

  private parseCall(name: string, pos: number): Node {
    const arity = FUNCTIONS[name];
    if (arity === undefined) {
      throw new ExpressionError('UNKNOWN_FUNCTION', `unknown function "${name}"`, pos);
    }
    this.expectOp('(');
    const args: Node[] = [];
    if (!this.isOp(')')) {
      args.push(this.parseOr());
      while (this.isOp(',')) {
        this.next();
        args.push(this.parseOr());
      }
    }
    this.expectOp(')');
    if (args.length !== arity) {
      throw new ExpressionError(
        'ARITY',
        `function "${name}" expects ${arity} argument(s), got ${args.length}`,
        pos,
      );
    }
    return this.mk({ type: 'call', name, args });
  }
}

// ---------------------------------------------------------------------------------------------------
// Static type inference — reject a statically non-boolean top level at compile time (fail closed early).
// ---------------------------------------------------------------------------------------------------

function staticType(node: Node): StaticType {
  switch (node.type) {
    case 'lit':
      if (node.value === null) return 'null';
      if (typeof node.value === 'boolean') return 'bool';
      if (typeof node.value === 'number') return 'num';
      return 'str';
    case 'var':
      return 'unknown';
    case 'unary':
      return node.op === '!' ? 'bool' : 'num';
    case 'in':
      return 'bool';
    case 'binary':
      switch (node.op) {
        case '&&':
        case '||':
        case '==':
        case '!=':
        case '<':
        case '<=':
        case '>':
        case '>=':
          return 'bool';
        default:
          return 'num';
      }
    case 'call':
      switch (node.name) {
        case 'lower':
        case 'upper':
          return 'str';
        case 'len':
        case 'abs':
          return 'num';
        case 'isNull':
          return 'bool';
        default:
          return 'unknown'; // coalesce
      }
  }
}

// ---------------------------------------------------------------------------------------------------
// Interpreter — deterministic, side-effect-free, fail-closed on every type ambiguity.
// ---------------------------------------------------------------------------------------------------

function typeName(v: WorkflowValue): string {
  return v === null ? 'null' : typeof v;
}

/** Membership/equality: null==null only; different non-null types are simply not equal (never throws). */
function valuesEqual(a: WorkflowValue, b: WorkflowValue): boolean {
  if (a === null || b === null) return a === null && b === null;
  if (typeof a !== typeof b) return false;
  return a === b;
}

function expectBoolean(v: WorkflowValue): boolean {
  if (typeof v !== 'boolean') {
    throw new ExpressionError('TYPE', `expected a boolean, got ${typeName(v)}`);
  }
  return v;
}

function expectNumber(v: WorkflowValue): number {
  if (typeof v !== 'number') {
    throw new ExpressionError('TYPE', `expected a number, got ${typeName(v)}`);
  }
  return v;
}

/** Relational comparison over two same-typed comparable operands (both number or both string). */
function orderCompare<T extends number | string>(op: '<' | '<=' | '>' | '>=', a: T, b: T): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

function evalNode(node: Node, env: Record<string, WorkflowValue>): WorkflowValue {
  switch (node.type) {
    case 'lit':
      return node.value;

    case 'var': {
      const v = env[node.name];
      // An absent declared variable reads as null — deterministic and fail-safe (never undefined).
      return v === undefined ? null : v;
    }

    case 'unary': {
      if (node.op === '!') {
        return !expectBoolean(evalNode(node.operand, env));
      }
      return -expectNumber(evalNode(node.operand, env));
    }

    case 'in': {
      const left = evalNode(node.left, env);
      for (const item of node.list) {
        if (valuesEqual(left, evalNode(item, env))) return true;
      }
      return false;
    }

    case 'call':
      return evalCall(node, env);

    case 'binary':
      return evalBinary(node, env);
  }
}

function evalBinary(
  node: Extract<Node, { type: 'binary' }>,
  env: Record<string, WorkflowValue>,
): WorkflowValue {
  const op = node.op;

  // Logical operators short-circuit and require boolean operands.
  if (op === '&&') {
    const l = expectBoolean(evalNode(node.left, env));
    if (!l) return false;
    return expectBoolean(evalNode(node.right, env));
  }
  if (op === '||') {
    const l = expectBoolean(evalNode(node.left, env));
    if (l) return true;
    return expectBoolean(evalNode(node.right, env));
  }

  const l = evalNode(node.left, env);
  const r = evalNode(node.right, env);

  if (op === '==') return valuesEqual(l, r);
  if (op === '!=') return !valuesEqual(l, r);

  // Ordering — only same-typed numbers or same-typed strings; null and mixed types fail closed.
  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    if (typeof l === 'number' && typeof r === 'number') return orderCompare(op, l, r);
    if (typeof l === 'string' && typeof r === 'string') return orderCompare(op, l, r);
    throw new ExpressionError('TYPE', `cannot order ${typeName(l)} and ${typeName(r)} with "${op}"`);
  }

  // Arithmetic — numbers only; division/modulo by zero fails closed.
  const ln = expectNumber(l);
  const rn = expectNumber(r);
  switch (op) {
    case '+':
      return ln + rn;
    case '-':
      return ln - rn;
    case '*':
      return ln * rn;
    case '/':
      if (rn === 0) throw new ExpressionError('DIV_BY_ZERO', 'division by zero');
      return ln / rn;
    default: // '%'
      if (rn === 0) throw new ExpressionError('DIV_BY_ZERO', 'modulo by zero');
      return ln % rn;
  }
}

function evalCall(node: Extract<Node, { type: 'call' }>, env: Record<string, WorkflowValue>): WorkflowValue {
  const arg0 = node.args[0];
  // Arity was validated at parse time, so every allow-listed function has its arguments; guard rather than
  // assert to satisfy the no-non-null-assertion rule and stay fail-closed.
  if (arg0 === undefined) throw new ExpressionError('ARITY', `${node.name}() is missing an argument`);
  const a = evalNode(arg0, env);
  switch (node.name) {
    case 'lower': {
      if (typeof a !== 'string') throw new ExpressionError('TYPE', 'lower() expects a string');
      return a.toLowerCase();
    }
    case 'upper': {
      if (typeof a !== 'string') throw new ExpressionError('TYPE', 'upper() expects a string');
      return a.toUpperCase();
    }
    case 'len': {
      if (typeof a !== 'string') throw new ExpressionError('TYPE', 'len() expects a string');
      return a.length;
    }
    case 'abs': {
      if (typeof a !== 'number') throw new ExpressionError('TYPE', 'abs() expects a number');
      return Math.abs(a);
    }
    case 'isNull':
      return a === null;
    default: {
      // coalesce(a, b)
      const arg1 = node.args[1];
      if (arg1 === undefined) throw new ExpressionError('ARITY', 'coalesce() is missing an argument');
      const b = evalNode(arg1, env);
      return a ?? b;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------

/**
 * Compiles `source` into a {@link CompiledExpression}, validating that every referenced identifier is one
 * of `declaredVariables` and that the whole expression is boolean-valued. Throws {@link ExpressionError}
 * (with a structured `code` and optional `position`) on any lexical, syntactic, semantic, or limit error.
 */
export function compileExpression(source: string, declaredVariables: readonly string[]): CompiledExpression {
  if (typeof source !== 'string') {
    throw new ExpressionError('SYNTAX', 'source must be a string');
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new ExpressionError('SOURCE_TOO_LONG', `source exceeds ${MAX_SOURCE_LENGTH} characters`);
  }

  const declared = new Set(declaredVariables);
  const tokens = tokenize(source);
  const parser = new Parser(tokens, declared);
  const ast = parser.parseProgram();

  // Reject a top level that is provably non-boolean at compile time; anything statically unknown
  // (variables, coalesce) is enforced at evaluate() instead.
  const st = staticType(ast);
  if (st !== 'bool' && st !== 'unknown') {
    throw new ExpressionError('NOT_BOOLEAN', `top-level expression must be boolean, it is ${st}`);
  }

  const variables: readonly string[] = Object.freeze([...parser.usedVariables()].sort());

  return Object.freeze({
    variables,
    evaluate(env: Record<string, WorkflowValue>): boolean {
      const result = evalNode(ast, env);
      if (typeof result !== 'boolean') {
        throw new ExpressionError(
          'NOT_BOOLEAN',
          `expression did not evaluate to a boolean (got ${typeName(result)})`,
        );
      }
      return result;
    },
  });
}
