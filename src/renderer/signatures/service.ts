// Renderer-side saved-signatures service.
//
// The signature list lives on the host: the backend persists it via
// `signatures:list` / `signatures:save` / `signatures:delete` IPC, and the
// renderer mirrors it locally for synchronous modal rendering. When the
// host IPC is missing (pre-Phase-4 backend, or unit tests), this module
// degrades to a module-local in-memory list so the manager modal and the
// place-on-page flow keep working.
//
// We deliberately keep this module small and synchronous-looking: every
// method returns a Promise so the call sites match the real IPC shape,
// but the stub path resolves on the next microtask.

import type {
  SavedSignature,
  SignatureSource,
} from "../../shared/types";
import {
  stubSignaturesDelete,
  stubSignaturesList,
  stubSignaturesSave,
} from "../engine/stubEngine";

export interface SignatureService {
  list(): Promise<SavedSignature[]>;
  save(source: SignatureSource, label?: string): Promise<SavedSignature[]>;
  delete(id: string): Promise<SavedSignature[]>;
}

function readWindowSignatures(): { list?: () => Promise<SavedSignature[]>; save?: (...a: never[]) => Promise<SavedSignature[]>; delete?: (...a: never[]) => Promise<SavedSignature[]> } | undefined {
  const tflex = (window as unknown as { tflex?: { signatures?: SignatureService } }).tflex;
  return tflex?.signatures;
}

class RealSignatureService implements SignatureService {
  readonly available = true;
  constructor(private readonly inner: NonNullable<ReturnType<typeof readWindowSignatures>>) {}
  async list(): Promise<SavedSignature[]> {
    if (this.inner.list === undefined) return [];
    return this.inner.list();
  }
  async save(source: SignatureSource, label?: string): Promise<SavedSignature[]> {
    if (this.inner.save === undefined) return [];
    return this.inner.save(source as never, label as never);
  }
  async delete(id: string): Promise<SavedSignature[]> {
    if (this.inner.delete === undefined) return [];
    return this.inner.delete(id as never);
  }
}

class StubSignatureService implements SignatureService {
  readonly available = false;
  async list(): Promise<SavedSignature[]> {
    return stubSignaturesList();
  }
  async save(source: SignatureSource, label?: string): Promise<SavedSignature[]> {
    return stubSignaturesSave(source, label);
  }
  async delete(id: string): Promise<SavedSignature[]> {
    return stubSignaturesDelete(id);
  }
}

let cached: SignatureService | undefined;

export function getSignatureService(): SignatureService {
  if (cached !== undefined) return cached;
  const real = readWindowSignatures();
  cached = real !== undefined ? new RealSignatureService(real) : new StubSignatureService();
  return cached;
}

export function _resetSignatureServiceForTests(): void {
  cached = undefined;
}