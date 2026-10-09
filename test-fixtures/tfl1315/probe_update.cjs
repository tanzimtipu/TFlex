"use strict";

// src/shared/activity.ts
var ACTIVITY_OPERATION_CAPABILITIES = {
  ocr: { kind: "ocr", cancelable: true, completionActions: ["view-details"] },
  convert: {
    kind: "convert",
    cancelable: true,
    completionActions: ["open-result", "view-details"]
  },
  "search-index": {
    kind: "search-index",
    cancelable: false,
    completionActions: []
  },
  update: { kind: "update", cancelable: false, completionActions: [] }
};
function toTruthfulProgress(input) {
  const { done = 0, total, unit = "items", phaseText } = input;
  if (typeof total === "number" && Number.isFinite(total) && total > 0) {
    const safeDone = Number.isFinite(done) ? Math.max(0, Math.min(done, total)) : 0;
    return { kind: "determinate", done: safeDone, total, unit };
  }
  return { kind: "indeterminate", phaseText: phaseText ?? "Working" };
}
function capabilityFor(kind) {
  return ACTIVITY_OPERATION_CAPABILITIES[kind];
}

// src/renderer/state/activity.ts
function makeProgress(input) {
  return toTruthfulProgress(input);
}
function createOperation(input) {
  return {
    id: input.id,
    document: input.document,
    task: input.task,
    state: { kind: "queued" },
    transactionId: null,
    completionActions: input.completionActions ?? [],
    cancelable: input.cancelable ?? false
  };
}
function startOperation(op, phaseText = "Working") {
  if (op.state.kind !== "queued") return op;
  return { ...op, state: { kind: "running", progress: makeProgress({ phaseText }) } };
}
function updateProgress(op, progress) {
  if (op.state.kind === "running" || op.state.kind === "cancellation-requested") {
    return { ...op, state: { kind: op.state.kind, progress } };
  }
  return op;
}
function requestCancellation(op) {
  if (op.state.kind !== "running") return op;
  return {
    ...op,
    state: { kind: "cancellation-requested", progress: op.state.progress }
  };
}
function confirmCancellation(op) {
  if (op.state.kind !== "cancellation-requested") return op;
  return { ...op, state: { kind: "cancelled" } };
}
function completeOperation(op, transactionId = null) {
  if (isTerminal(op.state)) return op;
  return { ...op, state: { kind: "completed" }, transactionId };
}
function completePartial(op, failed, transactionId = null) {
  if (isTerminal(op.state)) return op;
  if (failed.length === 0) return completeOperation(op, transactionId);
  return {
    ...op,
    state: { kind: "partial-success", failed: failed.map((f) => ({ ...f })) },
    transactionId
  };
}
function failOperation(op, failure, transactionId = null) {
  if (isTerminal(op.state)) return op;
  return { ...op, state: { kind: "failed", failure: { ...failure } }, transactionId };
}
function isTerminal(state) {
  return state.kind === "cancelled" || state.kind === "completed" || state.kind === "partial-success" || state.kind === "failed";
}

// src/renderer/state/activityShelf.ts
var initialActivityShelfState = {
  operations: [],
  acknowledged: [],
  settledAtMs: {}
};
function withSettledAt(state, before, after, atMs) {
  if (isTerminal(after.state) && !isTerminal(before.state)) {
    return {
      ...state,
      settledAtMs: { ...state.settledAtMs, [after.id]: atMs ?? Date.now() }
    };
  }
  return state;
}
function mapOperation(state, id, transition) {
  let changed = false;
  const operations = state.operations.map((op) => {
    if (op.id !== id) return op;
    const next = transition(op);
    if (next !== op) changed = true;
    return next;
  });
  return changed ? { ...state, operations } : state;
}
function reduceActivityShelf(state, action) {
  switch (action.type) {
    case "begin": {
      const started = startOperation(action.operation, action.phaseText);
      return { ...state, operations: [...state.operations, started] };
    }
    case "progress":
      return mapOperation(state, action.id, (op) => updateProgress(op, action.progress));
    case "request-cancel":
      return mapOperation(state, action.id, (op) => requestCancellation(op));
    case "confirm-cancel":
      return mapOperation(state, action.id, (op) => confirmCancellation(op));
    case "complete":
      return mapTerminal(
        state,
        action.id,
        action.atMs,
        (op) => completeOperation(op, action.transactionId ?? null)
      );
    case "complete-partial":
      return mapTerminal(
        state,
        action.id,
        action.atMs,
        (op) => completePartial(op, action.failed, action.transactionId ?? null)
      );
    case "fail":
      return mapTerminal(
        state,
        action.id,
        action.atMs,
        (op) => failOperation(op, action.failure, action.transactionId ?? null)
      );
    case "acknowledge":
      if (state.acknowledged.includes(action.id)) return state;
      return { ...state, acknowledged: [...state.acknowledged, action.id] };
    case "remove": {
      if (!state.operations.some((op) => op.id === action.id)) return state;
      const { [action.id]: _settled, ...settledAtMs } = state.settledAtMs;
      return {
        operations: state.operations.filter((op) => op.id !== action.id),
        acknowledged: state.acknowledged.filter((id) => id !== action.id),
        settledAtMs
      };
    }
  }
}
function mapTerminal(state, id, atMs, transition) {
  const before = state.operations.find((op) => op.id === id);
  if (before === void 0) return state;
  const after = transition(before);
  if (after === before) return state;
  const operations = state.operations.map((op) => op.id === id ? after : op);
  return withSettledAt({ ...state, operations }, before, after, atMs);
}
var UPDATE_TASK_NAME = "Update";
var UPDATE_OPERATION_ID = "tflex-update";
var UPDATE_SCOPE = "TFlex";
var UPDATE_AVAILABLE_PHASE = "Update available";
var UPDATE_DOWNLOADING_PHASE = "Downloading update";
function updateIdentity() {
  return {
    docId: UPDATE_OPERATION_ID,
    tabId: UPDATE_OPERATION_ID,
    path: null,
    displayName: UPDATE_SCOPE
  };
}
function activityFromUpdateStart(phaseText) {
  const capability = capabilityFor("update");
  const queued = createOperation({
    id: UPDATE_OPERATION_ID,
    document: updateIdentity(),
    task: { name: UPDATE_TASK_NAME, scope: UPDATE_SCOPE },
    completionActions: capability.completionActions,
    cancelable: capability.cancelable
  });
  return startOperation(queued, phaseText);
}
function runningUpdateAction(current, phaseText) {
  if (current === void 0) {
    return { type: "begin", operation: activityFromUpdateStart(phaseText) };
  }
  return {
    type: "progress",
    id: UPDATE_OPERATION_ID,
    progress: makeProgress({ phaseText })
  };
}
function updateStateAction(current, next) {
  switch (next?.kind) {
    case "available":
      return runningUpdateAction(current, UPDATE_AVAILABLE_PHASE);
    case "downloading":
      return runningUpdateAction(current, UPDATE_DOWNLOADING_PHASE);
    case "downloaded":
      return { type: "complete", id: UPDATE_OPERATION_ID };
    case "error":
      return {
        type: "fail",
        id: UPDATE_OPERATION_ID,
        failure: { item: UPDATE_TASK_NAME, reason: next.message }
      };
    case "checking":
    case "up-to-date":
    case "unsupported":
      return current === void 0 ? null : { type: "remove", id: UPDATE_OPERATION_ID };
    default:
      return current === void 0 ? null : { type: "remove", id: UPDATE_OPERATION_ID };
  }
}

// test-fixtures/tfl1315/probe_update.ts
function rows(st) {
  return st.operations.map((o) => ({ id: o.id, state: o.state.kind }));
}
function drive(label, states, useGuard) {
  let st = initialActivityShelfState;
  let lastKey = null;
  const log = [];
  for (const s of states) {
    const key = s === null ? "null" : s.kind;
    let skipped = false;
    if (useGuard) {
      if (lastKey === key) skipped = true;
      else lastKey = key;
    }
    const current = st.operations.find((o) => o.id === UPDATE_OPERATION_ID);
    const action = skipped ? null : updateStateAction(current, s);
    if (action !== null) st = reduceActivityShelf(st, action);
    log.push({ in: s === null ? null : s.kind, skipped, action: action ? action.type : null, rows: rows(st) });
  }
  return { label, useGuard, log };
}
var out = [
  drive("downloaded-no-prior", [{ kind: "downloaded", version: "9" }], true),
  drive("error-then-retry-downloading-without-checking", [
    { kind: "available", version: "9" },
    { kind: "error", message: "network down" },
    { kind: "downloading", progress: 10 },
    { kind: "downloaded", version: "9" }
  ], true),
  drive("unsupported-clears", [
    { kind: "available", version: "9" },
    { kind: "unsupported", reason: "no channel" }
  ], true),
  drive("repeat-same-kind-then-complete", [
    { kind: "available", version: "9" },
    { kind: "available", version: "9" },
    { kind: "downloading", progress: 1 },
    { kind: "downloading", progress: 2 },
    { kind: "downloaded", version: "9" }
  ], true),
  drive("completed-then-new-cycle", [
    { kind: "downloading", progress: 1 },
    { kind: "downloaded", version: "9" },
    { kind: "available", version: "10" },
    { kind: "downloading", progress: 5 },
    { kind: "downloaded", version: "10" }
  ], true),
  drive("error-then-checking-clears", [
    { kind: "available", version: "9" },
    { kind: "error", message: "x" },
    { kind: "checking" }
  ], true)
];
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
