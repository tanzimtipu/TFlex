// Phase 118 (TFL-1230 H) adversary probe against the shipped intake model.
// Plain Node (type-stripping), no vitest / build / electron. Run:
//   node test-fixtures/tfl1248-adversary/probe-intake-dispatch.mjs
//
// Imports the REAL src/renderer/intake/model.ts unchanged.

import { createIntakeModel } from "../../src/renderer/intake/model.ts";

const line = (s) => console.log(s);

function fresh() {
  let i = 0;
  return createIntakeModel({ mintId: () => `id${++i}` });
}

// ---------------------------------------------------------------- A. no
// extension trust: a .pdf-named input must not become a bogus "Ready".
line("=== A: extension-only trust / bogus Ready ===");
{
  const m = fresh();
  const item = m.add({ pathOrFile: "C:\\tmp\\actually-a-png.pdf" });
  line(`  add() state=${item.state} kind=${item.kind} (expect validating / unknown)`);
}

// ------------------------------------------------ B. duplicates + order.
line("=== B: duplicate basenames + order preservation ===");
{
  const m = fresh();
  m.add({ pathOrFile: "C:\\a\\report.pdf" });
  m.add({ pathOrFile: "D:\\b\\report.pdf" });
  m.add({ pathOrFile: "E:\\c\\notes.pdf" });
  line("  names: " + m.items().map((x) => x.name).join(" , ") + "  (expect report.pdf , report.pdf (2) , notes.pdf)");
}

// ---------------------------------------- C. synthetic / pathless File.
line("=== C: synthetic pathless File ===");
{
  const m = fresh();
  try {
    const f = new File([], "");
    const item = m.add({ pathOrFile: f });
    line(`  no crash; name="${item.name}" state=${item.state}`);
  } catch (e) {
    line("  CRASH: " + (e && e.stack ? e.stack : e));
  }
}

// ---------------------- D. remove-during-dispatch silently drops a queued file.
line("=== D: remove while a dispatch is in flight ===");
{
  const m = fresh();
  const a = m.add({ pathOrFile: "C:\\q\\a.pdf" });
  const b = m.add({ pathOrFile: "C:\\q\\b.pdf" });
  const c = m.add({ pathOrFile: "C:\\q\\c.pdf" });
  for (const it of [a, b, c]) m.classify(it.id, { kind: "pdf" });

  const opened = [];
  let removedOnce = false;
  const callbacks = {
    async openPdf(path) {
      opened.push(path);
      if (!removedOnce) {
        removedOnce = true;
        m.remove(a.id); // user clicks "Remove" on the row currently being opened
      }
    },
    async createFromImages() {},
  };
  const res = await m.dispatch(callbacks);
  line("  opened: " + JSON.stringify(opened));
  line("  skipped ids: " + JSON.stringify(res.skipped.map((x) => x.id)));
  const bVisited = opened.some((p) => p.includes("b.pdf")) || res.skipped.some((x) => x.id === b.id);
  line(`  b.pdf (id=${b.id}) was NOT removed by the user - visited by dispatch? ${bVisited} (false means silently dropped)`);
  line("  remaining queue: " + JSON.stringify(m.items().map((x) => [x.id, x.state])));
}

// --------------- E. concurrent dispatch double-creates the images PDF.
line("=== E: repeat-storm - two dispatches while one PDF open is pending ===");
{
  const m = fresh();
  const i1 = m.add({ pathOrFile: "C:\\p\\one.png" });
  const i2 = m.add({ pathOrFile: "C:\\p\\two.png" });
  const p = m.add({ pathOrFile: "C:\\p\\doc.pdf" });
  m.classify(i1.id, { kind: "image" });
  m.classify(i2.id, { kind: "image" });
  m.classify(p.id, { kind: "pdf" });

  let resolvePdf;
  const pending = new Promise((r) => (resolvePdf = r));
  let imageCalls = 0;
  let pdfCalls = 0;
  const callbacks = {
    async openPdf() {
      pdfCalls += 1;
      await pending; // hold the first dispatch open across the second dispatch
    },
    async createFromImages() {
      imageCalls += 1;
      return {};
    },
  };

  const first = m.dispatch(callbacks);
  await Promise.resolve(); // let the first dispatch reach the openPdf await
  const second = m.dispatch(callbacks); // user triggers "open all" again
  await Promise.resolve();
  resolvePdf();
  await Promise.all([first, second]);

  line(`  openPdf calls=${pdfCalls} (expect 1)`);
  line(`  createFromImages calls=${imageCalls} (expect 1 - a value of 2 is a duplicate PDF build)`);
}
