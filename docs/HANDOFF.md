# TFlex orchestration handoff

Use OpenCode only. Begin a new orchestration task by reading `AGENTS.md`, the relevant
section of `REQUIREMENTS.md`, and the specific open defect or requested feature. Ignore
legacy harness artifacts and historical handoff instructions.

## Active runtime

- Orchestrator: `openrouter/moonshotai/kimi-k2.5`.
- Local roles: `local-ninfer/qwen3.8-27b` through NInfer at port 8080.
- NInfer profile: 220000 context tokens, one decode slot, 8192 vision tokens.
- The OpenCode guard starts the model before local work. Stop it only when all known local
  work has settled.

## Resume discipline

1. Read only the current task's requirement, defect, and relevant prior evidence.
2. Use the owning OpenCode agent. Do not perform its work from the orchestrator.
3. Keep developer work and focused QA verification paired, unless the operator redirects it.
4. Do not push or publish until the operator explicitly authorises it in the current session.
5. Treat `AGENTS_NOTES.md` as targeted historical reference, never as startup context.

## Current ledgers

- `DEFECTS.md`: open defects and their evidence.
- `ADVERSARIAL_REVIEW.md`: triaged adversarial findings.
- `docs/FEATURE-BACKLOG.md`: operator-reviewed proposals.
- `docs/PROMPT-QUEUE.md`: explicitly deferred operator requests; not plugin runtime state.
