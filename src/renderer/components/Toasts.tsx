import { CheckCircle, Info, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { TfToast } from './motion/TfMotion';

/** The wide INPUT union for a toast request. Phase 126 retires the
 *  `warning` / `error` toast SURFACE — those tones are routed into the
 *  in-canvas `CanvasAlertNotice` by the App reducer — but the ~100
 *  existing call sites still name them, so the input type stays wide.
 *  Only `info` / `success` are ever rendered as toasts. */
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** The RENDERED toast record. Phase 126 narrows this to the surviving
 *  kinds: `warning` / `error` no longer have a toast presentation. The
 *  accent claims only the `info` slot — `success` is a status-only
 *  colour, never a primary action. */
export interface Toast {
  id: number;
  kind: 'info' | 'success';
  text: string;
}

/** Pure mapping from kind to icon component. Extracted so tests can
 *  pin the kind -> icon contract without rendering the component. */
export function toastIcon(kind: Toast['kind']): typeof CheckCircle {
  switch (kind) {
    case 'success': return CheckCircle;
    case 'info': return Info;
  }
}

/** Pure durability contract for the toast surface. Both surviving kinds
 *  are non-actionable and auto-dismiss; `null` would mean the toast
 *  persists until the user clicks Dismiss. Extracted so tests can pin
 *  the kind -> auto-dismiss contract without rendering the component. */
export function toastAutoDismissMs(kind: Toast['kind']): number | null {
  switch (kind) {
    case 'success':
    case 'info':
      return 5000;
  }
}

export function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const autoDismissMs = toastAutoDismissMs(toast.kind);
    if (autoDismissMs === null) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.kind, onDismiss]);

  const ToastGlyph = toastIcon(toast.kind);
  return (
    <TfToast
      toastKind={toast.kind}
      layout
      className={`toast toast-${toast.kind}`}
    >
      <Icon icon={ToastGlyph} size="sm" className="toast-icon" />
      <span className="toast-text">{toast.text}</span>
      <IconButton
        label="Dismiss"
        intent="tertiary"
        kind="action"
        density="compact"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        icon={<Icon icon={X} size="sm" />}
      />
    </TfToast>
  );
}
