import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import {
  DEFAULT_ENCRYPT_PERMISSIONS,
  readProtectionState,
} from '../../../src/main/services/encryption';
import type { EncryptPermissions } from '../../../src/shared/types';

/**
 * Phase 52 — encrypted PDF support (engine half).
 *
 * Fixtures are SYNTHETIC and built in-test. The RC4-128 fixture uses the
 * fork's `allowWeakCryptography` write path purely as a test input generator;
 * product code never writes RC4 (see `encryptPdfBytes`). No real/operator
 * document and no password-bearing file is used.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-p52-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function plainPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.drawText('phase52', { x: 20, y: 300 });
  return doc.save();
}

async function encryptedFixture(options: {
  userPassword: string;
  ownerPassword?: string;
  algorithm: 'AES-256' | 'AES-128' | 'RC4-128';
  permissions?: EncryptPermissions;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await plainPdfBytes());
  const toggles = options.permissions;
  doc.encrypt({
    userPassword: options.userPassword,
    ownerPassword: options.ownerPassword,
    algorithm: options.algorithm,
    allowWeakCryptography: options.algorithm === 'RC4-128',
    ...(toggles
      ? {
          permissions: {
            printing: toggles.highResPrint
              ? 'highResolution'
              : toggles.print
                ? 'lowResolution'
                : false,
            modifying: toggles.modify,
            copying: toggles.copy,
            annotating: toggles.comment,
            fillingForms: toggles.fillForms,
            contentAccessibility: toggles.accessibleCopy,
            documentAssembly: toggles.assemble,
          },
        }
      : {}),
  });
  return doc.save();
}

async function writeFixture(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

const perms = (overrides: Partial<EncryptPermissions>): EncryptPermissions => ({
  ...DEFAULT_ENCRYPT_PERMISSIONS,
  ...overrides,
});

describe('Phase 52 — password-aware open path', () => {
  it('opens an owner-restricted file (empty user password) with NO prompt', async () => {
    const bytes = await encryptedFixture({
      userPassword: '',
      ownerPassword: 'ownerpw',
      algorithm: 'RC4-128',
    });
    const path = await writeFixture('owner-only.pdf', bytes);
    const engine = new EngineService();
    // Caller supplies no password at all; the engine passes '' internally.
    const result = await engine.loadDocument('doc-owner', path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const state = await engine.getState('doc-owner');
      expect(state.ok && state.value.pageCount).toBe(1);
    }
  });

  it('returns a typed need-password result when a real user password is required', async () => {
    const bytes = await encryptedFixture({ userPassword: 'secret', algorithm: 'AES-256' });
    const path = await writeFixture('needs-pw.pdf', bytes);
    const engine = new EngineService();
    const result = await engine.loadDocument('doc-need', path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('need-password');
    }
  });

  it('opens with the correct password and exposes the opened document', async () => {
    const bytes = await encryptedFixture({ userPassword: 'secret', algorithm: 'AES-256' });
    const path = await writeFixture('with-pw.pdf', bytes);
    const engine = new EngineService();
    const result = await engine.loadDocument('doc-ok', path, 'secret');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const state = await engine.getState('doc-ok');
      expect(state.ok && state.value.pageCount).toBe(1);
    }
  });

  it('returns a typed incorrect-password result for a wrong password (never a parse failure)', async () => {
    const bytes = await encryptedFixture({ userPassword: 'right', algorithm: 'AES-256' });
    const path = await writeFixture('wrong-pw.pdf', bytes);
    const engine = new EngineService();
    const result = await engine.loadDocument('doc-wrong', path, 'wrong-password-attempt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('incorrect-password');
      // The attempted password must never leak into the error.
      expect(result.error.message).not.toContain('wrong-password-attempt');
    }
  });

  it('applies the same typed codes on the bytes path', async () => {
    const bytes = await encryptedFixture({ userPassword: 'secret', algorithm: 'AES-128' });
    const engine = new EngineService();
    const missing = await engine.loadDocumentBytes('doc-b1', bytes);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('need-password');
    const wrong = await engine.loadDocumentBytes('doc-b1', bytes, 'nope');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('incorrect-password');
    const right = await engine.loadDocumentBytes('doc-b1', bytes, 'secret');
    expect(right.ok).toBe(true);
  });

  it('returns null protection for an unencrypted document (existing path unchanged)', async () => {
    const path = await writeFixture('plain.pdf', await plainPdfBytes());
    const engine = new EngineService();
    const result = await engine.loadDocument('doc-plain', path);
    expect(result.ok).toBe(true);
    const protection = await engine.getDocumentProtection('doc-plain');
    expect(protection.ok && protection.value).toBe(null);
  });
});

describe('Phase 52 — session password cache', () => {
  it('reuses a remembered password on a reload, and clears it on closeDocument', async () => {
    const bytes = await encryptedFixture({ userPassword: 'secret', algorithm: 'AES-128' });
    const path = await writeFixture('cache.pdf', bytes);
    const engine = new EngineService();
    const first = await engine.loadDocument('doc-cache', path, 'secret');
    expect(first.ok).toBe(true);
    // Reload without a password — the cached session password opens it.
    const second = await engine.loadDocument('doc-cache', path);
    expect(second.ok).toBe(true);
    // Closing drops the document AND its password.
    await engine.closeDocument('doc-cache');
    const afterClose = await engine.loadDocument('doc-cache', path);
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.error.code).toBe('need-password');
  });
});

describe('Phase 52 — protection state from the file', () => {
  it('reads AES-256 (/V 5 /R 6 /AESV3) from a synthetic fixture', async () => {
    const bytes = await encryptedFixture({ userPassword: 'pw', algorithm: 'AES-256' });
    const state = await readProtectionState(bytes);
    expect(state).not.toBe(null);
    expect(state?.v).toBe(5);
    expect(state?.r).toBe(6);
    expect(state?.cfm).toBe('AESV3');
    expect(state?.algorithm).toBe('AES-256');
  });

  it('reads AES-128 (/V 4 /R 4 /AESV2) from a synthetic fixture', async () => {
    const bytes = await encryptedFixture({ userPassword: 'pw', algorithm: 'AES-128' });
    const state = await readProtectionState(bytes);
    expect(state?.v).toBe(4);
    expect(state?.r).toBe(4);
    expect(state?.cfm).toBe('AESV2');
    expect(state?.algorithm).toBe('AES-128');
  });

  it('reads a synthetic RC4-128 fixture', async () => {
    const bytes = await encryptedFixture({ userPassword: 'pw', algorithm: 'RC4-128' });
    const state = await readProtectionState(bytes);
    expect(state?.algorithm).toBe('RC4-128');
    expect(state?.encrypted).toBe(true);
  });

  it('reads the operator-shaped V4/R4/CFM=V2 protection state and its permission bits', async () => {
    // A minimal synthetic PDF carrying only the encryption dictionary. The
    // reader never decrypts; it reads /V, /R, /CF and /P from the trailer.
    // P = -3904 (0xFFFFF0C0) denies every permission.
    const text = [
      '%PDF-1.7',
      '1 0 obj',
      '<< /Type /Catalog /Pages 2 0 R >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Pages /Kids [] /Count 0 >>',
      'endobj',
      '3 0 obj',
      '<< /Filter /Standard /V 4 /R 4 /Length 128 /P -3904',
      '   /O <00> /U <00>',
      '   /CF << /StdCF << /AuthEvent /DocOpen /CFM /V2 /Length 16 >> >>',
      '   /StmF /StdCF /StrF /StdCF >>',
      'endobj',
      'trailer',
      '<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>',
      'startxref',
      '0',
      '%%EOF',
      '',
    ].join('\n');
    const state = await readProtectionState(new TextEncoder().encode(text));
    expect(state).not.toBe(null);
    expect(state?.v).toBe(4);
    expect(state?.r).toBe(4);
    expect(state?.cfm).toBe('V2');
    expect(state?.algorithm).toBe('RC4-128');
    expect(state?.permissions).toEqual({
      print: false,
      highResPrint: false,
      copy: false,
      accessibleCopy: false,
      modify: false,
      comment: false,
      assemble: false,
      fillForms: false,
    });
  });

  it('returns null for an unencrypted document', async () => {
    expect(await readProtectionState(await plainPdfBytes())).toBe(null);
  });
});

describe('Phase 52 — encryptDocument round-trip', () => {
  it('produces AES-256 by default and reports the requested permission flags', async () => {
    const engine = new EngineService();
    await engine.loadDocumentBytes('doc-enc', await plainPdfBytes());
    const requested = perms({
      print: false,
      highResPrint: false,
      copy: true,
      accessibleCopy: true,
      modify: false,
      comment: true,
      assemble: false,
      fillForms: true,
    });
    const result = await engine.encryptDocument('doc-enc', {
      userPassword: 'user-pw',
      ownerPassword: 'owner-pw',
      permissions: requested,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = new Uint8Array(result.value);
    const state = await readProtectionState(bytes);
    expect(state?.algorithm).toBe('AES-256');
    expect(state?.v).toBe(5);
    expect(state?.r).toBe(6);
    expect(state?.permissions).toEqual(requested);
    // The independent parser prompts for the user password and rejects a wrong one.
    await expect(PDFDocument.load(bytes, { password: 'user-pw' })).resolves.toBeDefined();
    await expect(PDFDocument.load(bytes, { password: 'bad' })).rejects.toThrow('Password incorrect');
  });

  it('produces AES-128 when asked and reports the permission flags', async () => {
    const engine = new EngineService();
    await engine.loadDocumentBytes('doc-enc128', await plainPdfBytes());
    const requested = perms({ modify: false, assemble: false, print: true, highResPrint: true });
    const result = await engine.encryptDocument('doc-enc128', {
      userPassword: 'user128',
      algorithm: 'aes-128',
      permissions: requested,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = new Uint8Array(result.value);
    const state = await readProtectionState(bytes);
    expect(state?.algorithm).toBe('AES-128');
    expect(state?.v).toBe(4);
    expect(state?.r).toBe(4);
    expect(state?.cfm).toBe('AESV2');
    expect(state?.permissions).toEqual(requested);
  });

  it('rejects an empty user password and leaves the live document unencrypted', async () => {
    const engine = new EngineService();
    await engine.loadDocumentBytes('doc-guard', await plainPdfBytes());
    const bad = await engine.encryptDocument('doc-guard', { userPassword: '' });
    expect(bad.ok).toBe(false);
    // The live document is NOT mutated: it has no protection and saving it
    // writes a DECRYPTED file.
    const protection = await engine.getDocumentProtection('doc-guard');
    expect(protection.ok && protection.value).toBe(null);
    const savePath = join(dir, 'decrypted-out.pdf');
    const saved = await engine.saveAs('doc-guard', savePath);
    expect(saved.ok).toBe(true);
    expect(await readProtectionState(new Uint8Array(await import('node:fs/promises').then((m) => m.readFile(savePath))))).toBe(null);
  });

  it('saving an opened encrypted document writes a DECRYPTED file', async () => {
    const encrypted = await encryptedFixture({ userPassword: 'pw', algorithm: 'AES-256' });
    const path = await writeFixture('opened-enc.pdf', encrypted);
    const engine = new EngineService();
    const load = await engine.loadDocument('doc-dec', path, 'pw');
    expect(load.ok).toBe(true);
    const savePath = join(dir, 'dec-saved.pdf');
    const saved = await engine.saveAs('doc-dec', savePath);
    expect(saved.ok).toBe(true);
    const { readFile } = await import('node:fs/promises');
    const savedBytes = new Uint8Array(await readFile(savePath));
    // No /Encrypt: the produced file opens everywhere with no password.
    expect(await readProtectionState(savedBytes)).toBe(null);
    await expect(PDFDocument.load(savedBytes)).resolves.toBeDefined();
  });
});

describe('Phase 52 — passwords never leak', () => {
  it('keeps the password out of logs, traces and returned payloads', async () => {
    const password = 'leak-canary-9f3';
    const bytes = await encryptedFixture({ userPassword: password, algorithm: 'AES-256' });
    const path = await writeFixture('canary.pdf', bytes);
    const engine = new EngineService();

    const logged: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      const missing = await engine.loadDocument('canary-1', path);
      const wrong = await engine.loadDocument('canary-2', path, 'not-the-password');
      const loaded = await engine.loadDocument('canary-3', path, password);
      const protection = await engine.getDocumentProtection('canary-3');
      const reopen = await engine.loadDocument('canary-3', path);
      const serialized = JSON.stringify({ missing, wrong, protection, reopen: reopen.ok });
      expect(serialized).not.toContain(password);
      expect(loaded.ok).toBe(true);
      expect(reopen.ok).toBe(true);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
    expect(logged.join('\n')).not.toContain(password);
    expect(logged.join('\n')).not.toContain('not-the-password');
  });
});

describe('Phase 52 — encryptDefaults setting', () => {
  it('preserves a valid algorithm + partial permission map (missing keys default to allowed)', async () => {
    const { normalizeEncryptDefaults } = await import('../../../src/main/services/settings');
    const result = normalizeEncryptDefaults({
      algorithm: 'aes-128',
      permissions: { copy: false, modify: false },
      unknownKey: 'dropped',
    });
    expect(result).toEqual({
      algorithm: 'aes-128',
      permissions: {
        print: true,
        highResPrint: true,
        copy: false,
        accessibleCopy: true,
        modify: false,
        comment: true,
        assemble: true,
        fillForms: true,
      },
    });
  });

  it('resolves a missing field to the AES-256/all-allowed default at the consumer', async () => {
    const { normalizeEncryptDefaults, DEFAULT_ENCRYPT_PERMISSIONS } = await import('../../../src/main/services/settings');
    expect(normalizeEncryptDefaults(undefined)).toBe(null);
    expect(DEFAULT_ENCRYPT_PERMISSIONS).toEqual({
      print: true,
      highResPrint: true,
      copy: true,
      accessibleCopy: true,
      modify: true,
      comment: true,
      assemble: true,
      fillForms: true,
    });
  });

  it('rejects an invalid algorithm or a non-boolean permission', async () => {
    const { normalizeEncryptDefaults } = await import('../../../src/main/services/settings');
    expect(normalizeEncryptDefaults({ algorithm: 'rc4-128' })).toBe(null);
    expect(normalizeEncryptDefaults({ permissions: { copy: 'yes' } })).toBe(null);
    expect(normalizeEncryptDefaults('nope')).toBe(null);
    expect(normalizeEncryptDefaults({})).toBe(null);
  });
});

  it('drops any password key — a password is never a setting', async () => {
    const { normalizeEncryptDefaults } = await import('../../../src/main/services/settings');
    const result = normalizeEncryptDefaults({
      algorithm: 'aes-256',
      permissions: { print: false },
      password: 'should-never-persist',
      userPassword: 'nor-this',
    });
    expect(result).not.toBe(null);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('should-never-persist');
    expect(serialized).not.toContain('nor-this');
    expect(serialized).not.toContain('password');
  });
