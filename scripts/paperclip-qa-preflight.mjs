import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.name !== 'tflex' || !manifest.scripts?.['test:e2e']) throw new Error('Not the TFlex application root');
if (process.versions.electron) throw new Error('Use C:/Program Files/nodejs/node.exe, not an Electron Node shim');
const files = ['e2e/lib/launch.cjs', 'e2e/lib/helpers.cjs', 'test-fixtures/form.pdf', 'scripts/paperclip-build-lock.mjs'];
for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing current QA resource: ${file}`);
console.log(JSON.stringify({ applicationRoot: root, inheritedCwd: process.cwd(), node: process.execPath,
  version: manifest.version, shellForBashTool: 'Windows PowerShell', fixtureExists: true,
  useNativePickerHelper: 'openSamplePath', buildLockHelper: 'scripts/paperclip-build-lock.mjs',
  agentIdentityPresent: Boolean(process.env.PAPERCLIP_AGENT_ID), runIdentityPresent: Boolean(process.env.PAPERCLIP_RUN_ID) }));
