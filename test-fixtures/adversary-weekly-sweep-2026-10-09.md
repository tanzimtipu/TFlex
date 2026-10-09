# Adversary Weekly Sweep - Status Report

**Session:** weekly-sweep  
**Agent:** adversary (77636bb1-eed6-4d71-96e8-78c3e996339f)  
**Timestamp:** 2026-10-09  
**Status:** BLOCKED - awaiting CTO triage on PENDING findings

## Current State

### 1. Build Lock Status
**Held by:** qa (agent 2fdc7fcc-39d9-421b-8a30-0a0bc1303e74)  
**Task:** TFL-1427 - Phase 123 chunk D verification  
**Impact:** Adversary probes requiring builds/tests are blocked until release

### 2. PENDING Findings Requiring CTO Triage

Two adversarial findings from Phase 116 remain in `ADVERSARIAL_REVIEW.md` with `Disposition: PENDING` and were never filed as DEFECTS:

#### ADV-249: External non-Latin1 annotation author lost on save+reload
- **Severity:** HIGH (silent irreversible metadata loss)
- **Issue:** PDFs with UTF-16BE hex-encoded `/T` (annotation author) lose the author metadata when opened and saved in TFlex
- **Root cause:** `parsePdfString()` in `annotations.ts:1081-1094` only handles `PDFString`, not `PDFHexString` (which is how UTF-16BE non-Latin1 text is encoded)
- **Reachability:** Open any PDF with non-Latin1 annotation author and save - the author is lost
- **Status:** PENDING since Phase 116, never filed as DEFECT
- **Location:** `ADVERSARIAL_REVIEW.md` line 12789

#### ADV-250: TFlex write path corrupts non-Latin1 annotation authors
- **Severity:** LOW (latent - no current renderer surface sets author)
- **Issue:** When TFlex writes annotation authors, it uses `PDFString.of(ann.author)` which only encodes Latin1, corrupting CJK/Cyrillic/Greek names to mojibake
- **Root cause:** `annotations.ts:1713-1714` uses `PDFString.of()` instead of `PDFHexString.fromText()`
- **Reachability:** Will break when Thread Stream (Phase 116+) or other features add author-setting UI
- **Status:** PENDING since Phase 116, never filed as DEFECT
- **Location:** `ADVERSARIAL_REVIEW.md` line 12822

### 3. AGENTS.md Compliance Gap

Per AGENTS.md section "ADVERSARIAL_REVIEW.md — the adversary's findings":
> "The orchestrator replaces PENDING with either `ACCEPTED -> DEF-NNN` or `REJECTED - reason`. Accepted findings are reproduced and filed in DEFECTS.md by qa. **No entry may remain PENDING when the final phase completes.**"

Phase 116 completed, but ADV-249 and ADV-250 remain PENDING with no DEFECT numbers assigned.

## Recommended Actions

1. **CTO to route ADV-249/ADV-250:**
   - Assign to qa for DEFECT filing (DEF-NNN)
   - Assign to backend-dev for fix (both are in `src/main/services/annotations.ts`)
   - These should be fixed together since they are read/write sides of the same encoding issue

2. **Adversary continuation:**
   - Resume weekly sweep once build lock is released
   - Focus areas: save/export/delete high-risk paths, hostile PDF handling, state persistence, silence attacks on Phase 123 controls
   - Consider diff-pass on Phase 123 once qa verification completes

## Evidence

- `ADVERSARIAL_REVIEW.md` lines 12750-12849 (Phase 116 annotation metadata findings)
- `test-fixtures/tfl116-adversary/probe-ann-metadata.mjs` (probe script)
- `test-fixtures/tfl116-adversary/probe-ann-metadata.log` (probe output)
- `test-fixtures/tfl116-adversary/foreign-hex-author.pdf` (test fixture)

---

**Disposition:** BLOCKED - awaiting CTO triage on ADV-249/ADV-250. Build lock held by TFL-1427.
