// DialogShell — the ONE reusable dialog structure for every modal in the app.
//
// Phase 92 (TFL-513 chunk A). The shell renders the shipped modal DOM exactly
// (backdrop -> dialog -> header / body / footer) so no selector or e2e hook
// moves, and it owns three things exactly once so adopters delete their
// duplicated copies:
//   - Esc-to-close (only when `onClose` is supplied),
//   - the shared backdrop-close drag guard (`useBackdropClose`),
//   - initial focus to the action marked `default`.
//
// `onClose` omitted makes a dialog must-answer: no close X, no backdrop close
// and no Esc. Every extra prop passed here (including arbitrary `data-*`
// hooks) is forwarded to the `TfDialog` root unchanged. Actions render as the
// canonical `.btn` variants, carry `data-dialog-action={key}` and forward any
// extra per-action data hook the caller attached (so an adopter's existing
// action hooks survive adoption).

import {
  useEffect,
  useRef,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "../icons/Icon";
import { AnimatePresence } from "motion/react";
import { useBackdropClose } from "./modalBackdrop";
import { TfBackdrop, TfDialog, TfSheet } from "./motion/TfMotion";
import { useDragWindow } from "./useDragWindow";

export interface DialogAction {
  key: string;
  label: string;
  /** Optional leading glyph rendered immediately before the label. */
  icon?: ReactNode;
  variant: "primary" | "secondary" | "tertiary" | "danger";
  onClick: () => void;
  disabled?: boolean;
  /** The action that receives initial focus on open. Exactly one per dialog. */
  default?: boolean;
  testId?: string;
}

export interface DialogShellProps {
  open: boolean;
  title: string;
  titleId?: string;
  /** Omit to make the dialog must-answer: no close X, no backdrop close, no Esc. */
  onClose?: () => void;
  /** While true the backdrop ignores clicks; Esc and the close X are unaffected. */
  blockBackdropClose?: boolean;
  /** Renders the header close X `disabled`; Esc and the backdrop guard are unaffected. */
  closeDisabled?: boolean;
  /** Optional `data-testid` for the header close X (keeps a shipped hook alive). */
  closeTestId?: string;
  /** Forwarded to the dialog root; lets an adopter keep a per-dialog Enter handler. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  icon?: ReactNode;
  /** TFL-873 (C2a) — one line of real document/task context rendered under
   *  the title in a `.modal-context` row. Omitted => the header DOM, class
   *  list and every data-* hook stay byte-identical. */
  headerContext?: ReactNode;
  size?: "sm" | "md" | "lg" | "tool";
  /** Dialog role; ConfirmDialog passes "alertdialog". Default "dialog". */
  role?: "dialog" | "alertdialog";
  /** Which surface family the shell renders. Default "dialog" (unchanged).
   *  "sheet" renders the shipped .sheet chrome (TfBackdrop .sheet-backdrop +
   *  TfSheet .sheet + .sheet-header/.sheet-title/.sheet-close/.sheet-body)
   *  so a sheet adopter keeps its surface. */
  surface?: "dialog" | "sheet";
  /** Accessible name (and title) for the close button. Default "Close dialog".
   *  Sheets use labels like "Close about dialog" / "Close preferences". */
  closeAriaLabel?: string;
  actions?: DialogAction[];
  /** Custom footer node, only for a dialog whose footer is not a plain action row. */
  footer?: ReactNode;
  bodyClassName?: string;
  /** TFL-873 (C2a) — opt into a bounded single body scroll: adds
   *  `modal-body-scroll` to the body and `modal-dialog-body-scroll` to the
   *  dialog root so the header and footer stay pinned. Omitted => the body
   *  DOM and class list are byte-identical. */
  bodyScroll?: boolean;
  className?: string;
  testId?: string;
  /** DEF-147 floating window. When set, the dialog root becomes a drag
   *  handle: a press on the dialog chrome (any element NOT matching
   *  `controlsSelector`) starts a viewport-clamped move, the root gains
   *  `modal-dialog-dragging` while in flight, and the offset is folded
   *  into the TfDialog motion `x`/`y`. Unset => every existing adopter is
   *  byte-identical. */
  draggable?: { controlsSelector: string };
  children: ReactNode;
}

const VARIANT_CLASS: Record<DialogAction["variant"], string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  tertiary: "btn-ghost",
  danger: "btn-danger",
};

const SIZE_CLASS: Record<NonNullable<DialogShellProps["size"]>, string> = {
  sm: "dialog-shell-sm",
  md: "",
  lg: "modal-dialog-wide",
  tool: "modal-dialog-tool",
};

function joinClasses(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

// A must-answer dialog (no `onClose`) wires no close handler; useBackdropClose
// still needs a callable it will never invoke while `blocked` is true.
function noop(): void {
  // intentionally empty
}

// DEF-525 — the last-opened still-open Esc-owning shell. Each mounted shell
// with an `onClose` pushes its token; only the tail handles a window Escape so
// two stacked dialogs no longer close on one key press.
const openShellStack: symbol[] = [];

export function DialogShell(props: DialogShellProps): ReactElement {
  const {
    open,
    title,
    titleId,
    onClose,
    blockBackdropClose = false,
    closeDisabled = false,
    closeTestId,
    icon,
    headerContext,
    size = "md",
    role = "dialog",
    surface = "dialog",
    closeAriaLabel = "Close dialog",
    actions,
    footer,
    bodyClassName,
    bodyScroll = false,
    className,
    testId,
    draggable,
    children,
    ...rest
  } = props;
  const defaultActionRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // DEF-525 — a stable per-instance identity for the open-shell stack.
  const shellToken = useRef(Symbol()).current;
  // DEF-147 floating window. Called unconditionally (hook order) even when
  // `draggable` is unset; the fallback selector is only ever consulted from
  // `handleProps.onPointerDown`, which is never wired in that case.
  const drag = useDragWindow({
    controlsSelector: draggable?.controlsSelector ?? "[data-dialog-shell-no-drag]",
  });

  // Esc closes only when the dialog has an onClose, and only for the top-most
  // open shell (DEF-525) so stacked dialogs close one at a time. A must-answer
  // dialog ignores the key entirely.
  useEffect(() => {
    if (!open || onClose === undefined) return;
    openShellStack.push(shellToken);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (openShellStack[openShellStack.length - 1] !== shellToken) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const index = openShellStack.lastIndexOf(shellToken);
      if (index !== -1) openShellStack.splice(index, 1);
    };
  }, [open, onClose, shellToken]);

  // Initial focus lands on the marked default action once the dialog mounts.
  // When that action is disabled at open, fall back to the first enabled
  // control so open always lands a visible focus (DEF-521).
  useEffect(() => {
    if (!open) return;
    queueMicrotask((): void => {
      const target = defaultActionRef.current;
      if (target !== null && !target.disabled) {
        target.focus();
        return;
      }
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    });
  }, [open]);

  // B3/B6 drag guard shared with every other modal. `onClose === undefined`
  // makes the dialog must-answer: the backdrop simply has no close handler.
  // `blockBackdropClose` lets a busy dialog keep its backdrop inert while
  // Esc and the close X stay live.
  const backdrop = useBackdropClose(
    onClose ?? noop,
    blockBackdropClose || onClose === undefined,
  );

  const isSheet = surface === "sheet";
  const dragging = draggable !== undefined && drag.dragging;

  const dialogClassName = joinClasses([
    "modal-dialog",
    "dialog",
    "dialog-shell",
    SIZE_CLASS[size],
    bodyScroll ? "modal-dialog-body-scroll" : undefined,
    className,
    dragging ? "modal-dialog-dragging" : undefined,
  ]);

  // TFL-513-E2a — the sheet surface keeps the shipped `.sheet` chrome so an
  // adopter (E2b) loses no selector. `size` is ignored; the drag-state class
  // matches the dialog surface so a draggable sheet behaves identically.
  const sheetClassName = joinClasses([
    "sheet",
    className,
    dragging ? "modal-dialog-dragging" : undefined,
  ]);

  // Shared header/body/footer, differing only in element classes.
  const HeaderTag: "header" | "div" = isSheet ? "header" : "div";
  const headerNode = (
    <HeaderTag
      className={joinClasses([
        isSheet ? "sheet-header" : "modal-header",
        headerContext !== undefined ? "has-header-context" : undefined,
      ])}
    >
      {icon}
      <h2 className={isSheet ? "sheet-title" : "modal-title"} id={titleId}>
        {title}
      </h2>
      {onClose !== undefined && (
        <button
          type="button"
          className={
            isSheet ? "btn btn-ghost btn-icon sheet-close" : "btn btn-ghost btn-icon modal-close"
          }
          onClick={(): void => onClose()}
          aria-label={closeAriaLabel}
          title={closeAriaLabel}
          disabled={closeDisabled}
          data-testid={closeTestId}
        >
          <Icon name="dialogClose" size="sm" />
        </button>
      )}
      {headerContext !== undefined && <div className="modal-context">{headerContext}</div>}
    </HeaderTag>
  );

  const bodyNode = (
    <div
      className={joinClasses([
        isSheet ? "sheet-body" : "modal-body",
        bodyScroll ? "modal-body-scroll" : undefined,
        bodyClassName,
      ])}
    >
      {children}
    </div>
  );

  const footerNode =
    footer !== undefined ? (
      footer
    ) : actions !== undefined ? (
      <div className={isSheet ? "sheet-footer" : "modal-footer"}>
        {actions.map((action) => {
          const {
            key,
            label,
            icon,
            variant,
            onClick,
            disabled,
            default: isDefault,
            testId: actionTestId,
            ...actionRest
          } = action;
          return (
            <button
              key={key}
              type="button"
              className={`btn ${VARIANT_CLASS[variant]}`}
              onClick={onClick}
              disabled={disabled}
              data-dialog-action={key}
              data-testid={actionTestId}
              data-dialog-default={isDefault ? true : undefined}
              ref={isDefault ? defaultActionRef : undefined}
              {...actionRest}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>
    ) : null;

  const dragProps =
    draggable !== undefined
      ? {
          onPointerDown: (e: ReactPointerEvent<HTMLDivElement>): void => {
            e.stopPropagation();
            drag.handleProps.onPointerDown(e);
          },
          animate: { x: drag.offset.x, y: drag.offset.y },
          exit: { x: drag.offset.x, y: drag.offset.y + 5 },
        }
      : {};

  const dialogRefCallback = (el: HTMLDivElement | null): void => {
    dialogRef.current = el;
    if (draggable !== undefined) drag.windowRef(el);
  };

  return (
    <AnimatePresence>
      {open && (
        isSheet ? (
          <TfBackdrop className="sheet-backdrop" {...backdrop}>
            <TfSheet
              {...rest}
              ref={dialogRefCallback}
              className={sheetClassName}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              data-dialog-shell={testId ?? true}
              {...dragProps}
            >
              {headerNode}
              {bodyNode}
              {footerNode}
            </TfSheet>
          </TfBackdrop>
        ) : (
          <TfBackdrop className="modal-backdrop" {...backdrop}>
            <TfDialog
              {...rest}
              ref={dialogRefCallback}
              className={dialogClassName}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              data-dialog-shell={testId ?? true}
              {...dragProps}
            >
              {headerNode}
              {bodyNode}
              {footerNode}
            </TfDialog>
          </TfBackdrop>
        )
      )}
    </AnimatePresence>
  );
}
