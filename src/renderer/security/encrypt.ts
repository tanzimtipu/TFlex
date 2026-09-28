// Phase 52 (feature D) — the Create-encrypted dialog's pure logic.
//
// The dialog is a thin shell: this module owns the validation, the default
// resolution and the mapping from the form to the engine's
// `EncryptDocumentOptions`, plus the remembered-defaults shape that is
// persisted to settings. It NEVER carries a password into a persisted
// default — `encryptDefaultsFromOptions` strips everything but the algorithm
// and the permission toggles.

import type {
  EncryptAlgorithm,
  EncryptDefaults,
  EncryptDocumentOptions,
  EncryptPermissions,
} from '../../shared/types';
import { ALL_PERMISSIONS_ALLOWED, PERMISSION_FIELDS } from './protection';

export const ENCRYPT_ALGORITHMS: readonly EncryptAlgorithm[] = ['aes-256', 'aes-128'];

export const DEFAULT_ENCRYPT_ALGORITHM: EncryptAlgorithm = 'aes-256';

export const DEFAULT_ENCRYPT_DEFAULTS: EncryptDefaults = {
  algorithm: DEFAULT_ENCRYPT_ALGORITHM,
  permissions: { ...ALL_PERMISSIONS_ALLOWED },
};

/** Algorithm labels for the dialog's radio group. AES-256 is the default,
 *  AES-128 the compatibility option; RC4 is never offered for writing. */
export const ENCRYPT_ALGORITHM_LABELS: Readonly<Record<EncryptAlgorithm, string>> = {
  'aes-256': 'AES-256 (recommended)',
  'aes-128': 'AES-128 (compatibility)',
};

/** The dialog's form state (the password fields are transient and are never
 *  part of `EncryptDefaults`). */
export interface EncryptFormValues {
  userPassword: string;
  ownerPassword: string;
  algorithm: EncryptAlgorithm;
  permissions: EncryptPermissions;
}

export type EncryptFormResult =
  | { ok: true; values: EncryptFormValues; options: EncryptDocumentOptions }
  | { ok: false; error: string };

/** Normalize a stored / partial `encryptDefaults` into a complete, valid
 *  shape. Unknown algorithms fall back to AES-256; missing or non-boolean
 *  toggles fall back to allowed. This mirrors the backend's consumer
 *  default while keeping the renderer robust to an older settings file. */
export function normalizeEncryptDefaults(raw: unknown): EncryptDefaults {
  const candidate = (raw ?? {}) as Partial<EncryptDefaults>;
  const algorithm: EncryptAlgorithm =
    candidate.algorithm === 'aes-128' ? 'aes-128' : 'aes-256';
  const rawPerms = (candidate.permissions ?? {}) as Partial<EncryptPermissions>;
  const permissions = { ...ALL_PERMISSIONS_ALLOWED };
  for (const field of PERMISSION_FIELDS) {
    if (typeof rawPerms[field.key] === 'boolean') {
      permissions[field.key] = rawPerms[field.key] as boolean;
    }
  }
  return { algorithm, permissions };
}

/** Validate the form. The only hard rule is a non-empty user password (the
 *  engine rejects an empty one too). The returned error NEVER contains the
 *  password. */
export function validateEncryptForm(values: EncryptFormValues): string | null {
  if (values.userPassword.length === 0) {
    return 'Enter a user password. The document cannot be encrypted without one.';
  }
  if (!ENCRYPT_ALGORITHMS.includes(values.algorithm)) {
    return 'Choose a supported encryption algorithm.';
  }
  return null;
}

/** Map a validated form to the engine payload. The owner password is only
 *  included when the user typed one (the engine then defaults it to the user
 *  password). Returns a discriminated result so the dialog can show the
 *  validation error inline. */
export function buildEncryptOptions(values: EncryptFormValues): EncryptFormResult {
  const error = validateEncryptForm(values);
  if (error !== null) {
    return { ok: false, error };
  }
  const options: EncryptDocumentOptions = {
    userPassword: values.userPassword,
    algorithm: values.algorithm,
    permissions: { ...values.permissions },
  };
  if (values.ownerPassword.length > 0) {
    options.ownerPassword = values.ownerPassword;
  }
  return { ok: true, values, options };
}

/** The PASSWORD-FREE defaults to persist: algorithm + the eight toggles.
 *  Deliberately takes the built options and copies only the safe fields, so
 *  a future edit that passes a password-heavy object here cannot leak one
 *  into settings. */
export function encryptDefaultsFromOptions(options: EncryptDocumentOptions): EncryptDefaults {
  const permissions = { ...ALL_PERMISSIONS_ALLOWED };
  const partial = options.permissions ?? {};
  for (const field of PERMISSION_FIELDS) {
    if (typeof partial[field.key] === 'boolean') {
      permissions[field.key] = partial[field.key] as boolean;
    }
  }
  return {
    algorithm: options.algorithm === 'aes-128' ? 'aes-128' : 'aes-256',
    permissions,
  };
}

/** Seed the dialog's form from the persisted defaults. Passwords always
 *  start empty — they are never remembered. */
export function formValuesFromDefaults(defaults: EncryptDefaults): EncryptFormValues {
  return {
    userPassword: '',
    ownerPassword: '',
    algorithm: defaults.algorithm,
    permissions: { ...defaults.permissions },
  };
}

/** True when the defaults payload contains no password-shaped key. A guard
 *  the tests use to pin the no-password-persistence rule. */
export function encryptDefaultsContainPassword(defaults: EncryptDefaults): boolean {
  const keys = Object.keys(defaults) as string[];
  if (keys.some((k) => /pass/i.test(k))) return true;
  return Object.keys(defaults.permissions as unknown as Record<string, unknown>).some((k) =>
    /pass/i.test(k),
  );
}

/** Suggested filename for the encrypted copy produced by the Encrypt flow:
 *  `<name> (encrypted).pdf`. The OS save dialog lets the user override it. */
export function encryptedFilename(displayName: string): string {
  const base = displayName.replace(/\.pdf$/i, '');
  const safe = base.replace(/[\\/:*?"<>|]+/g, '_').trim();
  const stem = safe.length === 0 ? 'document' : safe;
  return `${stem} (encrypted).pdf`;
}

