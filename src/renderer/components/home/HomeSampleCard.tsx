// Phase 106 (chunk A, DEF-592) — the ONE shared Home sample card.
//
// A bundled sample is presented as a TASK ("Read and navigate", "Try form
// fields", "Explore recognition") with the REAL first page of that bundled
// sample as its preview (rasterized once per sample, see `samplePreview.ts`),
// and an honest per-sample fallback while it loads or if it cannot render — so
// no two cards are ever identical. The card keeps the existing "open a copy"
// semantics through the passed-in `onOpen` handler, so bundled assets are never
// overwritten.

import type { ReactElement } from "react";
import { Icon } from "../../icons/Icon";
import type { SampleDocument } from "../../../shared/types";
import { sourceFormat } from "../../utils/sourceFormat";
import { sampleTaskFor } from "../../utils/sampleTask";
import { samplePreviewFallback, useSamplePreview } from "./samplePreview";

export interface HomeSampleCardProps {
  sample: SampleDocument;
  onOpen: (sample: SampleDocument) => void;
}

export function HomeSampleCard(props: HomeSampleCardProps): ReactElement {
  const { sample, onOpen } = props;
  const task = sampleTaskFor(sample);
  const format = sourceFormat(sample.path);
  // DEF-592 — the thumb is the REAL first page of this bundled sample; the
  // per-sample honest fallback covers the pending/unavailable state so no two
  // cards ever render the same generic glyph.
  const fallback = samplePreviewFallback(sample.name);
  const preview = useSamplePreview(sample.name);
  return (
    <button
      type="button"
      className="btn btn-ghost sample-card"
      data-sample-card
      data-sample-task={task.id}
      onClick={(): void => onOpen(sample)}
      title={`${task.label} \u00b7 ${sample.name}`}
      aria-label={`${task.label}: ${sample.name} (${format.label}). ${task.description}. Opens a copy.`}
    >
      <span
        className="sample-thumb"
        data-sample-format={format.kind}
        data-sample-tone={fallback.tone}
        data-sample-preview={preview.status}
        aria-hidden
      >
        {preview.status === "ready" ? (
          <img className="sample-thumb-page" src={preview.src} alt="" />
        ) : (
          <Icon name={fallback.icon} size="lg" className="sample-thumb-glyph" />
        )}
      </span>
      <span className="sample-name">{sample.name}</span>
      <span className="sample-sub">
        {task.label} {"\u00b7"} {format.label}
      </span>
    </button>
  );
}