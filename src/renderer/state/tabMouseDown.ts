/**
 * Minimal tab shape the AppHeader renders. Lives here (instead of next
 * to the component) so the mouse-down resolver can be imported by
 * AppHeader without a cycle — AppHeader imports the resolver and the
 * type, the resolver imports the type. The component is the visual
 * surface; this module owns the input-shape contract for both.
 */
export interface TabInput {
  id: string;
  title: string;
  modified: boolean;
}

/**
 * Result of resolving a mousedown on the tab strip to a logical action.
 * `null` means "do nothing" — used for non-left buttons and for clicks
 * that landed outside any tab (e.g. the empty area to the right of the
 * last tab, or the "No documents open" placeholder).
 */
export type TabMouseDownAction =
  | { kind: "activate"; id: string }
  | { kind: "close"; id: string }
  | null;

/**
 * Decide what a mousedown on the tab strip should do. Designed to be
 * the single source of truth for the AppHeader's tab click handling
 * (DEF-034) — the component calls this from its `onMouseDown` handler
 * and the unit test exercises every branch without spinning up React.
 *
 * Why mousedown (not click)?
 * - `click` requires a full mousedown -> mouseup pair on the same
 *   element. During state churn (theme toggle, settings echo, engine
 *   state mirror effects) the React tree can swap the button element
 *   between mousedown and mouseup, dropping the click. `mousedown`
 *   fires synchronously and is dispatched before React commits, so the
 *   activate mutation lands even if a re-render unmounts the element
 *   before the user releases the mouse.
 *
 * Why a resolver (not just `onClick` on the outer div)?
 * - The outer .tab container has padding and an internal gap between
 *   the title button and the close (X) button. With only a click
 *   handler on the inner button, the padding and gap clicks were
 *   dropped (DEF-034 step 1). Walking up from `event.target` lets us
 *   hit-test any descendant and still distinguish close-button presses
 *   from activation presses.
 *
 * Behaviour:
 * - Returns `{ kind: "activate", id }` when the mousedown landed on
 *   the tab container or any descendant other than the close button.
 * - Returns `{ kind: "close", id }` when the mousedown landed on (or
 *   inside) the close button.
 * - Returns `null` for non-primary buttons (right/middle click) so we
 *   don't accidentally activate a tab on a context-menu press.
 * - Returns `null` if the mousedown target is not an Element (e.g.
 *   a text node from a non-browser test env) or no tab container is
 *   found in the ancestry.
 */
export function resolveTabMouseDown(
  event: { target: EventTarget | null; button: number },
  tabs: readonly TabInput[],
): TabMouseDownAction {
  if (event.button !== 0) return null;
  const node = event.target;
  if (node === null || !(node instanceof Element)) return null;

  // Walk up to find the closest .tab container. We use the DOM rather
  // than a data attribute / ref because the AppHeader already gives
  // every tab container a stable id — using a DOM attribute keeps the
  // resolver testable in jsdom without React. The attribute is set by
  // AppHeader on the outer .tab div (see DEF-034).
  const tabEl = node.closest(".tab");
  if (tabEl === null) return null;
  const tabId = tabEl.getAttribute("data-tab-id");
  if (tabId === null) return null;
  if (!tabs.some((t) => t.id === tabId)) return null;

  // Did the mousedown land on the close button (or a child of it)?
  const closeEl = node.closest(".tab-close");
  if (closeEl !== null && tabEl.contains(closeEl)) {
    return { kind: "close", id: tabId };
  }
  return { kind: "activate", id: tabId };
}
