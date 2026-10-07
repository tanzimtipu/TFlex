# Jovrel Book View — reliable 3D paper curl

Replace the current Book View page-turn implementation with a production-quality WebGL paper-curl presentation integrated into the existing Electron PDF editor. Inspect the actual repository and applicable instructions first. The objective is fluid interaction, sharp readable PDF content and correct navigation, with realistic paper bending as a restrained enhancement. Deliver integrated code, regression tests, profiling evidence and a reviewable change rather than an isolated flipbook demo.

Read the accompanying live audit before implementation. In the installed app, entering from editor page 7 opened Book View at 1; leaving Book View at 8–9 restored editor 7. An outer-edge drag selected text instead of turning the sheet, and selection highlights persisted on a subsequent spread. Single/spread buttons and Next worked. Disabling Animations produced an immediate page change; preserve that behavior. No current FPS or VRAM benchmark has been established, and the current renderer technology has not been identified from source.

## 1. Stabilize navigation before replacing rendering

Create one document-scoped reading state shared by editor and Book View: document ID/version, focused PDF page, visible spread, reading direction and view anchor. Book View must enter at the current location and publish the final settled location on exit. Preserve location on resize, single/spread switching, tab switching and context restoration. Use 1-based PDF page numbers in the UI and explicit conversions for renderer indices.

Treat PDF page number and virtual physical leaf index as different concepts. Define and test a spread resolver for cover-style presentation: page 1 is displayed alone on the right in left-to-right mode; subsequent spreads 2–3,4–5,...; the final page may be alone. A turn from 2–3 to 4–5 presents page 3 on the front of the turning leaf and page 4 on its back. If an ordinary document uses a different pairing convention, keep that option explicit and consistent. Synthetic blank verso surfaces are not counted as PDF pages. Do not manufacture hard covers, spine titles or binding metadata that the PDF does not contain. Cover styling is an optional presentation mode.

Use an explicit state machine: idle → preparing → dragging or settling → committed/cancelled → idle. Include suspended, context-lost and disposed states. Distinguish committed page state from a requested target; the header must not claim a settled page while another sheet remains visible. Commit exactly once on a completed turn. Cancellation restores the original spread. Invalid turns at first/last page are no-ops.

Allow only one active turn. During settling, retain at most one pending navigation intent with a documented last-intent policy; do not build an unbounded animation queue. Opposite direction input must have predictable cancellation/settling rules. A direct page jump bypasses intermediate flips. Document close, stage exit, resize and animation-preference changes invalidate stale callbacks via a session/generation token.

## 2. Choose and isolate the engine

Default recommendation: a locally bundled Three.js WebGL renderer behind a BookRenderer adapter, reusing Jovrel's existing PDF page-raster service. Pin a compatible dependency version and record its license. Evaluate DearFlip only as a time-boxed alternative if it passes offline packaged-Electron operation, redistribution licensing, restrictive CSP, existing-PDF integration, drag control, instant mode, accessibility and resource lifecycle tests. Do not assume that its web/demo license or API meets desktop distribution needs. Avoid introducing a second PDF parser or independent document state merely to use a flipbook library.

Animated turns must use actual tessellated 3D page geometry, not a flat rectangle rotating with CSS or 2D canvas distortion. DOM and 2D PDF rendering remain appropriate for resting text/annotation interaction, reduced-motion mode and fallback. A WebGL canvas alone must not remove text selection, search, links, accessibility or annotation support already present in Book View.

Proposed module boundaries, adapted to existing project conventions:

- BookViewShell: responsive region, toolbar/footer, focus and accessible status.
- BookSession/SpreadResolver: canonical location and leaf/page mapping.
- TurnController: input arbitration, state machine, commit/cancel, animation settings.
- BookRenderer adapter with WebGLBookRenderer and InstantBookRenderer/fallback.
- PageCurlGeometry/material shader and BookStackGeometry.
- PdfPageTextureProvider: existing raster adapter, scheduling and cache keys.
- TextureBudget/ResourceOwner: explicit ownership, eviction and disposal.
- PageInteractionLayer: resting text, links, annotation coordinates and hit tests.
- Narrow preload/document capability API only where existing access requires it.

Do not implement every module as a new independent subsystem if an equivalent already exists. Reuse shared commands, semantic tokens and document lifecycle.

## 3. Paper deformation and input physics

Use a reusable indexed grid with normalized page coordinates, initially around 64×24 segments, tuned by profiling. An analytic developable cylindrical/conical curl or a constrained strip deformation is preferred over a general cloth solver. Preserve approximate arc length so text does not stretch like rubber. Anchor the bound edge, limit curvature and twist, and avoid self-intersection or penetration of the resting page stack.

Map the pointer to a book-local plane/ray intersection. Corner/edge displacement controls curl axis, radius and turn progress. Tight curvature follows the interaction point; the bound edge remains stable. A critically damped spring on progress and limited curl parameters provides the elastic release; it is not a full unconstrained paper simulation. Use time-based integration with bounded delta/substeps so behavior is refresh-rate independent. Do not allocate geometry/arrays/materials each frame. Prefer GPU vertex deformation or bounded reusable buffer updates; handle normals consistently for the bent surface.

Pointer dragging should be direct: pointer position drives the page without a lagging easing chain. On release, completion or rollback uses position plus velocity, with clamped thresholds. Start with a 350–500 ms button turn and 180–300 ms release settle; tune through observation, not arbitrary long cinematic sequences. No oscillatory bounce at the end.

Use Pointer Events and setPointerCapture after accepting a drag. Separate a 24–40 DIP outer-edge/corner turn region from the text-selection interior. Suppress text selection only during an accepted turn; do not globally disable it. Text selection and annotation mode take priority over curl when applicable. Clear stale selection ranges when their underlying page changes; do not reapply a DOM range onto another page's text.

Support click Next/Previous and reader-scoped ArrowLeft/ArrowRight/PageUp/PageDown where appropriate; never hijack arrows in text fields or editable annotation controls. Respect reading direction. Handle pointercancel, lost capture, blur, Escape, close and resize. A cancelled gesture must not leave a curled sheet or stuck input lock. No annotation may be created accidentally by a turn gesture.

## 4. Material, spine and thickness

Use correct front/back page textures, explicit UV orientation and back-face behavior. Make the resting surface appear close to the source PDF's white/ink colors. Use restrained ambient/hemisphere illumination plus one directional source, soft fold shading and modest shadowing. Keep paper matte/satin by default; optional low-intensity magazine sheen can be used for a chosen glossy presentation. Avoid metallic appearance, transmission, bloom, large environment reflections or highlights that wash out text. Roughness/highlight intensity are tunable visual parameters, not simulated material facts about the file.

Render a bounded number of real mesh surfaces: resting left/right pages, one turning leaf, left/right fore-edge stacks and optional covers. Do not create a mesh per PDF page. Stack thickness represents the number of leaves: while turning forward the right stack decreases and the left grows; total paper thickness is conserved within the stylized mapping. Clamp displayed thickness so a 520-page file does not become an absurd brick. Reverse turns restore stack balance. Add thin edge/bevel geometry without z-fighting.

The physical binding anchor stays stable. Center the visible book bounding box with a controlled book-root/camera offset for front cover, middle spread and back cover; do not arbitrarily move the spine independently of the meshes. Offset changes must not jump during a gesture. Single-page view also uses a true curled sheet during animation, with consistent page mapping and no fake blank page counted in navigation.

## 5. PDF texture pipeline and GPU budget

Use the existing document/raster engine. If it is PDF.js, use its packaged worker and cancellable render tasks rather than an additional hidden viewer window. If another engine is authoritative, adapt its raster results. The renderer should receive a document capability/session and page data, not unrestricted filesystem access.

Request current spread, the turning front/back surfaces and near neighbors. Prioritize visible pages; prefetch one spread in each direction when budget allows. Start with at most two concurrent raster jobs and profile. Cache by document version/page/rotation/raster scale; invalidate changed pages after edits. Late results from a previous session must never attach to a new document. Share in-flight work and avoid duplicate uploads.

Determine raster resolution from actual page screen coverage, zoom and capped device pixel ratio, respecting MAX_TEXTURE_SIZE and memory budgets. Upgrade sharpness after settling; do not swap texture resolution midway through a turn. Keep current source textures locked for the entire gesture and prepare target surfaces before starting. If the target is not ready, leave the current spread intact with an accessible preparing indication. Never replace the reader with a blank canvas while textures load.

Use a byte-budgeted LRU rather than a page-count-only cache. Initial configurable estimated GPU texture budget: 128 MiB standard, 64 MiB constrained mode, increased only when measured quality/performance justifies it. Include mipmaps, buffers, shadow/render targets and transient overlap in estimates. RGBA8 base texture memory is width×height×4 bytes; a full mip chain adds approximately one third. A2048×2048 texture is16 MiB base, about21.3 MiB with mipmaps, before driver overhead. Hardware VRAM capacity is not reliably queryable from WebGL; report estimates as estimates. Use lower resolutions to stay within budget rather than knowingly exceeding it with locked pages.

Prewarm shaders and upload ready textures outside the critical drag/turn path using APIs supported by the chosen Three.js version. Apply sRGB texture/output handling appropriate to that version and verify PDF colors against the normal reader. Render on demand while idle; stop the RAF loop when settled/hidden. Start with DPR capped at 1.5, enabling up to 2 only after profiling. Cap quality on slower devices based on measured frame times, not brand/model strings. Do not use synchronous GPU readbacks in the animation loop.

## 6. Lifecycle and graceful failure

Define ownership of each document texture, bitmap, material, geometry, render target, worker task, event listener, observer and animation callback. On eviction dispose the texture and release owned CPU image data. On Book View disposal cancel pending tasks/RAF, release pointer capture, remove listeners/observers, detach DOM layers and dispose all owned GPU resources. Call renderer.dispose when destroying an owned renderer, not whenever a document closes if that renderer is deliberately shared. Dispose textures/geometries/materials explicitly; renderer.dispose is not a replacement for that ownership cleanup. Keep shared PDF worker/document services alive until their actual owner releases them.

Handle webglcontextlost and restored. Preserve canonical reading state; stop rendering and offer/revert to the normal instant reader. Rebuild only current-needed resources on restoration, with generation guards. If WebGL creation or required capabilities fail, reading remains available through the existing PDF view. Do not force a costly context loss on every page turn or resize. Development context-loss simulation is a validation tool.

At most one active WebGL Book View should render across document tabs unless profiling proves a need for more. Inactive views retain logical state without continuous rendering. Closing and reopening repeatedly must not accumulate canvases, workers, textures or listeners.

## 7. Electron boundary and offline packaging

Keep contextIsolation:true, nodeIntegration:false, sandboxing and webSecurity enabled. Use packaged local scripts/shaders/workers with restrictive script-src 'self'; WebGL does not require unsafe-eval merely to run GLSL shaders. Add only the minimal worker/resource CSP origins required by the actual pipeline. Do not disable CSP or enable bypassCSP for a custom protocol.

Reuse existing validated file/document access. Prefer an authorized document ID through a narrow preload API, or an app-owned custom protocol with request validation, instead of rendering arbitrary raw file:// URLs or accepting arbitrary renderer-supplied absolute paths. Validate sender/session, authorization, path traversal and range requests. Register any custom protocol on the BrowserWindow's actual session. Large PDFs may need bounded/range reads rather than repeatedly copying the complete file buffer. Package all runtime resources; no CDN, remote code execution or document upload is necessary for Book View.

## 8. Animation off and accessibility

Effective turning animation = application animationsEnabled AND NOT prefers-reduced-motion. Honor changes while the reader is already open. Turning animations off during a drag/settle must cancel the RAF/spring and resolve to one documented committed location exactly once, restore interaction layers and show the page instantly. With animation disabled, every click/key/accepted swipe updates the page without flipping, fading, sliding, camera travel or delayed CSS transitions. Cached surfaces should update on the next render; uncached pages may show preparation feedback but retain the old page until ready. No visual delay is added just to mimic a turn.

Home decorative-motion pause is separate and must not govern Book View. Keep Next/Previous buttons, focused-page jump, visible range, close and keyboard paths available in both engines. Expose meaningful accessible names/status and focus return; a canvas-only reader is not acceptable. Preserve resting text selection, links and existing annotations. During a turn hide/disable misaligned DOM interaction layers, then restore them at exact settled PDF coordinates. For editing, coordinate transform correctness is mandatory; if editing cannot be supported safely in a curled state, restrict edits to settled pages explicitly.

## 9. Responsive containment

Measure the Book View container with ResizeObserver. Fit the book to usable width AND height after toolbar/footer; keep navigation visible. A narrow container defaults to a readable single page, preserving the focused PDF page; remember the user's preferred wide spread mode so it can return at wider sizes. Choose the breakpoint from minimum useful page width, initially about420 DIP per page plus gutters, and test at 973×633 and 960×640 window sizes as well as maximized.

On resize during a gesture, settle/cancel through the controller before applying new geometry; do not mutate camera/page dimensions halfway through a drag. Recompute projection, drawing buffer and interaction transforms coherently. Coalesce resize updates and re-rasterize only when needed. No layout feedback loop, extra renderer creation or blank-frame flash on every resize. Avoid vertical scrolling merely because the default fit ignored available height; allow deliberate zoom/pan separately.

## 10. Verification and performance gates

Test a 1-page PDF,2 pages, odd/even page counts,34-page text PDF, scanned pages, mixed page sizes/rotations,520 pages and a 1000-page stress fixture. Test first/last page, covers, reverse turns, middle jumps, single/spread, repeated/alternating input, cancel, blur, tab changes and close mid-load. Verify correct front/back texture content and absence of mirrored text.

Regression gates: editor 7→Book View includes 7; Book View8–9→editor restores focused 8 or 9 according to explicit focus, never old 7. Drag in edge region turns; interior drag selects text. Selection does not leak onto another spread. Resize preserves page state. Animations-off and reduced-motion apply instantly including mid-turn. No stray animation callback commits after session close. Search/links/annotation hit regions align when settled.

Profile the packaged Electron build on named representative integrated-GPU and constrained/software-rendering machines. Aim for 60 fps at the selected quality on the normal machine; initial warm-turn frame-time p95≤ 20 ms and no repeated >50 ms main-thread tasks. Record cold preparation separately from warm animation. These are targets to prove, not promises. Degrade mesh/DPR/shadows before quality becomes unstable; offer instant mode if smooth motion cannot be sustained.

Run 50 sequential turns and 20 enter/exit or open/close cycles. Record renderer.info resource counts, estimated texture bytes, main-thread/raster timing and process memory trend after warmup; resource counts should return to the owned baseline and memory should plateau rather than grow per cycle. Do not claim measured VRAM from texture estimates or require process memory to return byte-for-byte immediately after GC. Simulate context loss. Test offline install, CSP and local file access in the packaged app. Record reproducible traces/video, machine/build settings and failures.

## 11. Delivery order

First fix shared reading state, input arbitration and responsive instant mode. Next implement and validate one curled leaf with synthetic textures, correct front/back mapping and deterministic commit/cancel. Then integrate the existing PDF raster pipeline, byte-budget cache and ownership cleanup. Add restrained materials, spine/stack visuals and adaptive quality only after correctness and profiling gates pass. Validate the packaged app before removing the old implementation/fallback. Keep the replacement behind an internal feature flag until parity and performance are demonstrated; do not ship two conflicting navigation states.

Deliver the integrated wrapper, curl renderer/controller, raster adapter/cache, disposal code, security integration if needed, tests and measured verification report. Document any supported-feature gaps; do not mark the project production-ready based solely on an attractive demo.

References: [Three.js resource cleanup](https://threejs.org/manual/pages/cleanup.html), [WebGLRenderer API](https://threejs.org/docs/pages/WebGLRenderer.html), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol), [PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/), [DearFlip documentation](https://js.dearflip.com/docs/). Verify exact APIs against the repository's pinned versions.
