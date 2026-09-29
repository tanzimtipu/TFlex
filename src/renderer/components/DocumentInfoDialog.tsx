// Phase 57 (feature A) — the Document info surface.
//
// A registry-verb dialog that reports what the ACTIVE document declares: the
// XMP `pdfe:` engineering block (identification / measurement / geospatial),
// the layer count and the number of 3D objects the app cannot render. The host
// fetches the data (getCadMetadata / getLayers / get3dContent) and passes it
// in; the dialog owns no engine state. A document with no PDF/E block renders
// the explicit "No PDF/E engineering metadata" line, never a blank dialog.

import { useEffect, useRef, type ReactElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { PdfCadMetadata } from '../../shared/types';
import { useBackdropClose } from './modalBackdrop';
import { TfBackdrop, TfDialog } from './motion/TfMotion';

export interface DocumentInfoDialogProps {
  open: boolean;
  /** The document's PDF/E engineering block, or null when it declares none. */
  metadata: PdfCadMetadata | null;
  /** The number of optional content groups (layers) the document declares. */
  layerCount: number;
  /** The number of 3D annotations the app cannot render. */
  content3dCount: number;
  onClose: () => void;
}

/** One labelled pair list. Renders an explicit "None" when empty so a blank
 *  section is never mistaken for "still loading". */
function PairList(props: {
  label: string;
  pairs: ReadonlyArray<{ key: string; value: string }>;
  testId: string;
}): ReactElement {
  const { label, pairs, testId } = props;
  return (
    <section className="doc-info-section">
      <div className="doc-info-section-label">{label}</div>
      {pairs.length === 0 ? (
        <div className="doc-info-section-empty">None</div>
      ) : (
        <dl className="doc-info-pairs" data-testid={testId}>
          {pairs.map((pair, i) => (
            <div key={`${pair.key}-${i}`} className="doc-info-pair" data-testid="doc-info-pair">
              <dt className="doc-info-key">{pair.key}</dt>
              <dd className="doc-info-value">{pair.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function DocumentInfoDialog(props: DocumentInfoDialogProps): ReactElement | null {
  const { open, metadata, layerCount, content3dCount, onClose } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);

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

  const backdrop = useBackdropClose(onClose, false);

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop} data-document-info-dialog>
          <TfDialog
            className="modal-dialog dialog document-info-dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-info-title"
          >
            <div className="modal-header">
              <h2 id="document-info-title" className="modal-title">
                Document info
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={onClose}
                aria-label="Close dialog"
                data-testid="doc-info-close"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-help">
                What this document declares: its PDF/E engineering metadata, its
                layers and any 3D content the app cannot render.
              </p>

              <div className="doc-info-counts">
                <div className="doc-info-count" data-testid="doc-info-layer-count">
                  Layers: {layerCount}
                </div>
                <div className="doc-info-count" data-testid="doc-info-3d-count">
                  3D objects: {content3dCount}
                </div>
              </div>

              {metadata === null ? (
                <div className="doc-info-no-cad" data-testid="doc-info-no-cad">
                  No PDF/E engineering metadata in this document.
                </div>
              ) : (
                <div className="doc-info-cad">
                  <PairList
                    label="Identification"
                    pairs={metadata.identification}
                    testId="doc-info-identification"
                  />
                  <PairList
                    label="Measurement"
                    pairs={metadata.measurement}
                    testId="doc-info-measurement"
                  />
                  <PairList
                    label="Geospatial"
                    pairs={metadata.geospatial}
                    testId="doc-info-geospatial"
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                data-testid="doc-info-close-footer"
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
