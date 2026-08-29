# TFlex sample documents

This directory holds the sample PDFs bundled with the app and listed on the
welcome screen. q&a will place these four fixtures here:

- report.pdf
- scanned.pdf
- form.pdf
- long.pdf

The `samples:list` IPC handler scans this directory for `.pdf` files;
`samples:load` resolves names within this directory only (no path traversal).
