# TFlex — Requirements

## Summary

TFlex is a modern desktop PDF studio for Windows — a fast, lightweight, single-user
alternative to Adobe Acrobat Pro for the things people actually do with PDFs: view them
beautifully, organize pages, annotate, fill forms, and sign.

It is an installable Windows desktop app. It should feel like a real commercial product from
the first launch: quick, fluid, polished, and clearly capable. It ships with sample documents
available from a welcome screen so every feature can be tried immediately.

TFlex is built to grow: licensing, user accounts, and a cloud-backed document database are
planned for a future version. Version 1 stays fully local with no login, but the architecture
must not paint us into a corner (see "Future-proofing" below).

## The product

### Application shell

- A modern desktop window: left rail (thumbnails / annotations / bookmarks), top toolbar,
  central document canvas, right properties panel that appears when relevant.
- Light mode and dark mode, switched by an always-available control. The choice persists.
- A welcome / start screen shown when no document is open: recent files, sample documents,
  and clear primary actions (Open, Merge).
- Smooth, purposeful motion: panel transitions, tab changes and list updates animate
  (roughly 150–250 ms). Nothing janky, nothing gratuitous.
- Multiple documents open in tabs within one window.

### Phase features

See "Phases and success criteria" for the buildable, gated feature list.

## Seed content

The installer ships with sample PDFs (a formatted report, a scanned-style document, a form,
and a long document of 100+ pages) registered on the welcome screen, so every feature is on
display from first launch. The set grows with the phases.

## High-level technical guidance

Just enough direction to keep things on track — specific library choices are left to the
Coding Agent unless stated here.

- **Electron** app written in **TypeScript**, with a **React** renderer and a documented
  build/start setup (npm scripts). Packaged for Windows with **electron-builder** (NSIS
  installer and a portable build).
- **PDF.js** for page rendering in the renderer process.
- **pdf-lib** for PDF manipulation (merge, split, rotate, annotations, forms, flatten) in the
  main process. Rendering and manipulation are separate concerns — keep them in separate
  modules behind clear interfaces.
- All file and PDF-engine work happens in the main process (or a worker), never on the UI
  thread. The UI must stay responsive while a 500-page file loads.
- Prefer **popular, well-supported libraries** over custom code. Keep the implementation
  simple and conventional.
- End-to-end tests drive the real packaged-style app via **Playwright** (Electron support).
- Unit tests accompany every phase, frontend and backend.

### Future-proofing (architecture constraints, not features)

Version 2 will add license verification, user login and a database. Therefore in v1:

- Keep a clean main/renderer boundary with typed IPC contracts in `src/shared/` — no renderer
  code reaching into Electron APIs directly.
- Isolate all persistence behind a single storage/service layer (e.g. app settings, recent
  files) that can later front a real database.
- Keep an obvious seam where licensing/auth gating would attach (an app-level gate before
  the main UI mounts), without building the gate itself.
- Do NOT build: login, accounts, licensing, sync, or any network dependency. v1 works
  fully offline.

## Performance budget

TFlex's identity is fast and lightweight. These are requirements, not aspirations:

- Cold start to interactive welcome screen: under 3 seconds on an ordinary Windows laptop.
- Opening a 500-page PDF: first page rendered and UI interactive within 3 seconds; the app
  never freezes during load (progressive rendering).
- Scrolling and zooming a document stay smooth (no visible blank-page stalls beyond brief
  tile rendering).
- Idle memory with one typical document open: under 400 MB for the whole app.
- Installer size: under 150 MB.

## Not in scope

Deliberately left out of v1. Do not build these:

- No in-place editing of existing PDF text or images (v2 candidate — it is the hardest
  feature in the category).
- No OCR, redaction, document compare, Bates numbering, preflight/print-production,
  digital certificate signing, or batch processing.
- No login, licensing, accounts, cloud sync, or any network features (v2).
- No bookmarks/outline editing (read the outline if present; editing is out of scope).
- No PDF creation from scratch or from other formats (docx, images) — v1 works on
  existing PDFs, except that merge/split/extract produce new PDFs.
- No macOS or Linux packaging — Windows only.

### Current-scope supersession

The original v1 exclusions above describe the first release. A later numbered phase that
explicitly adds a capability supersedes the matching exclusion for the current project.
Therefore Phases 9–11 authorise their specified create/export, edit, and OCR work; Phase 6
authorises the OTA release workflow. All other original exclusions remain in force.

Where a later phase sets a visual or motion rule that differs from the general look-and-feel
guidance, the later phase controls for that feature. In particular, Phase 14's glass motion
may use its stated 200–400 ms spring transitions; all unrelated UI keeps the 150–250 ms,
non-bouncy baseline.

**Phase 35 supersedes the wallpaper show-through.** The operator requires standard Windows window
behaviour (double-click maximise, Aero Snap to the top/left/right edges, and an auto-hide taskbar that
reveals on hover). `transparent: true` makes the window a Windows layered window, which breaks those
behaviours and swallows the taskbar hover, so Phase 35 retires Phase 14's "desktop wallpaper shows
through the window" behaviour in favour of an opaque window whose frosted chrome diffuses the app's OWN
ambient background. The frosted/glassy look and its motion rules stay in force; only the source of the
translucency changes (the app's background instead of the desktop).

## Look and feel

Applies to the whole app:

- **Modern, calm, and designed on purpose.** Clean typography (a quality UI font such as
  Inter), generous spacing, a restrained neutral base (zinc/slate family) with ONE accent
  color used consistently for primary actions and selections — **`#2563eb` (blue 600)**.
- Dark mode is a first-class theme, equally considered — not an inverted afterthought. The
  document canvas adapts gracefully in dark mode (dimmed chrome around pages; page content
  itself is not color-inverted).
- Motion: fast, subtle transitions (150–250 ms, ease-out). Panels slide, hover states
  respond, tabs crossfade. No bouncy or slow animations.
- Avoid the tells of generated design: gradient hero backgrounds, purple-dominated themes,
  thin accent borders down one side of panels, oversized rounded corners on everything,
  emoji used as UI icons (use a proper icon set such as Lucide).
- Density: this is a productivity tool. Comfortable but information-dense — closer to
  VS Code / Linear than to a marketing site.
- Beyond these rules, layout and visual style are the Coding Agent's call.

## Phases and success criteria

Build in these phases, in order. **Do not start a phase until every success criterion of
the previous phase is demonstrably met** — each criterion must be something you can show
working, not just assert.

Every phase closes the same loop: its unit tests pass, its end-to-end tests pass against the
real running Electron app, and the new features have been used in the running app with
screenshots taken and inspected.

### Phase 1 — Viewer foundation and Windows packaging

**Features**

- Dev start with one documented command; production build produces a Windows installer
  (NSIS) and portable build via electron-builder.
- App shell: toolbar, left thumbnail rail, tab bar, welcome screen with recent files and
  samples; light/dark themes persisted.
- Open a PDF from disk; render pages with PDF.js; continuous scrolling, zoom (buttons,
  ctrl+wheel, fit-width / fit-page), page indicator and jump-to-page.
- Thumbnail rail with current-page highlight; text search within the document with hit
  highlighting and next/previous navigation; document outline (bookmarks) panel shown when
  the PDF has one.
- Recent files list, persisted. Window size/position/theme persisted.
- Sample PDFs bundled and listed on the welcome screen.
- The Playwright + Electron e2e harness runs against the real app.

**Success criteria**

1. One documented command starts the app in dev; a documented command produces an
   installable Windows build.
2. Opening the bundled sample report renders its pages crisply; zooming and fit modes work;
   scrolling stays smooth through 100+ pages.
3. The thumbnail rail tracks the current page; clicking a thumbnail jumps to it.
4. Searching for a known word in the sample report highlights all hits and next/previous
   cycles through them with the document scrolled to each.
5. Theme toggle restyles the whole app, and theme, recent files, and window geometry survive
   an app restart.
6. Cold start and 500-page-open meet the performance budget (timed and recorded).
7. Unit tests for document open, page model, search index and settings persistence pass.
8. At least one e2e test launches the real Electron app, opens a sample PDF, searches, and
   toggles the theme — and passes.

### Phase 2 — Page organization

**Features**

- Insert/merge: combine the open document with one or more other PDFs (choose position).
- Split by page range into a new file; extract selected pages to a new file.
- In the thumbnail rail: drag to reorder pages, rotate left/right, delete (with undo).
- Save and Save-As for the modified document.
- A clear modified-state indicator on the document tab.

**Success criteria**

1. Merging two sample PDFs produces a file whose pages are A-then-B in the expected order;
   the output opens correctly in an external reader (verified by re-opening it in TFlex with
   correct page count and text extraction).
2. Splitting pages 10–20 of the long sample produces an 11-page PDF that opens correctly.
3. Dragging a thumbnail reorders pages; rotate and delete apply correctly; undo restores.
4. Save-As writes a valid PDF; reopening it in TFlex shows the reorganized pages.
5. The tab shows modified state after any change and clears after save.
6. Unit tests for merge, split, reorder, rotate, delete and undo in the PDF engine pass.
7. E2e tests cover merging two documents and reordering pages via drag — and pass.

### Phase 3 — Annotation

**Features**

- Text markup: highlight, underline, strikethrough — applied by selecting text, with color
  choice.
- Freehand pen (color, width), text boxes, and shapes: rectangle, ellipse, arrow.
- Sticky-note comments attached to a page location, with an editable note.
- An annotations panel listing all annotations of the document; clicking one scrolls to it;
  annotations can be edited (color, content) and deleted.
- Annotations are written into the PDF itself (standard PDF annotation objects) so they
  appear when the file is opened in other readers; saving persists them.

**Success criteria**

1. Each annotation type can be created on a page and renders correctly at every zoom level.
2. Text markup anchors to the selected text and stays aligned after zoom and scroll.
3. The annotations panel lists every annotation; selecting one navigates to it; editing and
   deleting work.
4. After Save-As, annotations survive: reopening the file in TFlex shows them, and they are
   present as real annotation objects in the saved file (verified by parsing, e.g. with
   pdf-lib, in a unit test).
5. Unit tests for annotation create/edit/delete and PDF serialization pass.
6. E2e tests cover highlighting text, adding a sticky note, saving and reopening — and pass.

### Phase 4 — Forms and signatures

**Features**

- AcroForm detection: form fields (text, checkbox, radio group, dropdown, list) become
  fillable in the viewer with appropriate editors.
- Filled forms save with values intact (still editable on reopen) and can optionally be
  flattened (values baked in, fields removed) on Save-As.
- Signatures: create by drawing (pointer) or typing (rendered in a script style); place,
  move, resize and delete a signature on any page; saved signatures list for reuse
  (stored locally).
- Signed documents save correctly; optionally flattened.

**Success criteria**

1. Opening the sample form shows every field as fillable with a type-appropriate editor;
   filling and saving preserves values on reopen.
2. Flattening produces a PDF with the values visible but no form fields (verified by
   parsing the saved file).
3. A drawn signature can be placed, moved, resized and saved; it appears in the output file
   as page content.
4. A saved signature can be reused on another page without redrawing.
5. Unit tests for form read/write, flatten, and signature placement pass.
6. E2e tests cover filling the sample form, signing it, saving and reopening — and pass.

### Phase 5 — Final quality gate

**Work**

- A look-and-feel pass over the whole app in both themes.
- The full unit and e2e suites, with coverage measured.
- A complete walkthrough of the running app with screenshots of every screen in both
  themes.
- An adversarial review of the finished product, including hostile PDFs from
  `test-fixtures/`.
- A packaged-build verification: install the produced installer (or run the portable
  build) and repeat the smoke walkthrough there.
- Performance re-verified against the budget and recorded.

**Success criteria**

1. Full unit suites pass with at least 80% statement coverage in `src/main` (PDF engine)
   and meaningful coverage in the renderer core logic, reported by the test command.
2. The full e2e suite passes against the real running app.
3. Every feature in this document has been exercised in the running app with inspected
   screenshots in both themes; no errors in the console during the walkthrough.
4. The adversarial review record exists; every finding is fixed or rejected with a written
   reason; all suites pass on the final build.
5. The packaged build passes the same smoke walkthrough.
6. Performance budget numbers are met and recorded in `PERFORMANCE.md`.

## Final success criteria

The project is complete, and the Coding Agent may stop, when **all** of the following are
true:

- A non-technical person can install TFlex on Windows from the produced installer (or run
  the portable build) and use it without instructions beyond the welcome screen.
- Viewing, search, tabs, themes; merge/split/reorder/rotate/delete/extract with undo; all
  annotation types with an annotations panel; and form filling, flattening and signatures —
  all work as described, and all changes save correctly to real PDF files that open in
  other readers.
- The performance budget is met and recorded.
- The look-and-feel rules are met in both themes and none of the avoid-list appears.
- All unit tests pass at the coverage target and the full e2e suite passes.
- The adversarial record exists, every finding is fixed or rejected with a written reason,
  and all suites pass on the final packaged build.
- **Most importantly: the product has been validated by using it end to end as a real user
  would — opening, organizing, annotating, filling and signing real PDFs, in both themes,
  on the packaged build, with every screen visually inspected. Passing tests is necessary
  but NOT sufficient.**

## Version numbering (Phase 6 onward)

From Phase 6 the semver series is active: **v1.1.x**. Retrospemptive naming of v1
deliverables: v1.0.0 for the original gate closure (Phases 1-5). From now on
`package.json.version` always matches the next tag. Tag names like `v1.1.0`,
`v1.1.1` etc; incrementing through included build metadata when needed.

## Phase 6 — Tab UX, tools palette, menus, color picker, OTA updates, auto-git-push

**Planned first; fixes to land before features are declared green:**

1. BUG — tab click frozen/unresponsive (React handler/state) — reproduce and fix source.

Features and success criteria:

1. Empty tabs: "+" control to create an empty tab; opening a PDF fills it; closing
   returns to the previous tab. Success: "+ tab->" stay alive in welcome/-empty tab and
   closed returns to prior tab as evidenced by e2e.
2. Tools palette right-side panel (icon+label list/grid toggle persisted) containing
   merge/split/extract/rotate/delete/sign/forms entries. Success: panel opens; modes
   persist across restart via settings; e2e verifies.
3. Standard app menu: File (Open/Merge/Save/SaveAs/Recent/Close-Tab-Exit), View, Edit,
   Tools, Window, Help/About with version badge, Preferences (theme default, recents
   limit, storage). Success: menu rendered with existing single-source handlers;
   accelerators work; About reports app version for OTA surface.
4. Annotation color UX: active-tool swatch as rounded square under the tool; opens
   color palette with preset+full picker (hex/RGB); persisted per theme. Applies to
   highlight/ink/underline/strikeout/note/shapes. Success: e2e picks custom color and
   persists.
5. OTA updates: electron-updater in main via updateService, IPC status/download/install,
   About+toolbar indicator; silent download+prompt restart; portable build explicitly
   no-auto-update (documented); private repo credentials not committed. Success: bump
   version then simulated/published release surfaces "Update available" in app.
6. Release pipeline: after a full green loop (build, unit+e2e, package checks) for a
   phase/fix batch, git-agent tags v1.x.x (`npm version <level> --no-git-tag-version`,
   commit bump, `git tag`, then push) **only after explicit operator authorisation in the
   current session**. Success: tag lands only on green builds, and the pushed tag's
   `package.json` version matches the local working copy.

Repo-safety amendments:
- Prune duplicate reduntant e2e/unused harnesses before first commit; no new debug
  files under e2e/ or root.
- .gitignore additions: .env, test-results/, screenshots/, test-fixtures/*.pdf never
  pushing-kill exceptions (qa/adversary-authored README/MD inside those dirs still OK).
- Unused harnesses named harness.cjs/harness.js/retest_harness.cjs/retest_rework*
  purge as part of P6 gate.

Completion demands: all Phase-6 green; tag v1.x.x pushed; OTA verified by a version
bump against tanzimtipu/tflex-releases (release artifacts in the public releases repo,
source-only commits stay in the private tanzimtipu/TFlex repo); thumbnails/screenshots included per gate; timing per
performance budget as RECheckWise for the new tab-switch/palette work.

### Phase-6 no-op remediation checklist (required to close Phase 6)

These bugs came out of the Phase-6 extension scope. qa files one DEF each (severity
tagged inline/in parentheses), frontend/backend:frontend-dev owns renderer fixes
(except #3 export and #2 sign where the backend path is implicated; coordinate via
shared contract). qa defines entry, developer fixes, qa verifies → CLOSED. Each of
these must be verified together with the CONTROL-INDEX per phase rule and a no-op
sweep + silence attack audit before Phase 7 is allowed to start:

1. The "+" for new tab visible on empty workload. It must only appear when at least
   one tab exists. — LOW.
2. Sign inside PDF returns "Item not found" — the promised new flow returns a
   failure at engine/driver level. HIGH.
3. Word export saves as an image (.docx containing a page rendered as picture); it
   must contain editable text. HIGH — backend chose wrong export path.
4. Click Edit then select text: the canvas goes blank. HIGH (silent canvas crash).
5. Left-pane page selection reverts to page 2 of the long PDF. HIGH.
6. Rotate page click: no-op. HIGH.
7. Delete page click: no-op. HIGH.
8. Highlight color default shows white; must be the accent blue (#2563eb). MEDIUM.
9. Crop function click: no-op. HIGH.
10. Stamp "place on page" click: no-op. HIGH.

## Phase 7 — Phase-6 fixes (must land before Phase 8 features)

**Fixes (target the source, not workarounds):**

1. Color palette: replace the hex/RGB text-input picker with a visual color picker —
   hue/saturation gradient pad, hue slider, optional swatch grid, and the current-color
   preview. Preset swatches remain as quick-picks; the custom picker appears inline
   (not as a dialog) when the user selects "Custom…" from the swatch row. Applies to
   all annotation tools. Persisted per theme.
2. "+" add-tab control: move from the far right of the tab bar to immediately after
   the rightmost open tab (always adjacent to the last tab). Clicking "+" opens an
   empty tab; the control re-attaches to the new rightmost tab.
3. App menu: the Phase-6 standard menu (File/View/Edit/Tools/Window/Help/About/
   Preferences) is not visible in the running app. Diagnose why (missing
   `Menu.setApplicationMenu`, wrong platform assumption, or registration missing in
   `start()`) and fix so the menu bar renders on Windows with all items functional.

**Success criteria:**

1. Palette: visual gradient picker picks a custom color and persists per theme; unit
   tests cover the picker state model; e2e exercises a custom-color round trip.
2. "+": adjacent placement verified visually (screenshot) and by e2e (open 3 tabs,
   verify control sits after tab 3).
3. Menu: menu bar renders on Windows; every menu item triggers its handler; e2e drives
   File→Open and Preferences→theme-default.
4. No regressions: full unit + e2e suites green.

**Settings impact:** none (reuse Phase-6 `annotationColors` and existing fields).

## Phase 8 — Optimize (file size reduction)

**Features**

- Reduce file size action: one-click "Reduce file size" (image downsample/recompress,
  font subsetting, discard objects, cleanup) with a quality preset choice
  (screen/ebook/printer/press).
- Audit space usage: dialog showing percentage breakdown of the file by element type
  (images, fonts, content streams, metadata).
- Fast web view (linearize) toggle on Save-As.

**Success criteria**

1. Reducing a 20MB sample PDF produces a measurably smaller file that re-opens
   correctly with identical page count and text extraction.
2. Audit dialog shows a plausible breakdown for a real file; numbers are reproducible.
3. Unit tests for optimizer pipeline round-trip; e2e covers reduce+audit+reopen.

**Settings impact:** `optimizePreset?: 'screen'|'ebook'|'printer'|'press'` (default
`'ebook'`; validation: preserve-if-valid enum, reject-if-invalid; transported via
AppSettings IPC; used by the optimizer action and saved per-document? No — global).

## Phase 9 — Create + Export

**Features**

- Create PDF from images (JPEG/PNG) and from clipboard content; insert resulting pages
  into open document or new tab.
- Export PDF pages to images (JPEG/PNG/TIFF) with resolution choice; export text to
  plain text/RTF; export whole PDF to Word (.docx) via a bundled converter (offline).
- Insert blank page; insert from another PDF at a chosen position.

**Success criteria**

1. Creating a PDF from 3 sample images produces a valid PDF that opens in TFlex with
   correct page count and dimensions.
2. Exporting a page to PNG at 150 DPI produces a viewable image; text export preserves
   reading order for the sample report.
3. Insert-blank and insert-from-PDF round-trip correctly in unit tests and e2e.

**Settings impact:** `exportImageFormat?: 'png'|'jpeg'|'tiff'` (default `'png'`);
`exportImageDpi?: number` (default 150, range 72–600); `createImageQuality?: number`
(default 85, range 10–100). All validated preserve-if-valid.

## Phase 10 — Edit content (text and images in place)

**Features**

- Edit existing text: click into a text run, change/replace/delete with font metrics
  preserved (font, size, color, baseline); reflow within the original bounding box.
- Add new text box on any page with font/size/color choice.
- Edit images: move/resize/replace/crop embedded images.

**Success criteria**

1. Editing a word in the sample report produces a PDF that opens in an external reader
   with the change visible and no layout shift.
2. Round-trip: edit → save → reopen shows the edit; text extraction reflects it.
3. Unit tests for text-run replacement and image crop; e2e for the full edit-save-reopen
   loop.

**Settings impact:** `editDefaultFont?: string` (default `'Helvetica'`; validation:
string from a bundled allowlist, preserve-if-valid).

## Phase 11 — OCR (recognize text)

**Features**

- Recognize Text action on a scanned PDF: searchable-image output (text layer behind
  the image) with language choice and downsample option.
- Batch OCR via the tools palette on multiple open documents.
- Fix OCR suspects: list low-confidence words with click-to-correct.

**Success criteria**

1. Running OCR on the scanned-style sample makes its text searchable (search finds a
   known word) and selectable; saved file re-opens with the text layer intact.
2. Batch OCR on two scanned files completes without UI freeze; progress is reported.
3. Unit tests for OCR engine integration; e2e for search-after-OCR.

**Settings impact:** `ocrLanguage?: string` (default `'eng'`; validation: ISO-639
code from a bundled allowlist, preserve-if-valid); `ocrDownsample?: number` (default
300, range 72–600).

## Phase 12 — Residual page-organize + annotate parity

**Features**

- Replace pages (swap pages from another file, retaining links/bookmarks); renumber
  pages (logical page labels, sections); crop pages (CropBox/TrimBox control).
- Callout text boxes; stamps (built-in palettes + custom stamp creation); comment
  import/export (FDF/XFDF local files).

**Success criteria**

1. Replace-pages on the sample report retains its outline and links; output opens
   correctly.
2. Crop a page and verify dimensions change in the saved file.
3. Stamps render at every zoom; comment export produces a valid FDF that re-imports.
4. Unit tests for replace/renumber/crop/stamp/FDF; e2e for the user-visible flows.

**Settings impact:** `defaultStampId?: string` (default `'APPROVED'`; validation:
string from a bundled allowlist, preserve-if-valid).
## Phase 13 — UX polish: borderless window + professional color

**Features**

1. Borderless app window (frame: false) with a custom title bar (drag region,
   window controls min/max/close wired through existing IPC), modern industry-
   standard styling, smooth animations (150-250ms ease-out per existing design
   rules).
2. Professional color: UI text and icons pop against the neutral base with
   intentional semantic color (info/success/warning/error, action accent,
   annotation colors) rather than a flat all-gray palette. Both themes equally
   considered.

**Success criteria**

1. App launches frameless with a custom title bar that drags and window controls
   that work; no OS chrome visible.
2. The installer window also appears borderless/modern (electron-builder NSIS
   appearance configured to the extent it supports; document limits).
3. Typography and icons are visibly more readable and colorful in both themes,
   while keeping the single accent color rule for primary actions; no emojis,
   proper icon set throughout.
4. Unit tests for the title bar state + any new renderer reducers; e2e covers
   frameless launch + window controls + theme colors; performance budget
   re-timed (cold start, long-doc open) and unchanged or improved.

**Settings impact:** none (theme already stored; this phase refines it).

## Phase 14 — Liquid Glass theme with frosted glass effects

**Features**

1. **Frosted glass theme**: Replace solid backgrounds with translucent frosted glass that reveals the desktop wallpaper behind the app window. Use CSS `backdrop-filter: blur()` with appropriate opacity and background colors.

2. **Tool descriptions restored**: Tools panel shows icon + title + description text for each tool (e.g., "Merge PDFs" / "Combine multiple PDFs..."). Never icon-only in this view.

3. **Dynamic panel sizing**: Tools panel width adjusts dynamically to accommodate full tool descriptions without truncation or congestion. Panel can be wider than current fixed width.

4. **iOS liquid glass animations**: Implement spring-based, fluid animations for:
   - Panel open/close transitions (spring physics, not linear)
   - Tool item hover states (subtle scale/glow)
   - Background parallax/subtle movement
   - Window focus/defocus blur intensity changes
   - Smooth 200-400ms transitions with ease-out-spring curves

5. **Visual polish**: Gradient background hints, subtle inner shadows, rounded corners on panels (16-20px), consistent frosted glass across title bar, side panels, and tool panels.

**Success criteria**

1. Desktop wallpaper shows through frosted glass backgrounds; blur intensity is pleasant and readable.
2. Tools panel displays icon + title + description for every tool; text is fully visible and not truncated.
3. Panel width accommodates content without congestion; user can see full descriptions.
4. Animations feel fluid and springy (iOS-style), not mechanical; all transitions complete smoothly.
5. Light/dark/frosted themes all implement glass effects appropriately.
6. Performance: no frame drops during animations; 60fps maintained.
7. Unit tests for animation state; e2e verifies glass theme renders and animations complete.

**Settings impact:** none (theme already stored; this phase enhances the frosted glass variant).

## Phase 14.1 — Liquid Glass CORRECTION (Visual Refinement)

**Purpose:** Correct the Phase 14 implementation to properly match the Liquid Glass reference image. The current implementation incorrectly interprets Liquid Glass as "blue + transparent." This correction establishes proper material design.

**CORRECTION PRIORITIES:**

### 1. TOP BAR HIERARCHY (Most Critical)
Create THREE horizontal surfaces with CONSISTENT design:
- **Title/Tab Bar**: Document tabs, new tab, window controls
- **Primary Command Bar**: Open, navigation, Save, zoom, primary actions
- **Context Toolbar**: Annotation tools (only when editing)

Requirements:
- Standardized heights using tokens: `TitleBarHeight`, `CommandBarHeight`, `ToolbarHeight`
- Consistent vertical centering across all bars
- Control groups with glass capsule backgrounds
- 8px-based spacing system
- NO arbitrary heights based on content
- NO misaligned controls

### 2. NEUTRAL FROSTED GLASS (Not Blue)
Primary glass material must be NEUTRAL:
- White/gray translucent base
- Subtle backdrop blur
- Restrained saturation
- 1px luminous edge highlight
- Soft inner highlight
- Blue is ACCENT ONLY for:
  - Selected states
  - Active tools
  - Focus indicators
  - Primary actions (Open button)

### 3. SHARED GLASS SIDEBAR COMPONENT
Create `GlassSidebar` component used by BOTH panels:

**Shared tokens:**
- `GlassSidebarBackground`
- `GlassSidebarBorder`
- `GlassSidebarBorderRadius` (14-18px)
- `GlassSidebarShadow`
- `GlassSidebarHeaderHeight`
- `GlassSidebarContentPadding`

**Pages Sidebar (Left):**
- "Pages" header with toggle
- Floating glass card with margins
- Thumbnails with rounded selection (not blue rectangle)
- Selection: thin accent outline + subtle glow
- Thumbnail content remains opaque (PDF accurate)

**Tools Sidebar (Right):**
- "Tools" header with view toggle
- Same glass material as Pages
- Tool rows: neutral glass, hover highlight, selected tint
- Icon colors preserved
- Full descriptions visible

### 4. FLOATING PANELS WITH MARGINS
Both sidebars must:
- Float above workspace with consistent margins (16px)
- NOT be flush to window edges
- Have outer rounded corners
- Cast soft elevation shadow
- Feel like inspector panels

### 5. TOOLBAR CONTROL GROUPING
Group related controls into glass capsules:

Example groups:
- Navigation: `[<] [1/34] [>]`
- Actions: `[Save] [Open]`
- Zoom: `[-] [307%] [+]`
- Tools: `[pointer|hand|text|box|image]`
- Document: `[Merge] [Split] [Sign] [More]`

Each group has subtle translucent background.
NO individual heavy buttons for every icon.

### 6. STANDARDIZED DIMENSIONS

**Spacing tokens (8px-based):**
- 4px = micro
- 8px = small
- 12px = control
- 16px = standard
- 24px = section
- 32px = major

**Corner radii:**
- Window: 18-22px
- Panels: 14-18px
- Control groups: 10-14px
- Buttons: 8-12px
- Pills: full

**Control sizes:**
- Visual height: 32-38px
- Hit target: 36-44px

### 7. MATERIAL HIERARCHY
Create material tokens:
- `GlassChrome` - Title/command bars
- `GlassSidebar` - Left/right panels
- `GlassControlGroup` - Toolbar capsules
- `GlassControlHover` - Interactive hover
- `GlassSelection` - Selected items

Each has:
- Blur amount
- Opacity
- Border intensity
- Shadow
- Highlight

### 8. EDGE CHARACTERISTICS
All glass surfaces need:
- Top-edge luminous highlight
- 1px translucent border
- Soft inner highlight
- Soft outer shadow
- NO obvious white outlines

### 9. PDF ISOLATION (Preserve)
- PDF canvas: completely opaque
- NO blur/opacity/tint on PDF
- PDF thumbnails: opaque
- Only UI gets glass treatment

### 10. DOCUMENT WORKSPACE
- Neutral, quiet background
- Low saturation
- Does not compete with PDF
- Subtle material variation only

**Success Criteria**

1. Three top bars with consistent heights and alignment
2. Glass is primarily neutral, not blue
3. Left and right sidebars match in material and treatment
4. Both panels float with 16px margins
5. Toolbar controls grouped in glass capsules
6. Spacing follows 8px system
7. Corner radii standardized per hierarchy
8. Material system with edge highlights
9. PDF remains completely opaque
10. Side-by-side comparison matches reference

**Settings impact:** none (visual correction only).

## Phase 14.2 — Liquid Glass Polish (Remaining Issues)

**Purpose:** Address remaining visual polish issues from user feedback.

### 1. ANNOTATION BAR SIZE CONSISTENCY
**Issue:** Annotation bar is not same size as top bars
**Fix:** 
- Context annotation bar must match `--chrome-commandbar-h` (52px)
- Same material as command bar
- Consistent vertical centering
- Everything below fills entire app window

### 2. UNIFY PANELS WITH REST OF UI (ALL THEMES)
**Issue:** Left/right panels disconnected in frosted glass; look unified in dark/light
**Fix:**
- Apply same panel styling across ALL themes
- Panels should feel connected to main UI, not floating islands
- Consistent borders, shadows, spacing across themes
- Dark/light themes: panels should also adjust page view dynamically

### 3. OPEN BUTTON VISUAL
**Issue:** Open button has overlapping element with blue icon on top
**Fix:**
- Remove background overlap
- Clean single-layer button
- Blue accent only, no ghost element

### 4. DYNAMIC PAGE VIEW ADJUSTMENT (ALL THEMES)
**Issue:** Only frosted glass adjusts page view; dark/light don't
**Fix:**
- Light theme: page view adjusts when panels open/close
- Dark theme: page view adjusts when panels open/close
- Same responsive behavior as frosted glass

### 5. SMOOTH ANIMATION FOR PANEL/PAGE ADJUSTMENT
**Issue:** Clunky animation - panel collapses first, then page adjusts
**Fix:**
- Simultaneous animation of panel AND page view
- Use CSS transitions with `transition: width 0.3s ease, margin 0.3s ease`
- Both elements animate together, not sequentially
- Smooth 300ms ease-out

### 6. INCREASE ICON SIZES
**Issue:** Icons too small
**Fix:**
- Increase toolbar icons from ~16-18px to ~20-24px
- Command bar icons: 20px minimum
- Sidebar icons: 20px minimum
- Maintain proper hit targets (40px)

### 7. REPLACE THREE DOTS WITH "ALL TOOLS" ICON
**Issue:** Three dots (⋯) unclear
**Fix:**
- Replace with distinct "All tools" icon
- Use grid/layout icon or tools/wrench icon
- Clearly indicates tools panel

### 8. REDUCE EMPTY SPACE IN FROSTED GLASS PAGE VIEW
**Issue:** Too much margin around PDF in frosted glass
**Fix:**
- Mimic dark/light theme page positioning
- Tighter margins around document
- Page takes more available space
- Keep 16px minimum for floating aesthetic

**Success Criteria**

1. Annotation bar matches top bar height (52px)
2. Panels unified with UI in all themes (not disconnected)
3. Open button clean, no overlap
4. All themes dynamically adjust page view
5. Smooth simultaneous panel/page animations
6. Icons increased to 20-24px
7. "All tools" distinct icon (not three dots)
8. Frosted glass page margins match dark/light
9. No visual regressions in any theme
10. User approves final result

**Settings impact:** none (polish fixes only).

### Phase 15 — Cross-Theme Animation System

**Features**

- Centralized motion token system: CSS custom properties (`--motion-duration-*`, `--motion-ease-*`, `--motion-scale-*`) and a matching JS constants file (`motionTokens.ts`) consumed by all animated surfaces.
- Named animation wrappers/components: `AnimatedDialog` (bloom in/out), `AnimatedPanel` (slide in/out), `AnimatedTab` (crossfade + liquid glide), popover hooks (`usePopAnimation`), scale hooks (`useScaleAnimation`).
- Theme crossfade: a 400ms View-Transitions-based (or CSS-class fallback) crossfade on every theme switch; PDF page content is excluded from all transitions.
- Uniform motion across light/dark/frosted themes — only visual properties (shadow, highlight) differ; timing and easing stay identical.
- Reduced-motion support: all JS-driven springs and CSS transitions degrade when `prefers-reduced-motion: reduce` is active.
- Performance target: all animations stay within a 16ms frame budget and maintain 60fps.

**Success criteria**

1. Theme crossfade runs at ~60fps on a quiet workspace (measured via rAF sampling); no frame gaps exceed 33ms and the 400ms transition completes within its token duration.
2. Every pressable button family (`.btn`, `.tool-btn`, `.tab-new`, etc.) resolves the canonical `--motion-scale-press` token in its `:active` transform; no hardcoded scale values survive in the cascade.
3. The centralized token layer is wired to every animated surface named in the feature list: dialogs, panels, tabs, popovers, buttons, and thumbnails each consume the token system (not a parallel hardcoded preset).
4. Mid-session changes to the OS `prefers-reduced-motion` setting are picked up live: JS-driven springs collapse to instant state changes without an app restart.
5. Theme application does not trigger duplicate View Transitions or unhandled "Transition was skipped" pageerrors; at most one transition runs per user flip.
6. Unit tests cover the token constants, the animation hooks, and the component wrappers; e2e measures live fps and computed transform values.
7. No regressions: full unit + e2e suites green.

**Settings impact:** none.

### Phase 16 — Collapsible page panel with ruler mode

**Features**

- **Remove "Pages" title text** from the left sidebar header. The header shows only icon controls in a consistent layout.
- **Round/pill icon backgrounds** on every header icon in the left sidebar: the view-toggle icons (thumbnails, annotations, bookmarks) and the new collapse/expand icon all sit inside matching round glass-pill backgrounds (`glass-control-group` or `glass-icon-pill` treatment), matching the command bar's capsule style.
- **Collapse icon** on the left sidebar header: a chevron-left (or panel-left-close) button that collapses the entire left panel.
- **Collapsed ruler mode**: when collapsed, the left panel shrinks to a narrow vertical strip (~48px wide) that shows only page numbers stacked vertically. No thumbnails, no scroll bar chrome — just the numbers in the current theme's text color. The strip has a subtle separator border against the workspace.
- **Current-page highlight in ruler mode**: the number of the page currently visible in the main workspace is highlighted with the accent color (`#2563eb`) and/or bold weight so it stands out from the other numbers.
- **Click-to-jump in ruler mode**: clicking any page number in the ruler jumps the main workspace to that page (same behavior as clicking a thumbnail in expanded mode).
- **Expand icon** on the collapsed strip: a chevron-right (or panel-left-open) button that expands the panel back to full thumbnail view.
- **Panel state persistence**: the collapsed/expanded choice survives app restart.
- **Consistent animations**: the collapse and expand transitions use the centralized token system (Phase 15):
  - Panel width change: `AnimatedPanel` slide/resize with `--motion-duration-panel` (280ms) and `--motion-ease-layout` easing.
  - Page number appearance/disappearance: opacity + slight scale, not a hard cut.
  - Ruler number hover/focus: the standard `LiftMotionProps` hover lift (subtle, token-driven).

**Success criteria**

1. The left sidebar header shows zero text titles — only grouped round-background icons. The view tabs (thumbnails/annotations/bookmarks) and the collapse icon share the same pill background treatment.
2. Clicking the collapse icon shrinks the panel to the ruler strip within 280ms; the workspace reflows smoothly (page view adjusts, not overlapped).
3. In ruler mode: only page numbers are visible, rendered vertically, current page highlighted in accent color. Clicking a number jumps the workspace to that page.
4. Clicking the expand icon restores the full thumbnail panel within 280ms; the workspace reflows back.
5. The collapsed/expanded state persists across app restart (verified by closing and reopening the app).
6. No visual regressions in the thumbnail rail (drag reorder, rotate, delete, annotation panel, bookmarks panel) when expanded.
7. Unit tests for the collapse state reducer and ruler click handler; e2e covers collapse → ruler click → jump → expand cycle and persistence restart.
8. All animations resolved from the centralized motion token system; no hardcoded transition values in the collapse/expand CSS or JS.

**Settings impact:** `pagesPanelCollapsed?: boolean` (default `false`; validation: boolean, preserve-if-valid; transported via AppSettings IPC so the state survives restart).

## Phase 17 — PreferencesDialog redesign and enhanced settings

**Features**

- **PreferencesDialog redesign**: Simplified UI with a single panel layout instead of a sidebar navigation. The dialog now uses a cleaner, more streamlined layout with categorized sections.
- **Enhanced settings management**: All settings are now displayed in a single view with clear grouping by category (Appearance, Recent files, Storage locations).
- **Theme settings**: Direct control over the application theme (Light, Dark, Frosted, System default) with immediate visual feedback.
- **Recent files management**: Configuration for the maximum number of recent files to track.
- **Storage location information**: Clear display of user data, settings, and signatures storage paths.

**Success criteria**

1. The PreferencesDialog displays settings in a clean, single-panel layout without sidebar navigation.
2. All settings categories (Appearance, Recent files, Storage locations) are clearly visible and organized.
3. Theme selection works correctly with immediate visual feedback.
4. Recent files configuration works properly with input validation.
5. Storage location information is displayed correctly.
6. Unit tests for the new PreferencesDialog implementation pass.
7. E2e tests cover the redesigned PreferencesDialog functionality.

**Settings impact:** none (existing settings are preserved but with new UI layout).

## Phase 18 — Watermark (text or image overlay)

**Features**

- **Text watermark**: Add arbitrary text across pages with typography, transparency, and position/tile options.
- **Image watermark**: Stamp an image across pages with positioning, sizing, and transparency controls.
- **Position control**: Place watermarks at any position on the page using coordinates or predefined positions (top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right).
- **Transparency control**: Adjust watermark opacity from 0% (invisible) to 100% (opaque).
- **Tile option**: Repeat watermarks across the page to create a seamless pattern.
- **Typography options**: Choose font family, size, color, and style (bold, italic, underline) for text watermarks.
- **Page range selection**: Apply watermark to specific pages or all pages of the document.
- **Watermark preview**: Real-time preview of watermark appearance before applying.
- **Delete watermark**: Remove a specific watermark by ID from a document.

**Success criteria**

1. Text watermarks can be added to PDF pages with customizable typography and positioning.
2. Image watermarks can be added to PDF pages with positioning and transparency controls.
3. Watermark preview works in real-time before applying.
4. Watermark can be applied to specific pages or all pages of the document.
5. Watermark transparency and tiling options work correctly.
6. Watermark positioning works with both coordinate-based and predefined position controls.
7. Unit tests for watermark creation and application pass.
8. E2e tests cover creating, previewing, and applying watermarks.
9. Watermarks can be deleted by ID.

**Settings impact:** none (this feature is implemented as part of the annotation tools, similar to stamps and callouts).

## Phase 19 — Annotation tools move into the CommandBar (MRU five + all-tools dropdown)

**Supersession note:** this phase deliberately retires the separate annotation chrome row introduced
by the Phase 14.2 layout (`.ann-toolbar` as its own 52px row below the CommandBar). The annotation
tools now live INSIDE the CommandBar as one grouped pill; the freed row height returns to the page
view. The Phase 14.2 styling rules (CommandBar primitive, shared height token, tool-btn ladder) stay
in force for the group itself — only the second row is retired.

**Features**

- **One bar, one group**: the annotation tools render inside the CommandBar (`.toolbar`) at its right
  end, after the existing Tools group, as a single `GlassControlGroup` pill built from the CommandBar's
  own primitives (`tool-btn`, `toolbar-sep`, the 22px glyph ladder) so the bar reads as one chrome
  system. The separate `.ann-toolbar` row is removed and its height is returned to the page view.
- **Five visible tools**: the group shows exactly five tool buttons by default, ordered
  **most-recently-used first**. Using any annotation tool (from the visible five or from the dropdown)
  immediately promotes it to the first visible position.
- **Colour selector**: the existing annotation colour swatch + popover picker moves into the group
  immediately LEFT of the dropdown arrow, keeping today's rules (shown for colour-capable tools,
  hidden otherwise).
- **Dropdown (all tools)**: a single arrow button at the far right of the group opens a menu listing
  **all eleven tools** in today's six groups — Select; Text markup (highlight / underline /
  strikeout); Pen (ink); Text box; Shapes (rect / ellipse / arrow / callout); Note. Selecting one arms
  it. Keyboard: Arrow keys move, Enter arms, Escape closes; it also closes on outside click and on
  re-click of the arrow. `aria-haspopup` / `aria-expanded` reflect the state.
- **Pen width**: the ink-only pen-width row moves into the dropdown panel (shown when Ink is active);
  no other tool consumes pen width.
- **Persistence**: the MRU order survives app restart.
- **Consistency**: the dropdown uses the centralized popover motion (`usePopAnimation`); the tool
  buttons use the existing hover-lift / press tokens; identical timing across light / dark / frosted;
  no hardcoded animation values; the existing disabled states (Edit mode open, Pan active) and their
  explanatory tooltips are preserved.
- **Stable hooks**: every tool button (visible and in the dropdown) keeps `data-tool="<id>"`; the
  group keeps `data-annotation-toolbar`; new hooks `data-ann-tools-visible`,
  `data-ann-dropdown-toggle`, `data-ann-dropdown-menu`, `data-ann-color` let the e2e specs address the
  new structure without rewriting their intent.

**Success criteria**

1. No annotation row exists below the CommandBar; the tools render inside the CommandBar as one
   grouped pill at its right end, and the page view gains the freed height (no overlap, no clipped
   page slot).
2. Exactly five tool buttons are visible by default, ordered most-recent-first.
3. Arming a tool that is not among the visible five (chosen from the dropdown) makes it the FIRST
   visible button on the next render, and the fifth-most-recent drops out.
4. The colour selector sits immediately left of the dropdown arrow and opens the existing picker
   popover; it follows today's colour-capable-tool rules.
5. The dropdown lists all eleven tools in the six groups; selecting one arms it; Escape, outside
   click and re-clicking the arrow all close it; Arrow keys + Enter work; `aria-expanded` is accurate.
6. The pen-width control is reachable from the dropdown panel when Ink is active.
7. The MRU order survives app restart (verified by an e2e restart run reading the persisted order).
8. Disabled/blocked states are unchanged: with Edit mode open or Pan active the tools are disabled
   and carry the existing explanatory tooltips.
9. Unit tests pass for the MRU ordering helper (promote-on-use, cap, dedupe, malformed input) and for
   the group rendering (five visible buttons, dropdown contents, colour placement).
10. E2e covers: the group inside the CommandBar with five visible tools; MRU reorder after arming a
    dropdown tool; dropdown open / select / close (all three close paths); the colour popover; the
    restart persistence; the absence of the old row and the page-view height gain.
11. All animations resolve from the centralized motion token system; no hardcoded transition values in
    the new CSS or JS.
12. Existing annotation e2e/unit specs that asserted `.ann-toolbar` are repointed to the new group and
    pass (the `data-tool` contract is unchanged).

**Settings impact:** `annotationRecentTools?: string[]` — default `[]`; validation:
preserve-if-valid / reject-if-invalid in `src/main/services/settings.ts` (must be an array of at most
6 known annotation tool ids — `select`, `highlight`, `underline`, `strikeout`, `ink`, `textbox`,
`rect`, `ellipse`, `arrow`, `callout`, `note` — deduplicated, most-recent-first; anything else is
rejected so the field falls back to the default); transported via the AppSettings IPC so the order
survives restart. The main-process validation lands before any renderer code reads the field.

## Phase 20 — Animation standard: morphing surfaces, animated resizes, no un-animated appearances

**Supersession note:** this phase supersedes the per-component entrance treatments wherever they
conflict: every surface that appears, grows, shrinks or is replaced by another surface now follows the
standard below, and the Phase-15 token set stays the only source of durations/easings/scales.

**Features**

- **Morphing dropdowns/menus (the "one element" rule)**: a menu/popover/dropdown must read as the
  trigger box GROWING into the expanded box. Concretely: the surface animates from the trigger's rect
  to the menu's rect (origin-aware scale + fade), `transform-origin` pinned to the trigger edge it is
  anchored to, the menu flush with the trigger (no gap, no offset shadow seam, no separate-window
  feel), and the reverse morph on close. Applies to every menu/popover/dropdown in the app
  (annotation tools menu, colour popover, theme popover, title-bar menus, page-zoom and any future
  one).
- **Animated context-window resize**: any window whose content swaps to a different size (e.g. the
  Sign tool's three tabs) animates its width/height change with the standard token duration/easing
  instead of jumping. Content cross-fades within the resizing frame.
- **Animated window-to-window swap**: when one window/surface is replaced by another (tab-to-tab,
  tool panel to tool panel, dialog to dialog where one closes as another opens), the outgoing surface
  transitions into the incoming one (crossfade + morph) rather than disappearing and popping.
- **No un-animated appearances**: no element in the app may appear, disappear, grow, shrink or be
  replaced without an animation from the centralized token system. Any surface found without one gets
  the standard treatment (a `data-no-anim` escape hatch is allowed ONLY for the PDF content layer and
  for `prefers-reduced-motion`).
- **Enforceable standard**: the standard is documented in this phase and pinned by a contract test
  (every popover/menu/dialog/panel class must resolve its enter/exit from the motion tokens); a
  `prefers-reduced-motion` path collapses the durations to the reduced token without changing
  structure.
- **Consistency**: identical timing in light/dark/frosted; transform/opacity (and layout-aware
  animation for size changes) only, no layout thrashing; 60fps target preserved; PDF content never
  animates.

**Success criteria**

1. Opening and closing any dropdown/menu/popover shows a morph from the trigger's rect with no gap
   between trigger and surface, in all three themes (verified by frame sampling + screenshots).
2. The Sign tool's context window animates its size change when switching between its three tabs
   (measured: the frame's height/width interpolates over the token duration rather than jumping).
3. A window-to-window swap shows the outgoing surface transitioning into the incoming one (no frame
   where both are absent or both are fully painted at rest positions).
4. An inventory sweep of the app's surfaces (dialogs, popovers, menus, panels, floating toolbars,
   badges, toasts, banners) finds ZERO surfaces that appear/disappear without a token-driven
   animation; the inventory and its evidence are recorded.
5. The contract test fails when a surface's enter/exit is removed or hardcoded, and passes on the
   shipped tree.
6. Reduced motion collapses all of the above to the reduced-duration path with no structural change.
7. All new animations resolve from the motion tokens; no hardcoded durations/easings/scales.

**Settings impact:** none (uses the existing Phase-15 motion tokens; no new AppSettings fields).

## Phase 21 — Text properties panel (Word/Adobe-style text manipulation, replacing the floating toolbox)

**Supersession note:** this phase retires the floating inline text toolbox that appeared after
double-clicking a text-bearing tool. The editing surface becomes the left properties panel; the
in-canvas overlay keeps only the selection/drag affordances.

**Features**

- **Text properties panel**: a left-side panel (docked to the RIGHT of the thumbnail/page rail, on
  the same edge as the existing left panel) that appears whenever a text-bearing tool is selected or
  a text object is selected/created - text box, callout, sticky note, and the edit-text run editor.
  The page view reflows with animation to accommodate it (the same "page adjusts, never overlapped"
  contract the Tools panel follows).
  **Per-family control scope (settled 2026-09-19):** the FULL control set below applies to the
  TFlex-owned text objects (text boxes and edited text runs), whose style the engine draws. For
  ANNOTATION text objects (callout / sticky note / text-box annotation) the engine's annotation
  payload carries text colour only, so the panel opens for them, routes the colour control live, and
  renders every other control DISABLED with a tooltip naming the reason ("not supported for
  annotations - the annotation's text is baked by the annotation engine"). A disabled control must
  never silently no-op.
- **Word/Adobe-class controls** (researched from Adobe Acrobat's text-edit UI and Microsoft Word's
  font/paragraph groups): font family, font size, bold / italic / underline, text colour, highlight
  colour, superscript/subscript, character spacing where feasible, line spacing, paragraph alignment
  (left/centre/right/justify), bulleted/numbered lists, indent in/out, and clear-formatting. Every
  control applies live to the selected text object and persists in the panel while any text-bearing
  tool is active (one shared panel for all of them).
- **Live application + undo**: each change applies to the engine through the existing text-edit ops
  with the per-doc undo stack intact; a change that cannot be represented in the PDF (e.g. an
  unsupported font) must fail loud, not silently drop.
- **Selection-aware state**: the panel reflects the current text object's actual formatting when a
  text object is selected, and reverts to per-tool defaults when a new object is created.
- **Consistency**: the panel uses the standard panel animation (Phase 20), the existing panel tokens,
  and the app's control styling; disabled controls follow the app's disabled treatment with tooltips.

**Success criteria**

1. Selecting a text-bearing tool (or a text object) opens the left text panel; deselecting closes it;
   both animate and the page view reflows without overlap or clipping.
2. The panel exposes the full control list above; each control visibly changes the selected text and
   the change survives save + reopen (round-trip verified for at least: font family, size, bold,
   italic, underline, colour, highlight, alignment, line spacing, list style).
3. The floating double-click STYLE toolbox no longer appears for text-bearing tools; the panel is the
   only STYLE surface for them. The in-canvas editor keeps what is not styling - the drag grip, the
   text-content textarea, and the Confirm / Cancel / Delete actions - and no style control remains
   in-canvas (verified for the text box, callout, note and edit-text-run paths).
4. The same panel serves every text-bearing tool (text box, callout, note, edit-text run) and
   re-targets when tools/objects change: the full control set is live for TFlex-owned text objects
   (text boxes, edited runs) and, for annotation text objects, the colour control is live while every
   unsupported control is disabled with its reason tooltip (per the per-family scope above).
5. Undo/redo restores both the text and the panel's reflected state.
6. Unit tests cover the panel's control -> payload mapping and its selection-aware state; e2e covers
   open/close, the page reflow, and a save/reopen round-trip per control group.
7. Reduced motion and all three themes behave per the app standard.

**Settings impact:** none (the panel's visibility derives from the active tool; text defaults reuse the
existing `editDefaultFont` / annotation colour fields).

## Phase 22 — Title-bar Open + Save/Save As relocation

**Features**

- **Open and Save/Save As move to the title bar** (the bar that carries the TFlex logo and the PDF
  tabs): the two actions sit immediately to the RIGHT of the TFlex logo and to the LEFT of the tab
  strip, as one small grouped control that matches the title bar's material and metrics.
- The CommandBar keeps its page/zoom/view/annotate/edit/delete groups; the Open and Save buttons are
  removed from it (no duplicate controls anywhere).
- **Sizing/layout**: the relocated controls are sized to the title-bar ladder (not the CommandBar
  ladder), keep their existing accelerators (Ctrl+O / Ctrl+S / Ctrl+Shift+S), their aria-labels and
  their tooltips, and must not collide with the tab strip at the minimum window width (the tab strip
  scrolls instead).
- **State**: the Save control keeps its modified-dot / disabled semantics exactly as today.

**Success criteria**

1. The title bar shows Open and Save/Save As immediately right of the logo, left of the tabs, in one
   grouped control; screenshots in all three themes show it visually consistent with the title bar.
2. The CommandBar no longer contains Open/Save/Save As; no duplicate remains anywhere in the DOM.
3. Ctrl+O, Ctrl+S and Ctrl+Shift+S still work and the Save control still reflects the modified state
   and disables when there is nothing to save.
4. At the minimum window width the relocated controls stay reachable and the tab strip scrolls rather
   than clipping either.
5. Existing e2e/unit specs that addressed the CommandBar Open/Save selectors are repointed and pass.

**Settings impact:** none (pure layout relocation).

## Phase 23 — Animation off switch (setting + Preferences control)

**Features**

- **An "Animations" control in Preferences** (Appearance section) that turns the app's animations OFF
  entirely - not merely reduced. With it OFF, every motion collapses to the instant path app-wide:
  the Phase-20 morph, the Phase-21 panel reflow, the rail / panel slides, dialogs, popovers, menus,
  toolbars, toasts, tab transitions, the tools-palette resize and the theme crossfade all complete with
  no travel, scale or fade animation, while every end state and geometry stays identical to the
  animated path.
- **Effective motion policy**: animations run only when the setting is ON **and** the OS does not
  request reduced motion. `prefers-reduced-motion: reduce` always wins over the setting; the setting
  OFF forces the instant path regardless of the OS preference.
- **Immediate + persisted**: the change applies the moment the control is toggled (like the theme
  default) and survives restart.
- **Both motion layers neutralised**: the JS motion layer (springs/presets) AND the CSS
  animations/transitions must both honour the policy - the existing reduced-motion plumbing is the
  mechanism, extended to consider the setting, so no surface is left animating.
- **No structural change**: the instant path must still mount/unmount, position and reflow exactly as
  the animated path does; only the motion is removed.

**Success criteria**

1. With animations OFF, frame sampling shows the instant path (1-2 frames, no intermediate values) for:
   a morphing menu open/close, the text-panel reflow, a dialog open/close, a toast, a theme switch, the
   rail collapse/expand, a tab switch and the tools-palette resize - and every end state (rects,
   geometry, visibility) is identical to the animated path.
2. The setting persists across restart and is validated in the main process (a non-boolean or malformed
   stored value falls back to the default; a valid `false` is preserved and re-read).
3. The Preferences control reflects the stored value, applies immediately, and carries an explanatory
   hint naming what it disables.
4. With the setting ON and the OS reduced-motion preference set, the reduced path still applies (the OS
   preference wins); with the setting OFF and no OS preference, the instant path applies.
5. Unit tests for the main-process validation and the renderer's effective-motion resolver (setting x OS
   preference matrix); e2e for the toggle -> instant behaviour -> restart persistence.
6. The Phase-20 motion-token contract test still passes (the switch must not break the token plumbing),
   and no new hardcoded durations/easings are introduced.

**Settings impact:** `animationsEnabled?: boolean` - default `true`; validation:
preserve-if-valid / reject-if-invalid in `src/main/services/settings.ts` (must be a boolean; anything
else is rejected so the field falls back to the default); transported via the AppSettings IPC so the
choice survives restart. The main-process validation lands before any renderer code reads the field.

## Phase 24 — Full text-style support for annotation text objects (textbox, callout, note)

**Supersession note:** this phase supersedes the Phase-21 per-family scope restriction that limited
annotation text objects to colour-only in the text-properties panel. Every control in the panel
(font family, size, bold, italic, underline, alignment, line spacing, list, indent, highlight,
superscript/subscript, clear formatting) is now live for textbox/callout/note annotations, stored in
the annotation model, honoured by the baked appearance stream, and surviving save/reopen.

**Features**

- **The text-properties panel is fully live for annotation text objects.** When a textbox, callout
  or sticky-note annotation is selected, every panel control — font family, size, bold, italic,
  underline, colour, highlight, alignment, line spacing, bulleted/numbered lists, indent,
  superscript/subscript, clear formatting — operates exactly as it does for Edit-mode text boxes.
  The disabled-with-tooltip "not supported" message is retired.
- **Annotation model extended:** `AnnModel` carries the same `TextStyleFields` set introduced in
  Phase 21 (`font`, `size`, `bold`, `italic`, `underline`, `align`, `lineHeight`, `highlight`,
  `baselineShift`, `list`, `indent`); default values reproduce the previous behaviour when the
  fields are absent so all existing annotations are unaffected.
- **Baked appearance honours the style:** `buildFreeTextAPStream` (annotations.ts) uses the stored
  style fields when building the /AP stream — font variant selected via `selectStandardFont`, size
  from the stored value, colour from the stored colour, alignment positioning, highlight bands, line
  height, list prefixes and indent offset mirror the Phase-21 `drawStyledTextLines` logic. The auto-
  fit still applies when the stored size would overflow the box.
- **`createAnnotation` / `editAnnotation` payloads** accept the new style fields. Validation:
  preserve-if-valid / reject-if-invalid (same contract as Phase-21 `TextBoxStylePatch`).
- **Round-trip:** style fields are baked into the /AP stream and also persisted in the annotation's
  custom metadata so a reopen accurately reflects the stored style (the baked stream is what other
  viewers see; TFlex reads the metadata on reopen to re-populate the panel).

**Success criteria**

1. With a textbox/callout/note annotation selected, every text panel control is live (no disabled
   control and no "not supported" tooltip); changing font/size/bold/italic/alignment/etc. through
   the panel applies immediately to the annotation's rendered text.
2. All style changes survive save + reopen — the annotation opens in the other viewer with the
   correct appearance (via the baked /AP stream) and TFlex's panel reflects the stored style.
3. Existing annotations (no style fields stored) reopen unchanged (default values reproduce the
   old Helvetica appearance).
4. Validation rejects malformed style fields (same contract as Phase-21 text boxes) and fails loud;
   valid fields are preserved; absent fields default.
5. Unit tests for the new annotation payload validation + the appearance-stream style application
   (font variant, alignment, line height, list prefix, highlight band); e2e for the live apply +
   save/reopen round-trip for each style group.
6. The Phase-21 text-box / edit-text-run contracts are unchanged.

**Settings impact:** none (the style fields ride the existing annotation IPC; no new AppSettings
field).

## Phase 25 — Floating, movable text-properties panel (no header, no page reflow)

**Supersession note:** this phase supersedes the Phase-21/24 docked-column design. The panel is no
longer a grid column with a header and a page reflow; it is a floating card over the page view that
the user can drag anywhere inside the page area.

**Features**

- **No header**: the panel's distinct header bar and its "Text" title are removed. The controls are
  the whole panel; a small drag affordance (the existing `ContentGrip` pattern) is the only chrome.
- **Floats over the page view**: the panel is positioned inside the page-view area (`.workspace-main`)
  as an overlay, not a grid column. It never takes top-bar space and never sits outside the page
  window.
- **The page does NOT reflow**: opening/closing the panel must not change the page geometry, the
  scroll position, or the fit scale. The `--tf-text-w` grid column and the `data-text-panel-open`
  reflow are retired (or pinned to 0) so the page stays exactly where it was.
- **User-movable**: the panel can be dragged anywhere within the page view (the existing
  `useDragWindow` hook, the same pattern the stamp/watermark dialogs and the edit overlays use),
  clamped so it cannot be dragged fully out of view. Its position persists for the session (and is
  remembered per tab like the other floating surfaces).
- **Text-element move integrity**: moving a text element (drag) with the panel open must produce no
  artifacts - no ghost, no offset drift, no stale copy - because the panel no longer shifts the page
  geometry. This is explicitly verified (the DEF-232 class).
- **Motion + themes**: opening/closing uses the Phase-20 token motion (no un-animated appearance),
  honours the Phase-23 animation switch, and looks correct in all three themes.

**Success criteria**

1. The panel has no header/title bar; opening it does not move the page (frame-sampled: the page
   canvas rect and the scroller's scrollTop are unchanged across open/close), and it renders inside
   the page-view area only.
2. The panel can be dragged by its grip to any position inside the page view and stays where it is
   put; it cannot be dragged fully out of the visible page area.
3. With the panel open, dragging a text element (annotation textbox/callout/note and Edit-mode text
   box) moves it correctly with no ghost, offset drift or stale duplicate (verified live and after
   save/reopen).
4. No regression to the Phase-24 annotation text controls (all live) or the Phase-20/23 motion
   contracts; reduced motion and the animations-off setting behave as standard.

**Settings impact:** none.

## Phase 26 — Panel-driven text editing (double-click editors removed) + shape colour from the dropdown

**Features**

- **Double-click-to-edit is removed everywhere.** No text element opens an in-canvas editor on
  double-click, and no in-canvas text box appears when a text element is placed or clicked. The
  in-canvas editors for annotation textbox / callout / note (and the Edit-mode text-run editor's
  double-click path) are retired.
- **The panel gains a Text field** as the single text-editing surface for text-bearing tools. When a
  text element is PLACED or an existing one is CLICKED, the panel's text field becomes active and
  focused automatically, ready for typing. Editing the field updates the text element on the page
  LIVE (as the user types), with the per-doc undo stack intact.
- **Shape colour comes from the annotation dropdown**: the in-canvas colour palette that double-
  clicking a shape opened is removed. Shape (and text) colour is changed through the annotation
  toolbar's colour control (the existing `[data-ann-color]` swatch + picker popover).
- **Selection affordances stay**: clicking a text element still selects it (handles/selection chrome),
  the action bar keeps Confirm / Delete (Cancel where applicable), and the panel reflects the
  selected element's values.

**Success criteria**

1. Double-clicking any text element (annotation textbox/callout/note, Edit-mode text box/run) opens
   NO in-canvas editor; no in-canvas text box ever mounts for placing or clicking text (verified by
   DOM probe + screenshots).
2. Placing a text element or clicking an existing one focuses the panel's Text field automatically;
   typing there updates the page text live (verified mid-typing, not only on blur), and the change
   survives save/reopen.
3. Double-clicking a shape (rect/ellipse/arrow) opens no in-canvas colour palette; the annotation
   toolbar's colour control changes the selected shape's colour.
4. Existing actions still work: Confirm, Delete, undo/redo, and the panel's full style control set.
5. The Phase-24 annotation style contract and the Phase-21 text-box style contract are unchanged.

**Settings impact:** none.

## Phase 27 — Engine character spacing + a wider font set

**Features**

- **Character spacing (tracking)**: the `Tc` text-state operator is integrated into the engine's
  styled-text renderer, so the panel's character-spacing control is LIVE for TFlex-owned text boxes,
  edited text runs and annotation text objects (the control that has shipped disabled-with-tooltip
  since Phase 21/24 becomes functional). The value is validated (a bounded point range), baked into
  the appearance/content streams, and survives save/reopen.
- **More fonts**: the font set grows beyond the three StandardFont families. Bundled, offline,
  licence-clean font families ship in `assets/fonts/` and are embedded on demand (subset where the
  library allows), exposed through the panel's family dropdown and accepted by the engine's font
  validation. A font that cannot be embedded fails loud with a typed error (never a silent
  substitution).
- **Round-trip**: the chosen family (bundled or standard) is persisted with the text style and
  restored on reopen; a reopen in another viewer shows the embedded font's glyphs.

**Success criteria**

1. The character-spacing control is live for text boxes, edited runs and annotation text objects;
   changing it visibly changes the glyph spacing on the page and survives save/reopen (round-trip
   asserted in the baked stream by the `Tc` operator).
2. The font dropdown lists the bundled families in addition to the three standard families; each
   selected family renders on the page and survives save/reopen.
3. An unsupported/missing font file produces a typed `engine-error` naming the font (fail loud).
4. Character spacing and the new fonts compose with the existing style fields (bold/italic/size/
   colour/highlight/align/line-height/list/indent) with no regression.
5. Unit tests for the spacing validation + the `Tc` emission, the font allowlist/embedding, and the
   round-trip; e2e for a spacing change and a bundled-font change through the panel.

**Settings impact:** `editDefaultFont` widens to accept the new bundled family ids (existing field,
extended allow-list; preserve-if-valid / reject-if-invalid so an unknown id falls back to the current
default); no new AppSettings field.

## Phase 28 — Annotation interaction: arrow geometry, live edits, action-bar colour, comment threads

**Supersession note:** this phase supersedes (a) the confirm-before-apply editing model for annotation
shape/position/colour changes - edits now apply live and only Cancel reverts - and (b) the Phase-26
decision to take shape colour from the annotation toolbar dropdown: colour is picked from the
action-bar colour box, and the annotation dropdown colour is ignored for a selected annotation.

**Features**

- **Arrow geometry**: the arrow's leader line ends at the arrowhead's BASE, not at its tip, so the
  shaft never extends past or through the pointer. The head keeps its current wings; the shaft's
  visible line stops where the head begins (the invisible hit line may stay full-length).
- **Live edits (no Confirm required)**: moving a shape/arrow/text element, resizing it, and changing
  its colour all apply to the document IMMEDIATELY and stay applied. No Confirm click is required and
  no unconfirmed state exists. A Cancel action reverts the change (undo). Changing the colour after a
  move must work - it must never revert the move or be silently dropped.
- **Action-bar colour box**: in the in-canvas action bar, the "Edit" text button between Confirm and
  Delete is replaced by a COLOUR BOX (a swatch showing the current colour). A SINGLE click expands the
  colour picker (double-click is removed app-wide); picking a colour applies it live. The annotation
  toolbar's dropdown colour is ignored for a selected annotation (the action bar owns the colour).
- **Comment threads (Adobe-like)**: a comment affordance on annotations. Selecting an annotation shows
  its comment box (a text area for the comment plus a reply list with an "add reply" field). An
  annotation that HAS comments shows a small comment icon on the element itself; an annotation with NO
  comments shows NO icon. Comments and replies persist through save/reopen.
- **Icon behaviour**: the icon is an indicator only (a small badge on the annotation) - the comment box
  is the place to read/write; the icon must not intercept the annotation's own selection gestures.

**Success criteria**

1. An arrow's leader line visibly ends at the head's base in all three themes (frame/screenshot
   inspection) and the line never crosses or extends past the pointer; the hit target still covers the
   whole arrow.
2. Dragging a shape/arrow/text element applies the move immediately (no Confirm) and it stays; changing
   the colour right after a move applies live and does NOT revert or drop the move; Cancel reverts the
   change (undo). Verified live and after save/reopen.
3. The action bar shows a colour box in place of the Edit text, between Confirm and Delete; a single
   click opens the picker; picking a colour changes the selected annotation's colour; the annotation
   dropdown colour no longer changes a selected annotation's colour.
4. Selecting an annotation shows its comment box; adding a comment and a reply persists through
   save/reopen; an annotation with comments shows the small icon and one without shows none.
5. No regression to the Phase-26 live text field, the Phase-25 panel, or the annotation create/delete
   flows.

**Settings impact:** none.

## Phase 29 — Flush canvas (remove the empty space around the page view)

**Features**

- **No gutters**: the page view has no empty space around it - the `.document-content` 28px top/bottom
  padding and the `.document-scroller` right padding are removed (or set to 0) so the page area is
  flush with the app chrome on every side, in every theme (including the frosted duplicate rule).
- **Scroll math intact**: removing the padding must not break the page-jump/scroll-position math (the
  frosted `contentTopPadRef` path) or the page-slot alignment; page jumps still land correctly.
- **Interaction intact**: annotations, selection, the floating text panel and the tools palette keep
  working with the page flush (no clipped edges, no offset drift).

**Success criteria**

1. The page view is flush: measured 0 padding/gutter around `.document-content` and
   `.document-scroller` in all three themes (screenshots).
2. Page jumps (thumbnail click, page-nav) still land on the correct page and the scroll position is
   correct after the padding removal.
3. Placing/selecting/moving an annotation on the flush page maps to the correct page coordinates (no
   offset drift), and the floating text panel + tools palette still work.

**Settings impact:** none.

## Phase 30 — Print with advanced options (industry-standard)

**Research basis:** the option set and architecture below come from the print-dialog research (Adobe
Acrobat's print docs, Apple Preview, Chrome, Microsoft Learn's print stacks) and Electron's documented
print API (`webContents.print`, `getPrintersAsync`). Industry baseline = printer picker, copies +
collate, page range (all / current / custom syntax), the scaling quartet, duplex, colour mode, an
annotations toggle and a preview-first flow; the advanced tier = paper source by page size, N-up with
page order, odd/even/reverse, auto orientation, booklet/poster and presets.

**Features**

- **Print dialog (preview-first)**: opens from a Print icon in the title bar placed immediately LEFT of
  the preferences gear, from File > Print in the application menu, and from Ctrl+P. It shows a live
  PREVIEW of the selected page(s) with the current settings applied, and re-renders the preview as
  settings change.
- **Baseline options** (all wired to real print behaviour, never a silent no-op):
  - **Printer** picker populated from the OS printer list (`getPrintersAsync`), with the system default
    preselected; the value passed to Electron is the SYSTEM device name (not the friendly name).
  - **Copies** (1..99) + **Collate**.
  - **Page range**: All pages / Current page / Custom - accepting the industry syntax
    (`1-5, 8, 11-13`), validated with a clear in-dialog error for a malformed or out-of-range entry.
  - **Scaling**: Fit to page / Actual size / Shrink oversized pages / Custom % (1..500).
  - **Orientation**: Portrait / Landscape (plus Auto where the page aspect decides).
  - **Duplex**: Simplex / Long edge / Short edge.
  - **Colour**: Colour / Greyscale.
  - **Print annotations**: Document only / Document with annotations - the renderer produces the page
    images WITHOUT or WITH the annotation overlay layers accordingly.
- **Advanced options**:
  - **Pages per sheet (N-up)**: 1 / 2 / 4 / 6 / 9 / 16 with the page ORDER (horizontal / vertical and
    the reversed variants) applied to the preview and the composed print document.
  - **Odd/Even pages only** and **Reverse page order**.
  - **Paper source by page size** (tray selection) where the driver reports it.
  - **Print presets**: save the current dialog settings under a name and re-apply them (session-level).
- **Rendering architecture (the industry norm for Electron)**: the renderer renders each page in the
  selected range offscreen through the existing pdf.js pipeline at a print scale and hands the images to
  the main process, which composes a print document (one page per image, page-break separated) in a
  HIDDEN window and calls `webContents.print(options)` with the chosen options - page ranges, scale,
  N-up, orientation, duplex, colour and copies map onto Electron's documented keys. `printBackground` is
  enabled. The visible app window is never the print source (it is virtualized), and the renderer must
  not block while pages render for print.
- **Fail loud**: an option the platform/driver does not support (e.g. duplex on a driver that ignores it)
  must be REPORTED to the user - never silently dropped. A failed OS print call surfaces its
  `failureReason` in the dialog.

**Success criteria**

1. The Print icon renders immediately left of the preferences gear; clicking it, File > Print and Ctrl+P
   all open the same dialog.
2. The printer picker lists the OS printers with the default preselected; printing to "Microsoft Print to
   PDF" (or a real printer) with a custom page range produces a document containing exactly those pages
   (verified by inspecting the produced file).
3. Scaling, orientation, N-up and page order change the PREVIEW and the printed output accordingly
   (verified on at least: Fit vs Actual size, Portrait vs Landscape, 1-up vs 2-up, forward vs reverse).
4. The annotations toggle changes the printed output: "document only" prints without the annotation
   overlay, "with annotations" prints with it.
5. Copies/collate reach the print call; a malformed page range is rejected in-dialog with a clear error
   and nothing is sent to the printer.
6. An unavailable printer or a failed print surfaces the failure reason in the dialog (no silent no-op);
   the app stays responsive while pages render for print (no UI freeze on a 34-page document).
7. Unit tests cover the option model + the page-range parser + the option->Electron mapping; e2e covers
   opening the dialog from all three entry points, the preview reacting to the settings, the range
   validation error, and a print run against a PDF-capable destination.

**Settings impact:** none (print options are per-print; presets are session-level).

## Phase 31 — What's New in every release, shown in About

**Operator request (2026-09-21):** "From now on, add a What's New section in every OTA release and show
them in the About section."

**Research basis:** the industry norm (VS Code's release notes view, Chrome's "What's new" page, Windows
apps' About + changelog) is that a desktop app shows the notes of the version it is RUNNING without any
network call, and shows the INCOMING version's notes when an update is available. The OTA channel already
carries the notes for the incoming version (electron-updater parses the GitHub Release body into
`updateInfo.releaseNotes`), so both halves are available without adding a network dependency beyond the
existing updater.

**Features**

- **Single source of truth (bundled, offline)**: a structured changelog module in `src/shared/`
  (`whatsNew.ts` or equivalent) holding ordered entries `{ version, date?, highlights: string[] }`,
  newest first. It is bundled into the app, so the notes of the RUNNING version render with no network
  call. It is maintained as part of the release procedure: a version is not releasable without its entry.
- **About dialog — "What's New" section**: the existing About sheet gains a section that renders the
  running version's highlights (with the version label), plus the previous entries in a compact
  history, and - when the OTA feed reports an available or downloaded update - that INCOMING version's
  notes, clearly labelled with the incoming version and distinguished from the installed one's notes.
- **Updater plumbing**: `UpdateState`'s `available` and `downloaded` variants carry the incoming
  `releaseNotes`, normalised from electron-updater's `string | ReleaseNoteInfo[]` shape into a plain
  `string[]` of lines, so the renderer never parses provider-specific data.
- **Every OTA release carries its notes**: the GitHub Release body for a version is generated from that
  version's changelog entry, so the OTA feed (and therefore `releaseNotes` in the app) contains the same
  content the About dialog shows for the installed version.
- **Fail loud, render safe**: a running version with no changelog entry renders an explicit
  "No release notes for this version" state - never a blank section and never a crash. Notes content
  arriving from the feed (which may be HTML or markdown from GitHub) is rendered as PLAIN TEXT lines;
  markup must never be injected as HTML.

**Success criteria**

1. The About dialog renders a "What's New" section showing the RUNNING version's highlights, with the
   app offline (no network call is needed to see them), and its existing rows (version, Electron, Node,
   update status) and open/close behaviour are unchanged.
2. The bundled changelog is ordered newest-first and lookup is exact-version; unit tests cover the
   exact match, an unknown version (the explicit empty state), and the ordering.
3. With a simulated `available` / `downloaded` update state carrying notes, the About dialog shows the
   INCOMING version's notes labelled with that version; with no notes it shows the explicit empty state
   rather than a blank block.
4. A release gate exists in the test suite: the bundled changelog MUST contain an entry for the version
   in `package.json`, and the test fails when it does not (so no release can ship without its notes).
5. The GitHub Release body published for the release contains that version's What's New content,
   verified by inspecting the release in `tanzimtipu/tflex-releases`.
6. Notes content containing HTML/markdown markup is rendered as literal text in the About dialog
   (verified by a test that feeds tag-bearing notes and asserts no element is created from them).
7. `npm run verify` and the targeted unit tests pass; the About dialog's What's New section is captured
   in a screenshot for the release evidence.

**Settings impact:** none.

## Phase 32 — Multi Mode: two documents in one workspace

**Operator request (2026-09-21, verbatim):** "Implement loading multiple pdf files in one canvas. Up to two
for now. User should be able to view and interact with them in the same canvas. all the options like,
delete, insert etc options should available for the user to work on any window of the pdf. User should be
able to drag and drop pages from one pdf window to another. Thumbnail page view should be available for all
the files, resize them dynamically based on number of files loaded. The drag and drop should be allowed
within the thumbnail page view and also in the canvas. Plan and organizes the visual professionally, so that
it doesn't look poor or disjointed. Make sure to make it super smooth. No visible refresh or flicker should
be there. This feature will be called 'Multi Mode'. Add this to the bar with icon and also in the All tools
panel."

**Scope supersession:** this phase deliberately supersedes the earlier assumption that only one document is
visible in the workspace at a time. Tabs, single-document behaviour and every existing operation remain
unchanged when Multi Mode is off.

**Design decisions (fixed by this contract - do not re-invent them per chunk):**

- **Two panes, exactly.** Multi Mode shows TWO document panes side by side (the operator's "up to two for
  now"). There is no third pane: nothing may create one, and any attempt fails LOUD with a clear message,
  never a silent no-op. The same document must never occupy both panes (attempting it is refused with a
  message).
- **Opening a document while the mode is on** (Open, the pane's Open action, a dropped file, the sample
  cards): the document is assigned to the FOCUSED pane, replacing that pane's document - the previous
  document stays open as a tab and is one click away in the tab strip. A document must NEVER end up in a
  hidden tab with no visible effect. An assignment that cannot be honoured (the file is already shown in
  the other pane) is refused with a clear user-visible message. The pane pick list and the tab strip both
  honour the same guard.
- **Entry points.** A CommandBar control with an icon (`data-toolbar-multi-mode`, `aria-pressed` reflecting
  the mode) AND a ToolsPalette entry (the All tools panel; a tool id such as `multi-mode` with its group
  and search keyword). Both toggle the same mode; their state stays in sync.
- **Pane assignment.** Pane A holds the document that was active when the mode was switched on. Pane B
  starts empty with an explicit empty state offering (a) a pick from the currently open documents and
  (b) an Open action; it becomes a real pane the moment a document is assigned.
- **Focus model.** Exactly one pane is focused. Clicking anywhere in a pane (page, scrollbar area, its rail
  section, its header) focuses it. The focused pane carries a clear, non-jarring accent affordance plus a
  per-pane header (document name, page count, and a control to clear/replace its document). EVERY
  document-scoped action - the CommandBar and toolbar page operations (delete, rotate, reorder, insert
  blank/from-PDF, extract, optimize, OCR), annotations, undo/redo, Save/Save As, and every dialog-driven
  operation - acts on the FOCUSED pane only, never on both and never implicitly on the previously active
  tab.
- **Layout quality.** A single workspace split with an adjustable divider (a sensible minimum pane width,
  and both panes keep their own scroll position and zoom). The two panes must read as one deliberate
  composition: shared chrome height alignment, consistent spacing/typography with the rest of the app,
  one visual language - not two bolted-together viewers. All motion uses the existing motion tokens; no
  hardcoded durations/easings.
- **Thumbnails for all loaded files.** ONE shared thumbnail rail holds a labelled section per document
  (a header with the document name and page count), and the thumbnail width is computed DYNAMICALLY from
  the rail's available width and the number of loaded documents so both sets render at a legible size
  (a smaller width in Multi Mode than in single mode; still a comfortable hit target). Each section keeps
  its own scroll state; the focused pane's section is visually active; a page click in any section
  navigates that pane.
- **Page drag and drop, rail AND canvas.** A page can be dragged from one document to the other starting
  from its thumbnail OR from its page in the canvas. Both paths show the same clear drop affordance: the
  target pane/section highlights and an insertion-position indicator shows exactly where the page will
  land (before/after a target page, or at the end). Default is MOVE; holding Ctrl (or Alt) makes it a
  COPY. A completed drop is ONE atomic operation that cannot lose a page: the engine extracts the page
  from the source, inserts it into the target at the drop position, and (for a move) removes it from the
  source, as a single unit - a failure leaves BOTH documents exactly as they were. Intra-document page
  reordering keeps working exactly as today, in both the rail and the canvas.
- **Smoothness - no visible refresh or flicker (explicit).** Toggling Multi Mode, focusing a pane,
  assigning a document to a pane, changing the split, starting/hovering/dropping a drag, and completing a
  cross-document move must produce NO blank frame, NO white flash and NO re-raster of the unaffected pane.
  The DEF-274/DEF-222 rule applies everywhere a canvas can be re-rendered: never clear or resize a visible
  canvas before its replacement frame is ready (render offscreen, blit atomically). The drag preview is a
  lightweight clone (or a styled overlay), never a re-render of a pane. Pane state must be keyed stably so
  a focus change cannot remount a DocumentView.
- **Data safety.** Each pane's document keeps its own modified state; Save/Save As apply to the focused
  pane; the close/quit gate must account for the unsaved changes of BOTH panes (no silent data loss), and
  closing a tab whose document is in a pane must update that pane cleanly (empty state or another pick),
  never leave a stale pane.
- **Single mode untouched.** With Multi Mode off, the app behaves exactly as it does today - all existing
  e2e and unit suites must stay green, and the existing single-document flows must not regress.

**Features**

- Multi Mode toggle: CommandBar icon control + All tools panel entry, state-synced, persisted for the
  session.
- Two-pane workspace with an adjustable divider, per-pane headers, an explicit focus affordance, and a
  pane-B empty state with document pick/open.
- Full operation routing to the focused pane (page ops, annotations, undo/redo, save, dialogs).
- Shared thumbnail rail with one labelled, dynamically-sized section per loaded document.
- Cross-document page move/copy by drag and drop, from the rail and from the canvas, with a drop-position
  indicator, backed by one atomic engine operation.
- Close/quit safety across both panes.

**Success criteria**

1. The Multi Mode control is present in the CommandBar (with an icon) and in the All tools panel; both
   toggle the same mode and their states agree; the app returns cleanly to the single-pane layout when
   switched off.
2. With Multi Mode on, two different documents can be loaded and are both visible and interactive in the
   same workspace, each with its own page view, scroll position and zoom; opening another document assigns
   it to the focused pane with a visible effect (never a hidden tab, never a silent no-op), and assigning
   the document already shown in the other pane is refused with a clear message.
3. Every document-scoped operation acts on the FOCUSED pane only: deleting pages, rotating, reordering,
   inserting pages, and undo/redo each change the focused pane's document and leave the other pane's
   document untouched (page counts and content before/after per pane).
4. The shared thumbnail rail shows one labelled section per loaded document with a header (name + page
   count) and dynamically sized thumbnails that shrink when two documents are loaded; both sections render
   correctly and clicking a thumbnail navigates the correct pane.
5. Dragging a page from document A to document B moves it: the page appears at the indicated position in B
   and is gone from A (verified by page counts and content on both sides), from BOTH the rail and the
   canvas; holding Ctrl (or Alt) copies instead (B gains the page, A keeps it); a failed move leaves both
   documents unchanged.
6. No visible refresh or flicker: frame sampling across (a) toggling Multi Mode, (b) switching focus
   between panes, (c) starting and completing a cross-document drag, and (d) changing the split, shows no
   blank/white frame in either pane and no re-raster of the unfocused pane.
7. The app stays responsive with two documents loaded: scrolling, focusing and dragging cause no
   main-thread stall (the existing responsiveness probe, with both panes on 34-page documents), and the
   REQUIREMENTS performance budget items still hold.
8. The close/quit gate accounts for both panes' unsaved changes, and closing a tab whose document is in a
   pane updates the pane cleanly (verified in both directions).
9. With Multi Mode off, every existing behaviour is unchanged: the existing unit and e2e suites stay green.
10. Unit tests cover the pane/mode state model, the drag payload -> operation mapping (move vs copy,
    insertion index) and the cross-document move contract; e2e covers the two-pane layout, focused-pane
    routing, the rail sections, both drag paths, and the mode toggle round-trip.

**Settings impact:** none (the mode is session-level; persisting it across restarts is not requested).

## Phase 33 — Print and Multi Mode refinements (operator feedback)

**Operator request (2026-09-22, verbatim):**
"**Bug: For print** 1. Vertical and Horizontal page preview shows the same layout. 2. The print window
should be movable for the user.
**For Multi View:** 1. There shouldn't be two different tools bar for each window. There should be one
tool bar like 'Annotation' etc. User should be able to apply them to either of the windows. 2. The canvas
shouldn't have see through/transparent background. The background should be either light/dark. 3. The
thumbnail page view should be in the middle for multi view side by side for both files. Not in the same
row as the current implementation. In multi view, when the 2nd file is added, both thumbnail page view
will be in the middle side by side. The thumbnail for left window will be on its right and the thumbnail
for right window will be on tis left."

**Scope supersession:** this phase supersedes Phase 32's "ONE shared thumbnail rail holding a labelled
section per document" layout (item 3 below replaces it) and Phase 30's fixed, non-movable dialog shell
(item 1). Everything else in those phases stands.

**Features**

- **Movable print dialog.** The print dialog panel can be repositioned by the user: dragging its header
  (a visible drag affordance) moves the panel, clamped so it always stays fully inside the window. The
  move is smooth (no flicker, no layout thrash, transform-based), the dialog's controls keep working
  after a move, and a freshly opened dialog returns to its default centred position (the position is
  session-only, not persisted).
- **Print preview page order must be real.** "Vertical" and "Horizontal" page order must produce
  visibly DIFFERENT sheet layouts, matching the industry meaning (Acrobat's Page Order): Horizontal
  flows left-to-right (pages side by side), Vertical flows top-to-bottom (pages stacked). The effective
  sheet grid (columns/rows) AND the fill flow both follow the order - so at 2 pages per sheet, Horizontal
  is 2 columns x 1 row and Vertical is 1 column x 2 rows; at 6 per sheet the 3x2 grid becomes 2x3, and so
  on. The reversed variants reverse the flow within that grid. The PREVIEW and the composed PRINT
  DOCUMENT must agree for every pages-per-sheet value. (Phase 30 criterion 3 already promised this; this
  phase makes it true - the two orders currently render identically at 2-up because the grid dimensions
  never change.)
- **One shared toolbar in Multi Mode.** In Multi Mode the workspace has exactly ONE toolbar (the same
  toolbar the app shows in single mode - annotation tools, page tools, etc.), not one per pane. Its armed
  tools apply to whichever pane the user works in: arming a tool in the shared bar and then using it in a
  pane applies it to THAT pane (the interaction focuses that pane first). The per-pane toolbars are gone
  in Multi Mode; single mode keeps its existing toolbar unchanged.
- **Opaque canvas background in EVERY mode (operator follow-up: "Don't keep see-through for single
  mode").** The PDF canvas area - the pane surface and its scroller - must be an opaque surface colour of
  the active theme (light or dark) in BOTH single mode and Multi Mode, in every theme including frosted.
  Translucent chrome may stay glassy; the surface the pages sit on may not.
- **One All Tools badge in Multi Mode (operator follow-up: "All Tools badge shouldn't render twice").**
  The All Tools affordance must appear exactly ONCE in Multi Mode; an inactive pane must not render a
  duplicate of the workspace chrome (see the AGENTS_NOTES observation from the Phase 32 run).
- **Centred side-by-side thumbnail strips in Multi Mode.** When two documents are loaded, each pane's
  thumbnail strip sits at that pane's INNER edge, so the two strips meet in the MIDDLE of the workspace,
  side by side: pane A's strip immediately to the RIGHT of pane A's pages, pane B's strip immediately to
  the LEFT of pane B's pages, with the divider between the two strips. Each strip shows its own pane's
  document, thumbnails stay dynamically sized to the available width (still a comfortable hit target),
  clicking a thumbnail navigates its own pane, and drag and drop between the two strips and the canvas
  keeps working exactly as verified in Phase 32.

**Success criteria**

1. The print dialog can be dragged by its header to a new position and stays clamped inside the window at
   every drag extreme; the controls still work after a move (a print can be configured and started);
   frame sampling during the drag shows no blank/white frame or layout shift; reopening the dialog shows
   it centred again.
2. With 2 pages per sheet, Vertical and Horizontal produce visibly DIFFERENT preview layouts (stacked vs
   side by side - assert the cell geometry, not just the class); at 4 and 6 per sheet the arrangements
   differ in the expected direction; the reversed variants reverse the flow within the same grid; and for
   each order the composed PRINT DOCUMENT matches its preview (verified by inspecting produced PDFs - page
   count and the arrangement of the pages on the sheet).
3. In Multi Mode there is exactly ONE toolbar in the workspace (`[data-toolbar-*]` controls appear once,
   not once per pane); arming a tool in it and using it in pane A applies to A, and the same in pane B
   applies to B (verified by an actual operation on each side).
4. The canvas background is opaque in every theme (light / dark / frosted) in BOTH single mode and Multi
   Mode: pixel sampling of the canvas area returns an opaque colour, never the app background showing
   through, plus a screenshot for the visual record.
4b. The All Tools affordance renders EXACTLY ONCE in Multi Mode (a single badge in the workspace chrome,
   not one per mounted pane), while remaining reachable and functional.
5. With two documents loaded, pane A's thumbnail strip is to the RIGHT of pane A's pages and pane B's
   strip is to the LEFT of pane B's pages (assert the strips' horizontal positions relative to their own
   pane and to each other - both in the middle of the workspace, side by side); each strip shows its own
   document's thumbnails at a dynamically sized width; a thumbnail click navigates its own pane; and a
   cross-document drag from either strip still moves the page.
6. Single mode is unchanged apart from the now-required opaque canvas (one toolbar, the rail at its
   existing position and width, the existing suites green),
   and the previously verified Multi Mode behaviours still hold: focused-pane routing, the close/quit
   gate over both panes, and no visible refresh/flicker on mode toggle, focus switch, divider drag and
   drag-and-drop.

**Settings impact:** none.

## Phase 34 — Multi Mode round 2 (operator feedback)

**Operator request (2026-09-22, verbatim):**
"1. Expanding 'All tools' panel should resize both window equally. At this time, the left window resizes
with a blank space on its right, even though there's no all tools panel on the left window.
2. Multi view mode shouldn't open two tabs. It should put a divider in one tab and show both file names
on the two sides of the divider.
3. Make divider between the two windows more prominent. Currently it's not very visible.
4. When dragging and dropping a page, show a line between the pages where the page will be placed for
more clarity."

**Features**

- **The All Tools panel resizes BOTH panes equally.** Opening the All Tools palette must shrink the two
  panes by the SAME amount. Today the palette's reserved width (`--tf-tools-inset`) is consumed as a
  `margin-right` by EACH pane's `.document-scroller` (styles.css:3357-3361), so pane A - which the
  floating right-side panel does not even cover - reserves a full 344px inside itself and shows a blank
  strip on its right, beside its own thumbnail strip. The reserved width must instead come out of the
  WORKSPACE as a whole (consumed once at the stage level), so both panes lose half of it and neither
  pane carries an internal blank strip. The existing token-driven slide (registered
  `@property --tf-tools-inset`, the shared panel-slide duration/ease) must keep the panel and both panes
  moving together with no flicker, and single mode's panel behaviour must stay exactly as it is.
- **ONE tab for the Multi Mode workspace (not two).** While Multi Mode is on the tab strip shows exactly
  ONE tab representing the combined workspace, instead of the two individual document tabs. The
  underlying session model is unchanged (two engine documents, each with its own undo stack, modified
  flag and page state) - this is a presentation change over it:
  - the single tab's label names BOTH documents (truncated gracefully when long);
  - its modified indicator reflects EITHER document being modified;
  - closing it runs the existing modified-changes queue for EACH modified document before closing both;
  - switching Multi Mode off restores the individual tabs, with the focused pane's document active;
  - opening a document while the mode is on keeps the Phase 33 semantics (it is assigned to the focused
    pane, never a hidden tab).
- **Both file names flank the divider.** Each document's name and page count is displayed immediately
  ADJACENT to the divider - the left document's name on the divider's left side, the right document's
  name on its right side - so the two names read as the two sides of one split workspace. This replaces
  the current per-pane top headers. The names must update when a pane's document is replaced.
- **A prominent divider.** The divider between the panes must be clearly visible in every theme: a
  distinct surface colour with a visible grip affordance and a hover/active state, without becoming
  heavy or noisy. Its drag must keep tracking the pointer 1:1 (no transition declared on the geometry),
  keep the existing min-pane clamp, and keep working after a theme change.
- **A clear insertion line while dragging a page.** While a page is dragged, a clearly visible line
  spanning the page column is shown in the GAP where the page will land (in the canvas AND in the
  thumbnail rail), so the insertion point is unambiguous - stronger than the current 3px accent bar
  (`.page-drop-indicator`, styles.css:11818-11837). The line must sit between the two page slots (not
  overlay a page), move with the hovered slot, and disappear on drag end/cancel.

**Success criteria**

1. With the All Tools panel open in Multi Mode, measure both panes' page-area widths before and after:
   the two panes shrink by the SAME amount (equal deltas within a pixel), and neither pane contains a
   blank reserved strip on its inner/outer side beyond its normal gutter. In single mode the panel's
   behaviour is unchanged. Frame sampling across open/close shows no blank frame or flicker in either pane.
2. In Multi Mode the tab strip shows EXACTLY ONE tab; its label names both documents; its modified
   indicator is set when EITHER document is modified; closing it prompts for each modified document and
   closes both; switching the mode off restores the individual tabs with the focused pane's document
   active; opening a document while the mode is on still assigns it to the focused pane.
3. Both file names (with page counts) render adjacent to the divider - the left document's name on the
   divider's left, the right document's on its right (assert their horizontal positions relative to the
   divider's rect) - and they update when a pane's document is replaced.
4. The divider is clearly visible in all three themes: report its rendered width, colour and grip
   affordance plus its contrast against the neighbouring surfaces, with a screenshot for the visual
   record; dragging it still tracks the pointer 1:1 and re-splits both panes within the min-pane clamp.
5. During a page drag an insertion line spanning the page column is visible in the gap at the landing
   position: report its geometry (width, thickness, its position BETWEEN the two page slots) and that it
   follows the hovered slot, in BOTH the canvas and the rail.
6. No regressions: single mode unchanged, and the previously verified Multi Mode behaviours still hold -
   focused-pane routing, the close/quit gate over both panes, no visible refresh/flicker, drag-and-drop
   move/copy, one shared toolbar and one All Tools badge - with the existing suites green.

**Settings impact:** none.

## Phase 35 — Windows integration, printing and window behaviour

**Operator request (2026-09-22, verbatim, the non-Multi-View items):**
"1. App doesn't have default windows behaviour, like double clicking on the top bar or dragging it to the
top of the screen doesn't make it full screen. Also, dragging it to the left or right of the screen doesn't
place it in split windows mode. Make sure, app uses all the default windows behavior.
2. Hidden taskbar in windows doesn't pop-up on mouse hover.
3. Windows currently doesn't show the app as pdf reader. Selecting 'open with' doesn't show tflex. Also, not
able to set it as default pdf app.
7. For Print, 'Microsoft print to pdf' brings another windows print window. It should happen within the
tflex app.
8. Allow tflex print window independent of the app, so it can be taken and used outside of the tflex app
window."

**Features**

- **Standard Windows window behaviour.** The frameless window must behave like a normal Windows app:
  double-clicking the title bar toggles maximise/restore; dragging the window to the top edge maximises it;
  dragging it to the left/right edge snaps it to a half-screen split (Aero Snap / snap layouts); and a hidden
  (auto-hide) taskbar reveals on mouse hover at the screen edge. The custom caption keeps its look, but the
  DRAGGABLE REGION must cover the whole caption strip (today it is deliberately narrow - see the DEF-132 note
  in `styles.css` around `.titlebar-slot` / `.app-header`) so the OS gestures trigger everywhere on the bar.
  The window must not block the taskbar's reveal: default sizing/positioning should respect the display's
  WORK AREA (`screen.getPrimaryDisplay().workArea`), and the conflict with `transparent: true`
  (`src/main/window.ts:100` - a layered window, a known cause of swallowed taskbar hover) must be
  investigated and resolved while preserving the app's translucent look.
- **TFlex as a PDF handler in Windows.** The installer must register TFlex as a PDF handler
  (electron-builder `fileAssociations` for `.pdf` - there is none today), so TFlex appears in Explorer's
  "Open with" list and can be chosen as the default PDF app in Windows Settings. The app must accept a file
  from the OS: launching the exe with a PDF path argument opens that document, and a second launch while
  TFlex is running opens the document in the RUNNING instance (single-instance handling) rather than
  starting a second app. Setting the Windows default handler is a user action in Windows Settings - the app
  must be selectable there and must never misrepresent its own default status.
- **PDF output produced inside TFlex.** When the destination is a virtual PDF printer ("Microsoft Print to
  PDF" and similar), the flow must stay INSIDE TFlex: the app produces the PDF itself from the same composed
  print document and asks where to save it with the app's own save dialog - no Windows/Chromium print
  window, no OS print dialog. The produced file must match the preview and the settings (page range, N-up,
  page order, orientation, scaling) exactly as the direct-print path does.
- **The print window can live outside the app window.** The print UI must be usable as its own OS window:
  movable anywhere on the desktop, including beyond the TFlex window's bounds, while still driving the same
  print pipeline (settings, preview, print/save) and staying in sync with the app (closing it leaves the app
  usable; the app closing closes it; a document change is reflected). The in-app dialog may remain the
  default; the requirement is that the print window is not trapped inside the app window.

**Success criteria**

1. Double-clicking the caption strip toggles maximise/restore; dragging the window to the top edge maximises
   it; dragging it to the left and right edges snaps it to half the screen (report the measured window
   bounds before/after each gesture); a hit-test at several points across the caption strip shows it is
   draggable everywhere; and with an auto-hide taskbar the taskbar reveals on hover at the screen edge
   (a manual/observable check is acceptable where automation is impossible - state the method).
2. `.pdf` is registered by the installer: after a silent install the association is present and points at
   the installed executable, TFlex appears as a PDF handler, launching the exe with a PDF path argument opens
   that document, and a second launch while running opens the document in the running instance (no second
   process). Setting the Windows default is a user action - the app must be selectable and must not
   misreport its default status.
3. With "Microsoft Print to PDF" selected, printing from TFlex produces the PDF through TFlex's own save
   dialog with NO Windows print window appearing; the produced file's page count, page order and orientation
   match the preview and the settings (verified by inspecting the produced file).
4. The print UI can be moved outside the app window (its bounds can exceed the app window's bounds) and still
   works there: changing a setting updates the preview, the print/save action completes, closing the print
   window leaves the app usable, and closing the app closes the print window.
5. No regressions: the direct-print path to a real printer keeps its behaviour (silent with the mapped
   options); single mode and Multi Mode are unaffected except where the operator asked; the existing suites
   stay green.

**Settings impact:** none expected. If an implementation detail needs a persisted field (e.g. a print-window
preference or a remembered last-save directory), it must be added to `AppSettings` with validation in
`src/main/services/settings.ts` (preserve-if-valid, reject-if-invalid) and this line updated before any
renderer reads it.

## Phase 36 — TFlex STAGES: an object-first workspace (information-architecture restructuring)

**Operator request (2026-09-23):** restructure the information architecture into **TFlex STAGES** — an
object-first workspace organized by STAGE OF WORK (`PAGES · EDIT · REVIEW · DELIVER`) rather than by
feature list. Reference mockup supplied by the operator (`tflex-stages-concept.html`) and the accompanying
implementation prompt (`TFlex_Stages_Implementation_Prompt.txt`). This is a RESTRUCTURING task: the
existing animation system, design language, components and behaviours stay intact; surfaces are re-parented
and re-homed, never rewritten.

**Locked design decisions (operator-approved 2026-09-23 — do not re-litigate per chunk):**

- **The All-tools palette is RETIRED as a UI surface.** Its entries array becomes `toolsRegistry` (data:
  id, label, description, icon, shortcut, stage, action, availability) and its badge is retired. This
  SUPERSEDES the "also in the All tools panel" wording of Phases 13/30/32/33 and the single-badge
  requirement (DEF-284's UI half). Every tool that lived only in that panel must exist in the registry and
  be reachable from a stage surface and/or the palette.
- **Command palette**: `Ctrl+K` opens it (fuzzy search across every tool, recent file and view action) and
  it supersedes the All-tools panel as the browse-everything surface. `Ctrl+Shift+P` stays a legacy alias.
  **Pin a result to the dock with `Ctrl+Enter`.** `Ctrl+P` remains PRINT and must not be re-bound.
- **Stages**: `Ctrl+1..4` switch PAGES/EDIT/REVIEW/DELIVER. Stage state is per pane (Multi Mode tracks a
  stage per pane). The Stage Rail is 44px, full height, four icon+label buttons with the settings gear at
  its bottom, and collapses to icon-only below a 1100px window width.
- **One moving part**: switching stage swaps ONLY the left context panel, the dock contents and the
  inspector contents. The title bar, Stage Rail, canvas and floating pills never move.
- **Action Dock**: one component, four legal states (stage verbs / selection override / pinned / idle),
  floating at the bottom-centre of the canvas over the workspace chrome. Nothing else may occupy the
  bottom-centre of the canvas as WORKSPACE chrome - the object-level action bars (annotation place/confirm,
  `EditToolbar`) and the floating text panel keep their current behaviour and are exempt.
  Idle (fade to ~40%) must NEVER trigger while a tool is armed or a drag is in progress. Pins persist
  (`dockPins`, max 4, oldest overflow into a "..." chip); a pinned tool already present in the stage set is
  not duplicated.
- **Inspector**: the right panel (240-280px) showing live properties of the current selection with the
  actions that apply to it. It RE-PARENTS the existing text-properties, OCR-suspects and annotations
  components (never reimplements them) and reuses the existing panel-inset machinery - the Phase 33/34 and
  DEF-286/287 invariants stand: the panel shrinks BOTH panes equally, the page-area floor holds, the stored
  split fraction re-clamps on geometry change.
- **Annotations** live in the REVIEW stage: the dock's primary opens ONE expandable surface that hosts the
  existing `AnnotationToolbar` (select/ink/rect/ellipse/arrow/textbox/callout/note/highlight/underline/
  strikeout + colour/pen). It must NOT read as a duplicated tool set - the registry gives every tool
  exactly ONE canonical home and other surfaces only reference it.
- **Title bar**: keeps Print (icon + Ctrl+P), the update indicator, the theme picker, the preferences gear
  AND all three quick file actions (Open / Save / Save As). The hamburger becomes an explicit "File" menu
  label. A settings gear is ADDED to the Stage Rail bottom (the title-bar gear stays).
- **Multi Mode keeps its Phase 32-34 layout**: centred inner-edge thumbnail strips flanking the divider,
  ONE shared rail/dock/badge for the workspace, ONE composite tab, and the stage tracked PER PANE. The
  concept's left context panel applies to SINGLE mode only. The shared Multi Mode toolbar ROW is replaced
  by the shared floating dock; `--tf-multi-toolbar-h` and its offsets are re-derived while DEF-282's
  invariant (no overlap with the pane headers, offset applied pre-paint) is preserved by tests.
- **Motion**: express the concept's timings with the EXISTING motion tokens only (no new durations), and
  honour reduced motion and the Animations-off switch.
- **Theming**: the concept's hues are illustrative. The brand accent stays the existing accent token; only
  four NEW semantic stage tokens are introduced (`--tf-stage-pages`, `--tf-stage-edit`, `--tf-stage-review`,
  `--tf-stage-deliver`) with a value PER THEME (light / dark / frosted) meeting WCAG AA (4.5:1 text, 3:1
  icons/chips). Zero hardcoded colours anywhere (the conventions checker enforces this).
- **Shortcuts may be REASSIGNED** where they collide (the operator approved moving a collided binding to an
  alternate key); `Ctrl+P` (Print) and the existing document shortcuts (Ctrl+S / Ctrl+F / Ctrl+Shift+O /
  Ctrl+Shift+S / Ctrl+W / Ctrl+Z / Ctrl+Shift+Z / Ctrl+,) must keep working.
- **Every existing control is placed**: the registry is built from a grep-audit of the whole UI, not from
  the concept's 22-item table. Controls with no natural stage go to a GLOBAL bucket (palette + title bar /
  File menu). Nothing is removed, hidden or downgraded. Specific placements approved: the **Multi Mode
  toggle** moves to the title bar + palette; **Watermark** sits in REVIEW (and the palette); the **floating
  text panel** becomes an optional pop-out of the same Inspector component (one component, two mount
  points - never a second properties UI).
- **Test migration is part of every chunk**: the e2e suite is updated in the SAME chunk as the surface it
  describes, with a compatibility pass keeping key `data-*`/aria attributes on moved controls wherever
  possible. No chunk closes while its specs are red.

**Features**

- `toolsRegistry` as the single tool inventory (every existing command, each with exactly one canonical
  home) + the per-pane stage model.
- Stage Rail with the four stages, the gear, `Ctrl+1..4` and the narrow-width collapse.
- ContextPanel with four stage panels: PAGES (the existing live-thumbnail stack + inline hover verbs +
  right-click menu + merge entry + the outline section), EDIT (content outline + recognition), REVIEW
  (annotations + signatures), DELIVER (pre-flight + new document).
- ActionDock (four states, pins, idle, responsive overflow) replacing the toolbar row.
- Inspector replacing the All-tools palette, re-parenting the existing property/panel components.
- CommandPalette (`Ctrl+K`, fuzzy, frequency-boosted, `Ctrl+Enter` pin).
- Floating page + zoom pills replacing the toolbar's view controls.
- The four stage tokens per theme.

**Success criteria**

1. Every existing tool is reachable in <= 2 interactions (stage + dock/panel, or Ctrl+K) and the registry
   contains every control found in the inventory audit - nothing removed, hidden or downgraded.
2. No toolbar row remains; the canvas gains the reclaimed space; the concept's four states are the only
   workspace chrome at the bottom-centre of the canvas.
3. The PAGES panel shows LIVE-RENDERED page previews with today's rotation/deleted/reorder reflection,
   drag-reorder with its drop indicators, multi-select bulk ops, current-page highlight and scroll sync -
   verified side by side with the old rail before the old rail is retired.
4. Delete/Flatten never appear on persistent chrome; Rotate/Delete appear only on thumbnails, the PAGES
   dock and the right-click menu.
5. `Ctrl+1..4` switch stages; every pre-existing shortcut still works (`Ctrl+P` = Print unchanged).
6. The palette lists every registry tool with its stage tag, fuzzy-matches, boosts by usage, and pins with
   `Ctrl+Enter` (max 4, persisted, restart-surviving).
7. All four dock states render per spec; idle never triggers while a tool is armed or a drag is in
   progress; pins survive a restart.
8. Every new surface is verified in light, dark AND frosted with zero hardcoded colours (the only allowed
   literals are the new per-theme token definitions) and meets the contrast floors.
9. All pre-existing unit and e2e tests pass, with new tests for stage switching, dock state transitions,
   pin persistence, the registry audit, the palette and the inspector; the migrated specs keep asserting
   the same behaviours.
10. Multi Mode keeps its Phase 32-34 behaviour (centred strips, one shared dock/rail, one composite tab,
    per-pane stage) with the DEF-282/286/287 invariants intact, and each pane owns its stage, panel, dock
    and inspector contents.
11. The Phase 35 behaviours and the print pipeline are untouched: print dialog/window, the in-app PDF
    output, the OS open/drop paths and the window behaviour all keep working.

**Settings impact:** TWO new fields, both validated in `src/main/services/settings.ts` before any renderer
code reads them (preserve-if-valid, reject-if-invalid, mirroring the Phase-6 pattern):
- `dockPins?: string[]` - tool ids pinned to the Action Dock, capped at 4 (an over-long or invalid array is
  truncated/dropped per the validator's rule); unknown ids are dropped on read.
- `toolUsage?: Record<string, number>` - per-tool run counts for palette frequency ranking; non-finite,
  negative or non-number values are rejected/dropped.
`toolsPaletteLayout` is retained as a TOLERATED LEGACY key for one release (no UI writes it; the validator
must keep accepting it so an existing settings.json does not fail validation).

## Phase 37 — STAGES feedback round (22 operator items)

**Operator request (2026-09-24):** the 22 numbered items below (verbatim groupings). All of them are
refinements of the Phase 36 surfaces - the design language, the motion tokens and every existing behaviour
stay; nothing may be removed or hidden.

**Features (grouped; the ruling text IS the contract)**

**A. Inspector integration + chrome (items 1, 3, 5, 10, 22)**
- The text-manipulation panel is INTEGRATED INTO the Inspector for BOTH the annotate flow and the edit flow:
  the text manipulation sits at the TOP of the Inspector and the Inspector's existing content below it,
  separated by a subtle divider; the whole column scrolls when it is too long.
- The secondary panel that appears after choosing a tool from the dock (e.g. an annotation tool) renders as
  ONE ROW with NO header. It follows the same responsive behaviours as the dock (E below).
- The Inspector is FLUSH with the canvas top (no rounded left corner, no disjointed gaps) and gains an
  expand/collapse control.
- The Inspector's buttons are professional: a comfortable hit target and legible label size (no tiny text).
- Rails and panels gain SUBTLE SEPARATORS between distinct controls/rows/text blocks so items read as
  distinct elements, not a wall of plain text.

**B. Thumbnail panel + rail (items 4, 8, 9, 15, 16, 18, 19)**
- The panel's collapse/expand chevron must actually flip with the state (it currently never changes).
- The Stage Rail is NOT visible on the welcome (home) screen.
- The panel header's "Pages…" text is removed and the panel becomes narrower accordingly.
- The Outline section's bottom is flush with the panel bottom, with a separator between the thumbnail area
  and the Outline section.
- The Multi Mode thumbnail strips are narrower (they carry too much empty space).
- The Multi Mode strips get the SAME options as the single-mode panel, including the right-click menu.
- Placement audit: no control or label touches the window/canvas edge ("Settings" currently does); icons,
  panels and docks all get industry-standard padding and alignment.

**C. Edit text (items 11, 12, 13)**
- After selecting text, the action bar is `Confirm`, `Delete`, `Cancel` - the `Edit` option goes (selecting
  the text already brings the text-manipulation panel).
- Selecting text must NOT make it invisible - the selected text stays visible.
- The "Edit content" verb is removed from the EDIT dock: entering the EDIT stage ENABLES edit mode in the
  canvas (the stage is the switch).

**D. Labels (item 14)** - "Renumber pages" is renamed "Rename pages" everywhere.

**E. Action Dock behaviour (items 2, 6, 7, 21)**
- The dock is ALWAYS ONE ROW. It must never stack vertically.
- Responsive ladder as the window shrinks, in this exact order: (1) collapse the Inspector, (2) collapse the
  thumbnail panel, (3) hide the dock verbs' LABELS to fit, (4) if still too wide, shrink the dock and show
  left/right ARROW controls to scroll the verbs. Growing the window reverses the ladder.
- The dock renders CONSISTENTLY in every theme (same surface, spacing, contrast).
- The dock contains ALL the relevant tools for the stage BY DEFAULT, and a tool can be UNPINNED from it;
  a small hint line above the dock points at `Ctrl+K` for searching tools.

**F. Retirements (item 17)** - the in-app print dialog/window is REMOVED; the print entry points (title-bar
Print, File > Print, `Ctrl+P`) open the standalone print window directly.

**G. Bug (item 20)** - the `watermark` dock tool is greyed with "open a document first" even when a document
IS open. The availability gate must reflect the real state.

**Success criteria**

1. With a text object selected in the annotate flow AND in the edit flow, the Inspector shows the text
   manipulation at the top and its own content below, split by a subtle divider, and the column scrolls
   without clipping (verified for a long control set at 640 and 1440 widths).
2. The secondary tool panel (after picking a dock tool) renders one row, no header; at narrow widths it
   follows the dock's label-hiding/arrow behaviours (E).
3. The Inspector is flush with the canvas top (no rounded left corner, no gap), can be collapsed and
   expanded, and its expanded state matches the canvas geometry; its buttons meet a professional size
   (state the pixel targets).
4. Every rail/panel shows subtle separators between its distinct controls/rows (a screenshot per surface).
5. The thumbnail panel's chevron flips with the collapsed state; the "Pages…" header is gone and the panel is
   narrower; the Outline is flush at the panel's bottom with a separator above it.
6. The Stage Rail is absent on the welcome screen and present with a document open.
7. Multi Mode's strips are narrower, carry the same options as single mode (drag-reorder, hover verbs,
   right-click menu, multi-select) and look identical in behaviour.
8. Edit text: the action bar is `Confirm` / `Delete` / `Cancel` (no `Edit`); the selected text stays VISIBLE;
   and entering the EDIT stage enables edit mode in the canvas with no "Edit content" verb in the dock.
9. "Rename pages" is the label everywhere (the dock/panel/palette/menu title).
10. The dock is one row at every supported width and never stacks; the responsive ladder collapses the
    Inspector, then the thumbnail panel, then the labels, then shows the arrows - in that order, reversing
    when growing.
11. The dock looks identical in light, dark and frosted (the same surface/spacing/contrast).
12. The dock carries all the stage's tools by default, a tool can be unpinned, and the `Ctrl+K` hint appears
    above it.
13. The in-app print dialog is gone; the title-bar Print / File > Print / `Ctrl+P` open the standalone print
    window (verified on the installed build).
14. The watermark tool is enabled with a document open (the gate bug fixed) and disabled with none, with the
    correct reason.
15. No control or label touches a window/canvas edge (the placement audit), verified by measuring the edge
    gaps of the header controls, the rail, the panels and the dock.

**Settings impact:** one new field - `dockUnpinned?: string[]` (the tool ids the user removed from the dock;
validated like `dockPins`: an array of non-empty strings, de-duplicated, unknown ids dropped on read, a
cap to keep the file bounded). No other settings change.

## Phase 38 — Installation, legibility, the legacy text panel, edit fidelity and a multi-view glitch (5 operator items)

**Operator request (2026-09-25):** the five numbered items below (verbatim intent). Items 1 and 2 change the
product's packaging and visual language; items 3 and 4 retire a surface and correct the edit-text experience;
item 5 is a crash-class rendering bug on a real-world document that must be root-caused, not patched.

**Features**

**A. Standard Windows installation, 64-bit and 32-bit (item 1)**
- TFlex installs to the standard per-machine Program Files location, like any other Windows application:
  the 64-bit build to `C:\Program Files\TFlex` and the 32-bit build to `C:\Program Files (x86)\TFlex`
  (never the per-user `%LOCALAPPDATA%\Programs` location). The installer is a real per-machine install
  (the standard elevation prompt, an Add/Remove Programs entry, an uninstaller in the install folder).
- **Operator ruling (2026-09-25) - 32-bit is DEFERRED.** The pinned runtime (Electron 44) publishes no
  32-bit Windows binary upstream (`electron-v44.0.0-win32-ia32.zip` 404s; the local `checksums.json` lists
  only x64 and arm64 for win32), so an ia32 installer cannot be produced without repinning Electron -
  which would re-open validation of printToPDF, window behaviour and electron-updater. The operator chose
  x64-only for now. The release therefore ships ONE per-machine installer for x64 plus its portable build,
  with the architecture token kept in the artifact name so the updater's arch selection stays correct and
  an ia32 target can be added later without renaming anything. The ia32 target returns only if the runtime
  is deliberately repinned.
- Auto-update keeps working: the feed carries the x64 installer and the updater selects the entry whose
  URL matches the running architecture's token (`process.arch`); the mechanism is proven by the emitted
  metadata names and the updater's actual requested URL.
- **The installer removes the LEGACY per-user install** (operator ruling, 2026-09-25): the pre-1.30
  releases installed to `%LOCALAPPDATA%\Programs\TFlex` with a per-user uninstall entry and a per-user
  `.pdf` ProgID. A per-machine install must not leave that second copy behind - it removes the old install
  directory, its per-user uninstall registry entry and its per-user file-association ProgID.

**B. Rich, readable icons and text (item 2)**
- Icons and their labels are bigger, higher-contrast and colourful: the UI must read as rich, not as a wall
  of uniform grey. Tool families carry a distinct accent colour, while the icon shape and the label remain
  the primary differentiators (colour is never the only signal).
- Every interactive label and icon meets a legibility floor in ALL THREE themes (light, dark, frosted):
  text contrast at least 4.5:1 against its ACTUAL surface and icon/graphic contrast at least 3:1, with
  stated minimum sizes (no icon below 18px, no control label below 12px). Disabled states stay visibly
  distinct from enabled ones.

**C. The legacy text-manipulation panel is retired (items 3 and 4, second half)**
- The OLD floating text-manipulation panel - and its drag-to-move behaviour - is REMOVED from every flow.
  The Inspector-hosted text manipulation (Phase 37 item A) is the ONLY text-manipulation surface; it stays
  fixed in the Inspector and is not movable. No capability may lose its home in the retirement.

**D. Editing text looks like editing the original text (item 4, first half)**
- While a text object is being edited, the canvas editor renders the text at the SOURCE run's size and
  format (no visual shrink) and the original glyphs are FULLY covered - no ghost/duplicate of the old text
  may remain visible behind the edited text.
- Selecting a text object ACTIVATES the Inspector's text field (DOM focus), so the user can start typing
  immediately without first clicking the field.

**E. The multi-view page glitch on a real-world document (item 5)**
- `TanzimulIslamPaySlip20260930.pdf` (the operator's real payslip) opened as the SECOND document in Multi
  Mode glitches violently. The glitch is reproduced, ROOT-CAUSED with evidence (not guessed), filed as a
  defect, fixed, and the fix verified on that exact file plus the fixture corpus - no regression to single
  mode, to pane 1, or to the other fixtures.

**Success criteria**

1. After the installer runs on a 64-bit device, `TFlex.exe` lives under `C:\Program Files\TFlex` (measured
   path, not asserted from config), the install is per-machine (an Add/Remove Programs entry and an
   uninstaller exist), and no per-user `%LOCALAPPDATA%\Programs\TFlex` install remains.
2. The installed artifact's name carries its architecture (`-x64`) and that token is what the updater
   matches on; a 32-bit artifact is NOT produced while the runtime pin has no ia32 build - the deferral is
   recorded with its evidence (the upstream 404 and the checksums listing).
3. The published release carries the x64 installer, its blockmap, the x64 portable build and the feed
   metadata; the feed's entries and the updater's requested URL are reported as measured evidence.
   Installing over an existing legacy per-user install removes it: after the per-machine install there is
   NO `%LOCALAPPDATA%\Programs\TFlex` directory, no per-user uninstall entry and no per-user `.pdf`
   ProgID left behind.
4. Every interactive text label meets at least 4.5:1 contrast and every icon at least 3:1 against its real
   surface, in light, dark and frosted themes - measured by an automated sweep over the shipped controls,
   with the failing element named if any exists (zero failures required).
5. Icon and label sizes meet the stated floors (icon at least 18px, label at least 12px) across the dock,
   the stage rail, the panels, the Inspector and the header; the sizes are measured, not asserted from CSS.
6. Tool families are visually distinguishable by colour in all three themes (a screenshot per theme), and
   colour is never the only differentiator (shape/label carry the meaning).
7. The legacy text-manipulation panel is absent from the DOM in every flow (annotate and edit), its drag
   handle no longer exists, and exactly ONE text-manipulation surface renders - the Inspector's, fixed in
   place (a screenshot plus a DOM assertion for both flows).
8. No tool or capability lost its home in the retirement: the registry x surfaces sweep passes, and the
   Ctrl+K palette still reaches every text-manipulation control the retired panel offered.
9. While editing, the canvas editor's rendered text size equals the source run's size (within 0.5px) at
   several source sizes and zoom levels, and a pixel-difference of the edited region shows the original
   glyphs fully covered (no ghost text) - measured, with the numbers reported.
10. Selecting a text object focuses the Inspector's text field (`document.activeElement` is that input) and
    typing immediately changes its value without a manual click, verified in both the annotate and edit
    flows.
11. The payslip document opens as the second Multi Mode document and renders with NO violent glitch:
    painted-frame capture across opening in pane 2, focus switching, scrolling and zooming shows zero
    blank/garbled frames, and the defect record states the root cause with its evidence.
12. No regression: the full unit suite and the phase's e2e suite are green, the canonical installed spec
    passes against the Program Files install, and the previously released behaviours (Phase 36/37 surfaces,
    single mode, pane 1) are unchanged.

**Settings impact:** none - no new `AppSettings` field; the packaging change is build configuration and the
UI changes are tokens/styles, not user preferences.

## Phase 39 — Multi Mode consistency round (4 operator items)

**Operator request (2026-09-25):** the four numbered items below (verbatim intent). Three are concrete
defects seen with ONE document open in Multi Mode; the fourth asks for a DEEP SWEEP so Multi Mode's dock
behaves exactly like single mode. Multi Mode must not be a second-class surface.

**Features**

**A. The thumbnail preview must sit inside its page frame (item 1)**
- With ONE document open in Multi Mode, the page preview inside the thumbnail panel must render WITHIN its
  page border/box at every pane width and zoom - no part of the preview may spill outside the page frame
  or overlap the panel's edges.

**B. The pane's "Open a PDF" must open the file picker (item 2)**
- In Multi Mode, clicking the pane's "Open a PDF" affordance must open the standard OS file picker and open
  the chosen document into that pane. It must NOT resize the panes, move the divider or enlarge the left
  pane. This holds with one document and with two.

**C. The dock must exist and be correctly placed in Multi Mode (item 3)**
- With ONE document open in Multi Mode, the Action Dock must render and work exactly as in single mode -
  the same stage verb set, the same availability gates, the same pins.
- No control may overlap another panel: the page-rotate control that currently sits at the bottom of the
  thumbnail panel over other content must have ONE correct home (consistent with single mode) and must not
  intersect any other panel or control.

**D. Deep sweep: Multi Mode's dock must behave identically to single mode (item 4)**
- Every dock behaviour is compared between Multi Mode and single mode for each of the four stages: the
  default verb set and its curation, the availability gates, pins/unpins and their persistence, the
  responsive ladder (Inspector collapse, panel collapse, labels, arrows), the one-row guarantee, the
  hover/pressed/disabled/selected states, the right-click menu, the secondary row / annotations flyout,
  the Ctrl+K palette reach, and the Inspector's text integration. Every divergence is either FIXED or
  recorded as an operator-approved difference with a reason.

**Success criteria**

1. With ONE document in Multi Mode the thumbnail preview renders inside its page frame at the default
   window and at narrow/wide panes and several zoom levels (measured bounding boxes: the preview's box is
   inside the page's box; a screenshot per case).
2. Clicking the pane's "Open a PDF" in Multi Mode opens the OS file picker (the standard open flow) and the
   chosen document lands in that pane; the pane split and the divider position are UNCHANGED by the click
   (measured before/after). Verified with one and with two documents.
3. With ONE document in Multi Mode the Action Dock renders, and for every stage its verbs are reachable and
   identical to the single-mode set (a per-stage comparison with the single-mode baseline).
4. No control overlaps another: measured bounding boxes for the dock, the thumbnail panel, the rotate
   control, the pills and the Inspector show ZERO intersections in Multi Mode at the default and narrow
   widths, with one and with two documents.
5. The page-rotate (and every other page action) has exactly ONE home, the same one it has in single mode;
   no duplicate or floating page-action control remains anywhere.
6. A single-vs-multi comparison MATRIX is produced for all four stages covering every behaviour listed in
   feature D, with a verdict per row; every divergence is fixed or carries an operator-approved reason.
7. The dock's behaviour is identical in Multi Mode and single mode for the same stage and window width -
   the matrix has zero unexplained divergences.
8. No regression: single mode is unchanged, the Phase 38 criteria still hold (the legibility floors, the
   retired text panel, the edit fidelity, the pane first-fit), and `verify:full` plus the phase suites are
   green.

**Settings impact:** none - no new `AppSettings` field; this is behaviour parity and layout correction.

## Phase 40 — Chrome, dialogs, view modes and a professional design system (14 operator items)

**Operator request (2026-09-25):** the fourteen numbered items below (verbatim intent). This round mixes
concrete faults, three new affordances (a top-bar search icon pair, palette pin toggles, a single-view
page layout), one new capability (merge from scratch) and a design-system pass. The operator also ruled:
**no local install is required any more - they install through OTA** - so the release gate verifies the
PACKAGED build and the operator picks the update up over the air.

**Features**

**A. Multi Mode pill placement (item 1)**
- In Multi Mode the zoom control and the page-number control must be laid out HORIZONTALLY, one on each
  side of the individual canvas they belong to. No dock/pill group may ever be organised vertically at any
  window size - this supersedes the Phase 39 narrow-width stacked band.

**B. Readability and chrome (items 2, 13)**
- The "Open" button's label must be readable WITHOUT hover (its resting state must meet the Phase 38
  contrast floors - measured, not eyeballed).
- The top bar's Open/Save controls must lose their background box in EVERY theme (a borderless/ghost
  treatment that keeps the hover/focus affordance and the contrast floors).

**C. Dialogs (items 3, 4)**
- The "Create from images" window must resize with the application window (a responsive dialog that stays
  usable and inside the window at small and large sizes).
- "Merge PDF" must be startable FROM SCRATCH with no document open: the user selects multiple PDF files in
  one multi-select picker and combines them. This needs a new multi-file open dialog in the main process
  (a new IPC returning the picked paths) - the shared contract is extended for it.

**D. Header and palette affordances (items 5, 6, 8)**
- The top bar gains TWO distinct, intuitive icons: one for the Ctrl+K tool search and one for the Ctrl+F
  search. They must be visually unique from each other and self-explanatory.
- Every tool row in the Ctrl+K palette gains a PIN toggle beside it: clicking pins/unpins that tool, and
  the pin icon reflects the current state (pinned vs unpinned) - it must not be ambiguous.
- The Multi Mode toggle's hover tooltip must say "view/edit two ..." (the word "edit" added).

**E. Single-view page layouts (item 7)**
- The single-view canvas gains a page-layout control at its TOP-RIGHT offering three options: One page
  (the default), Two pages side by side, and Four pages in two rows. The chosen layout renders that many
  pages of the document at a time, with the icon reflecting the current layout.

**F. Retirements and panel layout (items 9, 10)**
- The page rotate/delete control that appears UNDER the page thumbnail when a page is selected is RETIRED
  in BOTH single and multi mode. The capabilities stay reachable through their other homes (the dock verbs
  and the page right-click menu) - no capability may lose its home.
- The Outline section must be flush to the bottom of the panel when EXPANDED as well (not only collapsed).

**G. Professional design system (items 11, 12)**
- Replace the ad-hoc per-family icon hues with a small, SEMANTIC palette: three to four set colours
  assigned by tool category/importance, applied consistently to icons and to application text. Colour is
  used methodically for separating lines and panel edges (not decoration), so the UI reads professional.
- The ContextPanel and the Inspector are the reference standard for organisation and typography; bring the
  other surfaces (the dock, the palette, the panels, the dialogs) to that standard of organisation.
- Research industry-standard practice where it helps; the outcome must be measurable (the palette is a
  named, finite token set; the contrast floors still hold in all three themes).

**Success criteria**

1. In Multi Mode the page and zoom controls render HORIZONTALLY, one on each side of their own canvas, at
   every supported window width (640 through 1920, one and two documents) - measured: the two controls'
   boxes are side by side, not stacked, and intersect nothing.
2. The "Open" button's resting label meets at least 4.5:1 against its real surface in all three themes
   (measured, with the failing ratio named if any).
3. The top bar's Open/Save controls have no background box in light, dark or frosted (measured: no
   background fill/border on the resting state), while their hover/focus affordance and contrast floors
   survive.
4. The "Create from images" dialog resizes with the window: at a small window it fits inside the viewport
   with no clipped control, and at a large window it uses the space (measured boxes + screenshots).
5. Merge PDF can be started with NO document open: the multi-select picker returns several files and the
   merge produces a combined document (report the picked paths and the resulting page count).
6. The top bar shows two distinct search icons (Ctrl+K and Ctrl+F); they are visually different from each
   other, each has an accessible name, and each activates its own surface (measured + screenshot).
7. Every Ctrl+K palette row has a pin toggle: clicking it pins the tool, clicking again unpins it, the icon
   changes with the state, and the pin persists across a restart (the existing pins store).
8. The Multi Mode toggle's tooltip reads "view/edit two ..." (the word "edit" present).
9. The single-view page-layout control offers exactly three options (one page, two side by side, four in
   two rows) and each renders that layout; one page is the default; the icon reflects the current layout.
10. The under-thumbnail rotate/delete control is GONE in both single and multi mode (DOM assertion), while
    rotate and delete remain reachable from the dock and the page right-click menu (verified by running
    them).
11. The Outline is flush with the panel's bottom in the EXPANDED state as well as collapsed (measured
    bottom offsets).
12. The icon/text palette is a named, finite set of three to four semantic colours assigned by category or
    importance, applied consistently to icons and text in all three themes, with the contrast floors still
    met (report the palette and the measured ratios).
13. Separators and panel edges use colour methodically (a stated rule), not decoration; the other surfaces
    match the ContextPanel/Inspector standard of organisation (screenshots per surface).
14. No regression: single mode, the Phase 36/37/38/39 behaviours (the dock ladder, the legibility floors,
    the retired text panel, edit fidelity, the pane fit and the Multi Mode parity) all still hold, and
    `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field. The page-layout choice (item 7) is a per-tab,
session-scoped view state, not a persisted preference; the palette pin toggles reuse the existing
`dockPins`. The ONE shared-contract change is a new multi-file open dialog IPC (item 4):
`openFilesDialog(kind?: OpenFileDialogKind): Promise<string[]>` - the main-process handler uses
`properties: ['openFile', 'multiSelections']` and returns the picked paths (an empty array on cancel).

## Phase 41 — Inspector surface, the legacy EDIT toolbar, selection styling and separators (4 operator items)

**Operator request (2026-09-26):** the four numbered items below (verbatim intent). All four are
refinements of the Phase 36-40 chrome; the design language, the four-role palette and every behaviour stay,
except where an item explicitly supersedes a rule.

**Features**

**A. The Inspector must be opaque and never overlapped (item 1)**
- In EDIT mode the Inspector renders with the SAME surface treatment as every other stage - no
  transparency - and no canvas content (page text, overlays, edit layers) may render behind or through it.
  The z-order and any clipping that lets content bleed over the panel are fixed.

**B. Retire the legacy EDIT toolbar (item 2)**
- The edit-mode toolbar at the top of the canvas is RETIRED. Before it goes, EVERY control it offers is
  audited and given a home in the dock, the Inspector or the Ctrl+K palette; anything without a home gets
  one first. No capability may be lost, and each must be reachable with a document open in EDIT.

**C. Professional selection styling (item 3)**
- The selected option in the text-manipulation panel's align/spacing controls, and the selected page in the
  thumbnail panel, get a professional selection treatment instead of the current blue highlight: a
  consistent, low-saturation selection style (a tinted fill with a border/glow and the accent reserved for
  the glyph), identical in geometry and timing across themes, meeting the contrast floors.

**D. Separators and the Inspector edge (item 4)**
- A separator line is added between the side rail and the ContextPanel.
- The BLUE line on the Inspector's edge is removed and replaced by a shadow/subtle glow separator. This
  supersedes the Phase 40 rule "the active panel edge takes `--sem-primary`" - the active/selected state is
  conveyed by the shadow/glow instead.

**Success criteria**

1. In EDIT the Inspector's computed background is opaque and of the same kind as the other stages (report
   the computed background per stage); a sample of the region across its edge in EDIT shows no canvas text
   or overlay bleeding through (screenshot with text hard against the panel).
2. No canvas content renders behind the Inspector in ANY stage (measured z-order/stacking plus a
   screenshot per stage).
3. The legacy edit toolbar is absent from the DOM in EDIT (assertion), and EVERY control it offered is
   accounted for in an audit table (control -> new home -> the proof it still runs); nothing is
   unreachable.
4. The text panel's selected align/spacing option and the thumbnail's selected page use the new treatment:
   no raw blue fill (measured computed styles), the same selection token in all three themes, and the
   contrast floors still met.
5. A 1px neutral separator exists between the side rail and the ContextPanel (measured; no gap and no
   overlap at 1440 and 900).
6. The Inspector's page-facing edge shows a shadow/subtle glow rather than the accent line (measured: no
   accent colour on the edge; the glow present), and an active selection is still visually distinguishable.
7. No regression: the Phase 36-40 behaviours (the dock ladder, the legibility floors, the retired text
   panel and edit-toolbar behaviour, the pane fit, the Multi Mode parity, the page layouts) all still hold,
   and `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field; this is surface styling, a retirement and an audit.

## Phase 42 — Tool icon identity and one home per tool (2 operator items)

**Operator request (2026-09-26):** the two items below (verbatim intent). The tool registry must give every
tool its OWN icon, and a tool must live in exactly one stage's dock.

**Features**

**A. One icon per tool (item 1)**
- No two registry entries may share an icon: every tool gets its own distinct, descriptive icon, so a user
  can tell two tools apart by their glyph alone. Every existing duplicate is found and fixed - not just the
  reported watermark/edit-text pair - and the invariant is enforced by a test so it can never regress.

**B. One home per tool (item 2)**
- The watermark tool currently appears in BOTH the EDIT and the REVIEW dock. It must appear in exactly ONE
  stage's dock (the stage the registry designates), must no longer leak into the other, and must stay
  reachable through the Ctrl+K palette. No capability may be lost.

**Success criteria**

1. An automated assertion over the tool registry reports ZERO duplicate icons (report the before state: the
   duplicate groups found, and the after state: the count of entries vs the count of distinct icons).
2. Every fixed duplicate receives a distinct icon that describes its tool; report id -> old icon -> new icon
   for each, and confirm each renders at the standard glyph size with the corrected contrast floors.
3. The watermark tool appears in exactly ONE stage's dock; report which stage, and the measured per-stage
   dock verb lists showing watermark present exactly once across PAGES/EDIT/REVIEW/DELIVER.
4. The watermark capability is not lost: it is reachable from the Ctrl+K palette and RUNS from there
   (verified by running it, not by reading the registry).
5. No other tool lost or gained a home: the registry x surfaces sweep still accounts for every entry, and
   every other stage's dock set is unchanged unless the item required it (report any change).
6. No regression: the dock's one-row/ladder behaviour, the Phase 41 styling and the earlier phases all hold,
   and `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field; this is registry data (icons) and one stage mapping.

## Phase 43 — Animation completeness and app-wide icon identity (2 operator items)

**Operator request (2026-09-26):** the two items below (verbatim intent). The Phase 15 animation system is
the contract for item 1 ("every element should have animation"); the Phase 42 uniqueness rule is extended
app-wide by item 2.

**Features**

**A. Animation completeness (item 1)**
- The single-view page-layout transition (one <-> two <-> four pages) must ANIMATE through the centralised
  motion system - the page slots move/fade with the layout change instead of snapping - respecting
  `prefers-reduced-motion` (immediate switch) and the Phase 15 rule that PDF page CONTENT is never
  recoloured or cross-faded (the layout/box animates, the page's own pixels do not).
- A full AUDIT of the application finds every element that lacks an animation and fixes it: every
  interactive surface (dialogs, popovers/menus, the palette, the dock, the panels/rail, the tabs, the
  flyout, the pills, the toasts, the context menus, the thumbnail selection, the layout control, the
  collapse/expand controls) must use a motion token - no hardcoded durations/easings - or carry a stated
  reason it must not animate.

**B. No two elements share an icon (item 2)**
- The Multi Mode toggle and the two-page layout option currently share the same icon. No two elements of
  DIFFERENT actions may share an icon anywhere in the app - not just in the tool registry. One universal
  action repeated verbatim (the close affordance) counts as ONE action; everything else gets its own glyph.
- The uniqueness invariant is extended to cover the app's icon usages (registry + header controls + the
  layout control + the dock/palette/panels/dialogs/pills) so it cannot regress.

**Success criteria**

1. Switching the page layout (one/two/four) animates: frame capture shows a transition on the page slots
   using the motion tokens (report the token, the duration and the captured frames); with reduced motion
   enabled the switch is immediate; the page CONTENT's pixels are not recoloured during the transition.
2. An animation audit table is produced listing every interactive surface/element, its animation and the
   token used - and every entry is either token-animated or carries a one-line reason it must stay static
   (the table is part of the report; keep it where the team can read it).
3. Every element the audit found without animation is fixed, with the token named per element.
4. No two DIFFERENT actions share an icon anywhere in the app: the Multi Mode toggle and the two-page layout
   option are distinct, and a sweep of all icon usages finds no other duplicate (report the before/after
   duplicate list; an automated assertion covers it so it cannot regress).
5. The changed/new icons render at the standard sizes with the contrast floors met in all three themes, and
   each still describes its control.
6. No regression: the Phase 15 motion rules (tokens only, identical timing across themes, transform/opacity
   only, reduced-motion fallback, PDF content protected), the Phase 42 registry invariant, and the earlier
   phases all hold; `verify:full` plus the phase suites are green.

**Settings impact:** none - no new `AppSettings` field; motion tokens are CSS/JS constants, and the icon
change is presentational.

## Standing standards (operator rulings, apply to every phase from now on)

**Animation - HARD RULE (operator, 2026-09-26).** Every element that appears, disappears, moves, changes
state or responds to input must animate through the CENTRALISED motion system: `src/renderer/hooks/motionTokens.ts`
plus the `src/renderer/styles/animations.css` tokens and the `AnimatedDialog`/`AnimatedPanel`/`AnimatedTab`
wrappers. No hardcoded durations or easings; transform/opacity only (never width/height/margin); identical
timing in light, dark and frosted; a `prefers-reduced-motion` fallback; and PDF page content is never
recoloured or cross-faded. Every phase that adds or changes a surface must state that surface's animation
and the token it uses, and the animation guard test must cover it. A new or changed element with no
token-based animation is a DEFECT, not a polish item.

**Icon identity (operator, 2026-09-26).** No two elements of different actions may share an icon anywhere in
the app. One universal action repeated verbatim (the close affordance) counts as one action; the same action
mirrored on two surfaces is allowed and must be allow-listed with a written reason. The icon guard test must
cover every surface.

**Test discipline (operator, 2026-09-26).** Targeted tests per change; the full suite only at a release gate
or when the human explicitly asks. Do not run the full suite "to be safe".

**To-do discipline (operator, 2026-09-26).** The orchestrator maintains a live to-do list for the run and
reports pending / in-progress / done in every dispatch summary.

**Version numbering - STANDING RULE (operator, 2026-09-27).** A release of BUG FIXES takes a **PATCH** bump
(1.39.0 -> 1.39.1). A **MINOR** bump is for new features/capabilities. A **MAJOR** bump is only for a breaking
change. Never bump a minor for a fix batch. (The operator corrected 1.39.0 -> 1.40.0, which should have been
1.39.1.)

## Phase 44 — Accounts and cloud sync on Neon (operator request 2026-09-26)

**Operator request (verbatim intent):** the app gets a **Sign in / Sign up** option on the top bar; users can
register or sign in with **email or Google**; **email registration requires verification**; registered users
are stored in **Neon**; the account also stores the user's **app settings and signatures** so that signing in
on any device restores them; **account deletion and data export** are included; the whole feature ships
**behind a flag** until battle-tested; **OTA stays on GitHub** (this database is NOT used for updates).
Operator rulings that shape it: the Neon project is `twilight-tooth-46220295` ("RealTflex", `aws-ap-southeast-1`),
the email sender is Neon's **shared** provider, and the free **0.5 GB** storage limit must be respected.

**SUPERSESSION (recorded deliberately).** The v1 contract says "No network calls in product code. v1 is fully
offline." Phase 44 deliberately supersedes that for the accounts and sync paths ONLY: the app must remain
fully usable **offline and signed-out**, with local data authoritative while signed out, and every network
path must degrade gracefully (never block the UI, never lose local work).

**Prerequisites that are NOT code (see "Unowned paths" below) - both are required before implementation can
land:**
- **P1 - the conventions gate must be amended.** `scripts/check-conventions.mjs` scans `src/` and fails on
  `fetch(`, `XMLHttpRequest`, `http/https/net/dns` imports and ANY non-localhost URL literal, so the accounts
  transport cannot exist in `src/` under the current rule. The amendment is NARROW: keep the rule for
  everything, add an explicit allowlist naming the ONE accounts/sync module path (e.g.
  `src/main/services/accounts/**`) and the permitted hosts (`*.neon.tech` only), with the reason recorded in
  the script. No other file and no other host becomes permitted; the check must still fail for a network call
  anywhere else.
- **P2 - the Neon infrastructure files** (`neon.ts` body, the Function source) live at the repo root and are
  writable by no role today. They are needed only for the Neon FUNCTION and the declared-bucket wiring; Auth,
  the Data API, the schema, RLS and the `tflex` bucket are already live, so the accounts/sync feature does NOT
  depend on P2.

**Features**

**A. The account section in the top bar (operator amendment, 2026-09-27).** The top-RIGHT of the top bar
carries the account, properly:
- **Signed out:** a sign-in entry that opens the sign-in / sign-up surface (email + password, **Continue with
  Google**).
- **Signed in:** a **round avatar** control. It shows the user's profile IMAGE when one is set; otherwise it
  shows their **INITIALS** (first name + last name; a single name yields one letter; with no name at all it
  falls back to the first letter of the email). It carries an accessible name (the user's name, else the
  email).
- **Clicking it EXPANDS a panel** anchored to the avatar showing the user's profile (avatar, name, email) and
  offering **Update profile** and **Sign out** (plus **Sync now** and the live sync status). **Update
  profile** opens a form for the fields the identity provider actually allows the user to change (the
  Managed provider permits the display name; it does NOT permit changing the email or password - the UI must
  state that rather than offering a control that cannot work).
- **There is NO beta toggle.** Accounts are simply ON: the `accountsEnabled` setting remains an internal
  escape hatch with a default of true, but it is NOT exposed as a Preferences row (the operator removed
  that), so the account section is always present.
Everything obeys the standing animation and icon rules.

**B. Email verification.** A registration with email must be verified with the **OTP code** Neon emails
(Neon's shared sender; production may move to custom SMTP later). The UI must handle: code sent, wrong code,
expired code, resend, and the verified-signed-in state.

**C. Settings sync.** The signed-in user's app settings are stored in `public.user_settings` (one row per user,
JSONB) and restored on any device. **Device-local fields are EXCLUDED** and never synced: window geometry, the
recent-files list, and any path-bearing field. Conflict rule: **last-write-wins per record** on `updated_at`
with a `revision` counter; the FIRST link of a device to an existing account makes the **cloud authoritative**,
after which the newest write wins. Sync is debounced and must never block or slow the UI.

**D. Signature sync.** The user's signatures live in `public.user_signatures` (metadata: label, kind
`drawn|typed|image`, payload for vector/typed data, `storage_key` for images) with the **image bytes in the
private `tflex` bucket**, never base64 in the database. Deletes are SOFT (`deleted_at`) so a second device
converges.

**E. Storage discipline (the operator's 0.5 GB cap).** Settings stay a few KB per user; signature images go to
the bucket; per-signature and per-user caps are enforced in the app so a user cannot fill the branch limit;
no counters, logs or analytics tables are added.

**F. Offline and signed-out behaviour.** No network call on startup; the app never waits on the network to
become usable; a failed sync surfaces a non-blocking message and retries later; signing out leaves all local
data intact.

**G. Security.** The **JWT is the only credential** the app holds; it is stored with Electron `safeStorage`,
never in `settings.json`, never logged, never committed. The **Data API's RLS is the per-row boundary**
(`auth.user_id() = user_id`) with `authenticated`-role grants and NO `anonymous` privileges; the app must never
be trusted to filter rows. The client secret exists only in Neon's server-side config.

**H. Flag, deletion and export.** The whole feature is hidden behind an `AppSettings` flag (default OFF) until
battle-tested. **Delete my account** erases the user's `user_settings` row, their signatures and their bucket
objects, then the auth user. **Export my data** writes a JSON (plus the images) the user chooses a location for.

**Success criteria**

1. With the flag OFF, no account surface is reachable anywhere and the app behaves exactly as today (verified
   by the existing suites plus a targeted assertion).
2. With the flag ON, the top bar offers Sign in / Sign up; email registration sends an OTP; entering the code
   verifies and signs the user in; a wrong or expired code shows a clear, non-blocking error; resend works.
3. Google sign-in completes on a real machine through the system browser and returns to the app signed in
   (the redirect URI `https://ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google`
   is registered in the operator's Google project).
4. Signing in on a second device (or a fresh profile) restores that user's settings and signatures.
5. Device-local fields (window geometry, recent files, paths) are NEVER overwritten by a sync (verified by
   syncing after locally moving/resizing the window and reopening a file).
6. Two devices editing settings resolve by last-write-wins on `updated_at`, with no data loss of the newer
   write.
7. Signature images land in the `tflex` bucket and the database holds only metadata (verified by inspecting
   both); a soft-deleted signature disappears on the other device after a sync.
8. Signing out restores local-only behaviour with all local data intact; sync failures never block the UI
   (verified with the network unreachable).
9. The JWT is never in `settings.json`, never in a log, never in the repo (grep assertion + a manual check of
   the storage location).
10. **Adversarial: a signed-in user cannot read or write another user's rows or objects** - attempts through
    the Data API and the bucket are denied by RLS/policies, and the attempt is recorded as a release blocker
    if it succeeds.
11. Delete my account removes the rows, the signature objects and the auth user (verified from the Neon side).
12. Export my data produces a readable JSON plus images at the user's chosen location.
13. Sync is debounced and small: the measured payload per sync and the row sizes are reported, and the
    projected per-user storage stays far below the 0.5 GB branch limit.
14. No regression: the standing standards (animation, icon identity), the earlier phases and `verify:full`
    all stay green; the measured startup time is unchanged with the flag both off and on.

**Settings impact:** three new `AppSettings` fields, all validated in `src/main/services/settings.ts`
(preserve-if-valid, reject-if-invalid) before any renderer reads them: `accountsEnabled?: boolean` (default
false - the feature flag), `syncDeviceId?: string` (a generated install id used for conflict notes; non-empty
string, capped length) and `lastSyncedAt?: string` (an ISO timestamp for display only). **The session/JWT is
NOT a settings field** - it is stored via Electron `safeStorage` in the main process.

## Phase 45 — Account surface rebuild + seven UI corrections (operator report, 2026-09-27)

**Operator report (verbatim intent).** The account surface "is too barebone and looks totally disjointed from
the app", has "empty spaces on the right for no reason", no Google icon, no forgot-password option, and it
DOES NOT WORK: "Clicking continue with google or email returns 'You appear to be offline. Check your
connection and try again.'" Plus seven numbered UI defects. The operator's standing demand: **do not ship
half-done surfaces.**

**ROOT CAUSE OF THE BROKEN DIALOG (diagnosed, not guessed):** `src/renderer/index.html` sets
`connect-src 'self' blob: data:`, so the renderer is FORBIDDEN from making ANY network request. The Neon auth
SDK's call is blocked by the CSP and the failure surfaces as a false "offline" error. Phase 44 added the
Google avatar host to `img-src` but never touched `connect-src`.

**Features**

**A. The account surface, rebuilt (operator complaint).**
- **The CSP must permit the app's own backend hosts**, narrowly: `connect-src` gains the provider domain
  (e.g. `https://*.neon.tech` - one trusted provider, which covers the auth host, the Data API host and the
  Function host on every branch). Nothing else is opened, and the reason is commented in place.
- **The surface must look like part of TFlex**, not a bare form: a branded header, a purposeful layout with
  **no dead space**, sensible widths/heights, the app's own controls and spacing, and the standing animation
  and icon rules.
- **A real Google button** with the Google mark (not a text-only button), and a **Forgot password?** flow
  (request a reset + complete it).
- Correct, honest states: loading, wrong credentials, unverified email, the OTP step, and "offline" ONLY when
  the app is actually offline.

**B. Create from images: the clipboard and the preview (item 1).** "Create from clipboard" must accept a
COPIED IMAGE and must NOT treat plain text as an image; the image preview must render inside that dialog.

**C. Distinct tab colours (item 2).** Each open document tab carries its own colour, visibly distinct from
its neighbours (in every theme).

**D. The Multi Mode activation animation (item 3).** Entering and leaving Multi Mode animates through the
centralised motion system (it currently does not).

**E. The EDIT dock highlight (item 4).** With "Edit mode off" active, NO other edit verb may appear selected;
and "Edit mode off" sits at the FAR LEFT of the edit group.

**F. The thumbnail/Undo overlap (item 5).** The first page preview must not overlap the "Undo last change"
control.

**G. Dialog proportions (item 6).** Tool windows (Watermark and the other long ones) are too tall: make the
dialogs as SQUARE as practical and re-lay out their contents to fit the new shape.

**H. Watermark custom position (item 7).** The Watermark dialog gains a tick for a CUSTOM X/Y position;
ticking it DISABLES the predefined position choices.

**Success criteria**

1. With the app online, email sign-in and Google sign-in both COMPLETE (no false offline error) - verified on
   a real machine with a real account; the CSP change is limited to the provider domain and the reason is
   commented.
2. The account surface matches the app's design language: branded, no dead space (measured: the panel's
   content fills its box at 1440 and at the minimum window), with a Google button carrying the Google mark
   and a working Forgot-password flow.
3. The states are honest: a wrong password says so, an unverified account says so, the OTP step works, and
   "offline" appears only when the app is genuinely offline (verified by blocking the network).
4. "Create from clipboard" inserts a copied IMAGE (verified with a real clipboard image) and refuses plain
   text with a clear message; the image preview renders in that dialog.
5. Every open tab has a distinct colour; two adjacent tabs are always visually distinguishable in all three
   themes.
6. Entering and leaving Multi Mode animates (frame capture), token-driven, reduced-motion safe.
7. In EDIT, selecting "Edit mode off" leaves no other edit verb looking selected, and it is the LEFTMOST verb.
8. The first thumbnail's preview does not intersect "Undo last change" (measured boxes, zero intersection).
9. The named long dialogs are re-shaped to a squarer box (report each dialog's before/after aspect ratio) and
   every control still fits with no clipping or scrolling loss.
10. The Watermark dialog's custom tick disables the predefined positions while ticked and restores them when
    unticked, and the chosen X/Y are applied to the produced watermark.
11. No regression: the standing standards (animation, icon identity), the console gate, and `verify:full`
    plus the phase suites stay green.

**Settings impact:** none - no new `AppSettings` field; the dialog shapes, the tab colours and the watermark
position toggle are view state, not preferences.

## Phase 48 - Deleted signatures must actually leave the cloud + three annotation corrections

**Operator report (verbatim intent, 2026-09-27).**
1. "After the initial sync, if I delete signatures and sync again, it doesn't delete them in the neon
   user_signature table. The table still contains the previous signatures. Check why are those signatures
   still kept in the table when it syncs correctly in the app."
2. **PROCESS RULE (standing):** "For bug fixes, never bump like major update like 1.39.0 to 1.40.0, it
   should have been 1.39.1."
3. "Adding rectangle under annotation shows the delete icon outside of the view. See if it is widespread."
4. "Placing text/comments brings the comment popup with it. Comment dialog box should only appear if user
   selects the annotation later like rectangle."

**Features**

**A. A deleted signature must leave the cloud (item 1).**
- Deleting a signature locally and syncing must remove it from `public.user_signatures` - the row must not
  linger. The sync must keep working in both directions (a delete on one device must not be resurrected by a
  stale pull from another), so the fix must state HOW convergence is preserved now that rows are actually
  removed.

**B. Version numbering rule (item 2) - STANDING.**
- Bug fixes take a **PATCH** bump (1.39.0 -> 1.39.1); a MINOR bump is for new features/capabilities; a MAJOR
  bump only for a breaking change. This release's work is a set of fixes, so it ships as the next PATCH.

**C. No annotation control may render outside the view (item 3).**
- The operator saw a rectangle annotation's delete control positioned outside the visible area. Audit EVERY
  annotation type and control (rectangle, ellipse, arrow, highlight, ink, text box, comment/note, stamp,
  signature, image, and the box/text property bars): with the annotation at any page edge and at any zoom,
  every control must stay inside the visible canvas/viewport, clamped (the codebase already has a clamp
  pattern for panels - reuse it). Report the audit table and fix each offender.

**D. The comment box opens on SELECTION, not on creation (item 4).**
- Placing text or a comment must NOT immediately open the comment dialog: the annotation is created, and the
  comment box appears only when the user later SELECTS that annotation - the same behaviour a rectangle has.

**Success criteria**

1. Delete a signature locally -> sync -> the row is GONE from `public.user_signatures` (verified by querying
   the table before/after, and the app's own list agrees). A second device that syncs afterwards does NOT
   resurrect it.
2. The release carrying these fixes uses a PATCH version bump (state the version), and the rule is recorded
   in the standing standards.
3. An audit table lists every annotation type x control with its position at the page's four edges and at
   several zoom levels; every control stays inside the visible area (measured boxes, zero out-of-view
   offenders) - before/after per fixed offender.
4. Placing text/comment creates the annotation WITHOUT opening the comment box; selecting it afterwards opens
   the box (verified for both text and comment); a rectangle behaves as before; and the action bar (Confirm/
   Delete/Cancel) still appears on creation as it does for other annotations.
5. No regression: the earlier annotation behaviour, the standing animation/icon rules, `verify:full` and the
   phase suites stay green.

**Settings impact:** none - no new `AppSettings` field; the delete policy and the annotation behaviours are
code behaviour, not preferences.

## Phase 49 - Rebrand: the product is JOVREL (the project stays TFlex)

**Operator request (2026-09-27, verbatim intent):** "The Final product name for this pdf app is Jovrel. TFlex is
still our project name. Make necessary changes accordingly." The brand assets live in the operator's
`jovrel-brand` folder (a blue squircle with a white triple-stroke **J**, `#60A5FA -> #1E3A8A`; a wordmark in
two background variants; a PDF file-type icon; the app `.ico`). They have been placed as:
`assets/brand/` (SHIPPED: `jovrel.ico`, `jovrel-pdf.ico`, the mark PNGs + SVG, the PDF-file PNGs + SVG, both
wordmark PNGs) and `docs/brand/website/` (NOT shipped: `favicon.ico`, the preview sheet) - the repo's app
assets go under `assets/`, website artwork is documentation.

**THE SPLIT (both halves are contract):**
- **JOVREL is the PRODUCT**: everything a user SEES or a Windows surface reads.
- **TFlex stays the PROJECT**: the repository name, the npm package name `tflex`, the `tflex` config block and
  its keys, the `TFlexApi`/`tflex:` IPC identifiers, the source layout, the docs, the agent tooling - all
  unchanged. `tflex-releases` (the OTA releases repo) also stays: renaming it would break the updater and the
  published feed.

**Features**

**A. Packaging (backend-dev).**
- `productName: Jovrel`; the app icon and the installer/uninstaller icons from `assets/brand/jovrel.ico`; the
  `.pdf` association gets `jovrel-pdf.ico` as its per-extension icon, the ProgID becomes `Jovrel.pdf` and its
  description names Jovrel.
- Artifact names become `Jovrel-Setup-${version}-${arch}.${ext}` and `Jovrel-${version}-portable-${arch}.${ext}`
  (the release procedure, the OTA upload list and the e2e asset checks all follow).
- **`appId` STAYS `com.tflex.app`** (an internal identity): it keeps the NSIS upgrade GUID, so the installer
  properly replaces an existing TFlex install instead of creating a second one. Say so in the config comment.
- **The userData directory MUST be migrated**: with the product name changed, Electron's userData path moves
  from `%APPDATA%\tflex` to `%APPDATA%\Jovrel`; on first run, if the new directory has no
  settings, COPY the operator's existing per-user state across (settings.json, the signature store and its
  images, the encrypted session) - one-time, idempotent, never destructive (the old directory is left alone).
  Report exactly what you migrate and how it is gated.
- The PDF metadata the app writes (Producer/Creator) becomes Jovrel; the window title, the print window's
  title and the menus read Jovrel.

**B. In-app branding (frontend-dev).**
- The brand MARK and WORDMARK are implemented as INLINE React SVG components built from `assets/brand/jovrel-mark.svg`
  (exact geometry and the `#60A5FA -> #1E3A8A` gradient) - not as file references, so the packaged app cannot
  lose them. Where the dark/light wordmark variants differ, pick per theme (the mark itself is
  gradient-on-transparent and safe on both).
- Apply them: the title bar (replacing the current TFlex wordmark treatment), the Welcome/home screen, the
  About dialog, the account sheet header, and the print window. Any user-visible "TFlex" string in those
  surfaces becomes "Jovrel". Do NOT touch internal identifiers, IPC names, the config keys, or historical
  What's New entries.

**C. Pipeline + verification (qa + git-agent).**
- The release procedure, the four-asset upload list, the canonical installed spec's paths
  (`C:\Program Files\Jovrel\...`) and any e2e that asserts the product name or artifact names are updated.

**Success criteria**

1. The installed product is Jovrel: `C:\Program Files\Jovrel\Jovrel.exe`, an ARP entry named Jovrel, Start-menu
   and desktop shortcuts named Jovrel, and an Explorer `.pdf` association whose ProgID is `Jovrel.pdf` with the
   Jovrel PDF icon (report the measured paths and the registry values).
2. Upgrading an existing TFlex install replaces it in place (the same appId/GUID) rather than adding a second
   product - verified by the install gate.
3. The user's existing per-user state survives the rename: after first launch of the Jovrel build, the previous
   settings, signatures and session are present (report the migration evidence, including that the old
   directory was left intact).
4. The window title, the About dialog, the Welcome screen, the title-bar wordmark, the account sheet and the
   print window all show Jovrel with the brand mark; no user-visible "TFlex" remains in those surfaces
   (a grep-based assertion plus screenshots).
5. The mark renders correctly in all three themes (light/dark/frosted) and at the small sizes used in the
   title bar (state the sizes).
6. PDFs produced by the app carry Jovrel in their metadata (Producer/Creator), verified by reading the
   produced file's info dictionary.
7. The brand assets are committed in `assets/brand/` (shipped) with the website set in `docs/brand/website/`
   (not shipped, not referenced by the app).
8. No regression: the standing animation/icon rules and `verify:full` plus the phase suites stay green; the
   release ships as a MINOR bump (a product identity change, not a fix).

**Settings impact:** none - no new `AppSettings` field. The userData MIGRATION is a path-level one-time move of
existing files, not a settings-shape change.

## Phase 50 - Sign in from the BROWSER, and a "set as default PDF app" affordance

**Operator request (2026-09-28, verbatim intent):** "d of pop up login window, have the user login from
browser." i.e. instead of an in-app popup window, Google sign-in must open in the user's DEFAULT BROWSER and
complete there, returning the user to the app already signed in.

**Features**

**A. Browser-based sign-in (replaces the in-app popup).**
- Clicking **Continue with Google** opens the provider URL in the OPERATING SYSTEM'S DEFAULT BROWSER (not an
  in-app popup/child window). The user completes Google in their own browser, the browser lands on the app's
  loopback return address, and the app finishes the sign-in in the background (it already captures the
  verifier and completes the exchange) - so the user comes back to an app that is signed in.
- The in-app copy must say so: the sign-in surface tells the user the browser was opened and to finish there;
  the loopback page tells them they can close the browser tab and return to the app.
- The URL opened externally must be VALIDATED (only the configured auth host over https) - the app must never
  hand an arbitrary URL to the OS.
- The existing deny-by-default popup rule stays (it is a security net); the auth flow simply no longer needs
  the popup.

**B. Set as the default PDF app (the icon affordance).**
- The app gains a clear affordance (e.g. in Preferences or About) that opens Windows' Default-apps settings so
  the user can make Jovrel the default PDF handler - which is what makes Explorer show the Jovrel icon and
  type name. The app must state WHY (Windows does not let an installer do it silently), and must not claim it
  changed the default itself.

**Success criteria**

1. Continue with Google opens the provider in the default browser (verify the URL was handed to the OS, and
   that no in-app popup window is created), and the flow completes: the browser lands on the loopback, the app
   signs in and shows the account with the real name/avatar.
2. The URL handed to the OS is validated: an auth-host https URL is opened; any other URL (another host,
   http, malformed) is REFUSED and reported, with a test for each case.
3. The user-facing copy in the sign-in surface and on the loopback page names the browser (not "the window"),
   and the app is usable while the browser is open (no modal block).
4. A visible affordance opens Windows' Default-apps settings (verified: the OS call is made; the app does not
   claim to have changed the default) and explains that Jovrel must be chosen there for the PDF icon/type.
5. No regression: the sign-in error surfacing, the verifier handling (single-use, never logged), the leak-free
   diagnostics, the standing animation/icon rules, `verify:full` and the phase suites stay green.

**Settings impact:** none - no new `AppSettings` field; both changes are behaviour and an OS call.

## Phase 51 - Sign-in completion, automatic sync, and the annotation/OCR correction round (16 operator items)

**Operator report (verbatim intent, 2026-09-28):** the sixteen numbered items below. TWO of them (3 and 4) are
RE-REPORTS of things previously claimed fixed - they are treated as regressions until proven otherwise, and
the fixes must be verified from the operator's own viewpoint (their screenshots), not from our assertions.

**Features**

**A. Google sign-in completion (item 1).** The browser flow now fails at the session lookup:
`HTTP 400 Session challenge cookie not found ... cookies=__Secure-neon-auth.session_challange,
__Secure-neon-auth.session_challenge verifier=present`. The app must present the challenge the provider
requires: investigate the cookie attributes (name spelling, domain, PATH, sameSite, expiry) in the app's own
session against what the provider's route expects, and make the exchange succeed. If the provider's
cookie-based challenge makes the external-browser flow impossible, SAY SO with the evidence and recommend the
mechanism that does work (the in-app window completed in the app's own session, which is where the challenge
lives) - the operator decides between UX and a working sign-in.

**B. Automatic sync (item 2).** Syncing must happen automatically: on sign-in, after adding or deleting a
signature, and after any settings change - not only on demand. The manual control stays as a BACKUP (a sync
icon/button), and the live status makes clear when a sync is running/finished.

**C. The thumbnail / Undo overlap (item 3, re-report).** The first thumbnail's selection border still overlaps
behind the "Undo last change" bar. Fix it so nothing of the thumbnail (including its selection ring) intrudes
into the Undo row, at the panel's normal and narrow widths - and verify it in the running app the way the
operator saw it.

**D. The rectangle's delete control clipping (item 4, re-report).** In the context panel, a rectangle's delete
icon still renders outside/at the edge. Fix it, and AUDIT the same class across every context-panel row type
(annotation rows, stamp, signature, text, image) so no control can be clipped - with measured boxes.

**E. Bright tab colours (item 5).** The PDF tab colours read as a pale wash of the original colour. Make them
BRIGHT (the full-strength colour), while keeping the active/inactive distinction and the text contrast floors.

**F. Edit-text behaviour (items 6, 7, 12, 13, 14, 15, 16).** One coherent area with seven faults:
- selecting text in the canvas must ARM/FOCUS the Inspector's Text field (item 6) and the text must be
  editable in BOTH the canvas box and the Inspector field (item 12);
- the selection must LOOK selected (item 7);
- dragging must move the text (not just the blue box) and must not leave a ghost (items 7, 15: moving twice
  shows the text duplicated at the original position);
- Confirm must not create a duplicate text (item 7);
- applying a format (Bold/Italic) after moving must NOT move the box back to its original position (item 13);
- with no text box selected, no formatting control may look active (item 14);
- superscript/subscript must not show a second copy of the text behind the box (item 16).
The "Add a text box" tool already had several of these fixed - mirror that behaviour for the text-run editing
path.

**G. OCR (items 9, 10).** Cancelling an OCR scan must actually stop it; and the OCR suspects panel must be
moved OUT of the context panel INTO the Inspector with proper formatting (the operator's screenshot shows a
scattered, overlapping layout) - the context panel is reorganised accordingly.

**H. Text boxes' border style (item 11).** Every text box uses a thicker border with ROUNDED corners (not a
thin blue line). Applies to all text boxes (canvas boxes, text annotations, comments).

**I. Opening a PDF fails (item 8).** `C:\Users\tanzi\OneDrive\Desktop\Parent visa\956.pdf` fails to open. The
error dialog shows `([object Object])` - the error text is being stringified wrongly, which must be fixed in
the same pass so any future failure is readable. Root-cause the open failure on that file (a real-world PDF).

**Success criteria**

1. Google sign-in completes from the operator's own attempt (or, if the mechanism cannot work in the browser,
   the app uses the mechanism that does and the decision is recorded) - and the failure text, if any, names
   the exact step/status/cookies.
2. Syncs happen automatically on sign-in, on signature add/delete and on a settings change (verified by
   observing the network/sync status without touching the manual control), the manual control still works, and
   the status is truthful.
3. The first thumbnail's selection border does not overlap the Undo row at any panel width (measured boxes,
   zero intersection) - verified in the running app with a screenshot matching the operator's view.
4. No context-panel control is clipped or rendered outside its panel, for every row type (measured boxes).
5. Tab colours are the full-strength colour (measured, not a washed tint), adjacent tabs differ, and the text
   contrast floors hold in all three themes.
6. The edit-text cluster: selection arms the Inspector field; the canvas text is visibly selected; dragging
   moves the text; Confirm creates no duplicate; a format change after a move does not reposition the box; no
   formatting looks active with nothing selected; superscript/subscript shows no second copy - each verified
   with a focused test and, where visual, a screenshot.
7. OCR cancel stops the scan (verified by the engine state and the UI), and the suspects UI lives in the
   Inspector with a clean, non-overlapping layout (screenshot).
8. All text boxes render a thicker, rounded-corner border (measured computed style + screenshot).
9. The named PDF opens, or the failure is explained with a readable message (no `[object Object]`) and the
   root cause is recorded.
10. No regression: the standing animation/icon rules, `verify:full` and the phase suites stay green; fixes
    ship per the version rule (fixes = PATCH).

**Settings impact:** none - no new `AppSettings` field; the sync triggers, the annotation behaviour and the
panel reorganisation are code behaviour.

## Phase 52 - Encrypted PDF support (open with a password, and create encrypted PDFs)

**Operator request (2026-09-28):** "Implement encrypted pdf feature. First have scout agent research all the
industry standard implementation of it." The scout's research (recorded in `docs/FEATURE-BACKLOG.md` as
FEA-017) is the design input; its key findings:
- **`pdfjs-dist` 4.x ALREADY decrypts** for DISPLAY: `getDocument({ password })`, `onPassword(callback, reason)`
  with NEED_PASSWORD / INCORRECT_PASSWORD, and its core `crypto.js` implements R2-R6 (RC4-40/128, AES-128,
  AES-256 R5/R6). The failing real-world file (RC4-128, V4, empty user password) renders today.
- **`pdf-lib` cannot decrypt and must not be used to work around encryption** (`ignoreEncryption` is
  explicitly unsafe per its own README), so the EDIT path needs a decrypting loader.
- **`@cantoo/pdf-lib`** is a MIT-licensed, API-compatible fork (drop-in): it loads with `{ password }`
  (an EMPTY password is explicitly supported), handles indirect crypt filters, and can WRITE AES-256 R6
  (default), AES-128 and RC4 (behind an explicit weak-crypto flag) with permission flags.
- Alternatives rejected for the first cut: `muhammara` (native C++ addon, Electron 44 prebuilt unverified) and
  a bundled `qpdf` binary (an unsigned exe in the installer, plus an unmaintained wrapper).
- Industry norm (qpdf manual, Sejda): readers try the EMPTY user password first, so owner-restricted files
  open WITHOUT a prompt; permission flags are surface-level ("some PDF readers will ignore these
  permissions"), and RC4 stays readable for legacy files.

**ORCHESTRATOR RULINGS (chosen to match the industry norm; the operator may veto any):**
1. **Permission flags are DISPLAY-ONLY** - the app shows an honest "protected / limited permissions" banner
   listing what the document asks, and does not pretend to enforce it (the spec cannot enforce it; the
   research quote is explicit). No pretending, no silent ignoring.
2. **No explicit "Remove protection" action** in this phase: saving an opened encrypted document writes a
   DECRYPTED file, and the UI must SAY SO in the save confirmation.
3. **Creating uses AES-256 (R6) by default, AES-128 optional; RC4 is NOT offered for writing** (legacy RC4
   files remain OPENABLE). No weak crypto is produced.
4. **Adopt `@cantoo/pdf-lib`** as the edit-path dependency (MIT, drop-in, no binary). The fork risk is
   accepted and recorded.
5. **No password persistence**: a password lives in renderer memory for the session only - never in
   `settings.json`, never logged, never synced.

**Features**

**A. Open a password-protected PDF.** Opening an encrypted file prompts for the password when needed
(NEED_PASSWORD), retries on a wrong one (INCORRECT_PASSWORD) with a clear message, and cancels back to the
library. A file whose user password is EMPTY (owner-restricted) opens WITHOUT a prompt.

**B. A truthful protection state.** The UI shows what the document's encryption says (algorithm/revision and
the permission flags read from the file) as an honest banner - display-only.

**C. The entire edit path works on an encrypted document.** Every tool (rotate, delete, merge, annotate, edit
text, forms, optimize, export) operates on a document opened with a password, because the engine now loads it
with that password. Saving writes a DECRYPTED copy and the confirmation says so.

**D. Create an encrypted PDF.** A dialog to encrypt the current document: a user password, an optional owner
password, the algorithm (AES-256 default / AES-128), and permission checkboxes (print, high-res print, copy,
accessibility copy, modify, comment, assemble, fill forms); the produced file must open with the password in
another reader.

**Success criteria**

1. The operator's real-world file (RC4-128, V4, empty user password) opens with NO prompt and is fully
   editable (report the file's `/R`, `/V`, `/CFM` read from it).
2. A file with a real user password prompts once, opens with the right password, and retries with a clear
   message on a wrong one; cancelling leaves the app in its previous state (no half-open tab).
3. An AES-256 (R6) file prompts and opens; an AES-128 file opens (report the fixtures used - SYNTHETIC
   fixtures only, never the operator's documents).
4. The protection banner shows the real algorithm/revision and permission flags, and does not claim to
   enforce them.
5. Editing + saving an opened encrypted document produces a plain (decrypted) file, and the save confirmation
   says the protection was removed; the produced file opens everywhere without a password.
6. Creating an encrypted PDF with AES-256 (and with AES-128) yields a file that PROMPTS for the password in an
   independent reader (verify with a parser/pdf.js, not just our own app), and whose permission flags read back
   correctly.
7. Passwords never touch `settings.json`, the logs, the sync payloads or any trace; a wrong-password attempt
   does not leak the attempted password.
8. No regression: the unencrypted open/edit/save paths, the standing animation/icon rules, `verify:full` and
   the phase suites stay green; the dependency swap does not change behaviour for unencrypted files.

**Settings impact:** one new field - `encryptDefaults?: { algorithm: 'aes-256' | 'aes-128'; permissions: { print: boolean; highResPrint: boolean; copy: boolean; accessibleCopy: boolean; modify: boolean; comment: boolean; assemble: boolean; fillForms: boolean } }` (the Create-encrypted dialog's remembered defaults; validated in `src/main/services/settings.ts` - preserve-if-valid, reject-if-invalid, unknown keys dropped, a missing field resolving to AES-256 with all permissions allowed). **No password is ever a setting.**
