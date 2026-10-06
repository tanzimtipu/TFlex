// Phase 57 (feature A) — the Engineering layers panel.
//
// Lists the active document's optional content groups (layers) with a
// visibility toggle each. A toggle mutates the document through the engine
// (`setLayerVisibility`), which is undoable and marks the doc modified, then
// the host applies the echoed EngineState and rebuilds the pdf.js proxy so the
// page re-renders with the layer off. On a failed toggle the checkbox reverts
// and the mapped error is toasted — never a silent no-op.
//
// The panel owns no engine state: every call is injected, mirroring
// FormDataIoDialog / ValidateDocumentDialog. A document that declares no
// layers renders an explicit empty state, never a blank dialog.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import type { Result } from '../../shared/result';
import type { EngineError } from '../../shared/types';
import type { EngineState } from '../engine/types';
import type { PdfLayer } from '../../shared/types';
import { useBackdropClose } from './modalBackdrop';
import { TfBackdrop, TfDialog } from './motion/TfMotion';

export interface EngineeringLayersPanelProps {
  open: boolean;
  /** The panel applies a toggle through this engine call. */
  setLayerVisibility: (
    docId: string,
    index: number,
    visible: boolean,
  ) => Promise<Result<EngineState, EngineError>>;
  /** The engine doc id the toggles address. */
  docId: string;
  /** The layers to list, as fetched by the host. */
  layers: readonly PdfLayer[];
  /** Host hook: mirror the echoed state (noteOpApplied). */
  onStateApplied: (state: EngineState) => void;
  /** Host hook: rebuild the pdf.js proxy so the page re-renders. */
  refreshDocProxyFor: () => Promise<boolean>;
  /** Host hook: surface a failed toggle. */
  pushToast: (level: 'error' | 'info', message: string) => void;
  onClose: () => void;
}

/** Map an EngineError to the toast the user sees. */
function layerErrorText(error: EngineError, message: string): string {
  if (error === 'engine-error' && message.trim() !== '') return message;
  return 'Could not change the layer visibility.';
}

export function EngineeringLayersPanel(
  props: EngineeringLayersPanelProps,
): ReactElement | null {
  const {
    open,
    docId,
    layers,
    setLayerVisibility,
    onStateApplied,
    refreshDocProxyFor,
    pushToast,
    onClose,
  } = props;

  // The checkbox values, seeded from the fetched layers. Kept local so a
  // failed toggle can revert exactly one row.
  const [visibleById, setVisibleById] = useState<Record<number, boolean>>({});
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setVisibleById(Object.fromEntries(layers.map((l) => [l.index, l.visible])));
    setPending(new Set());
  }, [open, layers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const backdrop = useBackdropClose(onClose, pending.size > 0);

  const onToggle = async (index: number, nextVisible: boolean): Promise<void> => {
    const prev = visibleById[index];
    setVisibleById((cur) => ({ ...cur, [index]: nextVisible }));
    setPending((cur) => new Set(cur).add(index));
    const result = await setLayerVisibility(docId, index, nextVisible);
    if (result.ok) {
      onStateApplied(result.value);
      try {
        await refreshDocProxyFor();
      } catch {
        // The proxy refresh has its own failure toast; the toggle still
        // stands (the engine accepted it).
      }
    } else {
      // Revert to the previous value and surface the mapped error.
      setVisibleById((cur) => ({ ...cur, [index]: prev ?? false }));
      pushToast('error', layerErrorText(result.error.code, result.error.message));
    }
    setPending((cur) => {
      const next = new Set(cur);
      next.delete(index);
      return next;
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop} data-engineering-layers-dialog>
          <TfDialog
            className="modal-dialog dialog engineering-layers-dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="engineering-layers-title"
          >
            <div className="modal-header">
              <h2 id="engineering-layers-title" className="modal-title">
                <Icon name="engineeringLayers" size="sm" /> Engineering layers
              </h2>
              <IconButton
                label="Close dialog"
                intent="tertiary"
                kind="action"
                density="standard"
                className="modal-close"
                onClick={onClose}
                data-testid="layer-close"
                icon={<Icon icon={X} size="sm" />}
              />
            </div>
            <div className="modal-body">
              {layers.length === 0 ? (
                <div className="engineering-layers-empty" data-testid="layer-empty">
                  This document declares no layers.
                </div>
              ) : (
                <>
                  <p className="engineering-layers-count" data-testid="layer-count">
                    {layers.length} layer{layers.length === 1 ? '' : 's'}
                  </p>
                  <ul className="engineering-layers-list">
                    {layers.map((layer) => {
                      const checked = visibleById[layer.index] ?? layer.visible;
                      const busy = pending.has(layer.index);
                      return (
                        <li
                          key={layer.index}
                          className="engineering-layer-row"
                          data-testid="layer-row"
                        >
                          <label className="engineering-layer-label">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              data-testid="layer-toggle"
                              onChange={(e): void => {
                                void onToggle(layer.index, e.target.checked);
                              }}
                            />
                            <span data-layer-name>{layer.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                data-testid="layer-close-footer"
              >
                Close
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
