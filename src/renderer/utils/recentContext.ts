// Phase 106 (chunk A) — containing-folder shorthand + duplicate disambiguation
// for the Home recent list.
//
// A recent row shows a SHORT folder context, not the full path (which lives in
// the accessible description/title). Two files with the same basename must
// still be distinguishable, so a duplicated name widens its context to the
// trailing folder segments, and only falls back to the full folder when even
// that collides.
//
// Pure: no React, no electron, no DOM.

function segments(dir: string): string[] {
  return dir.split(/[\\/]+/).filter((part) => part.length > 0);
}

/** The last real folder segment of a directory, or "" when there is none. */
export function folderShorthand(dir: string): string {
  const parts = segments(dir);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/**
 * A context label per row, in input order.
 *
 * - A unique basename keeps the concise last-folder shorthand.
 * - A duplicated basename widens to the trailing two folder segments; if two
 *   duplicated rows STILL share that label, the full folder is used so they
 *   can be told apart.
 */
export function recentContextLabels(
  rows: readonly { name: string; dir: string }[],
): string[] {
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicated = rows.map(
    (row) => (nameCounts.get(row.name.toLowerCase()) ?? 0) > 1,
  );

  const labels = rows.map((row, index) => {
    const parts = segments(row.dir);
    if (duplicated[index] !== true) {
      return parts.length > 0 ? parts[parts.length - 1] : "";
    }
    return parts.slice(-2).join(" / ");
  });

  const dupLabelCounts = new Map<string, number>();
  labels.forEach((label, index) => {
    if (duplicated[index] !== true) return;
    dupLabelCounts.set(label, (dupLabelCounts.get(label) ?? 0) + 1);
  });

  return labels.map((label, index) => {
    if (duplicated[index] !== true) return label;
    if (label.length > 0 && (dupLabelCounts.get(label) ?? 0) <= 1) return label;
    return rows[index]?.dir ?? label;
  });
}