// Phase 6 — About dialog.
//
// Opens as a Sheet on top of the app. Reads `AppInfo` from the backend
// over IPC (app.getInfo) — the contract entry is in src/shared/ipc.ts,
// but the renderer is defensive: if the preload wiring hasn't shipped
// yet (the backend side is still being added in parallel), the dialog
// shows a sensible fallback ("Version unavailable") instead of
// crashing. Once backend-dev lands the wiring, the real version and
// electron / node versions will populate automatically.

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AppInfo } from '../../shared/types';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

const FALLBACK_INFO: AppInfo = {
  version: 'unavailable',
  electronVersion: 'unavailable',
  nodeVersion: 'unavailable',
  storagePaths: {
    userData: 'unavailable',
    settings: 'unavailable',
    signatures: 'unavailable',
    cache: 'unavailable',
  },
};

export function AboutDialog(props: AboutDialogProps): ReactElement | null {
  const { open, onClose } = props;
  const [info, setInfo] = useState<AppInfo>(FALLBACK_INFO);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tflex = (window as unknown as { tflex?: { app?: { getInfo?: () => Promise<AppInfo> } } }).tflex;
    if (tflex === undefined || tflex.app === undefined || typeof tflex.app.getInfo !== 'function') {
      setUnavailable(true);
      return (): void => {
        cancelled = true;
      };
    }
    void tflex.app.getInfo().then((value) => {
      if (cancelled) return;
      setInfo(value);
    }).catch(() => {
      if (cancelled) return;
      setUnavailable(true);
    });
    return (): void => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const handleOpenPath = (path: string): void => {
    const tflex = (window as unknown as { tflex?: { app?: { openPath?: (p: string) => Promise<void> } } }).tflex;
    if (tflex?.app?.openPath === undefined) return;
    void tflex.app.openPath(path).catch(() => undefined);
  };

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={(e): void => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet sheet-about"
        role="dialog"
        aria-labelledby="about-title"
        aria-modal="true"
        data-about-dialog
      >
        <header className="sheet-header">
          <h2 id="about-title" className="sheet-title">About TFlex</h2>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="Close about dialog"
          >
            <X size={14} aria-hidden />
          </button>
        </header>
        <div className="sheet-body">
          <div className="about-mark" aria-hidden>TF</div>
          <h3 className="about-name">TFlex</h3>
          <p className="about-tagline">A modern PDF studio for Windows.</p>
          <div className="about-meta">
            <div className="about-row">
              <span className="about-row-label">Version</span>
              <span className="about-row-value" data-about-version>{info.version}</span>
            </div>
            <div className="about-row">
              <span className="about-row-label">Electron</span>
              <span className="about-row-value">{info.electronVersion}</span>
            </div>
            <div className="about-row">
              <span className="about-row-label">Node</span>
              <span className="about-row-value">{info.nodeVersion}</span>
            </div>
          </div>
          {unavailable && (
            <div className="about-warning">
              The app info channel isn't wired yet. The About dialog will populate
              automatically once the backend finishes the IPC handler.
            </div>
          )}
          <div className="about-paths">
            <div className="about-row about-row-path">
              <span className="about-row-label">User data</span>
              <button
                type="button"
                className="about-row-value about-row-value-link"
                onClick={(): void => handleOpenPath(info.storagePaths.userData)}
                title={info.storagePaths.userData}
              >
                {info.storagePaths.userData}
              </button>
            </div>
            <div className="about-row about-row-path">
              <span className="about-row-label">Settings</span>
              <button
                type="button"
                className="about-row-value about-row-value-link"
                onClick={(): void => handleOpenPath(info.storagePaths.settings)}
                title={info.storagePaths.settings}
              >
                {info.storagePaths.settings}
              </button>
            </div>
            <div className="about-row about-row-path">
              <span className="about-row-label">Signatures</span>
              <button
                type="button"
                className="about-row-value about-row-value-link"
                onClick={(): void => handleOpenPath(info.storagePaths.signatures)}
                title={info.storagePaths.signatures}
              >
                {info.storagePaths.signatures}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}