// @vitest-environment jsdom
//
// Phase 52 (feature D) — the Encrypt dialog's pure logic: validation, the
// AES-256 default, the permission mapping and the password-free defaults.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENCRYPT_ALGORITHM,
  DEFAULT_ENCRYPT_DEFAULTS,
  buildEncryptOptions,
  encryptDefaultsContainPassword,
  encryptDefaultsFromOptions,
  encryptedFilename,
  formValuesFromDefaults,
  normalizeEncryptDefaults,
  validateEncryptForm,
  type EncryptFormValues,
} from '../../../src/renderer/security/encrypt';
import { ALL_PERMISSIONS_ALLOWED } from '../../../src/renderer/security/protection';

const VALID: EncryptFormValues = {
  userPassword: 'hunter2-not-in-the-ui',
  ownerPassword: '',
  algorithm: 'aes-256',
  permissions: { ...ALL_PERMISSIONS_ALLOWED },
};

describe('phase 52 — encrypt validation', () => {
  it('requires a non-empty user password (the engine rejects an empty one)', () => {
    expect(validateEncryptForm({ ...VALID, userPassword: '' })).not.toBeNull();
    expect(buildEncryptOptions({ ...VALID, userPassword: '' }).ok).toBe(false);
  });

  it('the validation message never echoes the password', () => {
    const result = buildEncryptOptions({ ...VALID, userPassword: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('hunter2-not-in-the-ui');
      expect(result.error.toLowerCase()).toContain('user password');
    }
  });

  it('accepts a valid form and maps the permissions + optional owner password', () => {
    const result = buildEncryptOptions({
      ...VALID,
      ownerPassword: 'owner-secret',
      permissions: { ...ALL_PERMISSIONS_ALLOWED, print: false, copy: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options.userPassword).toBe('hunter2-not-in-the-ui');
    expect(result.options.ownerPassword).toBe('owner-secret');
    expect(result.options.algorithm).toBe('aes-256');
    expect(result.options.permissions).toMatchObject({ print: false, copy: false, modify: true });
  });

  it('omits the owner password when the field is empty', () => {
    const result = buildEncryptOptions(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options.ownerPassword).toBeUndefined();
  });
});

describe('phase 52 — encrypt defaults', () => {
  it('defaults to AES-256 with every permission allowed', () => {
    expect(DEFAULT_ENCRYPT_ALGORITHM).toBe('aes-256');
    expect(DEFAULT_ENCRYPT_DEFAULTS.algorithm).toBe('aes-256');
    expect(DEFAULT_ENCRYPT_DEFAULTS.permissions).toEqual(ALL_PERMISSIONS_ALLOWED);
  });

  it('normalizes a partial / hostile stored value', () => {
    const normalized = normalizeEncryptDefaults({
      algorithm: 'rc4' as never,
      permissions: { print: false } as never,
    });
    expect(normalized.algorithm).toBe('aes-256');
    expect(normalized.permissions.print).toBe(false);
    expect(normalized.permissions.copy).toBe(true);
  });

  it('persists the algorithm + permissions and NEVER a password', () => {
    const defaults = encryptDefaultsFromOptions({
      userPassword: 'hunter2-not-in-the-ui',
      ownerPassword: 'owner-secret',
      algorithm: 'aes-128',
      permissions: { print: false },
    });
    expect(defaults.algorithm).toBe('aes-128');
    expect(defaults.permissions.print).toBe(false);
    expect(defaults.permissions.copy).toBe(true);
    expect(encryptDefaultsContainPassword(defaults)).toBe(false);
    expect(JSON.stringify(defaults)).not.toContain('hunter2-not-in-the-ui');
    expect(JSON.stringify(defaults)).not.toContain('owner-secret');
  });

  it('seeds the form with empty passwords', () => {
    const form = formValuesFromDefaults(DEFAULT_ENCRYPT_DEFAULTS);
    expect(form.userPassword).toBe('');
    expect(form.ownerPassword).toBe('');
    expect(form.algorithm).toBe('aes-256');
  });

  it('builds a safe suggested filename', () => {
    expect(encryptedFilename('report.pdf')).toBe('report (encrypted).pdf');
    expect(encryptedFilename('a/b:c.pdf')).toBe('a_b_c (encrypted).pdf');
  });
});
