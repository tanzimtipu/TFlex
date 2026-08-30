# TFlex — autonomous build workspace

TFlex is a modern, fast, lightweight Windows PDF studio (view, organize pages, annotate,
fill forms, sign) built by a team of OpenCode agents. This repo contains the complete
build specification and the agent team — the agents write the product code.

- `REQUIREMENTS.md` — what gets built, phase by phase, with success criteria.
- `AGENTS.md` — the build rules: team roles, defect workflow, file formats, model fallbacks.
- `.opencode/agents/` — the five agent definitions (orchestrator, two devs, qa, adversary).

## Running the build (Windows, no VS Code required)

Prerequisites:

- Windows 10/11
- Node.js LTS (20+)
- OpenCode — either the Desktop app (visual: sessions, diffs, file tree) or the CLI
  (`npm install -g opencode-ai`). Both read the same `.opencode/agents/` definitions.

Steps:

1. Put an OpenRouter API key in `.env` at the repo root (copy `.env.example`), or export
   `OPENROUTER_API_KEY` in your shell. **Use a dedicated key with a spend cap** (suggested:
   $30) — the agents run unattended against paid models.

2. Gather test fixture PDFs per `test-fixtures/README.md`. The agents can synthesize some
   fixtures themselves, but real-world files (a tax form, a scanned document, a big report)
   make the QA and adversarial passes much stronger.

3. Start OpenCode in this folder and switch to the **orchestrator** agent (Tab cycles
   primary agents in the TUI; in the Desktop app pick it from the agent selector). Its
   model, Kimi K3 via OpenRouter, comes from the agent definition — check the status line.

4. Kick it off with:

   > Complete the entire project as specified in REQUIREMENTS.md and don't stop until all
   > success criteria are met and the packaged app is running.

   The orchestrator will first run its **model verification gate**: a trivial probe task
   to each sub-agent to confirm it loads on its pinned model. Watch this: each probe's
   task header must show that agent's own model (qwen3-coder-30b, qwen3-4b for local;
   gemini-3-flash-preview for qa; deepseek-v4-flash for adversary — NOT kimi-k3). If
   any probe fails or shows the wrong model, the build halts by design; fix the local
   server or model and restart. Do not override this gate — a silent fallback means
   paying orchestrator prices for worker tokens.

While it runs:

- Defects appear in `DEFECTS.md`, adversarial findings in `ADVERSARIAL_REVIEW.md`,
  evidence in `screenshots/`, end-to-end tests in `e2e/`, performance numbers in
  `PERFORMANCE.md`.
- You can jump in at any time to redirect the orchestrator. Expect to unstick it
  occasionally — autonomous does not mean unattended-perfect.
- Watch spend on the OpenRouter activity dashboard (per-model breakdown).

## Model lineup

| Agent | Model | Role |
| --- | --- | --- |
| orchestrator | openrouter/moonshotai/kimi-k3 | Plans, delegates, judges |
| backend-dev | local/qwen3-coder-30b (Qwen3-Coder-30B-A3B GGUF via llama-server) | PDF engine, main process |
| frontend-dev | local/qwen3-coder-30b (same shared local model) | React UI, PDF.js rendering |
| qa | openrouter/google/gemini-3-flash-preview | e2e tests, screenshot inspection |
| adversary | openrouter/deepseek/deepseek-v4-flash | Hostile inputs, edge cases |
| git-agent | local/qwen3-4b (Qwen3-4B GGUF via llama-server) | Local git ops, OTA tags |

Local sub-agent pins are served by `llama-server` on `http://127.0.0.1:8080`. The
orchestrator loads exactly one local model at a time using the `.cmd` scripts in the
temp llama.cpp folder, polls `/health` until `ok`, dispatches that agent's task, then
runs `stop-llama-server.cmd` before loading the next model. Backend-dev and frontend-dev
share Qwen3-Coder-30B and are dispatched sequentially on it. Prior hosted pins are in
`.opencode/backups/2026-08-30-pre-local-models/` (commit `backup-pre-local-models`).

Fallbacks are documented in AGENTS.md. **Verify the exact model IDs on
openrouter.ai/models before running** — provider catalogs change, and an unknown model
string will fail at kickoff. If an ID has changed, update the `model:` field in the
relevant `.opencode/agents/*.md` file.

## Notes for the operator

- Build phases gate on evidence: tests, screenshots, timed performance. Do not let the
  orchestrator skip a gate.
- The single most important discipline: every saved PDF gets re-opened and re-parsed in
  tests. Document corruption is the unforgivable defect class for this product.
- Phase 1 produces a Windows installer immediately — if packaging breaks later, that is
  always a HIGH defect.

## Commands

All product commands run from the repository root on Windows (use `npm.cmd` / `npx.cmd`
— the `.ps1` shims are blocked by system execution policy on the build machine):

- Dev: `npm.cmd run dev` — Vite dev server (renderer on http://localhost:5173) + esbuild
  main/preload + Electron against the dev server.
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
