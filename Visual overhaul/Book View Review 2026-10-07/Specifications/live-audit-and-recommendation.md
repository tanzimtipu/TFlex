# Book View audit and recommendation

7 October 2026. Launched the installed Jovrel app at C:\Program Files\Jovrel\Jovrel.exe and inspected a bundled 34-page report copy. This is a fresh live check following the earlier implementation audit; source code was not inspected or changed.

## Observed behavior

| Test | Result | Confidence |
|---|---|---|
| Editor page 7 → Book View | Opened page 1, reproducing earlier audit. | Confirmed live |
| Next single-page | Turned 1→2. A captured intermediate frame showed the outgoing cover as a flat tilted/trapezoidal sheet with the target page label already 2. | Observed appearance; renderer implementation unknown |
| Switch to spread | Settled at 2–3; an immediate capture was blank during preparation. It resolved in a later observation. | Transient blank observed; no duration measurement |
| Lower outer-edge drag right→left | Selected PDF text, stayed at 2–3; did not curl/turn. | Confirmed for tested gesture |
| Next after selection | Advanced 4–5 but selection highlights appeared over the new page's text. | Confirmed live |
| Right arrow after selection | Remained2–3 in that focused/selected state. | Limited test; not proof all keyboard navigation is absent |
| Restore window | At about973×633, spread 4–5 still displayed, with very small text. | Confirmed; automatic single-page recommended |
| Animations disabled | Next 4–5→6–7 showed a settled immediate change in the next capture; no curl seen. | Preserve working behavior; not high-speed video verification |
| Restore animation setting | Returned the originally checked Animations preference to enabled. | Done |
| Exit Book View at 8–9 | Editor returned to old page 7. | Confirmed live |

No document was saved, exported, printed or altered through annotations. One bundled report fixture remains open. The application was left at its restored compact window size in normal editor view. Animation preference was restored; theme preference was not changed. No GPU trace, high-speed video or source-level profiling was performed. The user's report of stutter remains a performance problem to measure during implementation, not an invented FPS result.

Evidence is in ../Evidence: turn-flat-sheet; spread-before-drag; edge-drag-selects-text; selection-persists-after-turn; compact-spread; animations-off-instant-change; book-location-eight-nine; exit-restores-old-page-seven. Matching TXT files contain accessibility snapshots, not application source.

## How I would implement it

Use one shared reading-state model and a renderer adapter. Preserve Jovrel's existing PDF engine and settled interaction layers. Animate only the turning leaf with a true subdivided 3D mesh; use a developable curl and a bounded damped spring for release. Maintain a small number of visible meshes and a byte-budgeted texture cache. DOM remains responsible for accessible controls and exact text/annotation interaction when pages are flat.

Use a custom, locally bundled Three.js adapter integrated with the existing document renderer and navigation. Commercial flipbook dependencies are excluded because the user will not purchase a flipbook license.

User amendment: Book View must be a continuous transformation of the existing document canvas, with the same workspace host and background. Prepare and align the WebGL page over the current rendered PDF page, then transform its geometry/framing into the book layout; reverse this on exit. No visibly separate reader canvas, duplicate page or blank-frame handoff. Single/double-page toggles also use a coordinated position/scale/framing and companion-page transition, preserving the focused PDF page and correct spread mapping. All these transitions become immediate when application animations are disabled or reduced motion is requested. See section 9 and the transition acceptance gates in the implementation prompt.

## Changes to the supplied proposal

- Keep real 3D mesh curl, correct front/back textures, lazy loading, modeled edge thickness and disciplined cleanup.
- Replace unspecified high-fidelity physics with a controllable arc-length-preserving curl and limited spring parameters. Full cloth simulation is unnecessary for a deterministic page reader.
- Prefer matte/satin paper. Gloss is an optional subdued material, rather than a universal PDF effect.
- The right paper stack shrinks while the left grows; total thickness is conserved. The entire book should not lose thickness as it is read.
- Keep the binding anchored and center the visible book using a root/camera offset. The spine must not jump independently of the pages.
- PDF bytes are rasterized into page images before upload; raw PDF content is not a WebGL texture. Reuse the app's existing render service, with cancellation/versioning and prefetch.
- Avoid calling file:// access inherently safe. Use the existing authorized document capability or validated app protocol. [Electron recommends custom protocols over file://](https://www.electronjs.org/docs/latest/tutorial/security/).
- Cleanup must follow ownership, including per-page texture disposal, tasks and listeners. [Three.js requires explicit disposal of GPU resources](https://threejs.org/manual/pages/cleanup.html); renderer.dispose alone does not define the document lifecycle.
- Add missing requirements: input state machine, cancel/reversal policy, text selection, links/annotations, location continuity, resize, context loss, accessible fallback, performance gates and animation-off mid-turn behavior.

All numeric geometry, timing and memory settings in the prompt are initial engineering targets for profiling, not facts measured from the current app.
