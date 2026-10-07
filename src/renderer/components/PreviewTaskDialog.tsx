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
  /** TFL-1197 (DEF-632 / ER18) — override the content-driven grow marker.
   *  Omitted => the shipped behaviour (grow iff any children exist), so
   *  every existing host (StampDialog) is unchanged. A host whose children
   *  are always present but whose preview body is only meaningful when it
   *  has data (CreateFromImagesDialog) passes the real data condition. */
  grow?: boolean;
}

export function PreviewTaskDialog(props: PreviewTaskDialogProps): ReactElement {
  const { children, className, grow, ...rest } = props;
  const hasContent = Children.count(children) > 0;
  const shouldGrow = grow ?? hasContent;
  const rootClass = [
    "task-dialog-preview",
    shouldGrow ? "task-dialog-preview-grow" : undefined,
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
