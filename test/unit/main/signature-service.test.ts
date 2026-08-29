import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignatureService } from '../../../src/main/services/signature-service';
import type { SignatureSource } from '../../../src/shared/types';

let dir: string;
let filePath: string;
let svc: SignatureService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-sig-svc-'));
  filePath = join(dir, 'signatures.json');
  svc = new SignatureService(filePath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeDrawnSource(overrides?: Partial<SignatureSource & { kind: 'drawn' }>): SignatureSource {
  return {
    kind: 'drawn',
    points: [[{ x: 10, y: 20 }, { x: 100, y: 80 }]],
    width: 300,
    height: 100,
    ...overrides,
  };
}

function makeTypedSource(text?: string): SignatureSource {
  return {
    kind: 'typed',
    text: text ?? 'John Doe',
    width: 200,
    height: 60,
  };
}

describe('SignatureService - list', () => {
  it('returns empty array when no file exists', async () => {
    const list = await svc.list();
    expect(list).toEqual([]);
  });

  it('returns empty array on corrupt JSON', async () => {
    await writeFile(filePath, '{ not valid }', 'utf8');
    const svc2 = new SignatureService(filePath);
    const list = await svc2.list();
    expect(list).toEqual([]);
  });

  it('returns empty array when file is not an array', async () => {
    await writeFile(filePath, '"just a string"', 'utf8');
    const svc2 = new SignatureService(filePath);
    const list = await svc2.list();
    expect(list).toEqual([]);
  });

  it('filters out entries missing required fields', async () => {
    await writeFile(filePath, JSON.stringify([
      { id: 'a', label: 'Valid', createdAt: '2026-01-01T00:00:00.000Z', source: { kind: 'typed', text: 'X', width: 100, height: 50 } },
      { label: 'No id' },
      { id: 'b' },
      'not an object',
      null,
    ]), 'utf8');
    const svc2 = new SignatureService(filePath);
    const list = await svc2.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('a');
  });
});

describe('SignatureService - save', () => {
  it('saves a drawn signature and returns the updated list', async () => {
    const source = makeDrawnSource();
    const list = await svc.save(source, 'My Drawing');
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('My Drawing');
    expect(list[0].source).toEqual(source);
    expect(list[0].createdAt).toBeTruthy();
    expect(list[0].id).toBeTruthy();
  });

  it('saves a typed signature with auto-label from text', async () => {
    const source = makeTypedSource('Jane Smith');
    const list = await svc.save(source);
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('Jane Smith');
    expect(list[0].source).toEqual(source);
  });

  it('generates sequential default labels for drawn signatures', async () => {
    const s1 = await svc.save(makeDrawnSource());
    expect(s1[0].label).toBe('Signature 1');

    const s2 = await svc.save(makeDrawnSource());
    expect(s2[1].label).toBe('Signature 2');

    const s3 = await svc.save(makeDrawnSource());
    expect(s3[2].label).toBe('Signature 3');
  });

  it('persists to disk and can be re-read by a new instance', async () => {
    const source = makeTypedSource('Persist Test');
    await svc.save(source, 'PersistLabel');

    const svc2 = new SignatureService(filePath);
    const list = await svc2.list();
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('PersistLabel');
    expect(list[0].source).toEqual(source);
  });

  it('saves multiple signatures and returns full list', async () => {
    await svc.save(makeTypedSource('A'), 'A');
    await svc.save(makeTypedSource('B'), 'B');
    const list = await svc.save(makeTypedSource('C'), 'C');
    expect(list.length).toBe(3);
    expect(list.map((s) => s.label)).toEqual(['A', 'B', 'C']);
  });

  it('each save assigns a unique id', async () => {
    const s1 = await svc.save(makeTypedSource('A'));
    const s2 = await svc.save(makeTypedSource('B'));
    expect(s1[0].id).not.toBe(s2[1].id);
  });
});

describe('SignatureService - delete', () => {
  it('deletes a signature by id and returns updated list', async () => {
    const s1 = await svc.save(makeTypedSource('A'), 'A');
    const s2 = await svc.save(makeTypedSource('B'), 'B');

    expect(s2.length).toBe(2);
    const list = await svc.delete(s1[0].id);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(s2[1].id);
  });

  it('deleting a non-existent id returns the current list unchanged', async () => {
    await svc.save(makeTypedSource('A'), 'A');
    const list = await svc.delete('non-existent-id');
    expect(list.length).toBe(1);
  });

  it('delete persists to disk', async () => {
    const s1 = await svc.save(makeTypedSource('Keep'), 'Keep');
    const s2 = await svc.save(makeTypedSource('Delete'), 'Delete');
    await svc.delete(s2[1].id);

    const svc2 = new SignatureService(filePath);
    const list = await svc2.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(s1[0].id);
  });

  it('delete from empty list does not throw', async () => {
    const list = await svc.delete('any-id');
    expect(list).toEqual([]);
  });
});

describe('SignatureService - round-trip integrity', () => {
  it('save -> delete -> save produces correct final list', async () => {
    await svc.save(makeTypedSource('A'), 'A');
    const s2 = await svc.save(makeTypedSource('B'), 'B');
    await svc.save(makeTypedSource('C'), 'C');

    await svc.delete(s2[1].id);

    const final = await svc.list();
    expect(final.length).toBe(2);
    expect(final.map((s) => s.label)).toEqual(['A', 'C']);
  });
});