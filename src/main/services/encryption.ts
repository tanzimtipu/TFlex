import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFParser,
} from '@cantoo/pdf-lib';
import type {
  DocumentProtectionState,
  EncryptDocumentOptions,
  EncryptPermissions,
  PasswordError,
  ProtectionAlgorithm,
} from '../../shared/types';
// The single canonical default lives in settings.ts (it is the validation
// default for the `encryptDefaults` field); re-exported here for the engine.
import { DEFAULT_ENCRYPT_PERMISSIONS } from './settings';

export { DEFAULT_ENCRYPT_PERMISSIONS };

/**
 * Phase 52 — encrypted-PDF engine helpers (pure, no engine state).
 *
 * The EDIT path uses `@cantoo/pdf-lib`, which loads with `{ password }` and
 * can write AES-256/AES-128. This module:
 *   - classifies the fork's password exceptions into typed codes;
 *   - reads a document's real encryption dictionary (`/V`, `/R`, `/CFM`, `/P`)
 *     from the raw bytes, because the fork drops `/Encrypt` once it decrypts;
 *   - produces encrypted bytes for `encryptDocument`.
 *
 * No password is logged or persisted here; values pass through unchanged.
 */

/** Phase 52 — every permission allowed is the default when the caller omits
 *  `permissions` (or a field within it). Canonical definition lives in
 *  settings.ts; see the import above. */

/** `/P` bit values (ISO 32000 Table 22). Bits 9-12 only exist from revision 3. */
const P_PRINT = 0x04;
const P_MODIFY = 0x08;
const P_COPY = 0x10;
const P_COMMENT = 0x20;
const P_FILL_FORMS = 0x100;
const P_ACCESSIBLE_COPY = 0x200;
const P_ASSEMBLE = 0x400;
const P_HIGH_RES_PRINT = 0x800;

/**
 * Phase 52 — map the fork's thrown password exceptions to the typed codes
 * the renderer speaks. `NEEDS PASSWORD` is thrown when no/empty password was
 * supplied and the key could not be derived; `Password incorrect` when a
 * non-empty password failed. Any other error is not a password failure.
 */
export function classifyPasswordError(error: unknown): PasswordError | null {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message.length === 0) return null;
  if (message.includes('NEEDS PASSWORD')) return 'need-password';
  if (message.includes('Password incorrect')) return 'incorrect-password';
  return null;
}

/** Derive the app's algorithm label from the raw dictionary values. */
function deriveAlgorithm(v: number, cfm: string, length: number): ProtectionAlgorithm {
  if (v === 5 || cfm === 'AESV3') return 'AES-256';
  if (cfm === 'AESV2') return 'AES-128';
  if (v === 4) {
    if (cfm === 'V2') return length > 0 && length <= 40 ? 'RC4-40' : 'RC4-128';
    return 'unknown';
  }
  if (v === 1) return 'RC4-40';
  if (v === 2 || v === 3) return length > 40 ? 'RC4-128' : 'RC4-40';
  return 'unknown';
}

/** Decode `/P` into the eight UI toggles. */
function decodePermissions(p: number, r: number): EncryptPermissions {
  const has = (bit: number): boolean => (p & bit) !== 0;
  return {
    print: has(P_PRINT),
    highResPrint: r >= 3 ? has(P_HIGH_RES_PRINT) : false,
    copy: has(P_COPY),
    accessibleCopy: r >= 3 ? has(P_ACCESSIBLE_COPY) : false,
    modify: has(P_MODIFY),
    comment: has(P_COMMENT),
    assemble: r >= 3 ? has(P_ASSEMBLE) : false,
    fillForms: r >= 3 ? has(P_FILL_FORMS) : false,
  };
}

/**
 * Phase 52 — read the protection state straight from the (undecrypted) file
 * bytes. `@cantoo/pdf-lib` removes `/Encrypt` from the trailer once it has
 * decrypted the document, so the loaded document cannot report it; a
 * read-only low-level parse (no `ignoreEncryption`) exposes the trailer's
 * `/Encrypt` dict. Returns null for an unencrypted/unparseable file.
 */
export async function readProtectionState(
  bytes: Uint8Array,
): Promise<DocumentProtectionState | null> {
  let dict: PDFDict;
  try {
    const context = await PDFParser.forBytesWithOptions(bytes).parseDocument();
    const encryptRef = context.trailerInfo.Encrypt;
    if (encryptRef === undefined) return null;
    dict = context.lookup(encryptRef, PDFDict);
  } catch {
    return null;
  }

  const num = (name: string): number | undefined => {
    try {
      const value = dict.lookupMaybe(PDFName.of(name), PDFNumber);
      return value === undefined ? undefined : value.asNumber();
    } catch {
      return undefined;
    }
  };

  const v = num('V') ?? 0;
  const r = num('R') ?? 0;
  const p = (num('P') ?? 0) >>> 0;
  const length = num('Length') ?? 0;

  let cfm = '';
  try {
    const cf = dict.lookupMaybe(PDFName.of('CF'), PDFDict);
    const streamFilter = dict.lookupMaybe(PDFName.of('StmF'), PDFName);
    if (cf !== undefined && streamFilter !== undefined) {
      const handler = cf.lookupMaybe(streamFilter, PDFDict);
      const cfmName =
        handler === undefined ? undefined : handler.lookupMaybe(PDFName.of('CFM'), PDFName);
      if (cfmName !== undefined) cfm = cfmName.asString().replace(/^\//, '');
    }
  } catch {
    // No crypt-filter dict (a /V 1-2 document) — leave cfm empty.
  }

  return {
    encrypted: true,
    v,
    r,
    cfm,
    algorithm: deriveAlgorithm(v, cfm, length),
    permissions: decodePermissions(p, r),
  };
}

/** Map the app's toggles to the fork's `UserPermissions` write shape. */
function toSecurityPermissions(permissions: EncryptPermissions): {
  printing: boolean | 'lowResolution' | 'highResolution';
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
} {
  return {
    printing: permissions.highResPrint
      ? 'highResolution'
      : permissions.print
        ? 'lowResolution'
        : false,
    modifying: permissions.modify,
    copying: permissions.copy,
    annotating: permissions.comment,
    fillingForms: permissions.fillForms,
    contentAccessibility: permissions.accessibleCopy,
    documentAssembly: permissions.assemble,
  };
}

/**
 * Phase 52 — load `plainBytes`, apply the fork's `encrypt()` and return the
 * encrypted bytes. AES-256 is the default; AES-128 is the only other option
 * (RC4 is never requested). The input document is not mutated: the caller's
 * live engine document stays decrypted.
 *
 * Throws when `userPassword` is empty (the create dialog always supplies one)
 * or when the underlying encrypt call fails.
 */
export async function encryptPdfBytes(
  plainBytes: Uint8Array,
  options: EncryptDocumentOptions,
): Promise<Uint8Array> {
  if (typeof options.userPassword !== 'string' || options.userPassword.length === 0) {
    throw new Error('a user password is required to encrypt a document');
  }
  const algorithm = options.algorithm === 'aes-128' ? 'AES-128' : 'AES-256';
  const permissions: EncryptPermissions = {
    ...DEFAULT_ENCRYPT_PERMISSIONS,
    ...(options.permissions ?? {}),
  };
  const doc = await PDFDocument.load(plainBytes);
  doc.encrypt({
    userPassword: options.userPassword,
    ...(options.ownerPassword !== undefined && options.ownerPassword.length > 0
      ? { ownerPassword: options.ownerPassword }
      : {}),
    algorithm,
    permissions: toSecurityPermissions(permissions),
  });
  const out = await doc.save();
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}
