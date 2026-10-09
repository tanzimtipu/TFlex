// Phase 118 (Drag Drop and Import) - the Intake Tray surface primitive.
//
// Presentational: it renders ONE ordered intake queue and forwards user intent
// to the host through callbacks. It owns no state and no dispatch logic - the
// host (chunks C/D/E) drives the `src/renderer/intake/model.ts` queue and wires
// the real operations. Rows mirror the Create-from-images reorder contract:
// index, basename, detected type, state, move up / down and Remove from queue.
//
// Truthfulness: a row never shows "Ready" for an unresolved detection (the
// model starts items `validating`), and a failed row without explicit text
// falls back to the real `unsupportedFileMessage` rather than invented copy.
//
// Accessibility: the tray is a labelled region, each row is focusable and
// named, Alt+ArrowUp / Alt+ArrowDown reorder a focused row (IME-safe), and an
// item error is a `role="alert"` node.

import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { ChevronDown, ChevronUp, FolderOpen } from "lucide-react";
import { Icon } from "../icons/Icon";
import { Button, IconButton } from "../components/Button";
import { unsupportedFileMessage } from "../state/convert";
import type { IntakeItem, IntakeKind, IntakeState } from "./model";

export interface IntakeTrayProps {
  /** The ordered queue. Order is authoritative and preserved verbatim. */
  items: readonly IntakeItem[];
  /** True while an eligible OS file drag is over the app (drop indication). */
  active?: boolean;
  /** Render the in-tray drop hint; the canvas surface opts out (Home keeps it). */
  showDropzone?: boolean;
  /** Empty-state sentence; a concise default is used when omitted. */
  emptyHint?: string;
  /** Remove from queue only - the host must never delete the file. */
  onRemove?: (id: string) => void;
  /** Move the row at `index` one slot by `dir`; bounds are enforced by the model. */
  onMove?: (index: number, dir: -1 | 1) => void;
  /** The ONE completion control (Phase 118 ruling 12): dispatches the queue
   *  through the real open / image-creation operations. Disabled when no item
   *  is `ready`, and while any item is `validating` / `converting`. */
  onOpen?: () => void;
  className?: string;
}

const KIND_LABEL: Record<IntakeKind, string> = {
  pdf: "PDF",
  image: "Image",
  convertible: "Convertible",
  unknown: "Unrecognized",
};

const STATE_LABEL: Record<IntakeState, string> = {
  validating: "Checking",
  ready: "Ready",
  converting: "Converting",
  failed: "Failed",
  done: "Done",
};

/** The accessible full location, kept off the visible row (safe text node). */
function sourceTitle(item: IntakeItem): string {
  return typeof item.pathOrFile === "string" ? item.pathOrFile : item.name;
}

/** The truthful error line, or null when the item has no error to show. */
function errorTextFor(item: IntakeItem): string | null {
  if (item.error !== undefined && item.error !== "") return item.error;
  if (item.state === "failed") {
    return item.kind === "unknown"
      ? unsupportedFileMessage(item.name)
      : `"${item.name}" could not be added to the queue.`;
  }
  return null;
}

function rowLabel(item: IntakeItem, index: number): string {
  return `${index + 1}. ${item.name}, ${KIND_LABEL[item.kind]}, ${STATE_LABEL[item.state]}`;
}

export function IntakeTray({
  items,
  active = false,
  showDropzone = true,
  emptyHint,
  onRemove,
  onMove,
  onOpen,
  className,
}: IntakeTrayProps): ReactElement {
  // A row is busy while its real operation is running, so the tray exposes one
  // honest `aria-busy` for assistive tech instead of a spinner per row.
  const busy = items.some(
    (item) => item.state === "validating" || item.state === "converting",
  );
  // Ruling 12 — the completion control is the ONE dispatch trigger. It is
  // enabled only with a `ready` item to act on and never while the queue is
  // still validating / converting (a dispatch in flight).
  const hasReady = items.some((item) => item.state === "ready");
  const canOpen = hasReady && !busy;
  const onRowKeyDown =
    (index: number) =>
    (event: ReactKeyboardEvent<HTMLLIElement>): void => {
      if (event.nativeEvent.isComposing) return;
      const item = items[index];
      if (item === undefined) return;
      // Delete / Backspace is the keyboard alternative to the Remove button.
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        onRemove?.(item.id);
        return;
      }
      // Alt+Arrow reorders the focused row, IME-safe.
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onMove?.(index, -1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        onMove?.(index, 1);
      }
    };

  return (
    <section
      className={["intake-tray", className].filter(Boolean).join(" ")}
      data-intake-tray
      data-intake-count={items.length}
      aria-label="Intake queue"
      {...(busy ? { "aria-busy": true } : {})}
    >
      {showDropzone ? (
        <div
          className="intake-dropzone"
          data-intake-dropzone
          {...(active ? { "data-intake-active": true } : {})}
        >
          <span className="intake-dropzone-icon" aria-hidden="true">
            <Icon icon={FolderOpen} size="md" />
          </span>
          <span className="intake-dropzone-text">
            <span className="intake-dropzone-title">
              Drop files to add them to the queue
            </span>
            <span className="intake-dropzone-hint">
              PDFs open as tabs; images become one PDF.
            </span>
          </span>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="intake-empty">
          {emptyHint ?? "No files added yet."}
        </p>
      ) : (
        <ul className="intake-list" aria-label="Queued files">
          {items.map((item, index) => {
            const errorText = errorTextFor(item);
            const errorId = `intake-error-${item.id}`;
            return (
              <li
                key={item.id}
                className="intake-row"
                data-intake-row={index}
                tabIndex={0}
                aria-label={rowLabel(item, index)}
                {...(errorText !== null
                  ? { "aria-describedby": errorId }
                  : {})}
                onKeyDown={onRowKeyDown(index)}
              >
                <div className="intake-row-main">
                  <span className="intake-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="intake-name" title={sourceTitle(item)}>
                    {item.name}
                  </span>
                  <span className="intake-kind">{KIND_LABEL[item.kind]}</span>
                  <span
                    className={`intake-state intake-state--${item.state}`}
                    data-intake-state={item.state}
                  >
                    {STATE_LABEL[item.state]}
                  </span>
                  <div className="intake-row-controls">
                    <IconButton
                      label={`Move ${item.name} up`}
                      size="sm"
                      className="intake-move"
                      disabled={index === 0}
                      data-intake-move-up={index}
                      icon={<Icon icon={ChevronUp} size="sm" />}
                      onClick={(): void => onMove?.(index, -1)}
                    />
                    <IconButton
                      label={`Move ${item.name} down`}
                      size="sm"
                      className="intake-move"
                      disabled={index === items.length - 1}
                      data-intake-move-down={index}
                      icon={<Icon icon={ChevronDown} size="sm" />}
                      onClick={(): void => onMove?.(index, 1)}
                    />
                    <IconButton
                      label={`Remove ${item.name} from the queue`}
                      size="sm"
                      className="intake-remove"
                      data-intake-remove={index}
                      icon={<Icon name="dialogClose" size="sm" />}
                      onClick={(): void => onRemove?.(item.id)}
                    />
                  </div>
                </div>
                {errorText !== null ? (
                  <p
                    className="intake-error"
                    id={errorId}
                    data-intake-error={index}
                    role="alert"
                  >
                    {errorText}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <div className="intake-actions">
          <Button
            intent="primary"
            kind="action"
            density="compact"
            className="intake-open"
            data-intake-open
            disabled={!canOpen}
            onClick={(): void => onOpen?.()}
          >
            Open
          </Button>
        </div>
      )}
    </section>
  );
}
