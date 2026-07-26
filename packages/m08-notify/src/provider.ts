/**
 * Channel provider ports/adapters (prompt §E2/§E21). The module is channel-neutral: delivery is performed by a
 * `NotificationProvider` adapter selected per channel. m08 ships NO real third-party integration and commits NO
 * secrets — real providers are a future adapter responsibility. It ships DETERMINISTIC test doubles so the core
 * is fully testable without network access. A provider maps its raw response onto the safe, normalized
 * `DispatchResult` (outcome + error category) the retry policy understands; it never surfaces provider secrets.
 */
import type { Channel } from './domain/channels.ts';
import type { ErrorCategory } from './domain/retry.ts';

export interface DispatchInput {
  readonly channel: Channel;
  readonly destination: string;
  readonly subject: string | null;
  readonly body: string;
  readonly correlationId: string;
}

export interface DispatchResult {
  readonly outcome: 'succeeded' | 'failed';
  readonly providerCode: string;
  readonly responseCode?: string;
  readonly errorCategory?: ErrorCategory;
  readonly retryable?: boolean;
  readonly providerRef?: string;
}

/** A channel delivery adapter. Pure of the module's persistence — it only sends and reports a safe result. */
export interface NotificationProvider {
  readonly code: string;
  supports(channel: Channel): boolean;
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}

/** Selects the provider for a channel. A real deployment registers one adapter per channel. */
export class ProviderRegistry {
  private readonly providers: NotificationProvider[];
  constructor(providers: NotificationProvider[] = []) {
    this.providers = providers;
  }
  register(provider: NotificationProvider): void {
    this.providers.push(provider);
  }
  for(channel: Channel): NotificationProvider | null {
    return this.providers.find((p) => p.supports(channel)) ?? null;
  }
}

/**
 * A deterministic in-memory provider for tests and local runs. It "delivers" successfully unless the
 * destination is listed in `failFor` (mapped to a supplied error category), so tests can drive the success,
 * retry, and exhaustion paths without any network. No randomness, no clock.
 */
export class DeterministicProvider implements NotificationProvider {
  readonly code: string;
  private readonly channels: readonly Channel[];
  private readonly failFor: Readonly<Record<string, ErrorCategory>>;

  constructor(options?: {
    code?: string;
    channels?: readonly Channel[];
    failFor?: Readonly<Record<string, ErrorCategory>>;
  }) {
    this.code = options?.code ?? 'deterministic-test';
    this.channels = options?.channels ?? ['email', 'sms', 'in_app', 'webhook'];
    this.failFor = options?.failFor ?? {};
  }

  supports(channel: Channel): boolean {
    return this.channels.includes(channel);
  }

  dispatch(input: DispatchInput): Promise<DispatchResult> {
    const category = this.failFor[input.destination];
    if (category !== undefined) {
      const retryable = category === 'transient' || category === 'throttled' || category === 'provider_error';
      return Promise.resolve({
        outcome: 'failed',
        providerCode: this.code,
        responseCode: `ERR_${category.toUpperCase()}`,
        errorCategory: category,
        retryable,
      });
    }
    return Promise.resolve({
      outcome: 'succeeded',
      providerCode: this.code,
      responseCode: 'OK',
      providerRef: `ref-${input.correlationId}`,
    });
  }
}
