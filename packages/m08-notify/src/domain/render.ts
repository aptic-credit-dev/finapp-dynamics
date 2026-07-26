/**
 * The safe, deterministic template renderer (ADR-040, prompt §E4).
 *
 * The ONLY dynamic construct is `{{ variableName }}` substitution over declared, typed variables. There is:
 * no eval, no Function constructor, no dynamic require, no vm, no expression language, no logic/conditionals,
 * no property access, no access to process/env/fs/network/Date.now/random/globals. Rendering is a pure
 * function of (template, values): the same inputs always produce the same output. Output is escaped for the
 * channel where appropriate, and every size/count bound is enforced fail-closed. Errors are structured and
 * never echo a secret or a raw value.
 */
import { NOTIFY_LIMITS, NotifyError } from './limits.ts';

/** A value that may be substituted. Scalars only — never an object, array, or function. */
export type RenderValue = string | number | boolean;

/** Strict placeholder grammar: `{{ ident }}` with optional inner whitespace. Nothing else is a placeholder. */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Detects a `{{` that does not open a well-formed placeholder — a malformed template that must be rejected at
 * validation rather than silently rendered (a `{{ 2 + 2 }}` or `{{ user.name }}` is not a variable and is a
 * template bug, not a value).
 */
export function hasMalformedPlaceholder(template: string): boolean {
  // Strip all well-formed placeholders; any remaining `{{` is malformed.
  const stripped = template.replace(PLACEHOLDER_RE, '');
  return stripped.includes('{{');
}

/** The variable names referenced by a template, in first-seen order (deterministic). */
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Deterministic scalar → string. Numbers/booleans have one canonical rendering; NaN/Infinity are rejected. */
function formatValue(name: string, value: RenderValue): string {
  switch (typeof value) {
    case 'string':
      if (value.length > NOTIFY_LIMITS.maxVariableValueChars) {
        throw new NotifyError('VALUE_TOO_LARGE', `variable "${name}" exceeds the value size limit`);
      }
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new NotifyError('INVALID_VALUE', `variable "${name}" is not a finite number`);
      }
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    default:
      throw new NotifyError('INVALID_VALUE', `variable "${name}" is not a scalar`);
  }
}

export interface RenderOptions {
  /** HTML-escape substituted values (email/in-app). Off for SMS/webhook. */
  readonly escape: boolean;
}

/**
 * Render a template. Throws `NotifyError` on a missing variable, a non-scalar value, a malformed placeholder,
 * or an output that exceeds the size bound. Deterministic and side-effect-free.
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, RenderValue>>,
  options: RenderOptions,
): string {
  if (template.length > NOTIFY_LIMITS.maxTemplateChars) {
    throw new NotifyError('TEMPLATE_TOO_LARGE', 'template exceeds the size limit');
  }
  if (hasMalformedPlaceholder(template)) {
    throw new NotifyError('MALFORMED_PLACEHOLDER', 'template contains a malformed placeholder');
  }
  const rendered = template.replace(PLACEHOLDER_RE, (_full, rawName: string) => {
    const value = values[rawName];
    if (value === undefined) {
      throw new NotifyError('MISSING_VARIABLE', `no value supplied for variable "${rawName}"`);
    }
    const formatted = formatValue(rawName, value);
    return options.escape ? escapeHtml(formatted) : formatted;
  });
  if (rendered.length > NOTIFY_LIMITS.maxRenderedChars) {
    throw new NotifyError('RENDERED_TOO_LARGE', 'rendered output exceeds the size limit');
  }
  return rendered;
}
