/**
 * Content-scan (antivirus) ports/adapters (prompt §E17). A version is not downloadable/active until required
 * scanning is satisfied. m09 ships NO real antivirus — a deterministic test double only; it records only SAFE
 * scan evidence (status + scanner code), never a malicious payload (ADR-046). A real AV integration is a future
 * adapter behind this port.
 */
export const SCAN_STATUSES = ['pending', 'clean', 'suspicious', 'infected', 'failed', 'bypassed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** A scan result carries the status + scanner code + a short safe signature label — never the payload. */
export interface ScanResult {
  readonly status: ScanStatus;
  readonly scannerCode: string;
  readonly signature?: string;
}

export interface ContentScanner {
  readonly code: string;
  scan(storageRef: string): Promise<ScanResult>;
}

/** True when a scan status permits a version to become downloadable/active. */
export function scanPermitsRelease(status: ScanStatus): boolean {
  return status === 'clean' || status === 'bypassed';
}

/** Deterministic scanner: 'clean' unless the storageRef is configured infected/suspicious. No I/O, no clock. */
export class DeterministicScanner implements ContentScanner {
  readonly code: string;
  private readonly flagged: Readonly<Record<string, ScanStatus>>;
  constructor(options?: { code?: string; flagged?: Readonly<Record<string, ScanStatus>> }) {
    this.code = options?.code ?? 'deterministic-scan-test';
    this.flagged = options?.flagged ?? {};
  }
  scan(storageRef: string): Promise<ScanResult> {
    const status = this.flagged[storageRef] ?? 'clean';
    return Promise.resolve({
      status,
      scannerCode: this.code,
      ...(status === 'infected' ? { signature: 'TEST.EICAR.SIGNATURE' } : {}),
    });
  }
}
