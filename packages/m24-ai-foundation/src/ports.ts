/**
 * The M24 provider ABSTRACTION — ports every AI capability is reached through, plus DETERMINISTIC test doubles. There
 * are NO production provider adapters in this module: the MVP ships only deterministic, offline doubles (no provider
 * secrets, no network/HTTP/socket calls, no vendor lock-in). A real adapter is prohibited until repository governance
 * explicitly approves it. A provider is identified by an OPAQUE handle + a SECRET REFERENCE (never a secret value);
 * DLP + approved-provider routing + human review are enforced by the services, not by any provider. The `Clock` keeps
 * usage/cost evidence deterministic and replayable.
 */

export interface Clock {
  now(): number;
}
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
export class FixedClock implements Clock {
  private ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  now(): number {
    return this.ms;
  }
  advance(byMs: number): void {
    this.ms += byMs;
  }
}

// --- AiProvider (provider-agnostic generation) -------------------------------------------------
export interface AiGenerationInput {
  readonly providerHandle: string;
  readonly modelCode: string;
  readonly renderedPrompt: string;
  readonly classification: string;
}
export interface AiGenerationOutput {
  readonly content: string;
  readonly confidenceBps: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly frameworkOnly: boolean;
}
export interface AiProvider {
  generate(input: AiGenerationInput): Promise<AiGenerationOutput>;
}

/**
 * The ONLY provider adapter in the MVP: a deterministic, offline double. It performs NO network call and holds NO
 * secret — it derives a stable pseudo-output from the input length so tests are reproducible. It exists to exercise the
 * governance pipeline (DLP -> routing -> generate -> validate -> citations -> human review), never to be a real model.
 */
export class DeterministicProvider implements AiProvider {
  async generate(input: AiGenerationInput): Promise<AiGenerationOutput> {
    await Promise.resolve();
    const len = input.renderedPrompt.length;
    return {
      content: `[framework-only summary of ${String(len)} chars]`,
      confidenceBps: 5000 + (len % 5000),
      promptTokens: len,
      completionTokens: Math.max(1, Math.floor(len / 4)),
      frameworkOnly: true,
    };
  }
}

// --- ModelRegistry / PromptRenderer ------------------------------------------------------------
export interface PromptRenderer {
  render(template: string, variables: Record<string, string>): string;
}
/** Deterministic, SAFE `{{var}}` renderer — no eval, no code execution; unknown vars render empty. */
export class SafePromptRenderer implements PromptRenderer {
  render(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, k: string) => variables[k] ?? '');
  }
}

// --- DlpPolicyEvaluator ------------------------------------------------------------------------
export interface DlpEvaluationInput {
  readonly classification: string;
  readonly text: string;
}
export interface DlpEvaluationResult {
  readonly action: 'allow' | 'redact' | 'block';
  readonly reasonCode: string;
  readonly findingCount: number;
}
export interface DlpPolicyEvaluator {
  evaluate(input: DlpEvaluationInput): Promise<DlpEvaluationResult>;
}
/**
 * Deterministic DLP double (the seam m41 integrates behind later). It BLOCKS restricted text that contains an obvious
 * secret-looking token and otherwise allows; it never calls out. Real DLP is deferred behind this port (m41).
 */
export class DeterministicDlp implements DlpPolicyEvaluator {
  async evaluate(input: DlpEvaluationInput): Promise<DlpEvaluationResult> {
    await Promise.resolve();
    const looksSecret = /\b(secret|password|api[_-]?key|ssn|pan)\b/i.test(input.text);
    if (input.classification === 'restricted' && looksSecret) {
      return { action: 'block', reasonCode: 'dlp_blocked', findingCount: 1 };
    }
    return { action: 'allow', reasonCode: 'dlp_cleared', findingCount: 0 };
  }
}

// --- OutputValidator / CitationResolver --------------------------------------------------------
export interface OutputValidationResult {
  readonly valid: boolean;
  readonly reasonCode: string;
}
export interface OutputValidator {
  validate(content: string, kind: string): Promise<OutputValidationResult>;
}
export class DeterministicValidator implements OutputValidator {
  async validate(content: string): Promise<OutputValidationResult> {
    await Promise.resolve();
    return content.trim() === ''
      ? { valid: false, reasonCode: 'empty_output' }
      : { valid: true, reasonCode: 'output_generated' };
  }
}

export interface CitationResolver {
  resolve(content: string): Promise<{ documentRef: string; span: string }[]>;
}
/** Deterministic citation resolver double — returns no citations (the MVP records citations supplied explicitly). */
export class NoopCitationResolver implements CitationResolver {
  async resolve(): Promise<{ documentRef: string; span: string }[]> {
    await Promise.resolve();
    return [];
  }
}

// --- HumanReviewGateway (human accountability; never auto-approves) ----------------------------
export interface HumanReviewGateway {
  isHuman(reviewerId: string | null): boolean;
}
export class DefaultHumanReviewGateway implements HumanReviewGateway {
  isHuman(reviewerId: string | null): boolean {
    return reviewerId !== null && reviewerId.trim() !== '';
  }
}

// --- UsageMeter / CostCalculator / ProviderHealthPort ------------------------------------------
export interface UsageMeter {
  meter(input: { promptTokens: number; completionTokens: number }): { totalTokens: number };
}
export class DefaultUsageMeter implements UsageMeter {
  meter(input: { promptTokens: number; completionTokens: number }): { totalTokens: number } {
    return { totalTokens: input.promptTokens + input.completionTokens };
  }
}
export interface CostCalculator {
  /** Cost in INTEGER minor units (never float) given tokens and a per-1k-token minor-unit rate. */
  cost(totalTokens: number, ratePer1kMinor: number): number;
}
export class DefaultCostCalculator implements CostCalculator {
  cost(totalTokens: number, ratePer1kMinor: number): number {
    return Math.round((totalTokens * ratePer1kMinor) / 1000);
  }
}
export interface ProviderHealthPort {
  status(providerHandle: string): Promise<{ healthy: boolean; detail: string }>;
}
export class DeterministicProviderHealth implements ProviderHealthPort {
  async status(): Promise<{ healthy: boolean; detail: string }> {
    await Promise.resolve();
    return { healthy: true, detail: 'framework-only (no external provider)' };
  }
}
