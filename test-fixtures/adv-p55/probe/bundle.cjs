"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err2) => function __init() {
  if (err2) throw err2[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err2 = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared/result.ts
function ok(value) {
  return { ok: true, value };
}
function err(code, message) {
  return { ok: false, error: { code, message: message ?? code } };
}
var init_result = __esm({
  "src/shared/result.ts"() {
    "use strict";
  }
});

// src/main/services/convert/errors.ts
function convertError(code, message) {
  return err(code, message ?? CONVERT_ERROR_MESSAGES[code]);
}
function mapAdapterThrow(thrown) {
  if (thrown instanceof ConvertCancelledError) {
    return convertError("cancelled", thrown.message);
  }
  if (thrown instanceof ConvertFailure) {
    return convertError(thrown.code, thrown.message);
  }
  const message = thrown instanceof Error && thrown.message.length > 0 ? `${CONVERT_ERROR_MESSAGES.internal} ${thrown.message}` : CONVERT_ERROR_MESSAGES.internal;
  return convertError("internal", message);
}
var CONVERT_ERROR_MESSAGES, ConvertCancelledError, ConvertFailure;
var init_errors = __esm({
  "src/main/services/convert/errors.ts"() {
    "use strict";
    init_result();
    CONVERT_ERROR_MESSAGES = {
      "unsupported-format": "This file type is not supported for import.",
      "empty-file": "The file is empty (zero bytes).",
      "password-required": "This file is protected; a password is required.",
      "too-large": "The file is larger than the import size limit.",
      "decode-failed": "The file could not be decoded with a supported text encoding.",
      corrupt: "The file appears to be corrupt and could not be read.",
      cancelled: "The import was cancelled.",
      timeout: "The conversion took too long and was stopped.",
      internal: "The import failed unexpectedly."
    };
    ConvertCancelledError = class extends Error {
      constructor(message = CONVERT_ERROR_MESSAGES.cancelled) {
        super(message);
        this.name = "ConvertCancelledError";
      }
    };
    ConvertFailure = class extends Error {
      code;
      constructor(code, message) {
        super(message ?? CONVERT_ERROR_MESSAGES[code]);
        this.name = "ConvertFailure";
        this.code = code;
      }
    };
  }
});

// src/main/services/convert/limits.ts
var CONVERT_LIMITS;
var init_limits = __esm({
  "src/main/services/convert/limits.ts"() {
    "use strict";
    CONVERT_LIMITS = {
      /** Bytes read for content sniffing before resolution. */
      sniffHeadBytes: 4096,
      /** Largest `.txt` input a non-streaming fallback path may buffer. */
      textBytes: 64 * 1024 * 1024,
      /** Chunk size for the streamed text reader. */
      textChunkBytes: 64 * 1024,
      /** Phase 54 — PNG/JPEG byte ceiling (raster embed buffers the file). */
      imageBytes: 128 * 1024 * 1024,
      /** Phase 54 — TIFF byte ceiling. `utif` requires the whole file in memory,
       *  so this is a hard ceiling rather than a streaming one. */
      tiffBytes: 512 * 1024 * 1024,
      /** Phase 54 (DEF-385) — hard ceiling on one TIFF frame's declared pixels.
       *  `UTIF.decodeImage`/`toRGBA8` allocate `width*height*4` bytes BEFORE the
       *  adapter's own guard can run, so a frame above this is rejected up front
       *  (64 MP -> a 256 MiB RGBA buffer at most). */
      tiffFramePixels: 64 * 1024 * 1024,
      /** Phase 54 (DEF-380) — hard ceiling on the pre-validated IFD chain length.
       *  `utif` walks the chain with `while(true)`; the adapter's own preflight
       *  refuses a chain above this before `UTIF.decode` is ever called. */
      tiffIfdChain: 1e4,
      /** Phase 54 — soft ceiling on TIFF frames. A stack above this still
       *  converts; the adapter warns loudly (never a silent truncation). */
      tiffFrames: 1e3,
      /** Phase 54 — SVG byte ceiling. The XML is decoded to a string and parsed
       *  in memory, so an oversized document gets a typed `too-large`. */
      svgBytes: 64 * 1024 * 1024,
      /** Phase 55 — `.docx` byte ceiling. The ZIP container and the embedded
       *  images are buffered before `mammoth` runs. */
      docxBytes: 256 * 1024 * 1024,
      /** Phase 55 — `.odt` byte ceiling. `content.xml` and the picture payloads
       *  are buffered/decompressed in memory. */
      odtBytes: 128 * 1024 * 1024,
      /** Phase 55 — legacy binary `.doc` byte ceiling. The CFB walker reads the
       *  whole container; the text recovery itself is bounded separately. */
      docBytes: 128 * 1024 * 1024,
      /** Phase 55 feature B — spreadsheet (`.xlsx`/`.xls`/`.ods`) byte ceiling.
       *  SheetJS decodes the whole workbook into in-memory records before the grid
       *  is built, so the file is buffered. */
      spreadsheetBytes: 256 * 1024 * 1024,
      /** Phase 55 feature B — the documented per-sheet row ceiling. A sheet above
       *  this is rendered up to the ceiling AND reported with a `row-limit`
       *  warning naming the sheet and its true count; rows are never dropped
       *  silently. A 20,000-row workbook is far below it. */
      sheetRows: 1e5,
      /** Phase 55 feature C — `.pptx` byte ceiling. The ZIP container and its
       *  media are buffered/decompressed in memory before the slide XML maps. */
      pptxBytes: 256 * 1024 * 1024,
      /** Phase 55 feature C — legacy binary `.ppt` byte ceiling. The CFB walker
       *  reads the whole container; text recovery is bounded separately. */
      pptBytes: 128 * 1024 * 1024
    };
  }
});

// test-fixtures/adv-p55/probe/electron-stub.cjs
var require_electron_stub = __commonJS({
  "test-fixtures/adv-p55/probe/electron-stub.cjs"(exports2, module2) {
    "use strict";
    module2.exports = {
      app: { getPath: () => require("node:os").tmpdir() },
      BrowserWindow: class {
      },
      session: { fromPartition: () => ({ webRequest: { onBeforeRequest() {
      } }, setPermissionRequestHandler() {
      } }) },
      ipcMain: { handle() {
      } }
    };
  }
});

// src/main/services/convert/templates.ts
function injectSecurityMeta(html) {
  if (html.includes("Content-Security-Policy")) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head !== null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + CONVERT_CSP_META + html.slice(at);
  }
  const root = /<html[^>]*>/i.exec(html);
  if (root !== null) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${CONVERT_CSP_META}</head>${html.slice(at)}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">${CONVERT_CSP_META}<style>${HTML_PRINT_BASE_CSS}</style></head><body>${html}</body></html>`;
}
var CONVERT_CSP_META, HTML_PRINT_BASE_CSS;
var init_templates = __esm({
  "src/main/services/convert/templates.ts"() {
    "use strict";
    CONVERT_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; style-src 'unsafe-inline'; font-src data:">`;
    HTML_PRINT_BASE_CSS = `
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.4; color: #111; }
img, svg, table, pre { max-width: 100%; }
table { border-collapse: collapse; }
pre { white-space: pre-wrap; overflow: hidden; }
`;
  }
});

// src/shared/printLayout.ts
var init_printLayout = __esm({
  "src/shared/printLayout.ts"() {
    "use strict";
  }
});

// src/main/services/convert/registry.ts
var init_registry = __esm({
  "src/main/services/convert/registry.ts"() {
    "use strict";
    init_limits();
  }
});

// src/main/services/dialog.ts
var import_electron;
var init_dialog = __esm({
  "src/main/services/dialog.ts"() {
    "use strict";
    import_electron = __toESM(require_electron_stub(), 1);
    init_registry();
  }
});

// src/main/services/print.ts
function isPdfBytes(bytes) {
  return bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, i) => bytes[i] === byte);
}
var import_electron2, import_node_child_process, import_node_util, execFileAsync, PRINT_TIMEOUT_MS, PDF_MAGIC;
var init_print = __esm({
  "src/main/services/print.ts"() {
    "use strict";
    import_electron2 = __toESM(require_electron_stub(), 1);
    import_node_child_process = require("node:child_process");
    import_node_util = require("node:util");
    init_printLayout();
    init_dialog();
    execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
    PRINT_TIMEOUT_MS = 12e4;
    PDF_MAGIC = [37, 80, 68, 70, 45];
  }
});

// src/main/services/convert/html-print.ts
function createBlockedRequestHandler(record) {
  return (details, callback) => {
    record(details.url);
    callback({ cancel: true });
  };
}
function blockedResourceWarnings(urls) {
  if (urls.length === 0) return [];
  const total = urls.length;
  return urls.slice(0, RESOURCE_WARNING_CAP).map((url) => ({
    code: "resource-blocked",
    message: `Blocked network resource: ${url}`,
    detail: `${total} network resource(s) blocked`
  }));
}
function mapHtmlPrintOptions(options) {
  const inches = options.marginMm / 25.4;
  return {
    pageSize: PAGE_SIZE_NAMES[options.pageSize],
    margins: { top: inches, bottom: inches, left: inches, right: inches },
    printBackground: options.printBackground,
    preferCSSPageSize: options.preferCSSPageSize ?? false
  };
}
function prepareConvertSession() {
  blockedUrls = [];
  const ses = import_electron3.session.fromPartition(CONVERT_SESSION_PARTITION);
  ses.webRequest.onBeforeRequest(
    { urls: [...CONVERT_BLOCKED_URL_PATTERNS] },
    createBlockedRequestHandler((url) => {
      blockedUrls.push(url);
    })
  );
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return ses;
}
function withTimeout(work, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(CONVERT_TIMEOUT_SENTINEL), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
async function countPdfPages(bytes) {
  const doc = await import_pdf_lib.PDFDocument.load(bytes);
  return doc.getPageCount();
}
async function printHtmlToPdf(html, options, deps = defaultHtmlPrintDeps) {
  const tempPath = (0, import_node_path.join)(deps.tempDir(), `tflex-convert-${(0, import_node_crypto.randomUUID)()}.html`);
  let win;
  let destroyed = false;
  const destroyOnce = () => {
    if (win === void 0 || destroyed) return;
    destroyed = true;
    if (!win.isDestroyed()) win.destroy();
  };
  try {
    await deps.writeFile(tempPath, injectSecurityMeta(html));
    win = deps.createWindow();
    const active = win;
    await new Promise((resolve, reject) => {
      active.webContents.once("did-finish-load", () => resolve());
      deps.loadFile(active, tempPath).catch(reject);
    });
    let bytes;
    try {
      bytes = await withTimeout(
        deps.printToPdf(active, mapHtmlPrintOptions(options)),
        deps.timeoutMs ?? PRINT_TIMEOUT_MS
      );
    } catch (thrown) {
      if (thrown === CONVERT_TIMEOUT_SENTINEL) {
        return err("timeout", CONVERT_ERROR_MESSAGES.timeout);
      }
      throw thrown;
    }
    if (!isPdfBytes(bytes)) {
      return err("decode-failed", CONVERT_ERROR_MESSAGES["decode-failed"]);
    }
    let pageCount;
    try {
      pageCount = await countPdfPages(bytes);
    } catch {
      return err("corrupt", CONVERT_ERROR_MESSAGES.corrupt);
    }
    return ok({ bytes, pageCount, blockedUrls: deps.collectBlockedUrls() });
  } catch (thrown) {
    return mapAdapterThrow(thrown);
  } finally {
    destroyOnce();
    await deps.unlink(tempPath);
  }
}
var import_electron3, import_node_crypto, import_promises, import_node_path, import_pdf_lib, CONVERT_SESSION_PARTITION, CONVERT_BLOCKED_URL_PATTERNS, RESOURCE_WARNING_CAP, PAGE_SIZE_NAMES, blockedUrls, defaultHtmlPrintDeps, CONVERT_TIMEOUT_SENTINEL;
var init_html_print = __esm({
  "src/main/services/convert/html-print.ts"() {
    "use strict";
    import_electron3 = __toESM(require_electron_stub(), 1);
    import_node_crypto = require("node:crypto");
    import_promises = require("node:fs/promises");
    import_node_path = require("node:path");
    import_pdf_lib = require("@cantoo/pdf-lib");
    init_result();
    init_errors();
    init_templates();
    init_print();
    CONVERT_SESSION_PARTITION = "convert:offscreen";
    CONVERT_BLOCKED_URL_PATTERNS = [
      "http://*/*",
      "https://*/*",
      "ws://*/*",
      "wss://*/*",
      "ftp://*/*"
    ];
    RESOURCE_WARNING_CAP = 5;
    PAGE_SIZE_NAMES = {
      a4: "A4",
      letter: "Letter"
    };
    blockedUrls = [];
    defaultHtmlPrintDeps = {
      createWindow() {
        const ses = prepareConvertSession();
        const win = new import_electron3.BrowserWindow({
          show: false,
          width: 800,
          height: 600,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // The document is untrusted markup: no scripting at all.
            javascript: false,
            // DEDICATED partition, never defaultSession (Phase 44/50 sign-in).
            session: ses
          }
        });
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", (event, url) => {
          if (!url.startsWith("file:")) event.preventDefault();
        });
        win.webContents.on("will-attach-webview", (event) => event.preventDefault());
        return win;
      },
      async loadFile(win, path) {
        await win.loadFile(path);
      },
      async printToPdf(win, options) {
        return win.webContents.printToPDF(options);
      },
      tempDir() {
        return import_electron3.app.getPath("temp");
      },
      async writeFile(path, data) {
        await (0, import_promises.writeFile)(path, data, "utf8");
      },
      async unlink(path) {
        await (0, import_promises.unlink)(path).catch(() => void 0);
      },
      collectBlockedUrls() {
        return [...blockedUrls];
      }
    };
    CONVERT_TIMEOUT_SENTINEL = /* @__PURE__ */ Symbol("tflex-convert-timeout");
  }
});

// src/main/services/convert/convert-zip.ts
function unzipOrThrow(data, filter) {
  try {
    return (0, import_fflate.unzipSync)(data, { filter });
  } catch (thrown) {
    throw new ConvertZipError(
      "corrupt",
      thrown instanceof Error ? `The ZIP container could not be read: ${thrown.message}` : "The ZIP container could not be read."
    );
  }
}
function inspectZip(data, limits = DEFAULT_ZIP_LIMITS) {
  const guard = new ZipGuard(limits);
  unzipOrThrow(data, (file) => {
    guard.accept(file);
    return false;
  });
  guard.assertWithinLimits();
}
function openZip(data, limits = DEFAULT_ZIP_LIMITS) {
  const guard = new ZipGuard(limits);
  const files = unzipOrThrow(data, (file) => guard.accept(file));
  guard.assertWithinLimits();
  let actualTotal = 0;
  for (const bytes of Object.values(files)) {
    actualTotal += bytes.length;
    if (bytes.length > limits.maxEntryUncompressedBytes || actualTotal > limits.maxTotalUncompressedBytes) {
      throw new ConvertZipError(
        "too-large",
        "The archive expands beyond the import ceiling."
      );
    }
  }
  const names = Object.keys(files);
  const byName = new Map(Object.entries(files));
  return {
    names: () => [...names],
    has: (name) => byName.has(name),
    readBytes: (name) => byName.get(name) ?? null,
    readText: (name) => {
      const bytes = byName.get(name);
      return bytes === void 0 ? null : (0, import_fflate.strFromU8)(bytes);
    }
  };
}
var import_fflate, DEFAULT_ZIP_LIMITS, ConvertZipError, ZipGuard;
var init_convert_zip = __esm({
  "src/main/services/convert/convert-zip.ts"() {
    "use strict";
    import_fflate = require("fflate");
    DEFAULT_ZIP_LIMITS = {
      maxEntries: 4096,
      maxTotalUncompressedBytes: 256 * 1024 * 1024,
      maxEntryUncompressedBytes: 128 * 1024 * 1024
    };
    ConvertZipError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.name = "ConvertZipError";
        this.code = code;
      }
    };
    ZipGuard = class {
      constructor(limits) {
        this.limits = limits;
      }
      limits;
      seen = 0;
      declaredTotal = 0;
      breached = false;
      accept(file) {
        this.seen += 1;
        if (this.seen > this.limits.maxEntries) {
          this.breached = true;
          return false;
        }
        if (file.originalSize > this.limits.maxEntryUncompressedBytes) {
          this.breached = true;
          return false;
        }
        this.declaredTotal += file.originalSize;
        if (this.declaredTotal > this.limits.maxTotalUncompressedBytes) {
          this.breached = true;
          return false;
        }
        return true;
      }
      assertWithinLimits() {
        if (this.breached || this.seen > this.limits.maxEntries) {
          throw new ConvertZipError(
            "too-large",
            `The archive exceeds the ${this.limits.maxEntries}-entry / ${Math.round(
              this.limits.maxTotalUncompressedBytes / (1024 * 1024)
            )} MiB import ceiling.`
          );
        }
      }
    };
  }
});

// src/main/services/convert/visible-content.ts
function hasImage(html) {
  return IMG_RE.test(html.replace(COMMENT_RE, " "));
}
function hasVisibleText(html) {
  const noComments = html.replace(COMMENT_RE, " ");
  const body = BODY_RE.exec(noComments);
  let scope = body !== null ? body[1] : noComments.replace(HEAD_RE, " ");
  scope = scope.replace(STYLE_RE, " ").replace(SCRIPT_RE, " ");
  const text = scope.replace(TAG_RE, " ").replace(NBSP_RE, " ").replace(ENTITY_RE, "x");
  return text.trim().length > 0;
}
function htmlHasVisibleContent(html) {
  return hasImage(html) || hasVisibleText(html);
}
var COMMENT_RE, IMG_RE, BODY_RE, HEAD_RE, STYLE_RE, SCRIPT_RE, TAG_RE, NBSP_RE, ENTITY_RE;
var init_visible_content = __esm({
  "src/main/services/convert/visible-content.ts"() {
    "use strict";
    COMMENT_RE = /<!--[\s\S]*?-->/g;
    IMG_RE = /<img\b/i;
    BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
    HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head\s*>/gi;
    STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
    SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
    TAG_RE = /<[^>]*>/g;
    NBSP_RE = /&nbsp;|&#160;/gi;
    ENTITY_RE = /&[a-z]+;|&#\d+;/gi;
  }
});

// src/main/services/convert/adapters/docx.ts
function wrapOfficeDocument(body) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${OFFICE_PRINT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}
function looksLikeDocx(head) {
  const text = head.toString("latin1");
  if (!text.startsWith("PK")) return false;
  return text.includes("[Content_Types].xml") || text.includes("word/document.xml");
}
function createDocxAdapter(print = printHtmlToPdf, maxBytes = CONVERT_LIMITS.docxBytes, zipLimits) {
  return {
    id: "docx",
    label: "Word document",
    extensions: [".docx"],
    capabilities: { canImport: true, canExport: false },
    // A reflow, not a byte-faithful reproduction.
    fidelity: "layout",
    specificity: "specific",
    maxBytes,
    sniff(_path, head) {
      return looksLikeDocx(head);
    },
    async convert(ctx) {
      const { path, options, signal, onProgress } = ctx;
      const info = await (0, import_promises2.stat)(path);
      if (info.size > maxBytes) throw new ConvertFailure("too-large");
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("decoding", 0.1);
      const bytes = await (0, import_promises2.readFile)(path);
      try {
        inspectZip(new Uint8Array(bytes), zipLimits);
      } catch (thrown) {
        if (thrown instanceof ConvertZipError) {
          throw new ConvertFailure(thrown.code, thrown.message);
        }
        throw thrown;
      }
      if (signal?.aborted) throw new ConvertCancelledError();
      let converted;
      try {
        converted = await import_mammoth.default.convertToHtml({ buffer: bytes });
      } catch (thrown) {
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        throw new ConvertFailure(
          "corrupt",
          `The Word document could not be read: ${detail}`
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("laying-out", 0.5);
      const html = injectSecurityMeta(wrapOfficeDocument(converted.value));
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }
      const warnings = [];
      const messages = converted.messages ?? [];
      if (messages.length > 0) {
        warnings.push({
          code: "generic-fallback",
          message: `Some Word constructs were approximated: ${messages.slice(0, MAMMOTH_MESSAGE_CAP).map((entry) => entry.message).join("; ")}`,
          detail: `${messages.length} document message(s)`
        });
      }
      if (!htmlHasVisibleContent(html)) {
        warnings.push({
          code: "partial-content",
          message: "The source document had no visible content, so no text appears on the page."
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));
      onProgress?.("done", 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: "docx",
        fidelity: "layout",
        warnings,
        title: (0, import_node_path2.basename)(path, (0, import_node_path2.extname)(path))
      };
    }
  };
}
var import_promises2, import_node_path2, import_mammoth, OFFICE_PRINT_CSS, MAMMOTH_MESSAGE_CAP, docxAdapter;
var init_docx = __esm({
  "src/main/services/convert/adapters/docx.ts"() {
    "use strict";
    import_promises2 = require("node:fs/promises");
    import_node_path2 = require("node:path");
    import_mammoth = __toESM(require("mammoth"), 1);
    init_errors();
    init_limits();
    init_html_print();
    init_templates();
    init_visible_content();
    init_convert_zip();
    OFFICE_PRINT_CSS = `
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
h1 { font-size: 24pt; margin: 0.6em 0 0.4em; }
h2 { font-size: 20pt; margin: 0.6em 0 0.4em; }
h3 { font-size: 17pt; margin: 0.6em 0 0.4em; }
h4 { font-size: 15pt; margin: 0.6em 0 0.4em; }
h5 { font-size: 13pt; margin: 0.6em 0 0.4em; }
h6 { font-size: 12pt; margin: 0.6em 0 0.4em; }
strong { font-weight: 700; }
em { font-style: italic; }
p { margin: 0.4em 0; }
ul { margin: 0.4em 0; padding-left: 1.4em; list-style: disc; }
ul ul { list-style: circle; }
ol { margin: 0.4em 0; padding-left: 1.6em; list-style: decimal; }
li { margin: 0.15em 0; }
table { border-collapse: collapse; margin: 0.5em 0; max-width: 100%; }
th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; vertical-align: top; }
img { max-width: 100%; }
.odf-tab { white-space: pre; }
`;
    MAMMOTH_MESSAGE_CAP = 5;
    docxAdapter = createDocxAdapter();
  }
});

// src/main/services/convert/sheet-to-html.ts
function resolveSheetOrientation(orientation, maxColumns) {
  if (orientation === "portrait" || orientation === "landscape") {
    return orientation;
  }
  return maxColumns > AUTO_LANDSCAPE_COLUMNS ? "landscape" : "portrait";
}
function escapeCell(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r\n|\r|\n/g, "<br>");
}
function composeSpreadsheetCss(options, orientation) {
  const paper = options.pageSize === "letter" ? "Letter" : "A4";
  const pageCss = `@page { size: ${paper}${orientation === "landscape" ? " landscape" : ""}; margin: ${options.marginMm}mm; }`;
  const borders = options.gridlines ? "border: 0.5pt solid #9aa0a6;" : "border: none;";
  const layout = options.fitToWidth ? "table-layout: fixed; width: 100%;" : "table-layout: auto; width: auto;";
  return `
${pageCss}
table { border-collapse: collapse; ${layout} font-family: Arial, Helvetica, sans-serif; font-size: 8pt; margin: 0 0 6pt; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th, td { ${borders} padding: 2pt 4pt; text-align: left; vertical-align: top; overflow-wrap: break-word; word-break: break-word; }
th { background: #f1f3f4; font-weight: bold; }
.sheet-name { font-size: 13pt; font-weight: bold; margin: 0 0 4pt; }
.sheet + .sheet { page-break-before: always; break-before: page; }
`.trim();
}
function key(row, column) {
  return `${row},${column}`;
}
function indexMerges(merges, rowCount, columnCount) {
  const origin = /* @__PURE__ */ new Map();
  const covered = /* @__PURE__ */ new Set();
  for (const merge of merges) {
    const r1 = Math.max(0, merge.s.r);
    const c1 = Math.max(0, merge.s.c);
    const r2 = Math.min(rowCount - 1, merge.e.r);
    const c2 = Math.min(columnCount - 1, merge.e.c);
    if (r2 < r1 || c2 < c1) continue;
    origin.set(key(r1, c1), { rowspan: r2 - r1 + 1, colspan: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        if (r === r1 && c === c1) continue;
        covered.add(key(r, c));
      }
    }
  }
  return { origin, covered };
}
function cellMarkup(tag, text, row, column, merges) {
  const span = merges.origin.get(key(row, column));
  const attributes = [];
  if (span !== void 0 && span.colspan > 1) attributes.push(`colspan="${span.colspan}"`);
  if (span !== void 0 && span.rowspan > 1) attributes.push(`rowspan="${span.rowspan}"`);
  const attr = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  return `<${tag}${attr}>${escapeCell(text)}</${tag}>`;
}
function buildColgroup(cells, columnCount) {
  if (columnCount === 0) return "";
  const widths = [];
  for (const row of cells) {
    for (let c = 0; c < columnCount; c += 1) {
      const length = Math.min((row[c] ?? "").length, COLUMN_WIDTH_CAP);
      widths[c] = Math.max(widths[c] ?? 0, length);
    }
  }
  const weights = widths.map((width) => Math.max(4, width));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cols = weights.map((weight) => `<col style="width:${(weight / total * 100).toFixed(2)}%">`).join("");
  return `<colgroup>${cols}</colgroup>`;
}
function planRowBlocks(merges, startRow, endRow, blockRows) {
  const blocks = [];
  let start = startRow;
  while (start < endRow) {
    const boundary = Math.min(start + blockRows, endRow);
    let end = boundary;
    if (boundary < endRow) {
      for (const merge of merges) {
        if (merge.s.r < boundary && merge.e.r >= boundary) {
          end = Math.min(end, Math.max(start + 1, merge.s.r));
        }
      }
    }
    blocks.push([start, end]);
    start = end;
  }
  return blocks;
}
function renderSheet(sheet, maxRows) {
  const totalRows = sheet.cells.length;
  if (totalRows === 0) {
    return { html: "", rowLimit: null, columnCount: 0 };
  }
  const trueRowCount = sheet.sourceRowCount ?? totalRows;
  const columnCount = sheet.cells.reduce(
    (widest, row) => Math.max(widest, row.length),
    0
  );
  const renderedRows = Math.min(totalRows, maxRows);
  const merges = indexMerges(sheet.merges, renderedRows, columnCount);
  const colgroup = buildColgroup(sheet.cells.slice(0, renderedRows), columnCount);
  const header = sheet.cells[0] ?? [];
  const headerCells = [];
  for (let c = 0; c < columnCount; c += 1) {
    if (merges.covered.has(key(0, c))) continue;
    headerCells.push(cellMarkup("th", header[c] ?? "", 0, c, merges));
  }
  const head = `<thead><tr>${headerCells.join("")}</tr></thead>`;
  const blocks = planRowBlocks(sheet.merges, 1, renderedRows, SHEET_TABLE_BLOCK_ROWS);
  if (blocks.length === 0) blocks.push([1, 1]);
  const tables = [];
  for (const [blockStart, blockEnd] of blocks) {
    const bodyRows = [];
    for (let r = blockStart; r < blockEnd; r += 1) {
      const row = sheet.cells[r] ?? [];
      const tds = [];
      for (let c = 0; c < columnCount; c += 1) {
        if (merges.covered.has(key(r, c))) continue;
        tds.push(cellMarkup("td", row[c] ?? "", r, c, merges));
      }
      bodyRows.push(`<tr>${tds.join("")}</tr>`);
    }
    tables.push(`<table>${colgroup}${head}<tbody>${bodyRows.join("")}</tbody></table>`);
  }
  const html = `<section class="sheet"><h1 class="sheet-name">${escapeCell(sheet.name)}</h1>` + tables.join("") + `</section>`;
  const rowLimit = trueRowCount > renderedRows ? { sheet: sheet.name, rowCount: trueRowCount, renderedRows } : null;
  return { html, rowLimit, columnCount };
}
function renderWorkbookHtml(sheets, options, maxRows = Number.POSITIVE_INFINITY) {
  const sections = [];
  const rowLimitSheets = [];
  let maxColumns = 0;
  for (const sheet of sheets) {
    const rendered = renderSheet(sheet, maxRows);
    if (rendered.html.length === 0) continue;
    sections.push(rendered.html);
    maxColumns = Math.max(maxColumns, rendered.columnCount);
    if (rendered.rowLimit !== null) rowLimitSheets.push(rendered.rowLimit);
  }
  const orientation = resolveSheetOrientation(options.orientation, maxColumns);
  const css = `${OFFICE_PRINT_CSS}
${composeSpreadsheetCss(options, orientation)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${sections.join("")}</body></html>`;
  return {
    html,
    rowLimitSheets,
    renderedSheets: sections.length,
    maxColumns
  };
}
var AUTO_LANDSCAPE_COLUMNS, SHEET_TABLE_BLOCK_ROWS, COLUMN_WIDTH_CAP;
var init_sheet_to_html = __esm({
  "src/main/services/convert/sheet-to-html.ts"() {
    "use strict";
    init_docx();
    AUTO_LANDSCAPE_COLUMNS = 8;
    SHEET_TABLE_BLOCK_ROWS = 2e4;
    COLUMN_WIDTH_CAP = 40;
  }
});

// src/main/services/convert/adapters/xlsx.ts
function isCfbHead(head) {
  if (head.length < CFB_SIGNATURE.length) return false;
  return CFB_SIGNATURE.every((byte, index) => head[index] === byte);
}
function isZipHead(head) {
  return head.length >= 2 && head[0] === 80 && head[1] === 75;
}
function looksLikeXlsx(head) {
  if (!isZipHead(head)) return false;
  const text = head.toString("latin1");
  return text.includes("xl/") || text.includes("spreadsheetml");
}
function looksLikeOds(head) {
  if (!isZipHead(head)) return false;
  const text = head.toString("latin1");
  if (text.includes("application/vnd.oasis.opendocument.spreadsheet")) return true;
  return text.includes("content.xml") && text.includes("styles.xml") && !text.includes("application/vnd.oasis.opendocument.text");
}
function looksLikeXls(path, head) {
  if (!isCfbHead(head)) return false;
  if ((0, import_node_path3.extname)(path).toLowerCase() === ".xls") return true;
  const utf16 = head.toString("utf16le");
  return utf16.includes("Workbook") || utf16.includes("Book");
}
function cellValueText(cell) {
  if (cell === void 0) return "";
  if (typeof cell.w === "string" && cell.w.length > 0) return cell.w;
  if (cell.v === void 0 || cell.v === null) return "";
  if (cell.t === "n" || cell.t === "d") {
    const format = typeof cell.z === "string" && cell.z.length > 0 ? cell.z : "General";
    try {
      return String(import_xlsx.SSF.format(format, cell.v));
    } catch {
      return String(cell.v);
    }
  }
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v);
}
function worksheetToGrid(name, ws, maxRows = Number.POSITIVE_INFINITY) {
  const ref = typeof ws["!ref"] === "string" ? ws["!ref"] : void 0;
  let range;
  try {
    range = import_xlsx.utils.decode_range(ref ?? "A1");
  } catch {
    range = import_xlsx.utils.decode_range("A1");
  }
  const merges = [];
  for (const merge of ws["!merges"] ?? []) {
    merges.push({
      s: { r: merge.s.r, c: merge.s.c },
      e: { r: merge.e.r, c: merge.e.c }
    });
    range.s.r = Math.min(range.s.r, merge.s.r);
    range.s.c = Math.min(range.s.c, merge.s.c);
    range.e.r = Math.max(range.e.r, merge.e.r);
    range.e.c = Math.max(range.e.c, merge.e.c);
  }
  const trueRowCount = range.e.r - range.s.r + 1;
  const renderedRowCount = Math.min(trueRowCount, maxRows);
  const cells = [];
  for (let r = range.s.r; r < range.s.r + renderedRowCount; r += 1) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const address = import_xlsx.utils.encode_cell({ r, c });
      row.push(cellValueText(ws[address]));
    }
    cells.push(row);
  }
  if (ref === void 0 && cells.every((row) => row.every((cell) => cell.length === 0))) {
    return { name, cells: [], merges, sourceRowCount: 0 };
  }
  return { name, cells, merges, sourceRowCount: trueRowCount };
}
function createSheetAdapter(config) {
  const print = config.print ?? printHtmlToPdf;
  const maxBytes = config.maxBytes ?? CONVERT_LIMITS.spreadsheetBytes;
  const maxRows = config.maxRows ?? CONVERT_LIMITS.sheetRows;
  return {
    id: config.id,
    label: config.label,
    extensions: [...config.extensions],
    capabilities: { canImport: true, canExport: false },
    // A reflow of the grid, not a byte-faithful reproduction.
    fidelity: "layout",
    specificity: "specific",
    maxBytes,
    sniff: config.sniff,
    async convert(ctx) {
      const { path, options, signal, onProgress } = ctx;
      const info = await (0, import_promises3.stat)(path);
      if (info.size > maxBytes) throw new ConvertFailure("too-large");
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("decoding", 0.1);
      const bytes = await (0, import_promises3.readFile)(path);
      if (bytes.length === 0) throw new ConvertFailure("empty-file");
      const head = bytes.subarray(0, 8);
      if (isZipHead(head)) {
        try {
          inspectZip(new Uint8Array(bytes), config.zipLimits);
        } catch (thrown) {
          if (thrown instanceof ConvertZipError) {
            throw new ConvertFailure(thrown.code, thrown.message);
          }
          throw thrown;
        }
      } else if (!isCfbHead(head)) {
        throw new ConvertFailure(
          "corrupt",
          "The file is not a readable spreadsheet container (no XLSX/ODS ZIP or XLS OLE header)."
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("parsing", 0.35);
      let workbook;
      try {
        workbook = (0, import_xlsx.read)(bytes, {
          type: "buffer",
          // Keep the file's own number/date formats and pre-formatted text.
          cellText: true,
          cellNF: true,
          cellDates: false
        });
      } catch (thrown) {
        throw new ConvertFailure(
          "corrupt",
          `The spreadsheet could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`
        );
      }
      const sheetNames = workbook.SheetNames ?? [];
      if (sheetNames.length === 0) {
        throw new ConvertFailure("decode-failed", "The workbook contains no sheets.");
      }
      const grids = [];
      for (const name of sheetNames) {
        const worksheet = workbook.Sheets[name];
        if (worksheet === void 0) continue;
        const grid = worksheetToGrid(name, worksheet, maxRows);
        if (grid.cells.length === 0) continue;
        grids.push(grid);
      }
      if (grids.length === 0) {
        throw new ConvertFailure(
          "decode-failed",
          "The workbook contains no cell data, so there is nothing to render."
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("laying-out", 0.6);
      const rendered = renderWorkbookHtml(grids, {
        gridlines: options.spreadsheetGridlines,
        fitToWidth: options.spreadsheetFitToWidth,
        orientation: options.spreadsheetOrientation,
        pageSize: options.pageSize,
        marginMm: options.marginMm
      });
      const html = injectSecurityMeta(rendered.html);
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
        // The composed `@page` rule carries the chosen orientation.
        preferCSSPageSize: true
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }
      const warnings = [];
      for (const limit of rendered.rowLimitSheets) {
        warnings.push({
          code: "row-limit",
          message: `Sheet "${limit.sheet}" has ${limit.rowCount} rows; only the first ${limit.renderedRows} were imported.`,
          detail: "The row ceiling was reached for this sheet; remaining rows were not rendered."
        });
      }
      warnings.push(...blockedResourceWarnings(printed.value.blockedUrls));
      onProgress?.("done", 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: config.id,
        fidelity: "layout",
        warnings,
        title: (0, import_node_path3.basename)(path, (0, import_node_path3.extname)(path))
      };
    }
  };
}
function createXlsxAdapter(print = printHtmlToPdf, maxBytes = CONVERT_LIMITS.spreadsheetBytes, zipLimits, maxRows = CONVERT_LIMITS.sheetRows) {
  return createSheetAdapter({
    id: "xlsx",
    label: "Excel workbook",
    extensions: [".xlsx"],
    sniff: (_path, head) => looksLikeXlsx(head),
    print,
    maxBytes,
    zipLimits,
    maxRows
  });
}
function createXlsAdapter(print = printHtmlToPdf, maxBytes = CONVERT_LIMITS.spreadsheetBytes, maxRows = CONVERT_LIMITS.sheetRows) {
  return createSheetAdapter({
    id: "xls",
    label: "Excel workbook (legacy .xls)",
    extensions: [".xls"],
    sniff: (path, head) => looksLikeXls(path, head),
    print,
    maxBytes,
    maxRows
  });
}
function createOdsAdapter(print = printHtmlToPdf, maxBytes = CONVERT_LIMITS.spreadsheetBytes, zipLimits, maxRows = CONVERT_LIMITS.sheetRows) {
  return createSheetAdapter({
    id: "ods",
    label: "OpenDocument spreadsheet",
    extensions: [".ods"],
    sniff: (_path, head) => looksLikeOds(head),
    print,
    maxBytes,
    zipLimits,
    maxRows
  });
}
var import_promises3, import_node_path3, import_xlsx, CFB_SIGNATURE, xlsxAdapter, xlsAdapter, odsAdapter;
var init_xlsx = __esm({
  "src/main/services/convert/adapters/xlsx.ts"() {
    "use strict";
    import_promises3 = require("node:fs/promises");
    import_node_path3 = require("node:path");
    import_xlsx = require("xlsx");
    init_errors();
    init_limits();
    init_html_print();
    init_templates();
    init_convert_zip();
    init_sheet_to_html();
    CFB_SIGNATURE = [208, 207, 17, 224, 161, 177, 26, 225];
    xlsxAdapter = createXlsxAdapter();
    xlsAdapter = createXlsAdapter();
    odsAdapter = createOdsAdapter();
  }
});

// src/main/services/convert/convert-cfb.ts
function isCfb(head) {
  if (head.length < CFB_SIGNATURE2.length) return false;
  return CFB_SIGNATURE2.every((byte, index) => head[index] === byte);
}
function u16(buf, offset) {
  if (offset + 2 > buf.length) throw new CfbError("truncated CFB field");
  return buf[offset] | buf[offset + 1] << 8;
}
function u32(buf, offset) {
  if (offset + 4 > buf.length) throw new CfbError("truncated CFB field");
  return (buf[offset] | buf[offset + 1] << 8 | buf[offset + 2] << 16 | buf[offset + 3] << 24) >>> 0;
}
var CFB_SIGNATURE2, ENDOFCHAIN, FREESECT, MAX_SECTOR_CHAIN, CfbError, CompoundFile;
var init_convert_cfb = __esm({
  "src/main/services/convert/convert-cfb.ts"() {
    "use strict";
    CFB_SIGNATURE2 = [208, 207, 17, 224, 161, 177, 26, 225];
    ENDOFCHAIN = 4294967294;
    FREESECT = 4294967295;
    MAX_SECTOR_CHAIN = 4 * 1024 * 1024;
    CfbError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "CfbError";
      }
    };
    CompoundFile = class {
      constructor(data) {
        this.data = data;
        this.sectorSize = 2 ** u16(data, 30);
        this.miniSectorSize = 2 ** u16(data, 32);
        this.miniCutoff = u32(data, 56);
        if (this.sectorSize < 128 || this.sectorSize > 65536) {
          throw new CfbError("unsupported CFB sector size");
        }
        this.readFat(u32(data, 44), u32(data, 48), u32(data, 68), u32(data, 72));
        this.readDirectory(u32(data, 48));
        this.readMiniFat(u32(data, 60), u32(data, 64));
      }
      data;
      sectorSize;
      miniSectorSize;
      miniCutoff;
      fat = [];
      miniFat = [];
      root;
      entries = [];
      sectorOffset(sector) {
        const offset = (sector + 1) * this.sectorSize;
        if (offset < 0 || offset + this.sectorSize > this.data.length) {
          throw new CfbError("CFB sector outside the file");
        }
        return offset;
      }
      sectorBytes(sector) {
        const offset = this.sectorOffset(sector);
        return this.data.subarray(offset, offset + this.sectorSize);
      }
      readFat(numFatSectors, _firstDir, firstDifat, numDifat) {
        const fatSectors = [];
        for (let i = 0; i < 109; i += 1) {
          const sector = u32(this.data, 76 + i * 4);
          if (sector === FREESECT || sector === ENDOFCHAIN) break;
          fatSectors.push(sector);
        }
        let difat = firstDifat;
        let guard = 0;
        while (difat !== ENDOFCHAIN && difat !== FREESECT && guard < numDifat && guard < MAX_SECTOR_CHAIN) {
          const bytes = this.sectorBytes(difat);
          const perSector = this.sectorSize / 4 - 1;
          for (let i = 0; i < perSector; i += 1) {
            const sector = u32(bytes, i * 4);
            if (sector === FREESECT || sector === ENDOFCHAIN) continue;
            fatSectors.push(sector);
          }
          difat = u32(bytes, perSector * 4);
          guard += 1;
        }
        const declared = numFatSectors === 0 ? fatSectors.length : numFatSectors;
        for (const sector of fatSectors.slice(0, declared)) {
          const bytes = this.sectorBytes(sector);
          for (let i = 0; i < bytes.length; i += 4) this.fat.push(u32(bytes, i));
        }
        if (this.fat.length === 0) throw new CfbError("CFB has no FAT");
      }
      readMiniFat(firstMiniFat, numMiniFat) {
        if (firstMiniFat === ENDOFCHAIN || firstMiniFat === FREESECT) return;
        let sector = firstMiniFat;
        let guard = 0;
        const seen = /* @__PURE__ */ new Set();
        while (sector !== ENDOFCHAIN && sector !== FREESECT && guard < numMiniFat + 1) {
          if (seen.has(sector)) break;
          seen.add(sector);
          const bytes = this.sectorBytes(sector);
          for (let i = 0; i < bytes.length; i += 4) this.miniFat.push(u32(bytes, i));
          if (sector >= this.fat.length) break;
          sector = this.fat[sector];
          guard += 1;
        }
      }
      readDirectory(firstDir) {
        const bytes = this.readFatChain(firstDir, 0);
        for (let offset = 0; offset + 128 <= bytes.length; offset += 128) {
          const nameLen = u16(bytes, offset + 64);
          const type = bytes[offset + 66];
          if (nameLen < 2 || type === 0) continue;
          const name = Buffer.from(
            bytes.subarray(offset, offset + Math.min(nameLen - 2, 62))
          ).toString("utf16le");
          const startSector = u32(bytes, offset + 116);
          const sizeLow = u32(bytes, offset + 120);
          const sizeHigh = u32(bytes, offset + 124);
          const size = sizeHigh === 0 ? sizeLow : Number.MAX_SAFE_INTEGER;
          this.entries.push({ name, type, startSector, size });
        }
        const root = this.entries.find((entry) => entry.type === 5);
        if (root === void 0) throw new CfbError("CFB has no root directory entry");
        this.root = root;
      }
      /** Follow a FAT chain from `start` and concatenate the sectors. */
      readFatChain(start, expectedSize) {
        const parts = [];
        let sector = start;
        let total = 0;
        let guard = 0;
        const seen = /* @__PURE__ */ new Set();
        while (sector !== ENDOFCHAIN && sector !== FREESECT && guard < MAX_SECTOR_CHAIN) {
          if (seen.has(sector)) throw new CfbError("CFB sector chain loops");
          seen.add(sector);
          const bytes = this.sectorBytes(sector);
          parts.push(bytes);
          total += bytes.length;
          if (expectedSize > 0 && total >= expectedSize) break;
          if (sector >= this.fat.length) break;
          sector = this.fat[sector];
          guard += 1;
        }
        const joined = Buffer.concat(parts.map((part) => Buffer.from(part)));
        return expectedSize > 0 ? joined.subarray(0, expectedSize) : joined;
      }
      /** Follow a mini-FAT chain within the root's mini stream. */
      readMiniChain(start, size) {
        const miniStream = this.readFatChain(this.root.startSector, this.root.size);
        const parts = [];
        let sector = start;
        let total = 0;
        let guard = 0;
        const seen = /* @__PURE__ */ new Set();
        while (sector !== ENDOFCHAIN && sector !== FREESECT && guard < MAX_SECTOR_CHAIN) {
          if (seen.has(sector)) throw new CfbError("CFB mini chain loops");
          seen.add(sector);
          const offset = sector * this.miniSectorSize;
          if (offset + this.miniSectorSize > miniStream.length) break;
          parts.push(miniStream.subarray(offset, offset + this.miniSectorSize));
          total += this.miniSectorSize;
          if (total >= size) break;
          if (sector >= this.miniFat.length) break;
          sector = this.miniFat[sector];
          guard += 1;
        }
        return Buffer.concat(parts.map((part) => Buffer.from(part))).subarray(0, size);
      }
      /** Read one stream by directory name, or null when absent. */
      read(name) {
        const entry = this.entries.find((candidate) => candidate.name === name);
        if (entry === void 0) return null;
        if (entry.size === 0) return new Uint8Array(0);
        if (entry.size !== Number.MAX_SAFE_INTEGER && entry.size < this.miniCutoff) {
          return this.readMiniChain(entry.startSector, entry.size);
        }
        return this.readFatChain(entry.startSector, entry.size);
      }
    };
  }
});

// src/main/services/convert/adapters/legacy-doc.ts
function looksLikeLegacyDoc(path, head) {
  if (!isCfb(head)) return false;
  if ((0, import_node_path4.extname)(path).toLowerCase() === ".doc") return true;
  return head.includes(Buffer.from("WordDocument", "utf16le"));
}
function u162(buf, offset) {
  if (offset + 2 > buf.length) throw new CfbError("truncated CFB field");
  return buf[offset] | buf[offset + 1] << 8;
}
function u322(buf, offset) {
  if (offset + 4 > buf.length) throw new CfbError("truncated CFB field");
  return (buf[offset] | buf[offset + 1] << 8 | buf[offset + 2] << 16 | buf[offset + 3] << 24) >>> 0;
}
function decodeWordBytes(raw, utf16) {
  if (utf16) return Buffer.from(raw).toString("utf16le");
  try {
    return new TextDecoder("windows-1252").decode(raw);
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}
function readPieceTable(word, table) {
  const fcClx = u322(word, 418);
  const lcbClx = u322(word, 422);
  if (lcbClx === 0 || fcClx + lcbClx > table.length) return null;
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  let index = 0;
  let plc = null;
  while (index < clx.length) {
    const kind = clx[index];
    if (kind === 1) {
      if (index + 3 > clx.length) break;
      const length = u162(clx, index + 1);
      index += 3 + length;
      continue;
    }
    if (kind === 2) {
      if (index + 5 > clx.length) break;
      const length = u322(clx, index + 1);
      if (index + 5 + length > clx.length) return null;
      plc = clx.subarray(index + 5, index + 5 + length);
      break;
    }
    break;
  }
  if (plc === null) return null;
  const pieces = Math.floor((plc.length - 4) / 12);
  if (pieces <= 0) return null;
  const pcdBase = (pieces + 1) * 4;
  let out = "";
  let chars = 0;
  for (let k = 0; k < pieces; k += 1) {
    const count = u322(plc, (k + 1) * 4) - u322(plc, k * 4);
    if (count <= 0) continue;
    chars += count;
    if (chars > MAX_RECOVERED_CHARS) break;
    const fc = u322(plc, pcdBase + k * 8 + 2);
    if ((fc & 1073741824) !== 0) {
      const start = (fc & 1073741823) >>> 1;
      if (start + count > word.length) continue;
      out += decodeWordBytes(word.subarray(start, start + count), false);
    } else {
      const offset = fc & 1073741823;
      if (offset + count * 2 > word.length) continue;
      out += Buffer.from(word.subarray(offset, offset + count * 2)).toString("utf16le");
    }
  }
  return out.length > 0 ? out : null;
}
function recoverDocText(doc) {
  const word = doc.read("WordDocument");
  if (word === null || word.length < 32) return null;
  if (u162(word, 0) !== 42476) return null;
  const flags = u162(word, 10);
  if ((flags & 256) !== 0 || (flags & 32768) !== 0) return null;
  const fComplex = (flags & 4) !== 0;
  const fWhichTblStm = (flags & 512) !== 0;
  const fExtChar = (flags & 4096) !== 0;
  if (fComplex) {
    const table = doc.read(fWhichTblStm ? "1Table" : "0Table");
    if (table !== null) {
      const text = readPieceTable(word, table);
      if (text !== null) return { text, method: "piece-table" };
    }
  }
  const fcMin = u322(word, 24);
  const fcMac = u322(word, 28);
  if (fcMac > fcMin && fcMac <= word.length) {
    return {
      text: decodeWordBytes(word.subarray(fcMin, fcMac), fExtChar),
      method: "simple"
    };
  }
  return null;
}
function cleanWordText(text) {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 13 || code === 11 || code === 12 || code === 10) {
      out += "\n";
      continue;
    }
    if (code === 7 || code === 9) {
      out += "	";
      continue;
    }
    if (code === 30) {
      out += "-";
      continue;
    }
    if (code === 160) {
      out += " ";
      continue;
    }
    if (code === 19 || code === 20 || code === 21) continue;
    if (code < 32) continue;
    out += character;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
function escapeText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function createLegacyDocAdapter(print = printHtmlToPdf, maxBytes = CONVERT_LIMITS.docBytes) {
  return {
    id: "doc",
    label: "Legacy Word document (.doc)",
    extensions: [".doc"],
    capabilities: { canImport: true, canExport: false },
    fidelity: "degraded",
    specificity: "specific",
    maxBytes,
    sniff(path, head) {
      return looksLikeLegacyDoc(path, head);
    },
    async convert(ctx) {
      const { path, options, signal, onProgress } = ctx;
      const info = await (0, import_promises4.stat)(path);
      if (info.size > maxBytes) throw new ConvertFailure("too-large");
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("decoding", 0.1);
      const bytes = await (0, import_promises4.readFile)(path);
      let doc;
      try {
        doc = new CompoundFile(new Uint8Array(bytes));
      } catch (thrown) {
        throw new ConvertFailure(
          "corrupt",
          `The legacy Word container could not be read: ${thrown instanceof Error ? thrown.message : String(thrown)}`
        );
      }
      const recovered = recoverDocText(doc);
      if (recovered === null) {
        throw new ConvertFailure(
          "decode-failed",
          "No readable text could be recovered from this legacy Word document. It may be encrypted or use an unsupported word-processing format."
        );
      }
      const text = cleanWordText(recovered.text);
      if (text.trim().length === 0) {
        throw new ConvertFailure(
          "decode-failed",
          "The legacy Word document contained no recoverable text."
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();
      onProgress?.("laying-out", 0.5);
      const html = injectSecurityMeta(
        wrapOfficeDocument(`<pre>${escapeText(text)}</pre>`)
      );
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }
      const warnings = [
        {
          code: "legacy-format-degraded",
          message: "This legacy .doc file was imported as extracted text only. Headings, lists, tables, images, inline styling, columns and page layout could not be recovered.",
          detail: `Recovered ${text.length} character(s) via ${recovered.method === "piece-table" ? "the Word piece table" : "the simple fcMin/fcMac range"}.`
        },
        ...blockedResourceWarnings(printed.value.blockedUrls)
      ];
      onProgress?.("done", 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: "doc",
        fidelity: "degraded",
        warnings,
        title: (0, import_node_path4.basename)(path, (0, import_node_path4.extname)(path))
      };
    }
  };
}
var import_promises4, import_node_path4, MAX_RECOVERED_CHARS, legacyDocAdapter;
var init_legacy_doc = __esm({
  "src/main/services/convert/adapters/legacy-doc.ts"() {
    "use strict";
    import_promises4 = require("node:fs/promises");
    import_node_path4 = require("node:path");
    init_errors();
    init_limits();
    init_html_print();
    init_templates();
    init_convert_cfb();
    init_docx();
    init_convert_cfb();
    MAX_RECOVERED_CHARS = 32 * 1024 * 1024;
    legacyDocAdapter = createLegacyDocAdapter();
  }
});

// src/main/services/convert/odf-to-html.ts
function localName(name) {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}
function parseAttributes(text) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    attrs[match[1]] = match[2] !== void 0 ? match[2] : match[3] ?? "";
  }
  return attrs;
}
function parseOdfXml(xml, limits = ODF_PARSE_LIMITS) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  let nodes = 0;
  let textChars = 0;
  let i = 0;
  const pushText = (text) => {
    if (text.length === 0) return;
    textChars += text.length;
    if (textChars > limits.maxTextChars) {
      throw new OdfParseError("ODF text exceeds the parse ceiling.");
    }
    stack[stack.length - 1].children.push(text);
  };
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      pushText(xml.slice(i));
      break;
    }
    if (lt > i) pushText(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end2 = xml.indexOf("-->", lt + 4);
      if (end2 < 0) throw new OdfParseError("Unterminated XML comment.");
      i = end2 + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end2 = xml.indexOf("]]>", lt + 9);
      if (end2 < 0) throw new OdfParseError("Unterminated CDATA section.");
      pushText(xml.slice(lt + 9, end2));
      i = end2 + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end2 = xml.indexOf(">", lt);
      if (end2 < 0) throw new OdfParseError("Unterminated XML declaration.");
      i = end2 + 1;
      continue;
    }
    const end = xml.indexOf(">", lt);
    if (end < 0) throw new OdfParseError("Unterminated XML tag.");
    let body = xml.slice(lt + 1, end);
    if (body.startsWith("/")) {
      const name2 = body.slice(1).trim();
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].name !== name2) depth -= 1;
      if (depth === 0 && stack[0].name !== name2) {
        throw new OdfParseError(`Unexpected closing tag </${name2}>.`);
      }
      stack.length = depth;
      i = end + 1;
      continue;
    }
    let selfClosing = false;
    if (body.endsWith("/")) {
      selfClosing = true;
      body = body.slice(0, -1);
    }
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    if (name.length === 0) throw new OdfParseError("Empty XML tag name.");
    const node = {
      name,
      attrs: parseAttributes(space < 0 ? "" : body.slice(space)),
      children: []
    };
    nodes += 1;
    if (nodes > limits.maxNodes) throw new OdfParseError("ODF node ceiling reached.");
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > limits.maxDepth) throw new OdfParseError("ODF depth ceiling reached.");
    }
    i = end + 1;
  }
  return root;
}
function unescapeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, entity) => {
    const named = ENTITIES[entity];
    if (named !== void 0) return named;
    if (entity.startsWith("#")) {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return whole;
  });
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function forEachElement(node, visit) {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    visit(child);
    forEachElement(child, visit);
  }
}
function readTextProperties(element) {
  const props = element.children.find(
    (child) => typeof child !== "string" && localName(child.name) === "text-properties"
  );
  if (props === void 0) return {};
  const out = {};
  const weight = props.attrs["fo:font-weight"];
  if (weight !== void 0) {
    if (weight === "bold") out.bold = true;
    else if (Number.isFinite(Number(weight))) out.bold = Number(weight) >= 600;
    else out.bold = false;
  }
  const style = props.attrs["fo:font-style"];
  if (style !== void 0) out.italic = style === "italic" || style === "oblique";
  return out;
}
function parseOfficeStyles(stylesXml) {
  const root = parseOdfXml(stylesXml);
  const raw = /* @__PURE__ */ new Map();
  const orderedLists = /* @__PURE__ */ new Set();
  forEachElement(root, (element) => {
    const name = localName(element.name);
    if (name === "style") {
      const styleName = element.attrs["style:name"];
      const family = element.attrs["style:family"];
      if (styleName !== void 0 && (family === "text" || family === "paragraph" || family === "table-cell")) {
        raw.set(styleName, {
          parent: element.attrs["style:parent-style-name"],
          ...readTextProperties(element)
        });
      }
    } else if (name === "default-style") {
      const family = element.attrs["style:family"];
      if (family === "text" || family === "paragraph") {
        const props = readTextProperties(element);
        if (props.bold !== void 0 || props.italic !== void 0) {
          raw.set("#default", props);
        }
      }
    } else if (name === "list-style") {
      const styleName = element.attrs["style:name"];
      if (styleName === void 0) return;
      let numbered = false;
      forEachElement(element, (child) => {
        if (localName(child.name) === "list-level-style-number") numbered = true;
      });
      if (numbered) orderedLists.add(styleName);
    }
  });
  const textStyles = /* @__PURE__ */ new Map();
  for (const styleName of raw.keys()) {
    const chain = [];
    const seen = /* @__PURE__ */ new Set();
    let current = styleName;
    while (current !== void 0 && !seen.has(current) && chain.length < 64) {
      seen.add(current);
      chain.push(current);
      current = raw.get(current)?.parent;
    }
    let bold = false;
    let italic = false;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const value = raw.get(chain[index]);
      if (value?.bold !== void 0) bold = value.bold;
      if (value?.italic !== void 0) italic = value.italic;
    }
    textStyles.set(styleName, { bold, italic });
  }
  return { textStyles, orderedLists };
}
function clampInt(value, fallback, min, max) {
  if (value === void 0) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function renderInline(nodes, ctx) {
  let out = "";
  for (const child of nodes) {
    if (typeof child === "string") {
      out += escapeHtml(unescapeXml(child).replace(/\s+/g, " "));
      continue;
    }
    switch (localName(child.name)) {
      case "span": {
        const inner = renderInline(child.children, ctx);
        const styleName = child.attrs["text:style-name"];
        const style = styleName === void 0 ? void 0 : ctx.styles.textStyles.get(styleName);
        let wrapped = inner;
        if (style?.bold === true) wrapped = `<strong>${wrapped}</strong>`;
        if (style?.italic === true) wrapped = `<em>${wrapped}</em>`;
        out += wrapped;
        break;
      }
      case "s":
        out += LINE_SPACE.repeat(clampInt(child.attrs["text:c"], 1, 1, 1e3));
        break;
      case "tab":
        out += TAB_SPAN;
        break;
      case "line-break":
        out += "<br>";
        break;
      case "a":
        out += renderInline(child.children, ctx);
        break;
      case "image": {
        const href = child.attrs["xlink:href"] ?? child.attrs["href"];
        const data = href === void 0 ? void 0 : ctx.images.get(href);
        if (data !== void 0) out += `<img src="${data}" alt="">`;
        break;
      }
      case "frame":
      case "g":
        out += renderInline(child.children, ctx);
        break;
      case "note":
        break;
      default:
        out += renderInline(child.children, ctx);
        break;
    }
  }
  return out;
}
function renderList(node, ctx) {
  const styleName = node.attrs["text:style-name"];
  const ordered = styleName !== void 0 && ctx.styles.orderedLists.has(styleName);
  const tag = ordered ? "ol" : "ul";
  let out = `<${tag}>`;
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (localName(child.name) !== "list-item") continue;
    out += `<li>${renderListItem(child, ctx)}</li>`;
  }
  return `${out}</${tag}>`;
}
function renderListItem(node, ctx) {
  const parts = [];
  for (const child of node.children) {
    if (typeof child === "string" || child.name === "") continue;
    const name = localName(child.name);
    if (name === "p") {
      parts.push(renderInline(child.children, ctx));
    } else if (name === "list") {
      parts.push(renderList(child, ctx));
    } else if (name === "table") {
      parts.push(renderTable(child, ctx));
    } else if (name === "h") {
      parts.push(renderInline(child.children, ctx));
    }
  }
  return parts.join("<br>");
}
function renderCell(node, ctx) {
  const parts = [];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const name = localName(child.name);
    if (name === "p") parts.push(renderInline(child.children, ctx));
    else if (name === "list") parts.push(renderList(child, ctx));
    else if (name === "table") parts.push(renderTable(child, ctx));
    else if (name === "h") parts.push(renderInline(child.children, ctx));
  }
  return parts.join("<br>");
}
function renderRows(node, ctx) {
  let out = "";
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const name = localName(child.name);
    if (name === "table-row") {
      out += "<tr>";
      for (const cell of child.children) {
        if (typeof cell === "string") continue;
        const cellName = localName(cell.name);
        if (cellName !== "table-cell" && cellName !== "covered-table-cell") continue;
        const repeat = cellName === "covered-table-cell" ? 1 : clampInt(cell.attrs["table:number-columns-repeated"], 1, 1, MAX_REPEATED_CELLS);
        for (let n = 0; n < repeat; n += 1) {
          out += `<td>${renderCell(cell, ctx)}</td>`;
        }
      }
      out += "</tr>";
    } else if (name === "table-rows" || name === "table-header-rows" || name === "table-row-group") {
      out += renderRows(child, ctx);
    }
  }
  return out;
}
function renderTable(node, ctx) {
  return `<table>${renderRows(node, ctx)}</table>`;
}
function renderHeading(node, ctx) {
  const level = clampInt(node.attrs["text:outline-level"], 1, 1, 6);
  return `<h${level}>${renderInline(node.children, ctx)}</h${level}>`;
}
function renderBlocks(nodes, ctx) {
  let out = "";
  for (const child of nodes) {
    if (typeof child === "string") continue;
    switch (localName(child.name)) {
      case "h":
        out += renderHeading(child, ctx);
        break;
      case "p":
        out += `<p>${renderInline(child.children, ctx)}</p>`;
        break;
      case "list":
        out += renderList(child, ctx);
        break;
      case "table":
        out += renderTable(child, ctx);
        break;
      case "section":
        out += renderBlocks(child.children, ctx);
        break;
      case "frame":
      case "image":
        out += renderInline([child], ctx);
        break;
      default:
        break;
    }
  }
  return out;
}
function findFirst(node, wanted) {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (localName(child.name) === wanted) return child;
    const nested = findFirst(child, wanted);
    if (nested !== null) return nested;
  }
  return null;
}
function odfToHtml(contentXml, styles, images) {
  const root = parseOdfXml(contentXml);
  const body = findFirst(root, "body");
  const text = body === null ? null : findFirst(body, "text");
  const nodes = text === null ? root.children : text.children;
  return renderBlocks(nodes, { styles, images });
}
var ODF_PARSE_LIMITS, OdfParseError, ENTITIES, LINE_SPACE, TAB_SPAN, MAX_REPEATED_CELLS;
var init_odf_to_html = __esm({
  "src/main/services/convert/odf-to-html.ts"() {
    "use strict";
    ODF_PARSE_LIMITS = {
      maxNodes: 2e5,
      maxDepth: 256,
      maxTextChars: 16 * 1024 * 1024
    };
    OdfParseError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "OdfParseError";
      }
    };
    ENTITIES = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'"
    };
    LINE_SPACE = "&nbsp;";
    TAB_SPAN = '<span class="odf-tab">&#9;</span>';
    MAX_REPEATED_CELLS = 1e3;
  }
});

// src/main/services/convert/pptx-to-html.ts
function emuToPt(emu) {
  return emu / EMU_PER_PT;
}
function parseRelationships(xml) {
  const out = [];
  for (const match of xml.matchAll(RELATIONSHIP_RE)) {
    out.push({ id: match[1] ?? "", type: match[2] ?? "", target: match[3] ?? "" });
  }
  return out;
}
function parsePresentationXml(xml) {
  const size = SLD_SZ_RE.exec(xml);
  if (size === null) {
    throw new PptxParseError("presentation.xml has no slide size (<p:sldSz>).");
  }
  const widthEmu = Number(size[1]);
  const heightEmu = Number(size[2]);
  if (!Number.isFinite(widthEmu) || !Number.isFinite(heightEmu) || widthEmu <= 0 || heightEmu <= 0) {
    throw new PptxParseError("presentation.xml declares a non-positive slide size.");
  }
  const slideRelIds = [];
  for (const match of xml.matchAll(SLD_ID_RE)) slideRelIds.push(match[1] ?? "");
  return { widthEmu, heightEmu, slideRelIds };
}
function resolvePackageTarget(baseDir, target) {
  const cleaned = target.replace(/\\/g, "/");
  if (cleaned.startsWith("/")) return cleaned.replace(/^\/+/, "");
  const segments = (baseDir.length === 0 ? [] : baseDir.split("/")).concat(
    cleaned.split("/")
  );
  const stack = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}
function resolveSlideTargets(slideRelIds, relationships) {
  const byId = new Map(relationships.map((rel) => [rel.id, rel]));
  const out = [];
  for (const relId of slideRelIds) {
    const rel = byId.get(relId);
    if (rel === void 0) continue;
    out.push(resolvePackageTarget("ppt", rel.target));
  }
  return out;
}
function attrNumber(attrs, name) {
  const match = new RegExp(`\\b${name}="(-?\\d+)"`).exec(attrs);
  return match === null ? null : Number(match[1]);
}
function parseXfrm(block) {
  const xfrm = /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(block)?.[1];
  if (xfrm === void 0) return null;
  const off = /<a:off\b([^>]*)\/?>/.exec(xfrm)?.[1];
  const ext = /<a:ext\b([^>]*)\/?>/.exec(xfrm)?.[1];
  if (off === void 0 || ext === void 0) return null;
  const x = attrNumber(off, "x");
  const y = attrNumber(off, "y");
  const cx = attrNumber(ext, "cx");
  const cy = attrNumber(ext, "cy");
  if (x === null || y === null || cx === null || cy === null) return null;
  return { xEmu: x, yEmu: y, cxEmu: cx, cyEmu: cy };
}
function parseFill(block) {
  const hex = /<a:solidFill>\s*<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
  return hex === void 0 ? null : `#${hex.toUpperCase()}`;
}
function parsePrst(block) {
  return /<a:prstGeom\b[^>]*\bprst="([^"]*)"/.exec(block)?.[1] ?? null;
}
function decodeXmlText(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function parseTextBody(txBody) {
  if (txBody === null) return [];
  const paragraphs = [];
  for (const paragraph of txBody.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const content = paragraph[1] ?? "";
    const runs = [];
    for (const token of content.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:br\s*\/>/g)) {
      if (token[0].startsWith("<a:br")) {
        runs.push({ text: "\n", sizePt: DEFAULT_RUN_PT, bold: false, italic: false });
        continue;
      }
      const run = token[1] ?? "";
      const rPr = /<a:rPr\b([^>]*)\/?>/.exec(run)?.[1] ?? "";
      const text = /<a:t[^>]*>([\s\S]*?)<\/a:t>/.exec(run)?.[1];
      if (text === void 0) continue;
      const size = /\bsz="(\d+)"/.exec(rPr);
      runs.push({
        text: decodeXmlText(text),
        sizePt: size === null ? DEFAULT_RUN_PT : Number(size[1]) / 100,
        bold: /\bb="1"/.test(rPr),
        italic: /\bi="1"/.test(rPr)
      });
    }
    if (runs.length > 0) paragraphs.push({ runs });
  }
  return paragraphs;
}
function parseSlideXml(xml, relationships, media, baseDir) {
  if (!/<p:sld\b/.test(xml) || !/<\/p:sld>/.test(xml)) {
    throw new PptxParseError("slide XML is not a well-formed <p:sld> part.");
  }
  const byId = new Map(relationships.map((rel) => [rel.id, rel]));
  const elements = [];
  const unsupportedPrst = [];
  for (const match of xml.matchAll(/<p:(sp|pic)\b[^>]*>([\s\S]*?)<\/p:\1>/g)) {
    const tag = match[1];
    const body = match[2] ?? "";
    const xfrm = parseXfrm(body);
    if (tag === "pic") {
      const embedId = /<a:blip\b[^>]*\br:embed="([^"]*)"/.exec(body)?.[1];
      if (embedId === void 0) continue;
      const rel = byId.get(embedId);
      if (rel === void 0) {
        throw new PptxParseError(`slide references missing relationship ${embedId}.`);
      }
      const packagePath = resolvePackageTarget(baseDir, rel.target);
      const dataUri2 = media.get(packagePath);
      if (dataUri2 === void 0) {
        throw new PptxParseError(`slide references missing media ${packagePath}.`);
      }
      elements.push({ kind: "image", xfrm, prst: null, fill: null, paragraphs: [], dataUri: dataUri2 });
      continue;
    }
    const txBody = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(body)?.[1] ?? null;
    const paragraphs = parseTextBody(txBody);
    const fill = parseFill(body);
    const hasText = paragraphs.some(
      (paragraph) => paragraph.runs.some((run) => run.text.trim().length > 0)
    );
    if (hasText) {
      elements.push({ kind: "text", xfrm, prst: null, fill, paragraphs, dataUri: null });
      continue;
    }
    const prst = parsePrst(body);
    if (prst === null) continue;
    if (!SUPPORTED_PRST.includes(prst)) {
      unsupportedPrst.push(prst);
      elements.push({ kind: "shape", xfrm, prst: "rect", fill, paragraphs: [], dataUri: null });
      continue;
    }
    elements.push({ kind: "shape", xfrm, prst, fill, paragraphs: [], dataUri: null });
  }
  return { elements, unsupportedPrst };
}
function formatPt(value) {
  return Number(value.toFixed(4)).toString();
}
function escapeHtml2(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function composeDeckPageRule(widthEmu, heightEmu) {
  return `@page { size: ${formatPt(emuToPt(widthEmu))}pt ${formatPt(emuToPt(heightEmu))}pt; margin: 0; }`;
}
function composeDeckCss(widthEmu, heightEmu) {
  const widthPt = formatPt(emuToPt(widthEmu));
  const heightPt = formatPt(emuToPt(heightEmu));
  return `
${composeDeckPageRule(widthEmu, heightEmu)}
html, body { margin: 0; padding: 0; }
.slide { position: relative; width: ${widthPt}pt; height: ${heightPt}pt; box-sizing: border-box; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
.slide:last-child { page-break-after: auto; break-after: auto; }
.shape { position: absolute; box-sizing: border-box; overflow: hidden; }
.text { display: block; }
.text p { margin: 0; white-space: pre-wrap; }
.image { display: block; }
.placeholder { display: flex; align-items: center; justify-content: center; }
.slide-placeholder { font-family: Arial, Helvetica, sans-serif; font-size: 16pt; color: #666; }
.notes { padding: 24pt; }
.notes h2 { margin: 0 0 8pt; font-size: 16pt; }
.notes pre { margin: 0; white-space: pre-wrap; font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #111; }
`.trim();
}
function geometryStyle(xfrm) {
  if (xfrm === null) return "";
  return `left:${formatPt(emuToPt(xfrm.xEmu))}pt;top:${formatPt(emuToPt(xfrm.yEmu))}pt;width:${formatPt(emuToPt(xfrm.cxEmu))}pt;height:${formatPt(emuToPt(xfrm.cyEmu))}pt;`;
}
function renderParagraph(paragraph) {
  const runs = paragraph.runs.map((run) => {
    const text = escapeHtml2(run.text).replace(/\n/g, "<br>");
    let inner = `<span style="font-size:${formatPt(run.sizePt)}pt">${text}</span>`;
    if (run.italic) inner = `<em>${inner}</em>`;
    if (run.bold) inner = `<strong>${inner}</strong>`;
    return inner;
  }).join("");
  return `<p>${runs}</p>`;
}
function renderElement(element) {
  const geometry = geometryStyle(element.xfrm);
  if (element.kind === "image") {
    return `<img class="shape image" src="${element.dataUri ?? ""}" alt="" style="${geometry}object-fit:fill;">`;
  }
  if (element.kind === "text") {
    const fill2 = element.fill === null ? "" : `background:${element.fill};`;
    const body = element.paragraphs.map(renderParagraph).join("");
    return `<div class="shape text" style="${geometry}${fill2}">${body}</div>`;
  }
  const fill = element.fill === null ? "" : `background:${element.fill};`;
  let extra = "";
  if (element.prst === "ellipse") extra = "border-radius:50%;";
  else if (element.prst === "roundRect") extra = "border-radius:8pt;";
  else if (element.prst === "triangle") {
    extra = "clip-path:polygon(50% 0,100% 100%,0 100%);";
  }
  return `<div class="shape ${element.prst ?? "rect"}" style="${geometry}${fill}${extra}"></div>`;
}
function placeholderSection(slideNumber) {
  return `<section class="slide placeholder"><div class="slide-placeholder">Slide ${slideNumber} could not be rendered.</div></section>`;
}
function renderPptxDeckHtml(input) {
  const sections = [];
  const warnings = [];
  let slidePages = 0;
  let notesPages = 0;
  for (const slide of input.slides) {
    let parsed;
    try {
      if (slide.xml === null) {
        throw new PptxParseError("the slide part is missing from the package.");
      }
      parsed = parseSlideXml(slide.xml, slide.relationships, input.media, slide.baseDir);
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      warnings.push({
        code: "generic-fallback",
        message: `Slide ${slide.number} could not be rendered and was replaced with a placeholder.`,
        detail: reason
      });
      sections.push(placeholderSection(slide.number));
      slidePages += 1;
      continue;
    }
    for (const prst of parsed.unsupportedPrst) {
      warnings.push({
        code: "generic-fallback",
        message: `Unsupported shape "${prst}" on slide ${slide.number} was drawn as a rectangle.`,
        detail: "The preset geometry has no mapping and falls back to a rectangle."
      });
    }
    const body = parsed.elements.map(renderElement).join("");
    sections.push(`<section class="slide">${body}</section>`);
    slidePages += 1;
    if (input.includeNotes && slide.notesText !== null && slide.notesText.length > 0) {
      sections.push(
        `<section class="slide notes"><h2>Notes</h2><pre>${escapeHtml2(slide.notesText)}</pre></section>`
      );
      notesPages += 1;
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${OFFICE_PRINT_CSS}
${composeDeckCss(input.widthEmu, input.heightEmu)}</style></head><body>${sections.join("")}</body></html>`;
  return { html, warnings, slidePages, notesPages };
}
var EMU_PER_PT, PptxParseError, RELATIONSHIP_RE, SLD_SZ_RE, SLD_ID_RE, DEFAULT_RUN_PT, SUPPORTED_PRST;
var init_pptx_to_html = __esm({
  "src/main/services/convert/pptx-to-html.ts"() {
    "use strict";
    init_docx();
    EMU_PER_PT = 12700;
    PptxParseError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "PptxParseError";
      }
    };
    RELATIONSHIP_RE = /<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bType="([^"]*)"[^>]*\bTarget="([^"]*)"[^>]*\/?>/g;
    SLD_SZ_RE = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/;
    SLD_ID_RE = /<p:sldId\b[^>]*\br:id="([^"]*)"/g;
    DEFAULT_RUN_PT = 18;
    SUPPORTED_PRST = ["rect", "ellipse", "roundRect", "triangle", "line"];
  }
});

// test-fixtures/adv-p55/probe/entry.ts
var entry_exports = {};
__export(entry_exports, {
  CompoundFile: () => CompoundFile,
  ConvertZipError: () => ConvertZipError,
  DEFAULT_ZIP_LIMITS: () => DEFAULT_ZIP_LIMITS,
  OdfParseError: () => OdfParseError,
  buildPptx: () => buildPptx,
  buildXlsx: () => buildXlsx,
  cellValueText: () => cellValueText,
  createSheetAdapter: () => createSheetAdapter,
  detectRowsFromText: () => detectRowsFromText,
  inspectZip: () => inspectZip,
  isCfb: () => isCfb,
  odfToHtml: () => odfToHtml,
  openZip: () => openZip,
  parseOdfXml: () => parseOdfXml,
  parseOfficeStyles: () => parseOfficeStyles,
  parsePresentationXml: () => parsePresentationXml,
  parseRelationships: () => parseRelationships,
  parseSlideXml: () => parseSlideXml,
  recoverDocText: () => recoverDocText,
  renderPptxDeckHtml: () => renderPptxDeckHtml,
  renderWorkbookHtml: () => renderWorkbookHtml,
  resolvePackageTarget: () => resolvePackageTarget,
  resolveSlideTargets: () => resolveSlideTargets,
  worksheetToGrid: () => worksheetToGrid
});
module.exports = __toCommonJS(entry_exports);
init_xlsx();
init_sheet_to_html();
init_convert_zip();
init_convert_cfb();
init_legacy_doc();
init_odf_to_html();
init_pptx_to_html();

// src/main/services/export/xlsx-export.ts
var import_xlsx2 = require("xlsx");
init_result();

// src/shared/export.ts
init_result();
var EXPORT_FIDELITY_NOTES = {
  txt: [
    "Text only: the document text layer and its reading order, nothing else.",
    "Page layout, images, colours, tables and annotations are not included."
  ],
  docx: [
    "Editable text: each page becomes real Word paragraphs you can edit.",
    "Fonts, weights, colours and exact positioning become plain paragraphs, so the page will not look identical.",
    "Pages with no extractable text appear as page images instead of text."
  ],
  xlsx: [
    "The grid is DETECTED from the text layout by a spacing heuristic (two or more spaces, or a tab, start a new cell).",
    "It is a best-effort reconstruction, not the original table structure, so columns may not match the source table.",
    "Page images are appended as a separate sheet only when images are enabled; the images sheet stores the PNG data in cells because a spreadsheet writer cannot anchor pictures to a cell."
  ],
  pptx: [
    "One slide per page, sized to the page box; a presentation has a single slide size, so the first page box is used when pages differ.",
    "The slide holds the page image when one was supplied, otherwise the extracted text as text boxes; pages with no extractable text say so.",
    "The page text is stored in the slide notes so it stays selectable even on an image-only slide."
  ]
};

// src/main/services/export/tables-from-text.ts
var CELL_SEPARATOR = /\t+| {2,}/;
function splitTextLine(line) {
  return line.split(CELL_SEPARATOR).map((cell) => cell.trim());
}
function detectRowsFromText(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    rows.push(splitTextLine(line));
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return [];
  return rows.map((row) => {
    const padded = row.slice();
    while (padded.length < width) padded.push("");
    return padded;
  });
}
function pageSheetName(pageIndex) {
  return `Page ${pageIndex}`;
}
function noTextMarker(pageIndex) {
  return `(page ${pageIndex} carried no extractable text)`;
}

// src/main/services/export/xlsx-export.ts
var FIDELITY_PROPERTY_MARKER = "conversion-fidelity";
var FULL_TEXT_SHEET = "Full text";
var PAGE_IMAGES_SHEET = "Page images";
var MAX_DATA_URI_CHARS = 3e4;
function dataUri(png) {
  const base64 = Buffer.from(png).toString("base64");
  const uri = `data:image/png;base64,${base64}`;
  return uri.length > MAX_DATA_URI_CHARS ? "(image omitted: too large to store in a spreadsheet cell)" : uri;
}
function buildXlsx(input) {
  const pagesWithoutText = [];
  const workbook = import_xlsx2.utils.book_new();
  for (const page of input.pages) {
    const rows = detectRowsFromText(page.text);
    if (rows.length === 0) {
      pagesWithoutText.push(page.pageIndex);
      import_xlsx2.utils.book_append_sheet(
        workbook,
        import_xlsx2.utils.aoa_to_sheet([[noTextMarker(page.pageIndex)]]),
        pageSheetName(page.pageIndex)
      );
      continue;
    }
    import_xlsx2.utils.book_append_sheet(workbook, import_xlsx2.utils.aoa_to_sheet(rows), pageSheetName(page.pageIndex));
  }
  const fullTextRows = [];
  for (const page of input.pages) {
    for (const line of page.text.split(/\r?\n/)) fullTextRows.push([line]);
  }
  if (fullTextRows.length === 0) fullTextRows.push([noTextMarker(0)]);
  import_xlsx2.utils.book_append_sheet(workbook, import_xlsx2.utils.aoa_to_sheet(fullTextRows), FULL_TEXT_SHEET);
  const images = input.includeImages ? input.images.filter((entry) => entry && typeof entry.pageNumber === "number") : [];
  if (images.length > 0) {
    const rows = [
      ["Page", "Width (px)", "Height (px)", "Page width (pt)", "Page height (pt)", "Image (PNG data URI)"]
    ];
    for (const entry of [...images].sort((a, b) => a.pageNumber - b.pageNumber)) {
      rows.push([
        entry.pageNumber,
        entry.width,
        entry.height,
        entry.pageWidth,
        entry.pageHeight,
        dataUri(entry.pngBuffer)
      ]);
    }
    import_xlsx2.utils.book_append_sheet(workbook, import_xlsx2.utils.aoa_to_sheet(rows), PAGE_IMAGES_SHEET);
  }
  const noteParts = [FIDELITY_PROPERTY_MARKER, ...EXPORT_FIDELITY_NOTES.xlsx];
  if (pagesWithoutText.length > 0) {
    noteParts.push(`Pages with no extractable text: ${pagesWithoutText.join(", ")}.`);
  }
  workbook.Props = {
    Title: "TFlex export (xlsx)",
    Subject: FIDELITY_PROPERTY_MARKER,
    Author: "TFlex",
    Company: "TFlex",
    Comments: noteParts.join(" | ")
  };
  const bytes = new Uint8Array((0, import_xlsx2.write)(workbook, { type: "buffer", bookType: "xlsx" }));
  return {
    format: "xlsx",
    bytes,
    fidelityNotes: EXPORT_FIDELITY_NOTES.xlsx,
    pagesWithoutText
  };
}

// src/main/services/export/pptx-export.ts
var import_pptxgenjs = __toESM(require("pptxgenjs"), 1);
init_result();
var DEFAULT_PAGE_PT = { widthPt: 612, heightPt: 792 };
var PPTX_FIDELITY_MARKER = FIDELITY_PROPERTY_MARKER;
function boxOf(entry) {
  if (entry === void 0) return null;
  const widthPt = Number(entry.pageWidth);
  const heightPt = Number(entry.pageHeight);
  if (!Number.isFinite(widthPt) || widthPt <= 0) return null;
  if (!Number.isFinite(heightPt) || heightPt <= 0) return null;
  return { widthPt, heightPt };
}
function sameBox(a, b) {
  return Math.abs(a.widthPt - b.widthPt) < 0.5 && Math.abs(a.heightPt - b.heightPt) < 0.5;
}
async function buildPptx(input) {
  const entryByPage = /* @__PURE__ */ new Map();
  for (const entry of input.entries) {
    if (entry && typeof entry.pageNumber === "number") entryByPage.set(entry.pageNumber, entry);
  }
  let primary = DEFAULT_PAGE_PT;
  for (const page of input.pages) {
    const box = boxOf(entryByPage.get(page.pageIndex));
    if (box !== null) {
      primary = box;
      break;
    }
  }
  if (primary === DEFAULT_PAGE_PT) {
    for (const entry of [...input.entries].sort((a, b) => a.pageNumber - b.pageNumber)) {
      const box = boxOf(entry);
      if (box !== null) {
        primary = box;
        break;
      }
    }
  }
  const primaryWidthIn = primary.widthPt / 72;
  const primaryHeightIn = primary.heightPt / 72;
  const pptx = new import_pptxgenjs.default();
  pptx.author = "TFlex";
  pptx.company = "TFlex";
  pptx.title = "TFlex export (pptx)";
  const layoutName = `TFLEX_PAGE_${Math.round(primary.widthPt)}x${Math.round(primary.heightPt)}`;
  pptx.defineLayout({ name: layoutName, width: primaryWidthIn, height: primaryHeightIn });
  pptx.layout = layoutName;
  const pagesWithoutText = [];
  const textOnlyPages = [];
  const differingPages = [];
  for (const page of input.pages) {
    const entry = entryByPage.get(page.pageIndex);
    const box = boxOf(entry);
    if (box !== null && !sameBox(box, primary)) differingPages.push(page.pageIndex);
    const text = page.text.trim();
    if (text.length === 0) pagesWithoutText.push(page.pageIndex);
    const slide = pptx.addSlide();
    const image = input.includeImages ? entry : void 0;
    if (image !== void 0) {
      slide.addImage({
        data: `image/png;base64,${Buffer.from(image.pngBuffer).toString("base64")}`,
        x: 0,
        y: 0,
        w: primaryWidthIn,
        h: primaryHeightIn
      });
    } else {
      textOnlyPages.push(page.pageIndex);
      slide.addText(text.length > 0 ? page.text : noTextMarker(page.pageIndex), {
        x: 0.4,
        y: 0.4,
        w: Math.max(0.2, primaryWidthIn - 0.8),
        h: Math.max(0.2, primaryHeightIn - 0.8),
        fontSize: 14,
        valign: "top",
        wrap: true
      });
    }
    slide.addNotes(text.length > 0 ? page.text : noTextMarker(page.pageIndex));
  }
  const noteParts = [PPTX_FIDELITY_MARKER, ...EXPORT_FIDELITY_NOTES.pptx];
  noteParts.push(
    `Presentation size: ${Math.round(primary.widthPt)} x ${Math.round(primary.heightPt)} points (${primaryWidthIn.toFixed(4)} x ${primaryHeightIn.toFixed(4)} inches).`
  );
  if (textOnlyPages.length > 0) {
    noteParts.push(`Text-only slides: ${textOnlyPages.join(", ")}.`);
  }
  if (pagesWithoutText.length > 0) {
    noteParts.push(`Pages with no extractable text: ${pagesWithoutText.join(", ")}.`);
  }
  if (differingPages.length > 0) {
    noteParts.push(
      `Pages whose box differs from the presentation size: ${differingPages.join(", ")}.`
    );
  }
  pptx.subject = noteParts.join(" | ");
  const written = await pptx.write({ outputType: "nodebuffer" });
  const bytes = written instanceof Uint8Array ? new Uint8Array(written) : new Uint8Array();
  return {
    format: "pptx",
    bytes,
    fidelityNotes: EXPORT_FIDELITY_NOTES.pptx,
    pagesWithoutText
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CompoundFile,
  ConvertZipError,
  DEFAULT_ZIP_LIMITS,
  OdfParseError,
  buildPptx,
  buildXlsx,
  cellValueText,
  createSheetAdapter,
  detectRowsFromText,
  inspectZip,
  isCfb,
  odfToHtml,
  openZip,
  parseOdfXml,
  parseOfficeStyles,
  parsePresentationXml,
  parseRelationships,
  parseSlideXml,
  recoverDocText,
  renderPptxDeckHtml,
  renderWorkbookHtml,
  resolvePackageTarget,
  resolveSlideTargets,
  worksheetToGrid
});
