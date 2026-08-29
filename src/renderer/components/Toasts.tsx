import { AlertCircle, Info, X } from 'lucide-react';
import { useEffect } from 'react';

export interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
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

  const Icon = toast.kind === 'error' ? AlertCircle : Info;
  return (
    <div className={`toast toast-${toast.kind}`}>
      <Icon size={14} aria-hidden />
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
