import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { useEffect } from 'react';

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

export function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 5000);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const Icon = toastIcon(toast.kind);
  return (
    <div className={`toast toast-${toast.kind}`}>
      <Icon size={14} aria-hidden className="toast-icon" />
      <span className="toast-text">{toast.text}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
