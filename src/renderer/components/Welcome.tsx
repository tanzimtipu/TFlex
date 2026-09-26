import type { ReactElement } from "react";
import { File, FileImage, FilePlus2, FolderOpen, GitMerge, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RecentFile, SampleDocument } from "../../shared/types";
import { formatOpenedAt } from "../utils/recentPath";

interface RecentDisplay {
  entry: RecentFile;
  meta: { name: string; dir: string; isSample: boolean };
}

interface WelcomeProps {
  recentFiles: RecentDisplay[];
  onOpenRecent: (entry: RecentFile) => void;
  onRemoveRecent: (entry: RecentFile) => void;
  onOpenFile: () => void;
  onSampleClick: (sample: SampleDocument) => void;
  onMergeClick?: () => void;
  /** Phase 9 — Create-from-images entry. Renders alongside the
   *  existing Open PDF / Merge PDFs buttons on the welcome hero.
   *  Optional: callers that don't yet wire the Phase 9 dialog can
   *  omit the prop and the button stays hidden. */
  onCreateFromImages?: () => void;
  samplesResolver: () => Promise<SampleDocument[]>;
}

export function Welcome(props: WelcomeProps): ReactElement {
  const {
    recentFiles,
    onOpenRecent,
    onRemoveRecent,
    onOpenFile,
    onSampleClick,
    onMergeClick,
    onCreateFromImages,
    samplesResolver,
  } = props;
  const [samples, setSamples] = useState<SampleDocument[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void samplesResolver().then((list) => {
      if (!cancelled) setSamples(list);
    });
    return (): void => {
      cancelled = true;
    };
  }, [samplesResolver]);

  const recentCount = recentFiles.length;
  const sampleCount = samples?.length ?? 0;

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-eyebrow">TFlex</div>
        <h1 className="welcome-title">A modern PDF studio for Windows.</h1>
        <p className="welcome-sub">
          Open a document to begin, or pick one of the samples below to see TFlex
          in action. Search and navigation are keyboard-driven; everything you
          need lives one click away.
        </p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={onOpenFile}>
            <FolderOpen size={16} aria-hidden /> Open PDF
            <span className="kbd" style={{ marginLeft: 8 }}>Ctrl O</span>
          </button>
          {onCreateFromImages !== undefined && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCreateFromImages}
              title="Combine picked images into a new PDF"
              data-welcome-create
            >
              <FileImage size={16} aria-hidden /> Create from images
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onMergeClick}
            title="Combine multiple PDF files into one document"
          >
            <GitMerge size={16} aria-hidden /> Merge PDFs
          </button>
        </div>
      </div>
      <div className="welcome-body">
        <section className="welcome-section">
          <h3>
            <span>Recent</span>
            <span className="count">{recentCount}</span>
          </h3>
          {recentCount === 0 ? (
            <div className="recent-list">
              <div className="recent-empty">
                <span>No recent files yet.</span>
                <span className="hint">Open a PDF and it will appear here.</span>
              </div>
            </div>
          ) : (
            <div className="recent-list">
              {recentFiles.map((row) => (
                <div
                  key={row.entry.path}
                  className="recent-row"
                  role="group"
                  title={row.entry.path}
                >
                  <button
                    type="button"
                    className="recent-row-open"
                    onClick={(): void => onOpenRecent(row.entry)}
                    title={`Open ${row.entry.path}`}
                  >
                    <span className="doc-icon" aria-hidden>
                      <File size={16} />
                    </span>
                    <span className="recent-row-text">
                      <div className="doc-name">{row.meta.name}</div>
                      <div className="doc-path">{row.meta.dir || "—"}</div>
                    </span>
                    <span className="doc-when">{formatOpenedAt(row.entry.openedAt)}</span>
                    <span className="doc-when">PDF</span>
                  </button>
                  <button
                    type="button"
                    className="recent-row-remove"
                    onClick={(): void => onRemoveRecent(row.entry)}
                    aria-label={`Remove ${row.entry.name} from Recents`}
                    title="Remove from Recents"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="welcome-section">
          <h3>
            <span>Sample documents</span>
            <span className="count">{sampleCount}</span>
          </h3>
          {samples === null ? (
            <div className="samples-grid">
              <div className="samples-empty">Loading samples…</div>
            </div>
          ) : samples.length === 0 ? (
            <div className="samples-grid">
              <div className="samples-empty">
                No bundled samples. Place PDF files in <code>assets/samples/</code> and rebuild.
              </div>
            </div>
          ) : (
            <div className="samples-grid">
              {samples.map((sample) => (
                <button
                  key={sample.path}
                  type="button"
                  className="sample-card"
                  onClick={(): void => onSampleClick(sample)}
                >
                  <div className="sample-thumb">
                    <Sparkles size={20} />
                  </div>
                  <div className="sample-name">{sample.name}</div>
                  <div className="sample-sub">Click to open · PDF</div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <span hidden>
        <FilePlus2 />
      </span>
    </div>
  );
}
