// TFL-873 (chunk C2a) — PreviewTaskDialog: the list/preview task surface.
//
// Builds on TaskDialog with the wider preview width class. The height is
// content-driven: the `task-dialog-preview-grow` marker (and therefore the
// reserved preview body height) is emitted ONLY once content is present, so
// an empty preview collapses to its header/footer instead of reserving a
// large blank body. The bounded single body scroll still comes from
// TaskDialog -> DialogShell.

import { Children, type ReactElement } from "react";
import { TaskDialog, type TaskDialogProps } from "./TaskDialog";

export interface PreviewTaskDialogProps extends Omit<TaskDialogProps, "width"> {
  /** Extra class(es) appended to the preview root. */
  className?: string;
}

export function PreviewTaskDialog(props: PreviewTaskDialogProps): ReactElement {
  const { children, className, ...rest } = props;
  const hasContent = Children.count(children) > 0;
  const rootClass = [
    "task-dialog-preview",
    hasContent ? "task-dialog-preview-grow" : undefined,
    className,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return (
    <TaskDialog {...rest} className={rootClass}>
      {children}
    </TaskDialog>
  );
}
