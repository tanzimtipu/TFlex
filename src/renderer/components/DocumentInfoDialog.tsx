// Phase 57 (feature A) — the Document info surface.
//
// A registry-verb dialog that reports what the ACTIVE document declares: the
// XMP `pdfe:` engineering block (identification / measurement / geospatial),
// the layer count and the number of 3D objects the app cannot render. The host
// fetches the data (getCadMetadata / getLayers / get3dContent) and passes it
// in; the dialog owns no engine state. A document with no PDF/E block renders
// the explicit "No PDF/E engineering metadata" line, never a blank dialog.

import { type ReactElement } from 'react';
import type { PdfCadMetadata } from '../../shared/types';
import { DialogShell, type DialogAction } from './DialogShell';

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

  // A single-action dialog renders its action as primary (Phase 92 Ruling 6).
  // The footer testid is shipped; the header close X keeps its `doc-info-close`
  // hook through the shell's closeTestId so the Phase 57a e2e selector stays.
  const actions: DialogAction[] = [
    {
      key: 'close',
      label: 'Close',
      variant: 'primary',
      onClick: onClose,
      default: true,
      testId: 'doc-info-close-footer',
    },
  ];

  return (
    <DialogShell
      open={open}
      title="Document info"
      titleId="document-info-title"
      className="document-info-dialog"
      onClose={onClose}
      closeTestId="doc-info-close"
      actions={actions}
      data-document-info-dialog
    >
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
    </DialogShell>
  );
}
