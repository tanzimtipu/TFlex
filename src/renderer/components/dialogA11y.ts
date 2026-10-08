// Phase 119 (TFL-1328 chunk F) — the ONE modal accessibility hook.
//
// Every modal renders through DialogShell, so the framework-native modal
// contract lives here once. While a dialog is `open` the hook:
//   1. traps Tab / Shift+Tab inside the dialog surface (first <-> last wrap),
//   2. makes the rest of the document inert by marking the dialog's sibling
//      subtrees at every ancestor level up to <body> (never the dialog's own
//      ancestor chain),
//   3. restores focus to whatever was focused when the dialog opened.
//
// Everything is torn down on cleanup: the listener detaches, only the siblings
// this hook newly marked lose `inert`, and the opener regains focus.

import { useEffect, type RefObject } from "react";

export interface DialogA11yOptions {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
}

// The canonical tabbable set for the in-dialog focus trap.
const TABBABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y({ open, dialogRef }: DialogA11yOptions): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // FOCUS TRAP — wrap Tab / Shift+Tab across the dialog's tabbable set.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const tabbables = Array.from(
        dialog.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
      );
      if (tabbables.length === 0) return;
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement;
      const inside = active !== null && dialog.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);

    // BACKGROUND INERT — mark every sibling at each level of the dialog's
    // ancestor chain, remembering only the ones this hook newly marked.
    const newlyInert: Element[] = [];
    let node: Element | null = dialog;
    while (node !== null && node !== document.body) {
      const parent: Element | null = node.parentElement;
      if (parent === null) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node) continue;
        if (!sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          newlyInert.push(sibling);
        }
      }
      node = parent;
    }

    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      for (const element of newlyInert) element.removeAttribute("inert");
      if (
        previouslyFocused !== null &&
        previouslyFocused.isConnected &&
        typeof previouslyFocused.focus === "function"
      ) {
        previouslyFocused.focus();
      }
    };
  }, [open, dialogRef]);
}
