# Implement optional Advanced OCR in Jovrel

Read applicable repository instructions and the existing OCR, settings, IPC, document-save and job-progress contracts first. Promote this feature into the project's normal requirements/phase workflow. Deliver an integrated, tested implementation, not an isolated OCR demo.

The current baseline is Tesseract.js 7.0.0 with local English traineddata. PDF.js rasterizes pages in the renderer; Tesseract processes images in a worker and returns per-word boxes/confidence. The existing Recognize text dialog offers language, raster DPI and current/all-page scope. Preserve Basic OCR and the existing PDF/result integration.

Add an optional, fully local **PP-OCR model pipeline using ONNX Runtime**. Use RapidOCR as the reference implementation/integration candidate. CPU execution is the initial supported backend. Do not require Docling, PyTorch, CUDA, a user-installed Python environment, an account or a cloud service. Do not promise a universal recognition or speed improvement. No paid licenses, royalties, subscriptions or components requiring separate commercial permission are permitted. Preserve required open-source attribution/notices and establish compatible terms for every actual model, dictionary and dependency before distribution.

## 1. Where users activate it

Integrate into **Preferences → Documents → Text recognition**. If Preferences is organized differently in the current build, use an equivalent dedicated Text recognition section without creating another settings window. Include Basic OCR status, Advanced OCR status, selected default engine, installed languages and pack management.

Before installation show **Set up Advanced OCR**, rather than a toggle that appears enabled while downloading. Clicking Set up displays a compact in-place setup view with supported languages, exact download size, installed footprint and disk-space requirement calculated from the actual pack plus staging allowance. Explain: “Documents stay on this device. Internet is needed to download the OCR pack.” Offer **Download and set up** and **Cancel**. Do not download on app launch, opening Preferences or ordinary OCR use.

After successful setup, show Ready and offer **Use Advanced OCR by default**, initially off. Enable only on explicit selection; also permit Done while leaving Basic as default. Turning the default off retains the downloaded pack. Provide Repair and Remove separately, with the installed version/languages and disk footprint. A removal action deletes only app-owned pack files and restores Basic as the effective engine; confirm the action and protect any active job before removing resources.

## 2. Where users use it

Keep the existing **Recognize text** command in the Edit dock, Edit context panel and existing menus/command surfaces. All launch the same dialog. Do not create a parallel “advanced-only” dock command.

Add an **Engine** selector: Basic OCR and Advanced OCR, with the saved default selected when healthy/available. A per-job selection does not change the saved default. Language, DPI/quality and page scope remain part of this one workflow. Show supported languages for the selected engine; never quietly run the wrong recognizer. If a language pack is missing, provide an inline Add language action and keep Basic available when it supports that language.

When Advanced is not installed, display a quiet inline row: “Optional: Advanced OCR may improve recognition on difficult scans.” Include **Set up**. Basic OCR stays selected and Recognize stays usable. Do not open a promotional modal, warning or settings redirect before every OCR action; no repeating toast or attention badge. Set up navigates directly to the Text recognition settings section. Preserve the pending OCR dialog's scope/language/DPI draft and return focus/state on Back or Cancel. Setup alone never starts recognition or changes the document.

Use existing Current page/All pages options and add Selected pages/Custom range through the shared scope component where supported. For a new dialog choose explicit selected pages if present, otherwise Current page; show the affected-page count. A remembered scope must remain obvious and valid for the active document. Validate ranges before running. Explain unsupported input inline and keep the primary action meaningful.

## 3. Setup and job feedback

Implement explicit states: Not installed, Downloading, Verifying, Installing, Testing, Ready, Failed and Removing. Keep installation state distinct from preferred engine and from the engine used by an active job. Persist safe state for interrupted setup; a partial pack cannot become Ready.

Use the app's shared progress styling: determinate percentage and downloaded bytes when known, stage text throughout, indeterminate progress only where actual progress is unavailable. Do not fabricate smooth percentages. Respect animationsEnabled/reduced motion: progress text/value stays visible with a static indicator when motion is disabled. Provide cancellation/retry and a clear failed-stage message. Heavy work must not block resizing/navigation. Users can continue with Basic while setup runs; allow only one setup/update per pack.

Recognition uses the existing job/progress surface with engine name, pages completed/total and Cancel. Do not estimate time remaining unless it is based on observed work. On completion summarize pages recognized/skipped/failed and provide **Review suspects**. Keep result details available without a disruptive success modal.

If Advanced fails, preserve the PDF, state that it could not complete, and offer Retry or **Use Basic OCR** with the same draft scope/options. Do not silently switch engines or rerun completed pages. Make the policy for cancelled/partial jobs explicit; retain existing transactional semantics where possible. Disabling Advanced does not delete existing OCR results and does not unexpectedly change an already-running job.

## 4. Pipeline and deployment

First build a benchmark adapter using a pinned RapidOCR/PP-OCR configuration. Compare an appropriate compact language-specific PP-OCRv5 configuration and a compatible PP-OCRv6 small configuration; choose from measured accuracy, alignment, latency and memory, not the newest version number. English is the first verified pack; other languages/scripts are separate tested capabilities. Do not claim all languages work because the toolkit lists them.

Production preference: a separate Node/native OCR process with ONNX Runtime and faithfully implemented detection preprocessing, orientation, crop handling, recognition decoding and dictionaries. ONNX Runtime by itself is not an OCR pipeline. Reuse maintained implementation code where licensing and quality permit. If a packaged RapidOCR Python worker is significantly more reliable/maintainable, document that trade-off, its complete footprint and runtime ownership; users must still receive a verified pack without installing Python or running pip themselves. Do not perform native inference in Electron's UI/main process.

The prebuilt ONNX Runtime Node provider matrix documents Windows CPU/DirectML, not Windows CUDA. Start CPU-first and postpone optional DirectML until supported model/operator behavior, packaged-binary compatibility and a real inference self-test pass. GPU presence is not a readiness check. Always retain a validated CPU path; do not download a GPU stack automatically. Keep Electron context isolation/security intact and expose only narrow, validated job/capability IPC.

Use app-owned versioned pack directories under Electron's resolved userData location, not Program Files or a relative working directory. Build and publish reproducible artifacts for each supported architecture with pinned versions, a trusted signed manifest, hashes, sizes, language/model capabilities and license notices. Verify downloads and safe extraction; prevent path traversal. Activate atomically after an isolated self-test. Keep a working pack during an update; clean staging safely on failure. Configure model paths explicitly so recognition never downloads missing files at runtime. Test with networking unavailable and disable optional runtime telemetry/network features where applicable.

A compact CPU ONNX pack below 300 MB installed is a target to measure, not a promised limit. Do not hard-code 3 GB as the requirement. Account for archive, extracted files, update overlap and a bounded temporary processing allowance. Offer only required runtime/model artifacts; no training tools, global environment changes or unrelated models.

## 5. Reuse PDF and OCR result contracts

Use the existing PDF.js raster path and coordinate transforms. Process bounded pages/crop batches rather than rasterizing the whole document into memory. Cap raster dimensions, worker concurrency and inference threads based on profiling; an environment variable alone is not an overload guarantee. Reuse loaded inference sessions and cancel queued work promptly. Supervise worker crashes, timeout and memory failure; never automatically purge the installed pack after one failed job. Reject late results by document ID/version and job generation.

Return text plus page/line/word geometry, reading order, engine/model provenance and correctly defined confidence. Verify word-level alignment required by selection, search, suspect review and PDF text-layer writing. Do not stretch line boxes into fake word boxes without validating the method. Retain the original page image/content; do not rasterize native text as a side effect, duplicate a valid existing text layer or imply OCR reproduces original font/editability.

Confidence scales differ between engines. Do not apply Tesseract's current 60 threshold mechanically to Advanced or describe scores as exact correctness probabilities. Define and test engine-specific suspect thresholds; distinguish genuine word confidence from a line score. Preserve corrections and offer selective rerun without overwriting reviewed results inadvertently. Blank/noise-only pages must not produce thousands of apparent words. Do not introduce LLM rewriting or inferred replacements for illegible numbers/text.

Preserve save/undo, mixed native/scanned pages, rotations, CropBox offsets, forms/annotations and cancellation. Make re-OCR replacement policy explicit and transactional; changes cannot leak across documents. Do not write document text into diagnostic logs or send document content to a remote service.

## 6. Settings and accessibility

Specify settings impact through the project's established process before UI use. Suggested conceptual fields: preferred OCR engine (default Basic), installed pack identity/version, selected OCR language and optional validated performance preference. Reuse existing ocrLanguage/ocrDownsample where their contracts remain appropriate. Keep runtime installation metadata/job state separate from general preference values. Validate/migrate settings in the settings service, expose through typed IPC and degrade truthfully when a stored pack is missing or incompatible. The default cannot silently enable itself after installation.

Match shared typography, field/button tokens, focus rings, dialog sizing and progress surfaces. Keyboard users must reach engine/language/scope, setup/cancel and recognition controls. Announce stage/error/completion changes without flooding the screen reader on every byte. Restore focus after settings detours and avoid horizontal scrolling in dialogs. Verify compact and high-DPI layouts, Light/Dark themes and reduced motion.

## 7. Delivery and acceptance

1. Inspect and record the current baseline and required languages. Benchmark approximately 100–200 labelled representative pages, separating tuning from held-out evaluation. Compare current Tesseract, a sensibly configured/preprocessed Tesseract baseline and selected PP-OCR packs. Include clean print, low-resolution/noisy/skewed scans, receipts, columns, tables, rotated/mixed-size pages, forms, mixed native/scanned PDFs and blank/noise images. Record character/word error rates, numeric errors, missed/false detections, reading order, word-box alignment, cold/warm latency, peak memory and complete pack size. Do not compare unrelated published benchmark percentages as if they measured Jovrel.
2. Implement the engine adapter and PDF integration with Basic preserved. Demonstrate search, text selection, suspect correction, save/reopen, undo and cancellation on the same fixtures. Test worker crash/timeout and document close/edit during recognition.
3. Implement versioned pack setup and the shared settings/OCR flows. Test cancelled download, insufficient disk, corrupt artifact, offline setup failure, interrupted activation, repair, removal, app restart and architecture mismatch. A failed install must leave Basic working.
4. Run the packaged application on representative Windows machines, including a constrained 8 GB CPU machine and arm64 if supported. Test responsive/high-DPI UI and rapid document switching. Measure actual download/installed footprints; report untested hardware/languages as untested.

Release gates: explicit setup only; no paid-license components; fully offline processing after setup; Basic always available; default changes only by user choice; no duplicate OCR workflow; no repeated upgrade prompt; accurate word geometry and PDF round-trip; bounded memory; cancellation/failure preserves documents; measured improvement on target difficult-scan categories without unacceptable clean-document regressions. Do not mark Advanced production-ready on installation success alone.

Deliver the integrated changes, settings/IPC contracts, verified artifact/model manifest and notices, benchmark report, meaningful tests, before/after UI evidence and a control index describing every new action. Keep the feature behind an internal rollout gate until these checks pass. Docling/layout/table extraction is outside this implementation and must not be pulled in as an unrequested dependency.
