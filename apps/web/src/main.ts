/**
 * Web shell entry point.
 *
 * Deliberately framework-free and deliberately tiny. No document in docs/ or manifests/ names a
 * frontend stack, and picking React/Vue/Angular here would quietly make a product decision on behalf of
 * whoever owns it — the same class of mistake as binding a stub to a kernel token. The choice is now
 * OPEN_QUESTIONS.md #17; this shell exists so the build, lint, and CI lanes cover apps/web from Stage 0,
 * and it will be replaced wholesale once the stack is decided.
 */

interface HealthResponse {
  readonly status: string;
  readonly stage: number;
}

const API_BASE = '/api/v1';

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}

export function render(target: HTMLElement, health: HealthResponse): void {
  target.textContent = `Finapp Dynamics — api ${health.status} (stage ${health.stage})`;
}

export async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#root');
  if (root === null) throw new Error('#root not found');
  try {
    render(root, await fetchHealth());
  } catch (error: unknown) {
    root.textContent = `Finapp Dynamics — api unreachable (${
      error instanceof Error ? error.message : String(error)
    })`;
  }
}
