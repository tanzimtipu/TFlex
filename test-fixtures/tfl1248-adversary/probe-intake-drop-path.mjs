// Phase 118 (TFL-1230 H) adversary probe - dropped OS file path loss.
// Plain Node (type-stripping), no vitest / build / electron. Run:
//   node test-fixtures/tfl1248-adversary/probe-intake-drop-path.mjs
//
// Imports the REAL src/renderer/hooks/useOsIntegration.ts and
// src/renderer/intake/model.ts unchanged. A simulated preload bridge provides
// the same `webUtils.getPathForFile` the real preload exposes
// (src/preload/preload.ts:876-881), so `resolveDroppedPath` returns a real
// absolute path exactly as it does in the running app.

// The bridge must exist before the hook module reads it.
globalThis.window = {
  tflex: {
    webUtils: {
      getPathForFile: (file) => `C:\\Users\\me\\Documents\\${file.name}`,
    },
  },
};

const { resolveDroppedPath } = await import(
  "../../src/renderer/hooks/useOsIntegration.ts"
);
const { createIntakeModel } = await import("../../src/renderer/intake/model.ts");

const line = (s) => console.log(s);

line("=== F: dropped OS PDF - is the resolved on-disk path carried to dispatch? ===");

const file = new File(["%PDF-1.7"], "report.pdf", {
  type: "application/pdf",
});

// What the drop hook can see for this file (useOsIntegration.ts:55-64).
const resolved = resolveDroppedPath(file);
line(`  resolveDroppedPath(file) = ${JSON.stringify(resolved)}`);
line(`  file.name               = ${JSON.stringify(file.name)}`);

// The landed drop contract (useOsIntegration.ts:150-159) uses `resolved` ONLY
// for the null check, then pushes the bare `File`:
//     if (resolveDroppedPath(file) === null) { ...continue; }
//     resolvable.push(file);
//   ... onIntake(resolvable);
// and App stores it verbatim (App.tsx:2821-2824):
//     intakeModelRef.current?.addMany(files.map((file) => ({ pathOrFile: file })));
const model = createIntakeModel();
const item = model.add({ pathOrFile: file });
model.classify(item.id, { kind: "pdf" });

let openedWith = null;
const result = await model.dispatch({
  openPdf: async (path) => {
    openedWith = path;
  },
  createFromImages: async () => ({}),
});

line(`  dispatch openPdf(path)  = ${JSON.stringify(openedWith)}`);
line(`  opened items            = ${result.opened.length} (expect 1)`);
line(
  `  VERDICT: ${openedWith === resolved ? "path preserved" : "PATH LOST - opened by bare basename"}`,
);

// Contrast: a path-payload PDF (the Open-dialog route) keeps the full path.
line("=== F2: picked-path PDF (Open dialog route) for contrast ===");
{
  const m = createIntakeModel();
  const it = m.add({ pathOrFile: "C:\\Users\\me\\Documents\\picked.pdf" });
  m.classify(it.id, { kind: "pdf" });
  let seen = null;
  await m.dispatch({
    openPdf: async (p) => {
      seen = p;
    },
    createFromImages: async () => ({}),
  });
  line(`  dispatch openPdf(path)  = ${JSON.stringify(seen)} (full path kept)`);
}
