import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Phase 49 fix — the Jovrel rebrand installer must land in
// $PROGRAMFILES64\Jovrel on a fresh install AND on an upgrade over a
// per-machine TFlex install, and must clean the nested 1.41.0 leftover.
// These tests read the real electron-builder.nsh and preprocess it with the
// electron-builder-bundled makensis (-PPO), asserting the expanded statements.

const ROOT = process.cwd();
const NSH_PATH = join(ROOT, 'electron-builder.nsh');
const NSH = readFileSync(NSH_PATH, 'utf8');

function findMakensis(): string | null {
  const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
  if (!existsSync(cache)) return null;
  try {
    for (const rel of readdirSync(cache, { recursive: true }) as string[]) {
      if (rel.endsWith('makensis.exe') && !rel.includes('\\Bin\\') && !rel.includes('/Bin/')) {
        const full = join(cache, rel);
        if (existsSync(full)) return full;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const MAKENSIS = findMakensis();

describe('Phase 49 install-dir fix — electron-builder.nsh source guards', () => {
  const customInit = NSH.slice(NSH.indexOf('!macro customInit'), NSH.indexOf('!macro customInstall'));
  const customInstall = NSH.slice(NSH.indexOf('!macro customInstall'));

  it('defines a customInit that resets a TFlex-rooted $INSTDIR to Program Files\\Jovrel', () => {
    expect(customInit).toMatch(/!macro customInit/);
    expect(customInit).toMatch(/StrCpy \$0 "\$PROGRAMFILES64\\TFlex"/);
    expect(customInit).toMatch(/StrCpy \$2 \$INSTDIR \$1/);
    expect(customInit).toMatch(/StrCpy \$INSTDIR "\$PROGRAMFILES64\\Jovrel"/);
  });

  it('gates the reset on the legacy-root prefix so a custom Jovrel path survives', () => {
    const guard = customInit.indexOf('${If} $2 == $0');
    const reset = customInit.indexOf('StrCpy $INSTDIR "$PROGRAMFILES64\\Jovrel"');
    expect(guard).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(guard);
  });

  it('keeps allowToChangeInstallationDirectory enabled', () => {
    const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8');
    expect(yml).toMatch(/allowToChangeInstallationDirectory:\s*true/);
  });

  it('removes the nested dir only when both Jovrel executables are present', () => {
    expect(customInstall).toMatch(/\$\{FileExists\} "\$0\\Jovrel\\Jovrel\.exe"/);
    expect(customInstall).toMatch(/\$\{FileExists\} "\$0\\Jovrel\\Uninstall Jovrel\.exe"/);
    expect(customInstall).toMatch(/\$\{AndIf\} \$\{FileExists\}/);
  });

  it('skips the nested cleanup when the current install targets inside the TFlex root', () => {
    const guard = customInstall.indexOf('${If} $2 != $0');
    const nested = customInstall.indexOf('RMDir /r "$0\\Jovrel"');
    expect(guard).toBeGreaterThan(-1);
    expect(nested).toBeGreaterThan(guard);
  });

  it('removes the parent with a non-recursive RMDir (empty-only) and never /r', () => {
    expect(customInstall).toMatch(/RMDir "\$0"/);
    expect(customInstall).not.toMatch(/RMDir \/r "\$0"/);
  });
});

describe('Phase 49 install-dir fix — preprocessed NSIS (makensis -PPO)', () => {
  let dir = '';
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!MAKENSIS)('expands customInit and the nested cleanup exactly as designed', () => {
    dir = mkdtempSync(join(tmpdir(), 'jovrel-nsh-'));
    const harness = join(dir, 'harness.nsi');
    const includeDir = join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include');
    writeFileSync(
      harness,
      [
        'Unicode true',
        `!addincludedir "${includeDir}"`,
        '!include "LogicLib.nsh"',
        '!include "FileFunc.nsh"',
        '!include "StrContains.nsh"',
        '!define APP_GUID "f890a78b-df18-5f38-8f11-e53795b72a9d"',
        '!define UNINSTALL_APP_KEY "f890a78b-df18-5f38-8f11-e53795b72a9d"',
        '!define INSTALL_REGISTRY_KEY "Software\\${APP_GUID}"',
        '!define UNINSTALL_REGISTRY_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_APP_KEY}"',
        `!include "${NSH_PATH}"`,
        'Name "jovrel-nsh-proof"',
        'OutFile "jovrel-nsh-proof.exe"',
        'Section',
        '  !insertmacro customInit',
        'SectionEnd',
        'Section "install"',
        '  !insertmacro customInstall',
        'SectionEnd',
      ].join('\n'),
    );

    const res = spawnSync(MAKENSIS as string, ['-PPO', harness], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    const out = res.stdout;

    // customInit: prefix compare then reset to the canonical per-machine dir.
    expect(out).toMatch(/StrLen \$1 \$0/);
    expect(out).toMatch(/StrCpy \$2 \$INSTDIR \$1/);
    expect(out).toMatch(/StrCmp `\$2` `\$0`/);
    expect(out).toMatch(/StrCpy \$INSTDIR "\$PROGRAMFILES64\\Jovrel"/);

    // nested cleanup: both proofs, recursive removal of the nested dir only.
    expect(out).toMatch(/IfFileExists `\$0\\Jovrel\\Jovrel\.exe`/);
    expect(out).toMatch(/IfFileExists `\$0\\Jovrel\\Uninstall Jovrel\.exe`/);
    expect(out).toMatch(/RMDir \/r "\$0\\Jovrel"/);
    expect(out).toMatch(/RMDir "\$0"/);
    expect(out).not.toMatch(/RMDir \/r "\$0"/);
  });
});
