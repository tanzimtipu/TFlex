# Advanced OCR implementation proposal — Jovrel

Prepared 8 October 2026. This folder contains an implementation brief, not application code or a completed OCR benchmark.

- [Orchestrator prompt](orchestrator-prompt.md): architecture, setup/use locations, UI behavior, rollout and acceptance criteria.
- [User flow](user-flow.md): concise specification for activation, recognition and fallback.

Verified baseline: installed Tesseract.js 7.0.0, bundled English traineddata, renderer PDF.js rasterization, a background Tesseract worker and per-word confidence/boxes. The source OcrDialog already offers language, DPI and current/all-page scope. Preserve and integrate with these contracts rather than creating a competing OCR workflow.

Decision: optional local PP-OCR/ONNX recognition, CPU-first, with RapidOCR as a reference/integration candidate. No mandatory Docling or PyTorch dependency. Docling remains a separate future structured-extraction proposal. No paid licenses, royalties, subscriptions or separate commercial permission requirements; retain required open-source notices and verify each distributed artifact's terms.

Research: [RapidOCR](https://github.com/RapidAI/RapidOCR), [ONNX Runtime Node platforms](https://onnxruntime.ai/docs/get-started/with-javascript/node.html), [PaddleOCR models](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html), [Tesseract quality guidance](https://github.com/tesseract-ocr/tessdoc/blob/main/ImproveQuality.md). Pin and verify exact versions at implementation time. No universal accuracy or speed improvement has been established against Jovrel.
