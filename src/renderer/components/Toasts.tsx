import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { TfToast } from './motion/TfMotion';

/** Toast kind. Phase 13 adds `success` + `warning` so the renderer can
 *  surface non-error non-info results distinctly. The accent still
 *  claims only the `info` slot — success / warning / error are
 *  status-only colours, never primary actions. Every existing call
 *  site passes `'info'` or `'error'`; the new kinds are opt-in. */
export interface Toast {
  id: number;
  kind: 'error' | 'info' | 'success' | 'warning';
  text: string;
}

/** Pure mapping from kind to icon component. Extracted so tests can
 *  pin the kind -> icon contract without rendering the component. */
export function toastIcon(kind: Toast['kind']): typeof AlertCircle {
  switch (kind) {
    case 'error': return AlertCircle;
    case 'success': return CheckCircle;
    case 'warning': return AlertTriangle;
    case 'info': return Info;
  }
}

/** Pure durability contract for the toast surface. Only non-actionable
 *  kinds auto-dismiss; `null` means the toast persists until the user
 *  clicks Dismiss. Actionable kinds (`warning`, `error`) must never
 *  vanish before they are read. Extracted so tests can pin the
 *  kind -> auto-dismiss contract without rendering the component. */
export function toastAutoDismissMs(kind: Toast['kind']): number | null {
  switch (kind) {
    case 'success':
    case 'info':
      return 5000;
    case 'warning':
    case 'error':
      return null;
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
