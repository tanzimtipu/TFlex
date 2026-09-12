# TFlex — Build Rules

These rules apply to every agent working on this project.

## The job

Build TFlex exactly as specified in REQUIREMENTS.md. That document is the contract: its
phases, success criteria and final criteria decide when work is done. When in doubt,
REQUIREMENTS.md wins.

For post-v1 feature work: the orchestrator promotes human feature requests into
REQUIREMENTS.md itself — appended numbered phases (Phase 6, 7, ...) with feature lists
and demonstrable success criteria, in the original format and phase template. The
original v1 text stays frozen; extensions are appended, never rewritten. Ledgers
(DEF-NNN, ADV-NNN numbering) continue across all phases and extend forever.

Every phase plan also carries a **Settings impact** line: either "none" or the new
AppSettings fields it introduces (name, default, validation/normalization rule, and
which IPC transports it). The developer implements the field's validation in
`src/main/services/settings.ts` (mirroring the Phase-6 pattern: preserve-if-valid,
reject-if-invalid) before any renderer code reads it. This rule came from the
Phase-7+ backlog — new feature buckets like Optimize/Create/Export/OCR each carry
their own settings (per-tool defaults, export formats, OCR language, etc.) and must
never grow the settings shape ad-hoc.

## The team

- **orchestrator** (primary) — plans, delegates, reviews, gates phases. Does not write code.
- **frontend-dev** — all renderer code (React UI, PDF.js display, interactions) and
  renderer unit tests. Text-only model: it captures screenshots on request, but visual
  judgment belongs to qa.
- **backend-dev** — all main-process code: the PDF engine (pdf-lib), file I/O, persistence,
  IPC services, packaging — and backend unit tests.
- **qa** — end-to-end tests, test runs, screenshots, DEFECTS.md. Does not fix code.
  Owns all visual judgment of screenshots.
- **adversary** — tries to break the running app and its PDF handling; records findings in
  ADVERSARIAL_REVIEW.md.
- **git-agent** — local git operations: initial commits, remote setup, tagging, pushes to
  origin, and verifying the OTA update release pipeline. Never edits product code,
  tests, or ledgers.

Role boundaries are enforced by permissions and are absolute. Do not work around them with
shell commands: if the edit tool would deny a file, do not modify that file any other way.

Shared contracts live in `src/shared/` (typed IPC and domain types). Both developers may
read them; only the orchestrator may approve changes to them mid-phase (a developer
proposes, the orchestrator amends the task spec).

## Repository conventions

- Distribution layout — two zones, never mixed. `release/` (electron-builder output)
  is the ONLY folder for user-sharable application files: the NSIS installer, the
  portable build, and `latest.yml`. Everything else is dev-only: source (`src/`),
  tests (`e2e/`, `test/`), fixtures, screenshots, ledgers, orchestration
  (`.opencode/`, `AGENTS*.md`), build intermediates (`dist/`), and tooling configs.
  No dev file may be placed under `release/`, and no packaging step may emit user
  artifacts anywhere else. Sample PDFs bundled INTO the installer are assets
  (`assets/`), referenced by the builder — they are not copies dropped into
  `release/` by hand.
- Fail loud: no silent no-ops. Every control introduced in a phase must implement its
  promised behavior; a click that does nothing is a defect, not polish. Developers
  return a CONTROL-INDEX with each phase — a list of every control it introduces with
  promised action and the e2e test that proves it; qa verifies it (see the qa
  definition, "no-op sweep").
- End-to-end tests, and their configuration, live under `e2e/`. Only qa writes there.
  Electron launches in e2e all go through the canonical helper `e2e/lib/launch.cjs`
  (import `launchApp`) — no ad-hoc launchers. Paths with spaces (this repo) are passed
  as separate argv array elements, never through shell shims (`*.cmd`) or concatenated
  `file://` strings. `npm run test:e2e` (i.e. `playwright test`) is the only runner
  command — use `npm.cmd` per machine policy.
- Screenshots live under `screenshots/`.
- Test fixture PDFs live under `test-fixtures/`. Only qa and adversary add files there.
- Permission patterns in agent definitions list both `dir/*` and `dir/**` forms for every
  allowed directory — some glob matchers treat `dir/**` as nested-paths-only and deny
  direct children. Do not "simplify" these to the `**` form alone.
- No emojis in code, comments, print statements, logging, or UI. Use the project's icon set.
- Keep it simple: small modules, clear names, no defensive programming, no overengineering.
  Prefer popular, well-supported libraries over custom code.
- No network calls in product code. v1 is fully offline.

## DEFECTS.md — the defect ledger

All defects live in `DEFECTS.md` at the repo root, one entry per defect, newest first.
Writers: **qa** (create, close, reopen) and **orchestrator** (record developer responses,
reject). Nobody else edits it, ever.

Format, exactly:

```
## DEF-001: Short title

- Status: OPEN
- Severity: HIGH | MEDIUM | LOW
- Found by: qa | adversary (ADV-003)
- Phase: 3

Steps to reproduce:
1. Numbered, specific, starting from app launch.

Expected: What should happen.
Actual: What happens instead.
Screenshot: screenshots/def-001.png (optional)

History:
- qa: opened

```

Statuses and who may set them:

| Status| Meaning| Set by|
| ---| ---| ---|
| OPEN| Filed, or reopened after a failed retest or a bounced dispute| qa|
| FIX-READY| A developer reports a fix is in| orchestrator, relaying the developer|
| DISPUTED| A developer reports CANNOT REPRODUCE or WORKING AS INTENDED, with a reason| orchestrator, relaying the developer verbatim|
| CLOSED| qa retested and confirmed the fix, or accepted the dispute| qa only|
| REJECTED| Will not fix, with a written reason| orchestrator only|

Every status change appends a History line saying who, what and why. A defect is never done
because a developer says so — it is done when qa closes it.

## ADVERSARIAL_REVIEW.md — the adversary's findings

All adversary findings live in `ADVERSARIAL_REVIEW.md` at the repo root.
Writers: **adversary** (create entries) and **orchestrator** (fill Disposition). Nobody else.

Format, exactly:

```
## ADV-001: Short title

- Session: phase-3 gate | final
- Suggested severity: HIGH | MEDIUM | LOW

What I did: ...
Expected: ...
Actual: ...
Screenshot: screenshots/adv-001.png (optional)

Disposition: PENDING

```

The orchestrator replaces PENDING with either `ACCEPTED -> DEF-NNN` or
`REJECTED - reason`. Accepted findings are reproduced and filed in DEFECTS.md by qa.
No entry may remain PENDING when the final phase completes.

## Model integrity — hard stop rule

Every agent runs only on the model pinned in its `.opencode/agents/*.md` definition.
The orchestrator's model, `openrouter/moonshotai/kimi-k2.5`, is reserved for the
orchestrator alone — a sub-agent starting on it is a silent fallback, exactly like any
other wrong model. If a sub-agent cannot load its pinned model (provider error, account
data-policy rejection, invalid ID) or starts on any other model, the build **stops** —
no planning, no real task dispatch, no work on the fallback model. The orchestrator
reports the failure to the human operator and waits. The orchestrator's startup probe
gate (see its definition, "Model verification gate") enforces this. Only the human may
resolve a model failure (fix the account setting, or swap the `model:` field per the
fallback table below) and restart the build.

## Model fallbacks

Each agent's model is pinned in its definition in `.opencode/agents/`. If a model
repeatedly fails at its role (tool-call errors, ignoring formats, incoherent output),
the human operator may swap that agent's `model:` field to the documented fallback:

- backend-dev: z-ai/glm-5.2 -> deepseek/deepseek-v4-pro
- frontend-dev: ~deepseek/deepseek-v4-flash-latest -> deepseek/deepseek-v4-flash
  (no vision needed — screenshot judgment belongs to qa, so any text-capable fallback
  is valid; then minimax/minimax-m3:free, then minimax/minimax-m3 paid. Note: the
  alias carries a leading tilde — the plain `deepseek/deepseek-v4-flash-latest` is NOT
  a valid OpenRouter ID)
- qa: z-ai/glm-5.3-flash -> google/gemini-3-flash-preview (native multimodal model used
  for screenshot inspection; gemini-3-flash-preview is the vision-capable fallback)
- adversary: deepseek/deepseek-v4-flash -> google/gemini-3-flash-preview
- git-agent: z-ai/glm-5.3-flash -> google/gemini-3-flash-preview
- orchestrator: no fallback — stop and ask the human.

Note: frontend-dev and adversary intentionally share the `deepseek/deepseek-v4-flash`
pin — both are text-only workloads.

Fallback to the orchestrator's model (`openrouter/moonshotai/kimi-k2.5`) is never
permitted for any sub-agent. The table above is the only valid fallback source.

2026-08-30 (third swap): frontend-dev re-pinned from minimax/minimax-m3 back to
minimax/minimax-m3:free. The operator updated the OpenRouter account data policy to allow
the free-route providers, unblocking the route that failed the earlier probe gate.
Paid route remains the fallback for rate-limit outages.

2026-08-30 (second swap): frontend-dev reverted from minimax/minimax-m3:free back to
minimax/minimax-m3. The free route failed the probe gate with an account-level provider
rejection ("No endpoints available matching your guardrail restrictions and data policy")
— same class as the 2026-08-27 qa vision-exp rejection. Fallback applied per this table;
backend-dev stays on z-ai/glm-5.2 (probed READY).

2026-08-30: backend-dev primary changed from deepseek/deepseek-v4-pro to z-ai/glm-5.2
($0.33/M in vs $0.57/M in, 77% discount, 1M context; the old primary becomes the fallback),
and frontend-dev primary changed from minimax/minimax-m3 to minimax/minimax-m3:free
(identical weights, free route; the paid route becomes the fallback for rate-limit
outages). New primary selections by the human operator after a discounted/free-model cost
analysis — not emergency fallbacks. Recorded here per this section's rule.

2026-08-27: qa model changed from deepseek/deepseek-v4-flash-vision-exp to
google/gemini-3-flash-preview before first run — vision-exp is single-provider (DeepSeek)
and was rejected by the operator account's data policy ("No endpoints available matching
your guardrail restrictions"). Recorded here per this section's rule.

After any swap, note it in `AGENTS_NOTES.md` (create it if needed) with the date and reason.

## Escalation after three failed attempts

If a sub-agent has failed to fix the same issue after three attempts, it must stop —
looping on a fourth attempt burns tokens without progress. It reports back to the
orchestrator with all the logs:

- The exact failing command and its full output (test run, build error, defect retest).
- What each of the three attempts changed, and what each returned.

The orchestrator analyzes the logs and replies with a written suggestion — a hypothesis
about the root cause, a different approach to try, or an amended task spec or shared
contract if the spec is the problem — then re-dispatches the same sub-agent to
continue. The orchestrator never takes over the fix and never writes code; the same
agent keeps doing its own work.

## Cross-bubbling event rules (to prevent ghost/unclickable regressions)

These patterns caused DEF-087/088/090 (sign ghost wrong content, action buttons
unclickable, tool disarm on pointerdown). They must be enforced at code review
and unit-test time:

- **Never call `e.preventDefault()` or `e.stopPropagation()` in a catch-all
  pointerdown/click handler.** If an overlay (annotation, signature, stamp,
  edit) registers a document-level click listener to place content, it must
  first walk the event target's ancestor chain and bail out on interactive
  elements (`button`, `input`, `textarea`, `select`, `[role='button']`, etc.)
  rather than swallowing the event. The check belongs at the handler's top.

- **Tool disarm belongs on `click`, not `pointerdown`.** Capture-phase disarms
  (e.g. "armed stamp swallows Theme toggle") unmount the target before the
  pointerup `click` event can fire. Disarm on the bubble phase `click` event
  only when the target has no interactive ancestor — same class as the
  `samplesResolver` memoization rule (churn prevention).

- **Ghost previews must render the selected content's actual source.** For
  signatures (drawn/typed/saved) the ghost pulls from the SavedSignature.source
  shape identity — if it falls back to a stamp icon or empty space, the lookup
  is wrong. Unit tests must cover drawn, typed, and saved sources.

- **Overlay layers (`.sig-layer`, `.stamp-layer`, `.edit-layer`) must have
  `pointer-events: none` on the layer and `pointer-events: auto` on the
  action-bar child.** This keeps clicks off the page canvas while the action
  bar responds.

When writing a unit test for an overlay interaction, include a click that lands
on the action bar's confirm button and assert it fires (not swallowed), and
include a click on a disarm-eligible element asserting the tool disarms while
the click still completes.

## Animation System (Phase 15)

All UI animations must use the centralized motion system. Do NOT hardcode animation values.

### Motion Tokens (src/renderer/styles/animations.css)

**Duration tokens:**
- `--motion-duration-micro: 150ms` - tooltips, micro-feedback
- `--motion-duration-fast: 200ms` - buttons, toggles, hovers
- `--motion-duration-standard: 250ms` - dialogs, popovers, panels
- `--motion-duration-panel: 280ms` - sidebar open/close
- `--motion-duration-layout: 350ms` - large layout changes
- `--motion-theme-crossfade: 400ms` - theme transitions

**Easing tokens:**
- `--motion-ease-standard: cubic-bezier(0.4, 0, 0.2, 1)`
- `--motion-ease-enter: cubic-bezier(0, 0, 0.2, 1)`
- `--motion-ease-exit: cubic-bezier(0.4, 0, 1, 1)`
- `--motion-ease-layout: cubic-bezier(0.4, 0, 0.2, 1)`

**Scale tokens:**
- `--motion-scale-press: 0.97` - button press
- `--motion-scale-enter: 0.95` - dialog/popover enter
- `--motion-scale-exit: 0.98` - dialog/popover exit

### Animation Patterns by Component

**Dialogs/Modals:**
- Open: Bloom In (scale 0.95→1, opacity 0→1, 200ms)
- Close: Bloom Out (reverse)
- Backdrop: Fade In/Out (180ms)
- Use: `AnimatedDialog` wrapper

**Popovers/Menus:**
- Open: Pop In (scale 0.95→1, 180ms)
- Dropdown: Drop Reveal (translateY -8px→0, 180ms)
- Tooltip: Micro Fade Lift (120ms)
- Menu Item Hover: Soft Material Highlight (150ms)
- Use: `usePopAnimation()` hook

**Sidebars/Panels:**
- Open: Slide In (translateX -100%→0, 280ms)
- Close: Slide Out (translateX 0→-100%, 220ms)
- Resize: Elastic Resize (300ms)
- Use: `AnimatedPanel` wrapper

**Tabs:**
- Switch: Crossfade (200ms)
- Indicator: Liquid Glide (transform translateX, 200ms)
- Use: `AnimatedTab` wrapper

**Buttons/Controls:**
- Hover: Luminous Hover (subtle lift, 150ms)
- Press: Soft Compression (scale 0.97, 100ms)
- Release: Spring Return (scale 1, 200ms)
- Toggle: Selection Fill (150ms)
- Use: `useScaleAnimation()` + token `--motion-scale-press`

**Thumbnails:**
- Select: Selection Bloom (border + shadow, 150ms)
- Hover: Lift (translateY -4px, 150ms)
- Drag: Floating Lift (scale 1.05, 200ms)

**Theme Transitions:**
- Switch: Crossfade (400ms)
- Uses View Transitions API when available
- PDF content NEVER animates (stays white)
- All themes use IDENTICAL timing

### Animation Rules

1. **NO hardcoded values** - import from `motionTokens.ts`
2. **Same motion across themes** - only visual properties (shadow, highlight) differ
3. **Transform/opacity only** - no layout thrashing
4. **Respect reduced-motion** - check `prefers-reduced-motion`
5. **60fps target** - keep animations under 16ms frame budget
6. **PDF protection** - never animate PDF content (page colors, text)

### Component Checklist

When adding any animated component:
- [ ] Uses centralized tokens
- [ ] Same timing in light/dark/frosted themes
- [ ] Reduced motion fallback
- [ ] 60fps verified
- [ ] PDF content unaffected

### Files

- `src/renderer/styles/animations.css` - token definitions
- `src/renderer/hooks/useAnimations.ts` - animation hooks
- `src/renderer/hooks/motionTokens.ts` - JS constants
- `src/renderer/components/AnimatedDialog.tsx` - dialog wrapper
- `src/renderer/components/AnimatedPanel.tsx` - panel wrapper
- `src/renderer/components/AnimatedTab.tsx` - tab wrapper

## Release pipeline (OTA)

A release is NOT complete when the tag is pushed. electron-updater only offers
an update once a GitHub Release exists for the tag with these assets attached:
`latest.yml`, `TFlex-Setup-<version>.exe` and its `.blockmap` (the portable
build is attached for users but is not auto-updateable).

- git-agent creates the GitHub Release with assets (`gh release create` /
  `gh release upload`) after verifying artifact names in `release/` match the
  tag; verification is the release URL listing all required assets.
- The repo is private: publishing needs `GH_TOKEN` (build-time,
  electron-builder) and the installed app needs `TFLEX_GH_TOKEN` (runtime
  updater). Tokens live in `.env` (gitignored, never committed); only the
  operator supplies the real token value.
- A pushed tag without a GitHub Release plus assets is an incomplete release.
