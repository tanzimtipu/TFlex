// TFL-873 (chunk C2a) — TaskDialog: the shared task-transaction surface.
//
// A thin composition of DialogShell. TaskDialog owns the interaction-surface
// geometry only (16px radius via --radius-panel, 1px border, --isf-shadow
// elevation, 24px padding, 16px field-group gap) plus a bounded single body
// scroll; DialogShell keeps every modal contract (Esc stack, backdrop guard,
// initial focus to the `default` action, dialog role/name, inert exit and
// focus return). Feature dialogs migrate onto this primitive in later chunks;
// this chunk ships the primitive only.

import type { ReactElement, ReactNode } from "react";
import { DialogShell, type DialogShellProps } from "./DialogShell";

export type TaskDialogWidth = "compact" | "standard";

export interface TaskDialogProps
  extends Omit<DialogShellProps, "size" | "className" | "bodyScroll" | "children"> {
  /** Nominal content-driven width: compact (440px) or standard (560px). */
  width?: TaskDialogWidth;
  /** Extra class(es) appended to the task-dialog root. */
  className?: string;
  /** Body content; optional so an empty/placeholder task surface can render. */
  children?: ReactNode;
}

const WIDTH_CLASS: Record<TaskDialogWidth, string> = {
  compact: "task-dialog-compact",
  standard: "task-dialog-standard",
};

export function TaskDialog(props: TaskDialogProps): ReactElement {
  const { width = "standard", className, children, ...rest } = props;
  const rootClass = ["task-dialog", WIDTH_CLASS[width], className]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return (
    <DialogShell {...rest} className={rootClass} bodyScroll>
      {children}
    </DialogShell>
  );
}
