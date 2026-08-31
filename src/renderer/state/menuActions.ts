// Phase 7 — application menu action dispatcher.
//
// The renderer's App component owns the actual side-effect handlers
// (open, save, toggleTheme, ...). The menu IPC bridge
// (`window.tflex.menu.onAction`) only delivers an action name string
// — it has no opinion on what to do. We isolate the dispatch
// decision here so the App effect can be a one-liner
// (`onAction((action) => dispatchMenuAction(action, ctx))`) and the
// action -> handler mapping stays unit-testable in isolation.
//
// The action set is the union of everything `src/main/menu.ts`
// sends over IPC. If a new menu item is added there, add its name
// here too; the switch's default branch returns `false` so a typo
// is caught at the type level via `MenuAction` (the wire string is
// narrowed before dispatch).
//
// `zoomIn` / `zoomOut` / `fitWidth` / `fitPage` are intentionally
// routed through `DocumentView`'s own keyboard handler so the
// menu accelerator reuses the same code path the toolbar's
// keyboard shortcuts already use. We still return `true` here
// so the IPC layer doesn't see the action as unhandled.

export type MenuAction =
  | 'open'
  | 'merge'
  | 'save'
  | 'saveAs'
  | 'closeTab'
  | 'undo'
  | 'redo'
  | 'toggleTheme'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'fitPage'
  | 'showToolsPalette'
  | 'about'
  | 'preferences'
  | 'optimize'
  | 'auditSpace'
  | 'createFromImages'
  | 'exportPages'
  | 'exportText'
  | 'exportDocx'
  | 'insertPages'
  | 'recognizeText'
  | 'checkForUpdate';

/** The bag of side-effect callbacks `App.tsx` hands the dispatcher.
 *  Each entry mirrors a menu item the user can trigger from the
 *  native menu bar. Keep these as plain functions — the dispatcher
 *  itself is pure and synchronous. */
export interface MenuActionContext {
  open(): void;
  merge(): void;
  save(): void;
  saveAs(): void;
  closeTab(): void;
  undo(): void;
  redo(): void;
  toggleTheme(): void;
  showToolsPalette(): void;
  about(): void;
  preferences(): void;
  /** Phase 8 — Optimize dialog. Opens the preset selector and, on
   *  confirm, runs `engine.optimize` against the active tab's engine
   *  doc and routes the result into a new tab. */
  optimize(): void;
  /** Phase 8 — Audit Space dialog. Opens the per-element-type size
   *  breakdown chart for the active tab. Read-only. */
  auditSpace(): void;
  /** Phase 9 — Create-from-images dialog. The WIN + Tools palette both
   *  funnel through this entry; the dialog picks image files, asks
   *  the user for a JPEG quality, and feeds the bytes to
   *  `engine.createFromImages`. Result opens as a new tab via the same
   *  flow split / extract / optimize use. */
  createFromImages(): void;
  /** Phase 9 — Export-Pages dialog. Page range + format + DPI +
   *  the dialog rasterizes each entry with pdf.js and triggers a
   *  per-page download. The active document is required. */
  exportPages(): void;
  /** Phase 9 — Export text (TXT or RTF). */
  exportText(): void;
  /** Phase 9 — Export the active document as a .docx. */
  exportDocx(): void;
  /** Phase 9 — Insert pages (blank or from another PDF). */
  insertPages(): void;
  /** Phase 11 — Recognize Text (OCR). Opens the OCR dialog against
   *  the active document. Same funnel as the toolbar's OCR button
   *  and the Tools palette entry. */
  recognizeText(): void;
  /** OTA UX — Help -> Check for Update. Triggers a fresh
   *  electron-updater check and opens the update prompt if a new
   *  version surfaces. Document-agnostic: reachable from the
   *  welcome screen too. The host wires this to the same prompt
   *  the auto-check-on-launch path uses (UpdatePromptDialog). */
  checkForUpdate(): void;
}

/** Dispatch a menu action string to its handler. Returns true if
 *  the action was recognised (including the deliberately-no-op
 *  zoom / fitWidth / fitPage actions that DocumentView handles
 *  internally), false if the action name is unknown. Unknown
 *  actions are silently ignored — main process may add new menu
 *  items in a future release without crashing older renderer
 *  builds. */
export function dispatchMenuAction(action: string, ctx: MenuActionContext): boolean {
  switch (action) {
    case 'open':             ctx.open();              return true;
    case 'merge':            ctx.merge();             return true;
    case 'save':             ctx.save();              return true;
    case 'saveAs':           ctx.saveAs();            return true;
    case 'closeTab':         ctx.closeTab();          return true;
    case 'undo':             ctx.undo();              return true;
    case 'redo':             ctx.redo();              return true;
    case 'toggleTheme':      ctx.toggleTheme();       return true;
    case 'showToolsPalette': ctx.showToolsPalette();  return true;
    case 'about':
    case 'help.about':       ctx.about();             return true;
    case 'preferences':      ctx.preferences();       return true;
    case 'optimize':         ctx.optimize();          return true;
    case 'auditSpace':       ctx.auditSpace();        return true;
    case 'createFromImages': ctx.createFromImages();  return true;
    case 'exportPages':      ctx.exportPages();       return true;
    case 'exportText':       ctx.exportText();        return true;
    case 'exportDocx':       ctx.exportDocx();        return true;
case 'insertPages':      ctx.insertPages();        return true;
    case 'recognizeText':    ctx.recognizeText();      return true;
    case 'checkForUpdate':   ctx.checkForUpdate();     return true;
    case 'zoomIn':
    case 'zoomOut':
    case 'fitWidth':
    case 'fitPage':
      // Routed to DocumentView's keyboard handler — see the comment
      // at the top of this file. The dispatcher still claims the
      // action so callers can tell it was on the menu.
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// DEF-065 — active-doc gating helpers.
//
// The native menu (built in `src/main/menu.ts`) shows every File / Edit /
// Tools item as enabled even when no document is open. The visual enabled
// state lives in the main process; the renderer cannot toggle it directly
// (no IPC contract exists for that, and per AGENTS rules neither main nor
// preload can be edited from this role). What the renderer CAN do — and
// does here — is guarantee that the click itself is a clean no-op when no
// tab is active, so the bug's "silent error in the background" claim does
// not reproduce even though the menu items still look enabled.
//
// The two helpers below are what `App.tsx` uses to wrap its context
// handlers. They isolate the active-doc check so it's a single,
// testable predicate rather than a duplicated `if (activeId !== null)`
// branch scattered across the menu wiring.
//
// `snapshotMenuEnabled` is the shape the main process will consume once
// the orchestrator amends the IPC contract (a new `menu:setEnabledState`
// channel + a tiny listener in `src/main/menu.ts`). Today the renderer
// can compute the snapshot but has nowhere to ship it; the helper exists
// so the day the contract lands, App.tsx can call it without a
// refactor.

// Menu actions that require an active document. Any other action in
// the menu (`open`, `merge`, `toggleTheme`, `about`, `preferences`,
// the zoom / fit / Tools palette / OCR family) is document-agnostic
// and can run with zero tabs.
export type ActiveDocMenuAction =
  | 'save'
  | 'saveAs'
  | 'closeTab'
  | 'undo'
  | 'redo';

/** True iff the named action needs an active document to be useful.
 *  Pure: depends only on its argument. */
export function menuActionRequiresActiveDoc(
  action: string,
): action is ActiveDocMenuAction {
  return (
    action === 'save' ||
    action === 'saveAs' ||
    action === 'closeTab' ||
    action === 'undo' ||
    action === 'redo'
  );
}

/** Wrap a document-required handler so it only fires when a doc is
 *  open. The `hasActiveDoc` predicate is the single source of truth
 *  for "is there a document right now?" — the App re-reads it on
 *  every menu dispatch because the active id can change between
 *  clicks. Returns a no-op thunk the dispatcher can call
 *  unconditionally.
 *
 *  Pure: the wrapper is a function; the gating is a closure over
 *  the predicate. Tests pass arbitrary `hasActiveDoc` values to
 *  exercise the path the App's `useEffect` takes. */
export function gateOnActiveDoc(
  hasActiveDoc: () => boolean,
  handler: () => void,
): () => void {
  return (): void => {
    if (!hasActiveDoc()) return;
    handler();
  };
}

/** Snapshot the renderer's current menu enable state. The shape
 *  matches the shared `MenuEnabledState` (Partial<Record<MenuItemId, boolean>>)
 *  in `src/shared/types.ts` so App.tsx can hand the result straight
 *  to `window.tflex.menu.setEnabled(...)` without re-mapping ids. The
 *  keys use the canonical `'menu.save'` / `'menu.saveAs'` /
 *  `'menu.closeTab'` / `'menu.undo'` / `'menu.redo'` ids from the
 *  `MenuItemId` union, which line up with the `id:` field in
 *  `src/main/menu.ts` (the two lists must stay in sync). The host
 *  pushes a fresh snapshot on every active-tab change so main can
 *  keep `MenuItem.enabled` in lock-step with the renderer's view
 *  (DEF-065). */
export function snapshotMenuEnabled(
  hasActiveDoc: boolean,
): {
  "menu.save": boolean;
  "menu.saveAs": boolean;
  "menu.closeTab": boolean;
  "menu.undo": boolean;
  "menu.redo": boolean;
} {
  return {
    "menu.save": hasActiveDoc,
    "menu.saveAs": hasActiveDoc,
    "menu.closeTab": hasActiveDoc,
    "menu.undo": hasActiveDoc,
    "menu.redo": hasActiveDoc,
  };
}
