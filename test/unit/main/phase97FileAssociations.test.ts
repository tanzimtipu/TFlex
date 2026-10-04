import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Phase 97 (DEF-525 / DEF-526) - config/manifest guard. The eight PDF-family
// types and the `acrobat:` protocol are registered as CANDIDATES ONLY in
// electron-builder.nsh; they must NOT be `win.fileAssociations` rows, because
// electron-builder's NSIS APP_ASSOCIATE macro writes the extension DEFAULT
// (`FileAssociation.nsh:65-74`), which silently changed Adobe's existing
// per-machine defaults. This pins the candidate-only registration and forbids
// the class-root/default writes so a future config edit cannot reintroduce them.

const YAML_PATH = resolve(process.cwd(), 'electron-builder.yml');
const NSH_PATH = resolve(process.cwd(), 'electron-builder.nsh');

const yml = readFileSync(YAML_PATH, 'utf8');
const nsh = readFileSync(NSH_PATH, 'utf8');

const FAMILY: ReadonlyArray<{ ext: string; progId: string; description: string }> = [
  { ext: 'aaui', progId: 'Jovrel.aaui', description: 'Acrobat User Interface' },
  { ext: 'bpdx', progId: 'Jovrel.bpdx', description: 'Acrobat Batch PDX' },
  { ext: 'fdf', progId: 'Jovrel.fdf', description: 'Acrobat Forms Document' },
  { ext: 'pdx', progId: 'Jovrel.pdx', description: 'Acrobat Catalog Index' },
  { ext: 'rmf', progId: 'Jovrel.rmf', description: 'Acrobat Rights Management Document' },
  { ext: 'sequ', progId: 'Jovrel.sequ', description: 'Acrobat Action File' },
  { ext: 'xdp', progId: 'Jovrel.xdp', description: 'Acrobat XML Data Package' },
  { ext: 'xfdf', progId: 'Jovrel.xfdf', description: 'Acrobat Forms Document' },
];

describe('Phase 97 - electron-builder.yml associations are .pdf only', () => {
  it('keeps the .pdf entry byte-identical and unique', () => {
    expect(yml).toMatch(/- ext:\s*pdf\n\s+name:\s*Jovrel\.pdf\n\s+description:\s*Jovrel PDF Document\n\s+icon:\s*assets\/brand\/jovrel-pdf\.ico/);
    expect((yml.match(/\bext:\s*pdf\b/g) ?? [])).toHaveLength(1);
    expect(yml.match(/icon:\s*assets\/brand\/jovrel-pdf\.ico\b/g) ?? []).toHaveLength(1);
  });

  it('declares exactly one association row and no family extensions', () => {
    const exts = [...yml.matchAll(/\bext:\s*([a-z0-9]+)/g)].map((m) => m[1]);
    expect(exts).toEqual(['pdf']);
    for (const row of FAMILY) {
      expect(yml).not.toMatch(new RegExp(`\\bext:\\s*${row.ext}\\b`));
    }
  });
});

describe('Phase 97 - electron-builder.nsh candidate-only registration', () => {
  it('writes a Jovrel.<ext> ProgID + OpenWithProgids candidate for each family type', () => {
    for (const row of FAMILY) {
      expect(nsh).toContain(`WriteRegStr SHELL_CONTEXT "Software\\Classes\\${row.progId}" "" "${row.description}"`);
      expect(nsh).toContain(`WriteRegStr SHELL_CONTEXT "Software\\Classes\\${row.progId}\\DefaultIcon" "" "$appExe,0"`);
      expect(nsh).toContain(
        `WriteRegStr SHELL_CONTEXT "Software\\Classes\\${row.progId}\\shell\\open\\command" "" '"$appExe" "%1"'`,
      );
      expect(nsh).toContain(`WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${row.ext}\\OpenWithProgids" "${row.progId}" ""`);
      expect(nsh).toContain(
        `WriteRegStr SHELL_CONTEXT "Software\\Jovrel\\Capabilities\\FileAssociations" ".${row.ext}" "${row.progId}"`,
      );
    }
  });

  it('writes the acrobat: protocol as a candidate ProgID, never the class root', () => {
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\Jovrel.acrobat" "" "Jovrel acrobat Protocol"');
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\Jovrel.acrobat" "URL Protocol" ""');
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\Jovrel.acrobat\\DefaultIcon" "" "$appExe,0"');
    expect(nsh).toContain(
      'WriteRegStr SHELL_CONTEXT "Software\\Classes\\Jovrel.acrobat\\shell\\open\\command" "" \'"$appExe" "%1"\'',
    );
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\acrobat\\OpenWithProgids" "Jovrel.acrobat" ""');
    expect(nsh).toContain(
      'WriteRegStr SHELL_CONTEXT "Software\\Jovrel\\Capabilities\\URLAssociations" "acrobat" "Jovrel.acrobat"',
    );
  });

  it('registers the app for Settings > Default apps', () => {
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\RegisteredApplications" "Jovrel" "Software\\Jovrel\\Capabilities"');
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Jovrel\\Capabilities" "ApplicationName" "Jovrel"');
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Jovrel\\Capabilities" "ApplicationDescription" "Jovrel PDF studio"');
    expect(nsh).toContain('WriteRegStr SHELL_CONTEXT "Software\\Jovrel\\Capabilities" "ApplicationIcon" "$appExe,0"');
  });

  it('never writes an extension DEFAULT or the acrobat class root (DEF-525/526)', () => {
    expect(nsh).not.toMatch(/WriteRegStr\s+SHELL_CONTEXT\s+"Software\\Classes\\\.[a-z0-9]+"\s+""/);
    expect(nsh).not.toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\acrobat"');
    expect(nsh).not.toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\acrobat\\DefaultIcon"');
    expect(nsh).not.toContain('WriteRegStr SHELL_CONTEXT "Software\\Classes\\acrobat\\shell\\open\\command"');
  });
});

describe('Phase 97 - electron-builder.nsh identity-guarded uninstall', () => {
  it('deletes only Jovrel own entries, outside the installer-only guard', () => {
    const guardStart = nsh.indexOf('!ifndef BUILD_UNINSTALLER');
    const guardEnd = nsh.indexOf('!endif', guardStart);
    const installMacro = nsh.indexOf('!macro customInstall');
    const unInstallMacro = nsh.indexOf('!macro customUnInstall');
    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(installMacro).toBeGreaterThan(guardStart);
    expect(installMacro).toBeLessThan(guardEnd);
    expect(unInstallMacro).toBeGreaterThan(guardEnd);

    for (const row of FAMILY) {
      expect(nsh).toContain(`DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${row.ext}\\OpenWithProgids" "${row.progId}"`);
      expect(nsh).toContain(`DeleteRegKey  SHELL_CONTEXT "Software\\Classes\\${row.progId}"`);
    }
    expect(nsh).toContain('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\acrobat\\OpenWithProgids" "Jovrel.acrobat"');
    expect(nsh).toContain('DeleteRegKey  SHELL_CONTEXT "Software\\Classes\\Jovrel.acrobat"');
    expect(nsh).toContain('DeleteRegKey  SHELL_CONTEXT "Software\\Jovrel\\Capabilities"');
    expect(nsh).toContain('DeleteRegValue SHELL_CONTEXT "Software\\RegisteredApplications" "Jovrel"');
  });

  it('never deletes the acrobat class root (DEF-526)', () => {
    expect(nsh).not.toContain('DeleteRegKey SHELL_CONTEXT "Software\\Classes\\acrobat"');
    expect(nsh).not.toContain('DeleteRegKey  SHELL_CONTEXT "Software\\Classes\\acrobat"');
  });
});
