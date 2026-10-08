# Activity Shelf inventory — Feedback and Progress surfaces (TFL-1216, chunk C1)

Scope: a truthful, read-only inventory of every existing entry point in the
renderer that gives the user feedback about, or shows progress of, an
asynchronous task, plus the IPC / engine events those surfaces consume. This
document does not modify any source: it only reads existing code paths.

It accompanies `src/renderer/state/activity.ts`, the shared operation-state
model later Activity Shelf chunks consume. The `Class` column classifies each
surface against that model:

- `SUPPORTED` — the model can express this surface truthfully today with data
  the app already produces (counts, phases, real cancellations, real results).
- `EXTENDABLE` — the underlying data or capability already exists but is not
  yet wired to a shelf; mapping it is later-chunk work, not a new capability.
- `UNSUPPORTED` — the surface is not an async operation (a passive notice, a
  reading-position indicator, a layout primitive), or a requested action (for
  example Cancel) has no engine support. The model must not pretend otherwise.

`file:line` anchors are current as of this chunk. All line references were
verified by reading the file in this repo.

## Primary inventory

| Surface | file:line | Trigger/handler | Current state model | Data source (store / IPC / engine event) | Capability predicate | Async state transitions | Existing test | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Toasts | `src/renderer/components/Toasts.tsx:13-17` (Toast type), `:35` (`toastAutoDismissMs`) | `pushToast(kind, text)` (`App.tsx:1877`); user Dismiss / X | `AppErrorState.toasts: Toast[]` + `nextId`, reducer `App.tsx:492-509`; `ToastItem` auto-dismisses only `success` / `info` after 5000 ms via `toastAutoDismissMs` (`warning` / `error` persist until acknowledged) | Local reducer only; no IPC, no engine event | Dismiss only; no cancel, no result action | push -> visible -> (success/info: auto 5 s or manual; warning/error: manual only) dismiss -> removed | `test/unit/renderer/toastKinds.test.tsx` | SUPPORTED (transient notice; error/warning durable until acknowledged, not a cancellable operation) |
| ConversionNotice card | `src/renderer/components/ConversionNotice.tsx:38-133` | `onOpened` after a successful `convert:toDocument` | `ConvertNoticeState` (`src/renderer/state/convert.ts:34-40`): sourceLabel, sourceFormat, fidelity, warnings[] | `ConvertOpenResult` from `convert:toDocument` (`src/shared/ipc.ts:430`) | None; shown unconditionally on success | Shown; collapse/expand via `useNoticeCollapse`; stays available | `test/unit/renderer/phase53_convertImport.test.tsx` | EXTENDABLE (terminal result notice; maps to `completed` + `view-details`) |
| ConversionProgress | `src/renderer/components/ConversionNotice.tsx:135-185` | Auto while `runConvertOpen` is in flight; Cancel button `:173-182` | `ConvertProgressState` (`convert.ts:43-49`): docId, phase, optional `ratio` | `convert:progress` push (`src/shared/ipc.ts:440`) + `ConvertProgress` (`src/shared/convert.ts:216-221`) | Cancel: `convert.cancel` (`ipc.ts:439`) exists and is wired | start (phase, optional ratio) -> cancel requested -> opened / cancelled / error; cancelled is quiet (`convert.ts:225`) | `test/unit/renderer/phase53_convertImport.test.tsx` | SUPPORTED (determinate only when a real ratio exists; no ETA) |
| UpdateIndicator | `src/renderer/components/UpdateIndicator.tsx:26-291` | Backend push via `update.onStatusChanged`; click routes download / install / retry | `UpdateState` (`src/shared/types.ts:363-370`); pure `indicatorView` `:37-86` | Updater IPC: `update.getStatus` / `check` / `download` / `install` / `onStatusChanged` | `download`, `install`, `check` present on the bridge | unsupported / checking / up-to-date / available / downloading / downloaded / error | `test/unit/renderer/updateIndicator.test.tsx`, `bug016_updateDialogProgress.test.tsx` | EXTENDABLE (downloading exposes a percent; no cancel of a download) |
| UpdatePromptDialog | `src/renderer/components/UpdatePromptDialog.tsx:46-541` | Opens when backend pushes available / downloaded | `UpdatePromptKind` via pure `promptKindFromState` `:79` | Same `UpdateState` push as the indicator | `update.download()` / `update.install()` | available -> downloading -> downloaded; Cancel / Later dismisses | `test/unit/renderer/updatePromptDialog.test.tsx`, `bug009_otaUpdatePromptUx.test.tsx` | EXTENDABLE |
| TaskDialog / PreviewTaskDialog | `src/renderer/components/TaskDialog.tsx:31-41`, `PreviewTaskDialog.tsx:24-40` | Composed by feature dialogs (StampDialog, CreateFromImagesDialog) | None: geometry, single-body scroll, width class only | None | None | No async state; layout primitive | `test/unit/renderer/phase113_dialogsNotices.test.tsx` | UNSUPPORTED (layout primitive, not a feedback/operation surface) |
| OcrDialog progress | `src/renderer/components/OcrDialog.tsx:560-596` | Run click; Cancel; engine progress events | `RunProgress` `:126-138` (total, completed, currentPage, phase); `error` (string or null); `cancelled: boolean` | `engine:ocrProgress` (`ipc.ts:284`) + `OcrProgress` (`types.ts:1581-1586`); run via `engine.ocrRecognize` (`ipc.ts:282`) | Cancel: `engine.ocrCancel` (`ipc.ts:287`) + host `cancelOcr` (`App.tsx:8516`) | idle -> rasterising -> recognizing/writing -> completed / error / cancelled | `test/unit/renderer/ocrDialog.test.tsx`, `phase51OcrCancel.test.tsx` | SUPPORTED (per-page determinate; cancel confirmed by engine `cancelled`) |
| OcrSuspectsPanel | `src/renderer/components/OcrSuspectsPanel.tsx:79-483` | Navigate to a suspect's page; close | `suspects: OcrSuspect[]`, `hasRun`, selection + bounded window | Result of `engine.ocrSuspects` (`ipc.ts:283`) | None (navigation only; correction/accept intentionally absent) | list shown -> selection -> navigate; no edit operation | `test/unit/renderer/ocrSuspectsPanel.test.tsx`, `tfl1116_ocrSuspects.test.tsx` | UNSUPPORTED (review surface; no async operation, engine has no correction op) |
| PrintPanel progress | `src/renderer/components/PrintPanel.tsx:665-695`; runs in the separate print-preview window `src/renderer/print-window/PrintWindowApp.tsx:276` | Confirm print; Cancel routes to `onCancelClick` | `PrintControls` (`usePrintControls.ts`): `running`, `progress` (currentPage/total), `error`, `success` | Renderer raster with an `AbortSignal` (`src/renderer/pdf/printRaster.ts:81`) + main print IPC | Cancel: `abortRef.current?.abort()` (`usePrintControls.ts:946-952`) | idle -> running (currentPage/total) -> success / error / cancelled | `test/unit/renderer/printDialog.test.tsx`, `printRaster.test.ts` | UNSUPPORTED (separate print-preview window; it owns its own progress + cancel, so it is NOT a main-window Activity Shelf operation) |
| BookView progress | `src/renderer/components/BookView.tsx:636-644` | Page turn; layout toggle | `displayIndex`, `total` (reading position) | Component props | None | Not an async operation (position label) | `test/unit/renderer/bookView.test.tsx` | UNSUPPORTED (reading-position indicator) |
| ReadingView progress | `src/renderer/components/ReadingView.tsx:340-350` | Page / chapter navigation | `current`, `total` (reading position) | Component props | None | Not an async operation (position label) | `test/unit/renderer/readingView.test.tsx` | UNSUPPORTED (reading-position indicator) |
| ProtectionNotice | `src/renderer/components/ProtectionNotice.tsx:52-183` | Shown when the active document is encrypted; collapse / expand | `DocumentProtectionState` (`src/renderer/security/protection.ts`) + `NoticePhase`; 10 s dwell `:46` | `engine:getDocumentProtection` (`ipc.ts:323`) | None | expanded <-> collapsed; no task lifecycle | `test/unit/renderer/phase59ProtectionNotice.test.tsx`, `phase67NoticeCollapse.test.tsx` | UNSUPPORTED (passive notice) |
| ExportPagesWithoutTextNotice | `src/renderer/components/ExportPagesWithoutTextNotice.tsx:26-39` | Rendered after a txt/docx/xlsx/pptx export | `pages` (number[] or null) | Export result | None | Shown after the export settles (terminal) | `test/unit/renderer/def390_exportPagesWithoutText.test.tsx` | EXTENDABLE (terminal result notice; maps to `completed` + `view-details`) |
| Pdf3dNotice | `src/renderer/components/Pdf3dNotice.tsx:39-87` | Active document carries 3D annotations; collapse / expand | `Pdf3dContent[]` + collapse phase | `engine:get3dContent` (`ipc.ts:310`) | None | expanded <-> collapsed; no task lifecycle | `test/unit/renderer/engineeringSurfaces.test.tsx` | UNSUPPORTED (passive limitation notice) |
| ValidationNotice | `src/renderer/components/ValidationNotice.tsx:41-170` | After a validate run or a blocked / warned save | `ValidationNoticeState` (`src/renderer/state/validation.ts`) | Validation result; no IPC event (invoke result) | None | Shown after save/validate settles; dismissible; terminal | `test/unit/renderer/phase54_validationSurface.test.tsx` | EXTENDABLE (terminal report; `view-details`) |
| searchIndexProgress | `src/renderer/App.tsx` (`searchIndexProgressFor` + `searchIndexShelfOpRef`); producer `DocumentView.tsx:180-183, 1953, 360`; builders `src/renderer/state/activityShelf.ts` (`searchIndexStartAction` / `searchIndexProgressAction`) | Background search-index build (while a search query is open) | `SearchIndexProgress { built, total }` mirrored into diagnostics AND mapped onto a shelf operation (determinate `pages`, no completion actions) | `DocumentView` `onSearchIndexProgress` callback (`DocumentView.tsx:360`) | None; no cancel channel; no completion actions | built 0..total; a `null` snapshot (query cleared) completes the shelf op; a closed tab removes it; the build's own `built === total` snapshot is NOT a settle signal (the walk only counts newly indexed pages) (`DocumentView.tsx:3398-3404, 3495-3497`) | `test/unit/renderer/searchIndex.test.ts`, `test/unit/renderer/activityShelfStore.test.ts` | SUPPORTED (surfaced in C5b: determinate `pages`, no cancel, no completion actions) |
| Inspector export-config status | `src/renderer/components/Inspector.tsx:436` (`InspectorExportStatus`), `:870-884` (render) | Export run started from the Inspector | `status { state: 'running' / 'error' / 'success'; current?; total?; message? }` | Renderer export loop over the engine export APIs | None | running (current/total) -> success / error | `test/unit/renderer/exportConfig*.test.ts` | UNSUPPORTED (contextual inline status under the export control; no global/background producer exists) |
| SearchBar replace report | `src/renderer/components/SearchBar.tsx:189-198` | Replace all | `replaceReport: string` | Renderer search/replace | None | Report string after replace-all settles (terminal) | `test/unit/renderer/phase86SearchReplace.test.tsx` | EXTENDABLE (result report, not a state machine) |

## Consumed IPC / engine events

| Event / channel | file:line | Payload type | Direction | Consumed by | Class |
| --- | --- | --- | --- | --- | --- |
| `engine:ocrProgress` | `src/shared/ipc.ts:284` | `OcrProgress` (`src/shared/types.ts:1581-1586`) | main -> renderer (push) | OcrDialog | SUPPORTED |
| `engine:ocrCancel` | `src/shared/ipc.ts:287` | `OcrCancelResult` (`types.ts:1594-1596`) | renderer -> main (invoke) | `cancelOcr` (`App.tsx:8516`) | SUPPORTED |
| `convert:progress` | `src/shared/ipc.ts:440` | `ConvertProgress` (`src/shared/convert.ts:216-221`) | main -> renderer (push) | `runConvertOpen` (`convert.ts:217`) | SUPPORTED |
| `convert:cancel` | `src/shared/ipc.ts:439` | job id | renderer -> main (invoke) | ConversionProgress Cancel | SUPPORTED |
| updater `download-progress` | `src/main/services/update-service.ts:259` | `{ percent: number }` mapped to `UpdateState` `downloading` | main -> renderer (push) | UpdateIndicator / UpdatePromptDialog | SUPPORTED (the ONLY percentage in a progress surface) |

Related shared types: `UpdateState` (`src/shared/types.ts:363-370`), `OcrProgress` (`:1581`),
`ConvertProgress` (`convert.ts:216`). `SearchIndexProgress` is a renderer-local type
(`DocumentView.tsx:180-183`), not an IPC contract; C5b reuses it type-only in
`activityShelf.ts` (no runtime import of the component).

## How existing state maps onto `ActivityOperation`

| Activity state | Existing sources that map onto it |
| --- | --- |
| `queued` | Not surfaced today; supported by the model for an operation created before its engine call is dispatched. |
| `running` | OcrDialog `RunProgress`; ConversionProgress; PrintPanel `running`; Inspector export `running`; `searchIndexProgress`; updater `downloading`. |
| `cancellation-requested` | Not distinct today: OcrDialog and PrintPanel fold request and confirmation into one click. The model separates them so a request cannot render as `cancelled` before the engine confirms. |
| `cancelled` | OcrDialog `{ cancelled: true }`; PrintPanel `save-cancelled`; convert `error.code === 'cancelled'` (quiet, `convert.ts:225`). |
| `completed` | ConversionNotice (opened); UpdateIndicator `downloaded`; PrintPanel `success`; export-config `success`. |
| `partial-success` | Multi-file conversion warning toast (`convertManyWarningToast`, `convert.ts:272-277`); ExportPagesWithoutTextNotice `pages`; docx image-fallback per text-free page. These carry explicit failure/degradation lists. |
| `failed` | Error toasts; OcrDialog `error`; UpdateIndicator `error`; PrintPanel `error`; export-config `error`; ValidationNotice blocked. |

## UNSUPPORTED capabilities (recorded, not built)

- **Cancel an OTA update download.** The toolbar shows download progress, but `electron-updater` exposes no cancel; UpdateIndicator and UpdatePromptDialog offer no Cancel for a download in flight.
- **Cancel the search-index build.** `searchIndexProgress` is mirrored into diagnostics with no cancellation channel.
- **OCR suspect correction / accept.** The engine offers no such operation; OcrSuspectsPanel is navigation-only by contract (`OcrSuspectsPanel.tsx:15-33`).
- **BookView / ReadingView progress as operations.** Both are reading-position labels (`data-book-progress`, `data-reading-progress`), not async tasks.
- **ProtectionNotice / Pdf3dNotice / ValidationNotice / ExportPagesWithoutTextNotice as operations.** Passive notices and reports, not cancellable tasks.
- **TaskDialog / PreviewTaskDialog.** Layout primitives with no state.
- **ETA for any operation.** No surface computes an ETA; the model deliberately has no ETA field.
- **Percentage in the operation model.** The updater's `downloading` percent (`UpdateIndicator.tsx:250`, `update-service.ts:259-263`) is a raw download percent from the backend; the Activity Shelf model has no percentage field and surfaces done/total or an indeterminate phase instead.

## Notes and out-of-scope findings (recorded only; not fixed in this chunk)

- Toasts: C5c made durability kind-aware — `success` / `info` auto-dismiss after 5 s, while `error` / `warning` now persist until the user clicks Dismiss (the pure `toastAutoDismissMs` helper in `Toasts.tsx`; `null` means persist). An error toast can no longer vanish before it is read (`Toasts.tsx:35`).
- UpdateIndicator `downloading` renders `{progress}%` (`UpdateIndicator.tsx:250`) — the only percentage in a progress surface.
- OcrDialog and PrintPanel each own a copy of the same progress markup (`ocr-progress-*` classes); the shelf will consolidate, but no shared component was built in this chunk.
- The search-index counts were diagnostics-only in C1 (`App.tsx`); C5b now also maps them onto a shelf operation (`searchIndexStartAction` / `searchIndexProgressAction`) so the build is visible outside diagnostics. The App diagnostics mirror is unchanged.
- TFL-1216 chunk C5: the standalone `ConversionProgress` widget is no longer
  mounted - the Activity Shelf owns the running import affordance
  (`convertStartAction` / `convertProgressAction`, cancel via `convertShelfOpRef`
  -> `convert:cancel`). The `ConversionNotice` card stays a document-attached
  terminal notice. The `ConversionProgress` component itself is unchanged and
  still DOM-tested.
- TFL-1216 chunk C5b: the background search-index build is the third shelf
  producer. `searchIndexProgressFor` keeps the existing diagnostics mirror and
  also dispatches `searchIndexStartAction` (capturing the tab's `engineDocId`,
  `tabId`, on-disk path and display name) on the first snapshot, then
  `searchIndexProgressAction` for later ones. A `null` snapshot (the search
  query cleared) settles the operation with `complete`; closing the owning tab
  abandons the build, so `performCloseTab` removes the row (no result to open,
  no user-actionable failure, so a stale `failed` notice is the wrong
  treatment). No `Cancel` is rendered - the build has no cancellation channel -
  and `completionActions: []` means no completion buttons.

## TFL-1216 chunk C5c — inventory reconciliation (closes the migration)

This chunk records the classifications that close the Activity Shelf migration
and makes error toasts durable. It changes no producers or shelf primitives.

Main-window non-modal operations that ARE migrated onto the Activity Shelf:
OCR (run progress + cancel), conversion / import (running import affordance +
cancel), and the background search-index build (determinate page counts, no
cancel, no completion actions).

Classified UNSUPPORTED (recorded, not migrated):

- `PrintPanel` progress (`usePrintControls`) runs in the SEPARATE
  print-preview window (`src/renderer/print-window/PrintWindowApp.tsx:276`), not
  the main shell. It is NOT a main-window Activity Shelf operation; the print
  window owns its own progress + cancel (`abortRef.current?.abort()`), so there
  is no global producer to route onto the shelf.
- Inspector export-config status (`src/renderer/components/Inspector.tsx:436`,
  rendered `:870-884`) is an inline contextual status under the export control;
  no global / background producer was found, so it is not a shelf operation.

Terminal document-attached notices stay document-attached, not shelf rows:
`ConversionNotice`, `ExportPagesWithoutTextNotice`, `ValidationNotice`.
Passive / review / position surfaces are not async operations and stay in place:
`ProtectionNotice`, `Pdf3dNotice`, `OcrSuspectsPanel`, `BookView` / `ReadingView`.

Toast durability (C5c): `error` and `warning` toasts now persist until the user
acknowledges them; only `success` / `info` auto-dismiss after 5 s. See
`src/renderer/components/Toasts.tsx` (`toastAutoDismissMs`).

## TFL-1216 chunk C7 — live update lifecycle on the shelf

The live app-updater is the fourth shelf producer, driven by the SAME
`tflex.update.onStatusChanged` subscription that feeds the Top Bar
`UpdateIndicator` / `UpdatePromptDialog` (no second subscription). App maps each
`UpdateState` transition through the pure `updateStateAction`
(`src/renderer/state/activityShelf.ts`) onto ONE stable operation
(`UPDATE_OPERATION_ID` and `UPDATE_TASK_NAME` = `'Update'`, built by
`activityFromUpdateStart`):

- `available` -> running, indeterminate "Update available";
- `downloading` -> running, indeterminate "Downloading update" - the updater's
  `progress` percentage is deliberately NOT surfaced on the shelf;
- `downloaded` -> `complete` (no completion actions; the badge owns
  "Restart to update");
- `error` -> `fail` with item "Update" and the updater message;
- `checking` / `up-to-date` / `unsupported` / cleared (null) -> the row is
  removed.

`capabilityFor('update')` declares `cancelable: false` and no completion
actions, so the row renders neither a Cancel nor a completion button. The Top
Bar badge stays the Download / Install / Check action surface (the
TFL-856/857/903 seam); the shelf carries only the state and the notice. Tests:
`test/unit/renderer/activityShelfStore.test.ts`.

## TFL-1216 chunk C8 — feedback palette, docs and accessibility hardening

Feedback palette (closes the deferred TFL-1241). The Consistency Corrections
item 6 palette is now carried by general semantic tokens in the token layer
(`src/renderer/styles.css`): `--feedback-success` / `--feedback-danger`,
declared in all three scopes with `#25754A` / `#B82E43` light, `#85D3A6` /
`#FF9AAD` dark, and the light values on the light-acrylic frosted surface. The
values mirror the icon ink signals `--tf-icon-success` / `--tf-icon-danger`; no
new hex was invented. The shelf-scoped roles now point at them —
`.activity-shelf { --activity-success: var(--feedback-success);
--activity-danger: var(--feedback-danger) }` — so the shelf ink matches the
handoff WITHOUT recolouring the shared `--success` / `--error` roles other
categories still consume. Pinned by `test/unit/renderer/foundationMirrors.test.ts`
(the three-scope parity suite) and the shelf suites.

Accessibility hardening (repairs only; no redesign):

- Failures are assertive: a `failed` row's reason and a `partial-success` row's
  failed-items list now carries `role="alert"`, so actionable failures announce.
  The collapsed summary stays `role="status" aria-live="polite"`.
- The summary's determinate counter ("4 of 12 pages") stays visible but is
  removed from the accessibility tree, so the polite region announces stage /
  completion changes and never each progress point; the model has no percentage
  and no ETA.
- Focus: opening the panel moves focus into the `role="dialog"`
  (`aria-modal="false"`) container; Escape / the close control returns focus to
  the summary trigger through `openButtonRef`; and a completion action that
  removes its row no longer strands focus on `<body>` while the panel stays
  open.

Docs (closes DEF-651): the Toasts note's stale anchor was corrected to
`Toasts.tsx:35` (`toastAutoDismissMs`).

## TFL-1320 — accepted adversary fixes (DEF-652 / DEF-653 / DEF-654)

Same-palette fixes to the shelf action / reducer / App wiring; no new control,
selector or producer.

- DEF-652: a completed CONVERSION's two declared controls are now real.
  `open-result` activates the converted document's still-open tab (resolved by
  the operation's captured `document.docId`, never the active tab) so the user
  lands on the result; `view-details` does the same and then reveals the
  document-attached `ConversionNotice` (expanding it from the collapsed "i" and
  scrolling it into view). A closed tab is a truthful no-op. Both actions still
  acknowledge and drop the row afterwards. `convert.completionActions` stays
  `['open-result', 'view-details']` in `src/shared/activity.ts` because both are
  honourable. The OCR `view-details` guarded path (B11) is unchanged.
- DEF-653: a new update lifecycle after a TERMINAL row now starts a FRESH row.
  `runningUpdateAction` (`src/renderer/state/activityShelf.ts`) maps
  `available` / `downloading` to a `begin` when the current operation is
  terminal; the App update effect removes the stale terminal row first, then
  dispatches the `begin`, so `available -> error -> downloading -> downloaded`
  (and `completed -> available -> ...`) can no longer stay stuck. At most one
  update row exists.
- DEF-654: the shelf's per-row Cancel for an OCR row now fires
  `engine.ocrCancel` for the operation's CAPTURED document (resolved by
  `document.docId`), not `cancelOcrForActiveTab()` against whatever tab is
  active. A closed tab is a truthful no-op; the request stays
  `cancelling`/`cancellation-requested` until the engine confirms.

Pinned by `test/unit/renderer/activityShelfStore.test.ts` (the convert
capability case plus the two terminal-recovery cases).

