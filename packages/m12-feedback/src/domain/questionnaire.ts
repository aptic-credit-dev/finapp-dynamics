/**
 * Feedback questionnaire spec + answer validation + deterministic score normalization (F6-F7). A questionnaire
 * is a versioned, immutable-after-publish document (mirrors m09 doctype). Questions are DATA — there is NO
 * executable expression inside a questionnaire (complex decisioning is M07's job, ADR-053). Scores (CSAT / NPS /
 * effort) are computed deterministically and explainably from raw answers against the declared scale.
 */
import { FEEDBACK_LIMITS } from './limits.ts';

export const QUESTIONNAIRE_SCHEMA_VERSION = 1;

export const ANSWER_TYPES = [
  'rating',
  'yes_no',
  'single_choice',
  'multiple_choice',
  'short_text',
  'long_text',
  'numeric',
  'date',
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];
export const CX_METRICS = ['csat', 'nps', 'effort', 'none'] as const;
export type CxMetric = (typeof CX_METRICS)[number];

export interface Question {
  readonly key: string;
  readonly prompt: string;
  readonly type: AnswerType;
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly scale?: number;
  readonly metric?: CxMetric;
}

export interface QuestionnaireSpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly product?: string;
  readonly transactionType?: string;
  readonly channel?: string;
  readonly language?: string;
  readonly questions: readonly Question[];
}

export interface SpecError {
  readonly path: string;
  readonly code: string;
}
export interface SpecValidation {
  readonly ok: boolean;
  readonly errors: readonly SpecError[];
}

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function validateQuestionnaireSpec(candidate: unknown): SpecValidation {
  const errors: SpecError[] = [];
  const push = (p: string, c: string): void => void errors.push({ path: p, code: c });
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  const s = candidate as Record<string, unknown>;
  if (s['schemaVersion'] !== QUESTIONNAIRE_SCHEMA_VERSION)
    push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof s['code'] !== 'string' || !IDENT_RE.test(s['code'])) push('code', 'INVALID_CODE');
  if (typeof s['name'] !== 'string' || s['name'].trim() === '') push('name', 'NAME_REQUIRED');
  const qs = s['questions'];
  const seen = new Set<string>();
  if (!Array.isArray(qs) || qs.length === 0) {
    push('questions', 'QUESTIONS_REQUIRED');
  } else {
    if (qs.length > FEEDBACK_LIMITS.maxQuestions) push('questions', 'TOO_MANY_QUESTIONS');
    qs.forEach((q, i) => {
      if (typeof q !== 'object' || q === null) {
        push(`questions[${String(i)}]`, 'INVALID_QUESTION');
        return;
      }
      const qq = q as Record<string, unknown>;
      if (typeof qq['key'] !== 'string' || !IDENT_RE.test(qq['key']))
        push(`questions[${String(i)}].key`, 'INVALID_KEY');
      else if (seen.has(qq['key'])) push(`questions[${String(i)}].key`, 'DUPLICATE_KEY');
      else seen.add(qq['key']);
      if (!(ANSWER_TYPES as readonly unknown[]).includes(qq['type']))
        push(`questions[${String(i)}].type`, 'INVALID_TYPE');
      if (
        (qq['type'] === 'single_choice' || qq['type'] === 'multiple_choice') &&
        (!Array.isArray(qq['options']) || qq['options'].length === 0)
      ) {
        push(`questions[${String(i)}].options`, 'OPTIONS_REQUIRED');
      }
      if (qq['type'] === 'rating') {
        const scale = qq['scale'];
        if (
          typeof scale !== 'number' ||
          !Number.isInteger(scale) ||
          scale < 1 ||
          scale > FEEDBACK_LIMITS.maxRatingScale
        ) {
          push(`questions[${String(i)}].scale`, 'INVALID_SCALE');
        }
      }
      if (qq['metric'] !== undefined && !(CX_METRICS as readonly unknown[]).includes(qq['metric'])) {
        push(`questions[${String(i)}].metric`, 'INVALID_METRIC');
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

export type AnswerValue = string | number | boolean | readonly string[];

export interface AnswerError {
  readonly key: string;
  readonly code: string;
}
export interface AnswerValidation {
  readonly ok: boolean;
  readonly errors: readonly AnswerError[];
  readonly values: Readonly<Record<string, AnswerValue>>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function answerMatches(q: Question, value: unknown): value is AnswerValue {
  switch (q.type) {
    case 'rating':
    case 'numeric':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (q.type !== 'rating' || (value >= 0 && value <= (q.scale ?? 0)))
      );
    case 'yes_no':
      return typeof value === 'boolean';
    case 'single_choice':
      return typeof value === 'string' && (q.options ?? []).includes(value);
    case 'multiple_choice':
      return (
        Array.isArray(value) && value.every((v) => typeof v === 'string' && (q.options ?? []).includes(v))
      );
    case 'short_text':
    case 'long_text':
      return typeof value === 'string' && value.length <= FEEDBACK_LIMITS.maxAnswerChars;
    case 'date':
      return typeof value === 'string' && ISO_DATE_RE.test(value);
    default:
      return false;
  }
}

/** Validate submitted answers against a questionnaire spec. Unknown keys rejected; required enforced. */
export function validateAnswers(spec: QuestionnaireSpec, provided: unknown): AnswerValidation {
  const errors: AnswerError[] = [];
  const values: Record<string, AnswerValue> = {};
  if (typeof provided !== 'object' || provided === null || Array.isArray(provided)) {
    return { ok: false, errors: [{ key: '<root>', code: 'ANSWERS_MUST_BE_OBJECT' }], values };
  }
  const bag = provided as Record<string, unknown>;
  if (Object.keys(bag).length > FEEDBACK_LIMITS.maxAnswers) {
    return { ok: false, errors: [{ key: '<root>', code: 'TOO_MANY_ANSWERS' }], values };
  }
  const declared = new Map(spec.questions.map((q) => [q.key, q]));
  for (const key of Object.keys(bag)) if (!declared.has(key)) errors.push({ key, code: 'UNKNOWN_QUESTION' });
  for (const q of spec.questions) {
    const present = Object.prototype.hasOwnProperty.call(bag, q.key);
    if (!present) {
      if (q.required === true) errors.push({ key: q.key, code: 'MISSING_REQUIRED' });
      continue;
    }
    const raw = bag[q.key];
    if (!answerMatches(q, raw)) {
      errors.push({ key: q.key, code: 'INVALID_ANSWER' });
      continue;
    }
    values[q.key] = raw;
  }
  return { ok: errors.length === 0, errors, values };
}

export interface CxScores {
  readonly csat?: number;
  readonly nps?: number;
  readonly npsCategory?: 'promoter' | 'passive' | 'detractor';
  readonly effort?: number;
  readonly rating?: number;
}

/** Deterministic, explainable CX metrics from validated answers. NPS 0-10, CSAT normalized to 0-100. */
export function computeScores(
  spec: QuestionnaireSpec,
  values: Readonly<Record<string, AnswerValue>>,
): CxScores {
  const out: {
    csat?: number;
    nps?: number;
    npsCategory?: 'promoter' | 'passive' | 'detractor';
    effort?: number;
    rating?: number;
  } = {};
  for (const q of spec.questions) {
    if (q.type !== 'rating') continue;
    const v = values[q.key];
    if (typeof v !== 'number') continue;
    const scale = q.scale ?? 0;
    if (q.metric === 'nps') {
      out.nps = v;
      out.npsCategory = v >= 9 ? 'promoter' : v >= 7 ? 'passive' : 'detractor';
    } else if (q.metric === 'csat') {
      out.csat = scale > 0 ? Math.round((v / scale) * 10000) / 100 : 0;
    } else if (q.metric === 'effort') {
      out.effort = v;
    } else {
      out.rating ??= scale > 0 ? Math.round((v / scale) * 10000) / 100 : v;
    }
  }
  return out;
}
