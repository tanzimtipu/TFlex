// Shared modal-backdrop close guard (B3 / B6, formerly B17).
//
// Every modal dialog's backdrop closes the dialog on an outside
// click. The naive `onClick={onClose}` is wrong for text-heavy
// dialogs: a text-selection drag that BEGINS in an input and
// RELEASES over the backdrop dispatches its `click` on the backdrop
// (the common ancestor of the mousedown and mouseup targets), which
// used to close the dialog mid-edit. This hook records where the
// pointer interaction STARTED (an onMouseDown handler + ref). The
// returned onClick only closes when BOTH the mousedown and the
// click target the backdrop itself (`target === currentTarget`). A
// genuine outside click still closes; a drag that ended over the
// backdrop does not.
//
// `blocked` disables backdrop-close entirely (e.g. while an OS file
// picker is open or an async export is running) — the same
// `running ? undefined : onClose` gate the busy dialogs used before.

import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export interface BackdropCloseHandlers {
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** `undefined` when `blocked` — the backdrop swallows no clicks,
   *  it simply has no close handler wired. */
  onClick: ((e: ReactMouseEvent<HTMLDivElement>) => void) | undefined;
}

export function useBackdropClose(
  onClose: () => void,
  blocked = false,
): BackdropCloseHandlers {
  const backdropDownRef = useRef(false);
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    backdropDownRef.current = e.target === e.currentTarget;
  };
  const onClick = blocked
    ? undefined
    : (e: ReactMouseEvent<HTMLDivElement>): void => {
        if (backdropDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
      };
  return { onMouseDown, onClick };
}
