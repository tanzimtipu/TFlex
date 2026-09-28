// Phase 52 gate (qa) — synthetic encrypted-PDF fixtures and INDEPENDENT
// verification helpers. Only qa writes under e2e/.
//
// Fixtures are built in a temp dir OUTSIDE the repo from a plain synthetic
// PDF; no operator document is ever copied or used as a fixture. The
// independent checks use pdf.js (the display library, a different code path
// from the app's engine) and a direct @cantoo/pdf-lib raw parse — never the
// app's own readProtectionState.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName, PDFNumber, PDFDict, PDFParser } = require('@cantoo/pdf-lib');

const FIXTURE_DIR = path.join(os.tmpdir(), 'tflex-p52-fixtures');

async function makePlainPdf(pageCount = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([400, 520]);
    page.drawText(`TFlex Phase 52 synthetic fixture - page ${i + 1}`, {
      x: 40,
      y: 460,
      size: 14,
    });
  }
  return doc.save();
}

/** Map the app's eight toggles to the fork's write shape (mirrors
 *  src/main/services/encryption.ts toSecurityPermissions). */
function toSecurityPermissions(p) {
  return {
    printing: p.highResPrint ? 'highResolution' : p.print ? 'lowResolution' : false,
    modifying: p.modify,
    copying: p.copy,
    annotating: p.comment,
    fillingForms: p.fillForms,
    contentAccessibility: p.accessibleCopy,
    documentAssembly: p.assemble,
  };
}

const ALL_ALLOWED = {
  print: true,
  highResPrint: true,
  copy: true,
  accessibleCopy: true,
  modify: true,
  comment: true,
  assemble: true,
  fillForms: true,
};

/**
 * Build a synthetic encrypted fixture. `algorithm` is 'AES-256' | 'AES-128'
 * (RC4 is only ever used as a test INPUT generator, never by product code).
 * Returns the absolute path.
 */
async function makeEncryptedFixture(opts) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const plain = await makePlainPdf(opts.pageCount ?? 2);
  const doc = await PDFDocument.load(plain);
  const permissions = { ...ALL_ALLOWED, ...(opts.permissions ?? {}) };
  doc.encrypt({
    userPassword: opts.userPassword,
    ...(opts.ownerPassword !== undefined ? { ownerPassword: opts.ownerPassword } : {}),
    algorithm: opts.algorithm ?? 'AES-256',
    allowWeakCryptography: opts.algorithm === 'RC4-128',
    permissions: toSecurityPermissions(permissions),
  });
  const bytes = await doc.save();
  const out = path.join(FIXTURE_DIR, opts.name);
  fs.writeFileSync(out, Buffer.from(bytes));
  return out;
}

/** True when the raw bytes carry an /Encrypt token (a plain file must not). */
function hasEncryptToken(filePath) {
  return fs.readFileSync(filePath).includes(Buffer.from('/Encrypt'));
}

/**
 * INDEPENDENT raw parse of the /Encrypt dictionary via @cantoo/pdf-lib's
 * low-level parser (a parser, not the app's reader). Returns null for a plain
 * file. `p` is the unsigned /P value.
 */
async function readRawEncryptDict(filePath) {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  let context;
  try {
    context = await PDFParser.forBytesWithOptions(bytes).parseDocument();
  } catch {
    return null;
  }
  const ref = context.trailerInfo.Encrypt;
  if (ref === undefined) return null;
  const dict = context.lookup(ref, PDFDict);
  const num = (name) => {
    try {
      const value = dict.lookupMaybe(PDFName.of(name), PDFNumber);
      return value === undefined ? undefined : value.asNumber();
    } catch {
      return undefined;
    }
  };
  let cfm = '';
  try {
    const cf = dict.lookupMaybe(PDFName.of('CF'), PDFDict);
    const stmf = dict.lookupMaybe(PDFName.of('StmF'), PDFName);
    if (cf !== undefined && stmf !== undefined) {
      const handler = cf.lookupMaybe(stmf, PDFDict);
      const c = handler === undefined ? undefined : handler.lookupMaybe(PDFName.of('CFM'), PDFName);
      if (c !== undefined) cfm = c.asString().replace(/^\//, '');
    }
  } catch {
    /* no crypt filter */
  }
  return {
    v: num('V') ?? 0,
    r: num('R') ?? 0,
    p: (num('P') ?? 0) >>> 0,
    length: num('Length') ?? 0,
    cfm,
  };
}

/**
 * INDEPENDENT pdf.js probe. Loads the file with (or without) a password and
 * reports whether it opened, the page count, and the permission flags pdf.js
 * itself reads from /P. A password-protected file with no/wrong password
 * rejects with a PasswordException (name 'PasswordException').
 */
async function pdfjsProbe(filePath, password) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  try {
    const doc = await pdfjs.getDocument({
      data,
      password: password ?? '',
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
    const permissions = await doc.getPermissions();
    const numPages = doc.numPages;
    await doc.destroy();
    return { opened: true, numPages, permissions };
  } catch (e) {
    return {
      opened: false,
      name: e && e.name,
      code: e && e.code,
      message: e && e.message,
    };
  }
}

/** pdf.js PermissionFlag values (independent of the app's bit constants). */
const PDFJS_PERMISSION_FLAG = {
  PRINT: 0x04,
  MODIFY_CONTENTS: 0x08,
  COPY: 0x10,
  MODIFY_ANNOTATIONS: 0x20,
  FILL_INTERACTIVE_FORMS: 0x100,
  COPY_FOR_ACCESSIBILITY: 0x200,
  ASSEMBLE: 0x400,
  PRINT_HIGH_QUALITY: 0x800,
};

module.exports = {
  FIXTURE_DIR,
  ALL_ALLOWED,
  PDFJS_PERMISSION_FLAG,
  makePlainPdf,
  makeEncryptedFixture,
  hasEncryptToken,
  readRawEncryptDict,
  pdfjsProbe,
};
