// Phase 118 (Drag Drop and Import) - THE one renderer intake model.
//
// This is the single ordered queue every intake entry point feeds: the Home
// surface, the Open path, OS / canvas drops and "Create PDF from images".
// It is deliberately free of React, Electron, IPC and engine imports - it
// performs no IO, trusts no file extension and calls nothing on its own.
//
// Truthfulness rules this module encodes:
//   - `add` produces a `validating` / `unknown` item. It never guesses a kind
//     from a filename (no bogus "Ready"): the caller performs the real
//     content / engine detection and hands the result to `classify`.
//   - `classify` takes that real detection result (`kind`, optional truthful
//     `error`); an item with an error becomes `failed` with its message, an
//     otherwise-clean item becomes `ready`.
//   - `remove` is queue-only: it splices the item out of the list and returns
//     it. It never deletes, moves or reads the underlying file.
//   - `dispatch` routes each `ready` item to the REAL operation the host
//     injects: PDFs go to `openPdf` (one session each, in order) and the whole
//     image set goes to `createFromImages` exactly once. Recognized
//     convertibles and unknowns are not dispatched here because the host owns
//     the conversion route; they are reported back as `skipped` and stay in
//     the queue.

/** Detected content kind. Never inferred from an extension by this module. */
export type IntakeKind = "pdf" | "image" | "convertible" | "unknown";

/** Item lifecycle. `done` is a successfully dispatched item. */
export type IntakeState =
  | "validating"
  | "ready"
  | "converting"
  | "failed"
  | "done";

/** One queued intake item. `pathOrFile` carries the real on-disk path or the
 *  picked / dropped `File`; `error` is present only while `failed`. `file`
 *  keeps the dropped `File` for a row whose `pathOrFile` is its resolved
 *  absolute path (the OS-drop route), so image dispatch still has the bytes
 *  while PDFs open by the real path. */
export interface IntakeItem {
  id: string;
  name: string;
  pathOrFile: string | File;
  kind: IntakeKind;
  state: IntakeState;
  error?: string;
  file?: File;
}

/** The caller's real detection result. `error` is the truthful, already
 *  human-readable failure text (from the engine / convert helpers); when set
 *  the item is `failed`, never a fabricated "Ready". */
export interface IntakeDetection {
  kind: IntakeKind;
  error?: string;
}

/** What `add` accepts. `name` is optional; the basename of `pathOrFile` is
 *  used when it is omitted so rows never expose a giant full path. `file` is
 *  the dropped `File` when `pathOrFile` is its resolved absolute path. */
export interface IntakeInput {
  pathOrFile: string | File;
  name?: string;
  file?: File;
}

/** Operations the host provides. The model owns none of them and calls only
 *  the ones present on the queue it can truthfully route. */
export interface IntakeDispatchCallbacks {
  openPdf(path: string): Promise<void>;
  createFromImages(files: Array<string | File>, quality: number): Promise<unknown>;
}

/** Outcome of one `dispatch`, kept so the surface can report partial failure
 *  while successes stay visible. `skipped` items remain in the queue. */
export interface IntakeDispatchResult {
  opened: IntakeItem[];
  images: IntakeItem[];
  skipped: IntakeItem[];
}

/** Default image quality used by `dispatch` when the host does not pass one.
 *  Mirrors `DEFAULT_CREATE_IMAGE_QUALITY` in `state/preferences.ts` so the
 *  model stays free of that module's import chain. */
export const DEFAULT_INTAKE_IMAGE_QUALITY = 0.85;

/** The public queue surface. */
export interface IntakeModel {
  add(input: IntakeInput): IntakeItem;
  addMany(inputs: readonly IntakeInput[]): IntakeItem[];
  classify(id: string, detection: IntakeDetection): IntakeItem | undefined;
  /** ready -> converting. Called by the host the moment the REAL operation
   *  for a ready item starts; any other state is left unchanged. */
  begin(id: string): IntakeItem | undefined;
  /** Settle a converting item: `ok` -> done (error cleared), otherwise
   *  -> failed with the truthful error. A non-converting item is unchanged. */
  settle(
    id: string,
    outcome: { ok: true } | { ok: false; error: string },
  ): IntakeItem | undefined;
  /** Quietly drop an item (a cancelled conversion leaves the queue with no
   *  error state and no toast) and return it. */
  cancel(id: string): IntakeItem | undefined;
  remove(id: string): IntakeItem | undefined;
  reorder(index: number, dir: -1 | 1): boolean;
  clear(): void;
  items(): readonly IntakeItem[];
  size(): number;
  dispatch(
    callbacks: IntakeDispatchCallbacks,
    quality?: number,
  ): Promise<IntakeDispatchResult>;
}

export interface IntakeModelOptions {
  /** Test seam; defaults to `crypto.randomUUID` with a counter fallback. */
  mintId?: () => string;
}

/** The display basename of a path or File. Strips both Windows and POSIX
 *  directory separators and any trailing separator, so a dropped full path
 *  renders as a short, safe text node. */
export function basename(pathOrFile: string | File): string {
  if (typeof pathOrFile !== "string") {
    return pathOrFile.name;
  }
  const parts = pathOrFile.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.length > 0 ? (parts[parts.length - 1] ?? pathOrFile) : pathOrFile;
}

/** Split `report.final.pdf` into `["report.final", ".pdf"]`. A leading dot
 *  (`.gitignore`) or a dotless name keeps the whole name as the stem. */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

/** A name not already present in `taken`, disambiguated as `stem (2).ext`.
 *  Duplicate basenames stay separate items - never merged or dropped. */
function uniqueName(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired;
  const [stem, ext] = splitExtension(desired);
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

/** The path a PDF item opens by. A `File` without a resolver falls back to its
 *  name; the host's `openPdf` owns any further resolution. */
function openPathFor(item: IntakeItem): string {
  return typeof item.pathOrFile === "string"
    ? item.pathOrFile
    : item.pathOrFile.name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let idSeq = 0;

function defaultMintId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoApi?.randomUUID !== undefined) {
    return `intake-${cryptoApi.randomUUID()}`;
  }
  idSeq += 1;
  return `intake-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/** Build the one ordered intake model. Plain object: no React, no globals
 *  beyond the optional id seam, so it is safe to unit-test in isolation. */
export function createIntakeModel(
  options: IntakeModelOptions = {},
): IntakeModel {
  const mintId = options.mintId ?? defaultMintId;
  const list: IntakeItem[] = [];
  // DEF-656 — one dispatch in flight per model. A concurrent dispatch() while
  // an await is pending is a no-op (returns the empty result) instead of
  // re-collecting the same `ready` items and building the images PDF twice.
  let dispatchInFlight = false;

  const add = (input: IntakeInput): IntakeItem => {
    const desired = input.name ?? basename(input.pathOrFile);
    const taken = new Set(list.map((item) => item.name));
    const item: IntakeItem = {
      id: mintId(),
      name: uniqueName(desired, taken),
      pathOrFile: input.pathOrFile,
      kind: "unknown",
      state: "validating",
    };
    if (input.file !== undefined) item.file = input.file;
    list.push(item);
    return item;
  };

  const classify = (
    id: string,
    detection: IntakeDetection,
  ): IntakeItem | undefined => {
    const item = list.find((entry) => entry.id === id);
    if (item === undefined) return undefined;
    item.kind = detection.kind;
    if (detection.error !== undefined && detection.error !== "") {
      item.state = "failed";
      item.error = detection.error;
    } else if (item.state === "validating" || item.state === "failed") {
      item.state = "ready";
      delete item.error;
    }
    return item;
  };

  const remove = (id: string): IntakeItem | undefined => {
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) return undefined;
    return list.splice(index, 1)[0];
  };

  const begin = (id: string): IntakeItem | undefined => {
    const item = list.find((entry) => entry.id === id);
    if (item === undefined) return undefined;
    if (item.state === "ready") {
      item.state = "converting";
      delete item.error;
    }
    return item;
  };

  const settle = (
    id: string,
    outcome: { ok: true } | { ok: false; error: string },
  ): IntakeItem | undefined => {
    const item = list.find((entry) => entry.id === id);
    if (item === undefined) return undefined;
    if (item.state !== "converting") return item;
    if (outcome.ok) {
      item.state = "done";
      delete item.error;
    } else {
      item.state = "failed";
      item.error = outcome.error;
    }
    return item;
  };

  const reorder = (index: number, dir: -1 | 1): boolean => {
    const to = index + dir;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) {
      return false;
    }
    const moved = list.splice(index, 1)[0];
    if (moved === undefined) return false;
    list.splice(to, 0, moved);
    return true;
  };

  const dispatch = async (
    callbacks: IntakeDispatchCallbacks,
    quality: number = DEFAULT_INTAKE_IMAGE_QUALITY,
  ): Promise<IntakeDispatchResult> => {
    // DEF-656 — defense in depth: a second dispatch while one is in flight
    // no-ops instead of rebuilding the images PDF.
    if (dispatchInFlight) {
      return { opened: [], images: [], skipped: [] };
    }
    dispatchInFlight = true;
    try {
      const opened: IntakeItem[] = [];
      const images: IntakeItem[] = [];
      const skipped: IntakeItem[] = [];
      const imageItems: IntakeItem[] = [];

      // DEF-655 — snapshot the queue before the await loop. Iterating the LIVE
      // array across `await callbacks.openPdf(...)` lets a remove() splice skip
      // the next unvisited item; iterating the snapshot and skipping any item
      // no longer in `list` makes a remove affect only that row.
      const snapshot = list.slice();
      for (const item of snapshot) {
        if (!list.includes(item)) continue; // removed mid-dispatch
        if (item.state !== "ready") {
          skipped.push(item);
          continue;
        }
        if (item.kind === "pdf") {
          item.state = "converting";
          try {
            await callbacks.openPdf(openPathFor(item));
            item.state = "done";
            opened.push(item);
          } catch (error) {
            item.state = "failed";
            item.error = errorMessage(error);
            skipped.push(item);
          }
        } else if (item.kind === "image") {
          // DEF-656 — enter `converting` at COLLECTION time, not after the PDF
          // loop, so a concurrent dispatch can never re-collect a `ready` image.
          item.state = "converting";
          imageItems.push(item);
        } else {
          skipped.push(item);
        }
      }

      // An image removed during a later PDF await must not be built either.
      const liveImageItems = imageItems.filter((item) => list.includes(item));
      if (liveImageItems.length > 0) {
        try {
          await callbacks.createFromImages(
            liveImageItems.map((item) => item.file ?? item.pathOrFile),
            quality,
          );
          for (const item of liveImageItems) {
            item.state = "done";
            images.push(item);
          }
        } catch (error) {
          const message = errorMessage(error);
          for (const item of liveImageItems) {
            item.state = "failed";
            item.error = message;
            skipped.push(item);
          }
        }
      }

      return { opened, images, skipped };
    } finally {
      dispatchInFlight = false;
    }
  };

  return {
    add,
    addMany: (inputs) => inputs.map(add),
    classify,
    begin,
    settle,
    cancel: remove,
    remove,
    reorder,
    clear: () => {
      list.length = 0;
    },
    items: () => list.slice(),
    size: () => list.length,
    dispatch,
  };
}
