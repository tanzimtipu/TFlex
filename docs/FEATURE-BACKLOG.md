# FEATURE-BACKLOG.md — proposed features from competitor research

The ledger for TFlex feature proposals. Numbering is **FEA-NNN**, continuing forever, matching
the `DEF-NNN` and `ADV-NNN` ledgers.

Writers: **orchestrator** only. The `feature-scout` role returns proposals but is read-only by
design — it never writes this file, which keeps an agent that ingests untrusted web pages away
from every write path. The orchestrator records what the scout returns and sets dispositions.

Entries are appended newest-section-last inside each batch, and a disposition is never
rewritten — it is changed in place only by the orchestrator, with a History line saying who,
what and why.

## Statuses

| Status | Meaning | Set by |
| --- | --- | --- |
| PROPOSED | Returned by feature-scout, not yet decided | orchestrator |
| ACCEPTED -> Phase N | Promoted into REQUIREMENTS.md as phase N | orchestrator |
| REJECTED - reason | Will not build, with the reason | orchestrator |
| DEFERRED - reason | Wanted, but not in the current plan | orchestrator |
| OUT-OF-SCOPE - reason | Conflicts with the build rules, e.g. needs a network | orchestrator |

Accepting a proposal is not the end of it: the orchestrator appends the feature to
`REQUIREMENTS.md` as the next numbered phase, in the original phase template, including the
mandatory **Settings impact** line.

Keep entries terse. This file is read in full by the scout on every run, so it grows by ten
entries per batch and its size is a recurring cost. Name, one line, source, status. When it
passes roughly 500 lines, archive closed entries to `docs/FEATURE-BACKLOG-ARCHIVE.md`.

## Entry format

```
## FEA-001: Short feature name

- Status: PROPOSED
- Source: https://example.com/page (Product)
- Category: Optimize | Create | Export | Edit | Annotate | Organize | OCR | UX
- Effort: S | M | L
- Likely new settings: yes | no
- Batch: 1

What it does: One or two sentences.

Why it matters: The user value, in one sentence.

History:
- orchestrator: recorded from feature-scout batch 1
```

---

_No proposals recorded yet. The first `feature-scout` run appends its batch below this line._
