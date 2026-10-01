// Phase 52 (feature B + C) — the truthful protection state and the
// decrypted-save wording.
//
// Everything here is PURE and DOM-free so the banner copy, the permission
// labels and the save-confirmation text can be unit-tested without mounting
// App or a dialog. The renderer never enforces a permission flag (the phase
// ruling): it only reports what the document's encryption dictionary asks
// for. These helpers are the single source of that copy.

import type {
  DocumentProtectionState,
  EncryptPermissions,
  ProtectionAlgorithm,
} from '../../shared/types';

/** The eight permission toggles in the canonical order the dialog and the
 *  banner both render. `key` is the wire field on `EncryptPermissions`; the
 *  label is what the user reads. */
export const PERMISSION_FIELDS: ReadonlyArray<{
  key: keyof EncryptPermissions;
  label: string;
  /** One-line explanation for the Encrypt dialog's checkboxes. */
  description: string;
}> = [
  { key: 'print', label: 'Print', description: 'Allow printing the document.' },
  {
    key: 'highResPrint',
    label: 'High-resolution print',
    description: 'Allow printing at full resolution.',
  },
  { key: 'copy', label: 'Copy', description: 'Allow copying text and images.' },
  {
    key: 'accessibleCopy',
    label: 'Accessibility copy',
    description: 'Allow screen readers to extract the text.',
  },
  {
    key: 'modify',
    label: 'Modify',
    description: 'Allow changing the document content.',
  },
  { key: 'comment', label: 'Comment', description: 'Allow adding comments and notes.' },
  {
    key: 'assemble',
    label: 'Assemble',
    description: 'Allow inserting, rotating or deleting pages.',
  },
  { key: 'fillForms', label: 'Fill forms', description: 'Allow filling in form fields.' },
];

/** Every permission allowed — the engine's consumer default for a partial
 *  or missing `permissions` payload, and the Encrypt dialog's default. */
export const ALL_PERMISSIONS_ALLOWED: EncryptPermissions = {
  print: true,
  highResPrint: true,
  copy: true,
  accessibleCopy: true,
  modify: true,
  comment: true,
  assemble: true,
  fillForms: true,
};

/** The exact wording backend-dev specified for the decrypted-save note.
 *  Used verbatim in the save/save-as toasts and the Save-As dialog. */
export const SAVE_REMOVES_PROTECTION_TEXT =
  'Saving removes the protection. The saved file will open without a password.';

/** The banner's honest disclaimer: what the document asks vs what we do. */
export const PROTECTION_ENFORCEMENT_TEXT =
  'Jovrel displays these permissions but does not enforce them.';

/** Human label for the cipher read from an opened document. The raw `/R`,
 *  `/V` and `/CFM` values are appended by `protectionSummary`. */
export function protectionAlgorithmLabel(
  algorithm: ProtectionAlgorithm,
): string {
  switch (algorithm) {
    case 'AES-256':
      return 'AES-256';
    case 'AES-128':
      return 'AES-128';
    case 'RC4-128':
      return 'RC4-128';
    case 'RC4-40':
      return 'RC4-40';
    case 'unknown':
      return 'Unknown cipher';
  }
}

/** A compact, honest one-line summary of the encryption dictionary:
 *  cipher plus the raw revision / version / crypt-filter values read from
 *  the file. Example: `AES-256 · /R 6 · /V 5 · /CFM AESV3`. */
export function protectionSummary(
  protection: DocumentProtectionState,
): string {
  const cipher = protectionAlgorithmLabel(protection.algorithm);
  const parts = [cipher, `/R ${protection.r}`, `/V ${protection.v}`];
  if (protection.cfm.trim().length > 0) {
    parts.push(`/CFM ${protection.cfm}`);
  }
  return parts.join(' \u00b7 ');
}

/** The permission rows for the banner: label plus whether the document asks
 *  for it. Order matches `PERMISSION_FIELDS`. */
export function protectionPermissionRows(
  permissions: EncryptPermissions,
): ReadonlyArray<{ key: keyof EncryptPermissions; label: string; allowed: boolean }> {
  return PERMISSION_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    allowed: permissions[field.key] === true,
  }));
}

/** The save-confirmation sentence for a plain in-place Save. */
export function saveConfirmationText(
  displayName: string,
  encrypted: boolean,
): string {
  const base = `Saved ${displayName}.`;
  return encrypted ? `${base} ${SAVE_REMOVES_PROTECTION_TEXT}` : base;
}

/** The save-confirmation sentence for Save-As / Save-a-copy. */
export function saveAsConfirmationText(
  displayName: string,
  encrypted: boolean,
): string {
  const base = `Saved a copy of ${displayName}.`;
  return encrypted ? `${base} ${SAVE_REMOVES_PROTECTION_TEXT}` : base;
}
