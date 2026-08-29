// Splits an absolute (or sample) path into display components used by the
// recent-files list. Sample paths are display-relative ("samples/foo.pdf").
export interface PathMeta {
  name: string;
  dir: string;
  isSample: boolean;
}

export function splitRecentPath(path: string): PathMeta {
  if (path.startsWith("samples/")) {
    return { name: path.slice("samples/".length), dir: "samples", isSample: true };
  }
  // Strip both Windows (\\) and POSIX (/) separators.
  const idxWin = path.lastIndexOf("\\");
  const idxPos = path.lastIndexOf("/");
  const cut = Math.max(idxWin, idxPos);
  if (cut < 0) return { name: path, dir: "", isSample: false };
  const name = path.slice(cut + 1);
  const dir = path.slice(0, cut);
  return { name: name.length > 0 ? name : path, dir, isSample: false };
}

export function formatOpenedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const day = 24 * 3600 * 1000;
  if (diff < day) return "Today";
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString();
}
