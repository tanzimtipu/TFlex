// Local counters mirroring the engine's undo / redo stacks.
//
// The page-organization engine does not expose the size of its undo or redo
// stacks through `EngineState` (the IPC contract only carries `modified`,
// `pageOrder`, `rotations`, `deleted`, `pageCount`). The rail's Undo button
// needs to disable itself when the stack is empty and stay enabled while
// there is at least one undo step remaining. We track both stack depths
// locally on the renderer side, mirrored against the engine by reacting to
// the success of each IPC call:
//
//   applyOp success     -> undoCount += 1, redoCount = 0  (new op clears redo)
//   undo   success      -> undoCount -= 1, redoCount += 1
//   redo   success      -> undoCount += 1, redoCount -= 1
//   save / saveAs       -> undoCount = 0, redoCount = 0   (engine clears history)
//
// The renderer's UI flags are derived directly from the counters, so the
// "Undo disables after first click even when more steps remain" class of
// bugs (DEF-010) is structurally impossible: every transition is driven by
// a real counter, not a hardcoded literal.
//
// Counters are clamped at zero so a stray IPC call (e.g. an undo on an empty
// stack that somehow returns ok=true because of a backend bug) cannot push
// the canUndo flag into a permanently-stuck-true state.

export interface UndoCounters {
  undoCount: number;
  redoCount: number;
}

export const ZERO_COUNTERS: UndoCounters = {
  undoCount: 0,
  redoCount: 0,
};

/** Result of a successful applyOp: pushes onto the undo stack and clears
 *  the redo stack (engine contract). */
export function countersAfterApply(prev: UndoCounters): UndoCounters {
  return { undoCount: prev.undoCount + 1, redoCount: 0 };
}

/** Result of a successful undo: pops from undo, pushes onto redo. */
export function countersAfterUndo(prev: UndoCounters): UndoCounters {
  return {
    undoCount: Math.max(0, prev.undoCount - 1),
    redoCount: prev.redoCount + 1,
  };
}

/** Result of a successful redo: pops from redo, pushes onto undo. */
export function countersAfterRedo(prev: UndoCounters): UndoCounters {
  return {
    undoCount: prev.undoCount + 1,
    redoCount: Math.max(0, prev.redoCount - 1),
  };
}

/** Result of a successful save / saveAs: the engine clears both stacks. */
export function countersAfterSave(_prev: UndoCounters): UndoCounters {
  return { undoCount: 0, redoCount: 0 };
}

/** Derive the canUndo / canRedo flags the UI cares about. */
export interface UndoFlags {
  canUndo: boolean;
  canRedo: boolean;
}

export function flagsFromCounters(counters: UndoCounters): UndoFlags {
  return {
    canUndo: counters.undoCount > 0,
    canRedo: counters.redoCount > 0,
  };
}
