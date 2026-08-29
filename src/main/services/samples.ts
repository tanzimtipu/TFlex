import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { err, ok, type Result } from "../../shared/result";
import type { SampleDocument } from "../../shared/types";

export class SamplesService {
  constructor(private readonly dir: string) {}

  async list(): Promise<SampleDocument[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const pdfs: SampleDocument[] = [];
    for (const entry of entries) {
      const full = join(this.dir, entry);
      const s = await stat(full).catch(() => null);
      if (s !== null && s.isFile() && extname(entry).toLowerCase() === ".pdf") {
        pdfs.push({ name: entry, path: `samples/${entry}` });
      }
    }
    pdfs.sort((a, b) => a.name.localeCompare(b.name));
    return pdfs;
  }

  async load(
    name: string,
  ): Promise<Result<SampleDocument & { path: `samples/${string}` }, "not-found">> {
    if (name !== basename(name) || name.length === 0) {
      return err("not-found", `invalid sample name: ${name}`);
    }
    const resolved = resolve(this.dir, name);
    const dirWithSep = this.dir.endsWith(sep) ? this.dir : this.dir + sep;
    if (resolved !== dirWithSep + name) {
      return err("not-found", `invalid sample name: ${name}`);
    }
    const s = await stat(resolved).catch(() => null);
    if (s === null || !s.isFile()) {
      return err("not-found", `no such sample: ${name}`);
    }
    return ok({ name, path: `samples/${name}` } as SampleDocument & { path: `samples/${string}` });
  }

  async read(name: string): Promise<Result<ArrayBuffer, "not-found">> {
    if (name !== basename(name) || name.length === 0) {
      return err("not-found", `invalid sample name: ${name}`);
    }
    const resolved = resolve(this.dir, name);
    const dirWithSep = this.dir.endsWith(sep) ? this.dir : this.dir + sep;
    if (resolved !== dirWithSep + name) {
      return err("not-found", `invalid sample name: ${name}`);
    }
    const s = await stat(resolved).catch(() => null);
    if (s === null || !s.isFile()) {
      return err("not-found", `no such sample: ${name}`);
    }
    const bytes = await readFile(resolved);
    return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
}