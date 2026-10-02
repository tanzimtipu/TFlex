/**
 * Phase 82 — offline spell-check dictionary service.
 *
 * Reads the bundled plain-text word list from a LOCAL directory
 * (`assets/dictionary/`, wired by the caller the same way `OcrService` reads
 * `assets/tessdata/`) so the product stays fully offline. One word per line.
 *
 * A missing or unreadable file is reported as a typed `Result` error and is
 * never thrown across the IPC boundary.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '../../shared/result';
import type { DictionaryLoadError } from '../../shared/ipc';
import type { SpellCheckLanguage } from '../../shared/types';

export class DictionaryService {
  constructor(private readonly dir: string) {}

  async load(
    language: SpellCheckLanguage,
  ): Promise<Result<{ language: SpellCheckLanguage; words: string }, DictionaryLoadError>> {
    const file = join(this.dir, `${language.toLowerCase()}.txt`);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return err('not-found', `no dictionary for ${language}`);
      }
      return err('read-failed', `could not read dictionary for ${language}`);
    }
    return ok({ language, words: raw });
  }
}