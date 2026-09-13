// Phase 16 — the side-rail pages panel collapse state.
//
// App is the SINGLE owner of the value: it starts expanded
// (`collapsed: false`), restores the persisted value at boot, keeps it
// in sync with settings echoes, and persists the user's toggle through
// the shared trackAndSave path. SideRail / DocumentView receive the
// value as props and only report the toggle — the rail never owns the
// state (see the SideRail props).
//
// The reducer mirrors the backend's preserve-if-valid rule: the
// settings echo (`sync`) only applies a real boolean; an absent or
// invalid value leaves the local state untouched, so the renderer can
// never write a value the backend would reject.

export interface PagesPanelState {
  /** When true the rail body shows the page-number ruler strip
   *  instead of the thumbnails / annotations / bookmarks panels. */
  collapsed: boolean;
}

export type PagesPanelAction =
  /** User pressed the collapse/expand control. */
  { type: 'toggle' }
  /** Apply an explicitly computed boolean (boot restore, toggle
   *  write). Only real booleans are representable here. */
  | { type: 'set'; collapsed: boolean }
  /** Settings echo (main re-sends the persisted value). `undefined`
   *  means the field is absent from the echo — leave local state
   *  alone. */
  | { type: 'sync'; value: boolean | undefined };

/** Documented default: the panel is expanded. */
export const initialPagesPanelState: PagesPanelState = { collapsed: false };

export function pagesPanelReducer(
  state: PagesPanelState,
  action: PagesPanelAction,
): PagesPanelState {
  switch (action.type) {
    case 'toggle':
      return { collapsed: !state.collapsed };
    case 'set':
      return { collapsed: action.collapsed };
    case 'sync':
      // Preserve-if-valid: an absent (undefined) or non-boolean echo
      // value is ignored, exactly like the backend normalizer.
      return typeof action.value === 'boolean'
        ? { collapsed: action.value }
        : state;
  }
}