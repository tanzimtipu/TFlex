# OCR recommendation for Jovrel — 8 October 2026

## Decision

Choose an optional local **PP-OCR model pack running through ONNX Runtime**, using RapidOCR as the reference implementation/integration candidate. Retain the existing OCR engine as a fallback. Start with CPU execution; evaluate DirectML later for Windows acceleration. Reserve Docling for a separate structured-document analysis capability covering reading order and tables, rather than making it mandatory for improved text recognition.

This is a recommendation based on official documentation and deployment fit. No engines were installed or benchmarked against Jovrel in this research. The current basic engine, target language list and exact native/runtime architecture have not been established from source. Recognition superiority and complete installed size therefore remain unmeasured.

## Why this option

RapidOCR provides an OCR pipeline built around models including PaddleOCR-derived ONNX models and supports offline deployment. It is not a separate family of magically better models: its role is making the selected models usable. Detection, recognition, orientation, dictionaries, preprocessing and decoding must be versioned as one tested pipeline. [RapidOCR](https://github.com/RapidAI/RapidOCR), [model manifest](https://github.com/RapidAI/RapidOCR/blob/main/python/rapidocr/default_models.yaml).

ONNX Runtime has Node bindings with prebuilt CPU binaries for Windows x64/arm64 and other major desktop platforms. Its documented prebuilt Node provider table lists DirectML on Windows, while CUDA is listed for Linux x64 rather than Windows. Do not assume installing onnxruntime-node enables Windows CUDA or that availability of a GPU makes an execution provider usable. Validate the exact pinned runtime against the packaged Electron build. [Node binding/platform table](https://onnxruntime.ai/docs/get-started/with-javascript/node.html).

My deployment preference is a separate OCR process with the smallest practical runtime. Prototype with RapidOCR's supported implementation; if the project can maintain preprocessing/postprocessing parity, deploy an isolated Node/native ONNX worker to avoid an added Python/PyTorch environment. ONNX Runtime alone is inference machinery, not a complete OCR pipeline. A packaged RapidOCR Python worker remains acceptable if it is materially simpler to maintain; it should be versioned and installed as a verified pack, not assembled by arbitrary pip commands on users' machines.

## Model selection

For an English-first implementation, benchmark the pinned PP-OCRv5 mobile detector plus the dedicated English recognition model as a baseline. Paddle's published model sizes are 4.7 MB for that detector and 7.5 MB for the English recognizer. The approximately 12.2 MB sum is **not** the total Jovrel download/install size: it excludes ONNX export differences, orientation models, dictionaries, image processing, runtime binaries and packaging. [Paddle model tables](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html).

Current documentation also offers PP-OCRv6 tiny/small/medium variants. Test the small variant against the v5 baseline before selecting a production default; do not automatically choose the newest version. Paddle explicitly notes that v6 and v5/v4 table metrics use different evaluation sets and are not directly comparable. Model and language support must be pinned and verified through the selected ONNX pipeline. Add script/language packs according to supported models rather than downloading everything. [Paddle model tables](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html), [Docling language/model mapping](https://docling-project.github.io/docling/concepts/OCR/).

Do not restrict the advanced engine to a tiny model based only on installed RAM. Stream bounded page batches, cap raster dimensions and recognition crop batches, and offer Fast/Balanced/Accurate profiles only where a measured trade-off exists. An English-specific model is not a multilingual solution; mixed-script documents require explicit routing or a validated multilingual recognizer.

## Alternatives considered

| Option | Assessment for Jovrel |
| --- | --- |
| RapidOCR / PP-OCR + ONNX | Preferred starting architecture for local text recognition. Allows selecting the actual detection/recognition models and a CPU-first desktop runtime. |
| Docling | Valuable for full document structure, reading order and table extraction. It can use RapidOCR itself; adding Docling does not establish higher recognition quality. Keep optional and separate. |
| Full PaddleOCR runtime | Valuable reference and model ecosystem, with Windows deployment options. Choose it if the selected models/features cannot be deployed faithfully through the ONNX pipeline; otherwise evaluate whether its additional deployment surface is justified. |
| EasyOCR | Supports many languages and CPU/GPU operation, but its documented implementation uses PyTorch. It does not offer a compelling deployment simplification for this Windows/Electron requirement. Keep as a benchmark comparator where target scripts warrant it. |
| Tesseract with improved models | Worth benchmarking if basic OCR already uses Tesseract. Official tessdata_best trades speed for accuracy relative to tessdata_fast; it is a modest model change, not proof that difficult scans will be solved. |

Sources: [Docling capabilities and licensing](https://github.com/docling-project/docling), [OCR engines](https://docling-project.github.io/docling/concepts/OCR/), [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [EasyOCR](https://github.com/JaidedAI/EasyOCR), [Tesseract model comparison](https://github.com/tesseract-ocr/tessdoc/blob/main/Data-Files.md).

## Integration requirements that decide whether this works

- Preserve each original PDF page. Use the existing raster service; map OCR coordinates back through scale, crop and rotation correctly. Provide a searchable text layer without rasterizing native text or duplicating existing valid text.
- Produce stable result records including text, polygons/boxes, page mapping, reading order and engine/model provenance. Validate word-level positioning: line boxes alone are not sufficient for accurate word selection or the OCR suspect list. Do not label a line-level confidence as an individual word confidence without an appropriate contract.
- Treat confidence as an engine score, not a calibrated probability of correctness. Tune suspect thresholds on labelled samples and retain a correction workflow. Noise-only and near-blank pages must not flood the document with fabricated text.
- Do not silently use an LLM to rewrite recognized content. Exact numbers, identifiers and quotations must remain reviewable; handwriting and severely degraded scans should have explicit measured limits.
- Keep worker crashes, timeout and memory failures outside the renderer/main process. Cancel jobs on document close; reject stale results after edits/tab changes. Limit page concurrency and image sizes instead of promising that a thread environment variable prevents overload.
- Use verified versioned packs with a manifest, hashes, notices and atomic activation. Calculate disk requirements from actual selected components and staging allowance. Provide cancellation, repair and uninstall; a failed update must not destroy a working pack.
- Download only during explicit setup/update. Test offline recognition and block unexpected runtime fetching. Keep documents local and avoid recording document text in diagnostic logs by default.

## Licensing

RapidOCR and PaddleOCR repositories use Apache-2.0, ONNX Runtime uses MIT, and Docling's code is MIT. Docling explicitly distinguishes individual model licenses from its code license. These are workable open-source starting points, but the actual distributed model checkpoints, dictionaries, native dependencies and notices must be accounted for in the pack manifest. This research does not establish legal clearance for unspecified artifacts. [RapidOCR](https://github.com/RapidAI/RapidOCR), [PaddleOCR license](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE), [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE), [Docling licensing](https://github.com/docling-project/docling#license).

## Release gate

Build a labelled corpus of approximately 100–200 representative pages: clean text, low resolution, skew/rotation, receipts, dense multi-column pages, tables, mixed native/scanned PDFs, intended scripts, handwritten samples and noise/blank pages. Split tuning and held-out validation pages. Compare the existing engine, selected PP-OCR packs and optionally Tesseract best/EasyOCR on the same inputs.

Record character/word error rate by document category, numeric/identifier errors, detection misses/false positives, reading order, box alignment, cold start, total time/page, peak memory, cancellation responsiveness and verified installed/download sizes. Model-inference-only timings in upstream tables are not page-processing latency. Test the packaged build on a typical integrated-GPU Windows laptop, a constrained 8 GB machine and Windows arm64 if supported. Advanced must show an improvement on the intended difficult-page categories without unacceptable regressions before it becomes the preferred engine. Keep basic OCR available.

**Proceed with the ONNX OCR prototype and benchmark now. Add Docling later only when structured extraction is part of the feature being delivered.**
