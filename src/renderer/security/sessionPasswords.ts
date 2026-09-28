// Phase 52 / DEF-372 — session-only document-password cache.
//
// The main-process engine caches an opened document's password in
// `EngineService.docPasswords`, but that map is keyed by the TRANSIENT engine
// doc id and is cleared by `closeDocument` when a tab closes. The renderer
// mints a fresh engine doc id on every open, so a UI re-open of the SAME file
// in the same session re-prompts (DEF-372). The engine cache is therefore not
// enough: the password must follow the FILE.
//
// This store is keyed by the same platform-aware path comparison key the open
// dedupe and the Multi Mode pane guard use (`pathComparisonKey`), so case- and
// separator-variant spellings of one path share a single entry and a re-open
// through the Open dialog, a recent, a drop or a second-instance launch all
// resolve to the same entry.
//
// Rules encoded here (Phase 52):
//   - renderer process memory only, for the app session: never settings, logs,
//     sync, IPC or the DOM;
//   - an entry is consulted BEFORE an open would need a password, so a re-open
//     of the same file in the same session does not re-prompt;
//   - a freshly constructed store is empty, so an app restart always prompts
//     again (nothing is persisted, no storage API is touched);
//   - a bytes-only open (a sample, or a derived create / split / optimize
//     output) has no stable on-disk identity, so it is never cached.

import { pathComparisonKey } from "../state/pathIdentity";

export class SessionPasswordStore {
  /** JS-private: never enumerable, so it can never reach a serialiser. */
  #passwords = new Map<string, string>();

  /** The cache key for an on-disk path, or "" when there is no stable file
   *  identity (a bytes-only open) and nothing may be cached. */
  static keyFor(onDiskPath: string | null): string {
    if (onDiskPath === null) return "";
    if (onDiskPath.trim() === "") return "";
    return pathComparisonKey(onDiskPath);
  }

  /** Remember `password` for the file at `onDiskPath`. An empty password is
   *  not a secret and adds nothing (pdf.js opens an empty-user-password file
   *  without a prompt anyway), so it is not stored. */
  remember(onDiskPath: string | null, password: string): void {
    const key = SessionPasswordStore.keyFor(onDiskPath);
    if (key === "") return;
    if (typeof password !== "string" || password.length === 0) return;
    this.#passwords.set(key, password);
  }

  /** The remembered password for `onDiskPath`, or undefined when this session
   *  has none. A caller passes the result into the open attempt; when it is
   *  stale the open returns `incorrect-password` and the normal prompt retry
   *  overwrites it on success. */
  recall(onDiskPath: string | null): string | undefined {
    const key = SessionPasswordStore.keyFor(onDiskPath);
    if (key === "") return undefined;
    return this.#passwords.get(key);
  }

  /** Drop one file's entry. */
  forget(onDiskPath: string | null): void {
    const key = SessionPasswordStore.keyFor(onDiskPath);
    if (key === "") return;
    this.#passwords.delete(key);
  }

  /** Drop every entry. */
  clear(): void {
    this.#passwords.clear();
  }

  /** Number of cached entries (diagnostics / tests only; never the values). */
  get size(): number {
    return this.#passwords.size;
  }
}
