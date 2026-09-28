// @vitest-environment jsdom
//
// Phase 52 (features B + C) — banner content and the decrypted-save wording.
// Pure helpers, so no React mount is needed.

import { describe, expect, it } from 'vitest';
import type { DocumentProtectionState } from '../../../src/shared/types';
import {
  ALL_PERMISSIONS_ALLOWED,
  PROTECTION_ENFORCEMENT_TEXT,
  SAVE_REMOVES_PROTECTION_TEXT,
  protectionAlgorithmLabel,
  protectionPermissionRows,
  protectionSummary,
  saveAsConfirmationText,
  saveConfirmationText,
} from '../../../src/renderer/security/protection';

const AES256: DocumentProtectionState = {
  encrypted: true,
  v: 5,
  r: 6,
  cfm: 'AESV3',
  algorithm: 'AES-256',
  permissions: { ...ALL_PERMISSIONS_ALLOWED, copy: false, modify: false },
};

describe('phase 52 — protection banner content', () => {
  it('labels every cipher', () => {
    expect(protectionAlgorithmLabel('AES-256')).toBe('AES-256');
    expect(protectionAlgorithmLabel('AES-128')).toBe('AES-128');
    expect(protectionAlgorithmLabel('RC4-128')).toBe('RC4-128');
    expect(protectionAlgorithmLabel('RC4-40')).toBe('RC4-40');
    expect(protectionAlgorithmLabel('unknown')).toBe('Unknown cipher');
  });

  it('summarises the real /R, /V and /CFM read from the file', () => {
    expect(protectionSummary(AES256)).toBe('AES-256 · /R 6 · /V 5 · /CFM AESV3');
  });

  it('omits /CFM for a pre-crypt-filter document', () => {
    const legacy: DocumentProtectionState = {
      encrypted: true,
      v: 2,
      r: 3,
      cfm: '',
      algorithm: 'RC4-128',
      permissions: { ...ALL_PERMISSIONS_ALLOWED },
    };
    expect(protectionSummary(legacy)).toBe('RC4-128 · /R 3 · /V 2');
  });

  it('lists the permission flags the document asks for', () => {
    const rows = protectionPermissionRows(AES256.permissions);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.label)).toEqual([
      'Print',
      'High-resolution print',
      'Copy',
      'Accessibility copy',
      'Modify',
      'Comment',
      'Assemble',
      'Fill forms',
    ]);
    const denied = rows.filter((r) => !r.allowed).map((r) => r.label);
    expect(denied).toEqual(['Copy', 'Modify']);
  });

  it('states plainly that the permissions are not enforced', () => {
    expect(PROTECTION_ENFORCEMENT_TEXT).toContain('does not enforce');
  });
});

describe('phase 52 — decrypted-save wording', () => {
  it('appends the exact backend wording for an encrypted document', () => {
    const text = saveConfirmationText('secret.pdf', true);
    expect(text).toContain('secret.pdf');
    expect(text).toContain(
      'Saving removes the protection. The saved file will open without a password.',
    );
    expect(SAVE_REMOVES_PROTECTION_TEXT).toBe(
      'Saving removes the protection. The saved file will open without a password.',
    );
  });

  it('says nothing extra for a plain document', () => {
    expect(saveConfirmationText('plain.pdf', false)).toBe('Saved plain.pdf.');
    expect(saveAsConfirmationText('plain.pdf', false)).toBe('Saved a copy of plain.pdf.');
  });

  it('carries the note through Save-As too', () => {
    expect(saveAsConfirmationText('secret.pdf', true)).toBe(
      'Saved a copy of secret.pdf. Saving removes the protection. The saved file will open without a password.',
    );
  });
});
