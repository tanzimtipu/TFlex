// Phase 106 (chunk A) — the ONE shared Home recent row.
// Phase 112 (TFL-990, chunk C6b) — reworked onto the shared panel vocabulary.
//
// A recent entry shows its real basename, a short containing-folder shorthand,
// the TRUE last-opened time (`formatOpenedAt`) and only VERIFIED metadata: the
// recorded `sourceLabel` / `sourceKind` when present, a "converted" marker when
// the working document is a converted PDF, and otherwise an honest HINT label
// derived from the file extension (never presented as a verified content type).
// A missing / unopenable file keeps its record, renders a clear missing state
// and offers Locate missing. Every action dispatches the host's existing
// handler; removing from Recents never deletes a file.

import type { ReactElement } from "react";
import { File, FolderOpen, FolderSearch, Pin, PinOff, X } from "lucide-react";
import { Icon } from "../../icons/Icon";
import type { RecentFile } from "../../../shared/types";
import { formatOpenedAt, type PathMeta } from "../../utils/recentPath";
import { sourceFormat } from "../../utils/sourceFormat";

export interface HomeRecentRowProps {
  entry: RecentFile;
  meta: PathMeta;
  /** Containing-folder shorthand, already disambiguated for duplicate names. */
  contextLabel: string;
  /** True when the file is missing / unopenable on disk. */
  missing?: boolean;
  onOpen: (entry: RecentFile) => void;
  onRemove: (entry: RecentFile) => void;
  /** Pin / unpin through the host's existing settings save path. */
  onTogglePin?: (entry: RecentFile) => void;
  /** Reveal the file in the OS file manager (`recent:showInFolder`). */
  onShowInFolder?: (entry: RecentFile) => void;
  /** Re-point a missing entry (`recent:locateMissing`); shown only when missing. */
  onLocateMissing?: (entry: RecentFile) => void;
}

export function HomeRecentRow(props: HomeRecentRowProps): ReactElement {
  const {
    entry,
    meta,
    contextLabel,
    missing = false,
    onOpen,
    onRemove,
    onTogglePin,
    onShowInFolder,
    onLocateMissing,
  } = props;

  // Verified metadata ONLY. `sourceFormat(path)` reads the extension and is a
  // HINT, never a verified content type, so it is marked as such.
  const verified = typeof entry.sourceLabel === "string" && entry.sourceLabel.length > 0;
  const hint = sourceFormat(entry.path);
  const formatLabel = verified ? entry.sourceLabel ?? hint.label : hint.label;
  const formatKind =
    verified && typeof entry.sourceKind === "string" && entry.sourceKind.length > 0
      ? entry.sourceKind
      : hint.kind;
  const converted = entry.converted === true;
  const pinned = entry.pinned === true;
  const location = contextLabel.length > 0 ? contextLabel : "\u2014";

  const formatTitle = verified
    ? `Verified source format: ${formatLabel}`
    : `Format inferred from the file extension (not verified): ${formatLabel}`;
  const accessible =
    `Open ${meta.name}, ${verified ? `verified ${formatLabel}` : `${formatLabel} (unverified hint)`}` +
    (converted ? ", converted to PDF" : "") +
    (contextLabel.length > 0 ? `, in ${contextLabel}` : "") +
    (missing ? ", file not found" : "") +
    `. Full path: ${entry.path}`;

  return (
    <div
      className="recent-row"
      role="group"
      title={entry.path}
      data-recent-row
      data-recent-missing={missing ? "true" : "false"}
      data-recent-pinned={pinned ? "true" : "false"}
    >
      <button
        type="button"
        className="btn btn-ghost recent-row-open"
        data-recent-action="open"
        onClick={(): void => onOpen(entry)}
        title={missing ? `File not found: ${entry.path}` : `Open ${entry.path}`}
        aria-label={accessible}
      >
        <span className="doc-icon" aria-hidden>
          <Icon icon={File} size="sm" />
        </span>
        <span className="recent-row-text">
          <span className="doc-name">{meta.name}</span>
          <span className="doc-path">{location}</span>
        </span>
        <span className="recent-row-meta">
          <span
            className="doc-format"
            data-source-format={formatKind}
            data-source-verified={verified ? "verified" : "hint"}
            title={formatTitle}
          >
            {formatLabel}
          </span>
          {converted && (
            <span className="doc-converted" data-recent-converted title="Converted to PDF for editing">
              Converted
            </span>
          )}
          {missing && (
            <span className="doc-missing" data-recent-missing-note>
              Missing
            </span>
          )}
          <span className="doc-when">{formatOpenedAt(entry.openedAt)}</span>
        </span>
      </button>
      <div className="recent-row-actions">
        {onTogglePin !== undefined && (
          <button
            type="button"
            className="btn btn-ghost btn-icon recent-row-action"
            data-recent-action="pin"
            aria-pressed={pinned}
            aria-label={pinned ? `Unpin ${meta.name}` : `Pin ${meta.name} to the top`}
            title={pinned ? "Unpin from the top" : "Pin to the top"}
            onClick={(): void => onTogglePin(entry)}
          >
            <Icon icon={pinned ? PinOff : Pin} size="sm" />
          </button>
        )}
        {onShowInFolder !== undefined && (
          <button
            type="button"
            className="btn btn-ghost btn-icon recent-row-action"
            data-recent-action="show"
            aria-label={`Show ${meta.name} in its folder`}
            title="Show in folder"
            onClick={(): void => onShowInFolder(entry)}
          >
            <Icon icon={FolderOpen} size="sm" />
          </button>
        )}
        {missing && onLocateMissing !== undefined && (
          <button
            type="button"
            className="btn btn-ghost btn-icon recent-row-action"
            data-recent-action="locate"
            aria-label={`Locate the missing file ${meta.name}`}
            title="Locate missing file"
            onClick={(): void => onLocateMissing(entry)}
          >
            <Icon icon={FolderSearch} size="sm" />
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-icon recent-row-action recent-row-remove"
          data-recent-action="remove"
          aria-label={`Remove ${meta.name} from Recents`}
          title="Remove from Recents (does not delete the file)"
          onClick={(): void => onRemove(entry)}
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>
    </div>
  );
}
