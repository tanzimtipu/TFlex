// Phase 106 (chunk A) — the ONE shared Home recent row.
//
// A recent entry shows its real basename, a short containing-folder shorthand,
// the TRUE source format (derived from the path extension, never a blanket
// "PDF") and the relative opened-at time. The full path lives in the row's
// accessible description/title, not as a long visible string. The open/remove
// handlers are the existing App handlers, passed straight through.

import type { ReactElement } from "react";
import { File, X } from "lucide-react";
import { Icon } from "../../icons/Icon";
import type { RecentFile } from "../../../shared/types";
import { formatOpenedAt, type PathMeta } from "../../utils/recentPath";
import { sourceFormat } from "../../utils/sourceFormat";

export interface HomeRecentRowProps {
  entry: RecentFile;
  meta: PathMeta;
  /** Containing-folder shorthand, already disambiguated for duplicate names. */
  contextLabel: string;
  onOpen: (entry: RecentFile) => void;
  onRemove: (entry: RecentFile) => void;
}

export function HomeRecentRow(props: HomeRecentRowProps): ReactElement {
  const { entry, meta, contextLabel, onOpen, onRemove } = props;
  const format = sourceFormat(entry.path);
  const location = contextLabel.length > 0 ? contextLabel : "\u2014";
  const accessible =
    `Open ${meta.name}, ${format.label}` +
    (contextLabel.length > 0 ? `, in ${contextLabel}` : "") +
    `. Full path: ${entry.path}`;
  return (
    <div className="recent-row" role="group" title={entry.path} data-recent-row>
      <button
        type="button"
        className="btn btn-ghost recent-row-open"
        onClick={(): void => onOpen(entry)}
        title={`Open ${entry.path}`}
        aria-label={accessible}
      >
        <span className="doc-icon" aria-hidden>
          <Icon icon={File} size="sm" />
        </span>
        <span className="recent-row-text">
          <span className="doc-name">{meta.name}</span>
          <span className="doc-path">{location}</span>
        </span>
        <span className="doc-format" data-source-format={format.kind}>
          {format.label}
        </span>
        <span className="doc-when">{formatOpenedAt(entry.openedAt)}</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon recent-row-remove"
        onClick={(): void => onRemove(entry)}
        aria-label={`Remove ${meta.name} from Recents`}
        title="Remove from Recents"
      >
        <Icon icon={X} size="sm" />
      </button>
    </div>
  );
}