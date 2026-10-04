# Jovrel file associations (Phase 97)

Jovrel registers as a selectable Windows default-app candidate for the full
PDF-family set below. `.pdf` is fully renderable; every other row is
registration-only. The typed source of truth is
`src/shared/file-associations.ts`; the shipped `.pdf` association is declared in
`electron-builder.yml` (`win.fileAssociations`); the eight non-pdf types and the
`acrobat:` URL protocol are registered as CANDIDATES ONLY by
`electron-builder.nsh` (`Jovrel.<ext>` ProgIDs + `OpenWithProgids` +
`RegisteredApplications`/`Capabilities`).

Jovrel registers as a candidate only; the installer never changes an existing
default handler, and uninstall removes only Jovrel's own entries.

| Extension | ProgID | Description | Renderable |
| --- | --- | --- | --- |
| `.aaui` | `Jovrel.aaui` | Acrobat User Interface | no |
| `.bpdx` | `Jovrel.bpdx` | Acrobat Batch PDX | no |
| `.fdf` | `Jovrel.fdf` | Acrobat Forms Document | no |
| `.pdf` | `Jovrel.pdf` | Jovrel PDF Document | yes |
| `.pdx` | `Jovrel.pdx` | Acrobat Catalog Index | no |
| `.rmf` | `Jovrel.rmf` | Acrobat Rights Management Document | no |
| `.sequ` | `Jovrel.sequ` | Acrobat Action File | no |
| `.xdp` | `Jovrel.xdp` | Acrobat XML Data Package | no |
| `.xfdf` | `Jovrel.xfdf` | Acrobat Forms Document | no |

The `acrobat:` URL protocol is registration-only as well: it is a candidate
under the `Jovrel.acrobat` ProgID, with a candidate `OpenWithProgids` value
under `Software\Classes\acrobat`; the installer never writes (or deletes) that
class root itself.

Opening a registration-only type (or the `acrobat:` protocol) launches Jovrel
and shows a type-naming message in the app instead of rendering the file; no
Acrobat-proprietary payload is claimed as renderable.
