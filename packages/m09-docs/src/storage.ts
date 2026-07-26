/**
 * Document storage ports/adapters (prompt §E4). Large binary content lives in an object store behind a
 * `DocumentStorage` port — NOT in PostgreSQL, which holds only the opaque storage REFERENCE plus metadata
 * (ADR-045). m09 ships NO cloud-provider integration and commits NO credentials — real S3/Azure/GCS adapters
 * are a future responsibility. It ships a deterministic in-memory adapter so the whole module is testable
 * without network or secrets. The port never returns credentials; downloads are server-mediated or short-lived.
 */
import { bytesHash } from './hash.ts';

/** What the store observes about an object — the server-side truth upload completion is verified against. */
export interface StorageHead {
  readonly contentHash: string;
  readonly byteSize: number;
}

export interface DocumentStorage {
  readonly code: string;
  /** Store bytes at an opaque reference and return the observed head. */
  put(storageRef: string, bytes: Uint8Array): Promise<StorageHead>;
  /** Observe an object's hash + size, or null if absent. Used to verify a claimed upload. */
  head(storageRef: string): Promise<StorageHead | null>;
  /** Server-mediated read for streaming download, or null if absent. Never exposes a raw credential. */
  read(storageRef: string): Promise<Uint8Array | null>;
  /** Purge object bytes (only ever called by an authorized disposition; a DB tombstone remains). */
  purge(storageRef: string): Promise<void>;
}

/** Deterministic in-memory adapter for tests and local runs. No network, no clock, no secrets. */
export class InMemoryStorage implements DocumentStorage {
  readonly code: string;
  private readonly objects = new Map<string, Uint8Array>();

  constructor(code = 'in-memory-test') {
    this.code = code;
  }

  put(storageRef: string, bytes: Uint8Array): Promise<StorageHead> {
    this.objects.set(storageRef, bytes);
    return Promise.resolve({ contentHash: bytesHash(bytes), byteSize: bytes.byteLength });
  }

  head(storageRef: string): Promise<StorageHead | null> {
    const bytes = this.objects.get(storageRef);
    if (bytes === undefined) return Promise.resolve(null);
    return Promise.resolve({ contentHash: bytesHash(bytes), byteSize: bytes.byteLength });
  }

  read(storageRef: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(storageRef) ?? null);
  }

  purge(storageRef: string): Promise<void> {
    this.objects.delete(storageRef);
    return Promise.resolve();
  }
}
