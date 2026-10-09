# TFlex

TFlex is a Windows Electron PDF application. Paperclip manages the development
team, issue ownership, verification, and release gates.

The application workspace is `C:/Users/tanzi/OneDrive/App Development/TFlex`.
Read `AGENTS.md` for shared rules, the assigned Paperclip issue for scope, and the
relevant `docs/phase-specs/` extract for acceptance criteria. Product source is in
`src/`; unit tests in `test/`; end-to-end tests in `e2e/`. Requirements and defect
ledgers remain authoritative. Release assets belong in `release/`.

All agent models are cloud routes configured in Paperclip. Repository files do not
select models. Run the board with the stable installation's Start-Paperclip.ps1;
do not start another orchestrator alongside it. Only git-agent commits; pushes and
publishing require explicit operator authorization.

## Commands

All product commands run from the repository root on Windows (use `npm.cmd` / `npx.cmd`
— the `.ps1` shims are blocked by system execution policy on the build machine):

- Dev: `npm.cmd run dev` — Vite dev server (renderer on http://localhost:5173) + esbuild
  main/preload + Electron against the dev server.
- Built app: `npm.cmd run start:prod` — Electron against the already-built `dist/` output.
- Build: `npm.cmd run build` — tsc typecheck + vite renderer build into `dist/` + esbuild
  main/preload.
- Windows installer + portable: `npm.cmd run dist` — production build + electron-builder
  producing `release/TFlex-Setup-<version>.exe` (NSIS) and
  `release/TFlex-<version>-portable.exe`.
- Unit tests: `npm.cmd run test:unit` (vitest).
- Coverage: `npm.cmd run test:coverage` (vitest --coverage).
- E2e: qa-owned scripts under `e2e/` (see `e2e/DIRECTORY.md` for the official list); run
  after a production build.

(The full command lifecycle was moved out of `docs/COMMANDS.md`; that file is a stub kept
for reference only.)
