import type { RecentFile } from '../../shared/types';

/** Mirror of the recent-files rules; the backend applies the same policy. */
export const RECENT_CAP = 10;

export function pushRecent(list: RecentFile[], entry: RecentFile, cap = RECENT_CAP): RecentFile[] {
  const rest = list.filter((f) => f.path !== entry.path);
  return [entry, ...rest].slice(0, cap);
}

export function removeRecent(list: RecentFile[], path: string): RecentFile[] {
  return list.filter((f) => f.path !== path);
}
