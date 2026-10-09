## Windows QA execution — verified runtime

On this host the tool named `bash` executes Windows PowerShell. The name does not
mean Bash syntax is supported. Do not use `if [ ... ]`, `then`, `fi`, `$(date ...)`,
Unix redirect recipes, or `\"` to escape PowerShell JSON. Do not nest PowerShell
inside this tool. Use `write`/`edit` for files and simple executable calls for commands.

The application root is `C:/Users/tanzi/OneDrive/App Development/TFlex`.
Use the tool's workdir argument when available. These absolute commands also work
without relying on inherited cwd:

    & 'C:/Program Files/nodejs/node.exe' 'C:/Users/tanzi/OneDrive/App Development/TFlex/scripts/paperclip-qa-preflight.mjs'
    & 'C:/Program Files/nodejs/node.exe' 'C:/Users/tanzi/OneDrive/App Development/TFlex/scripts/paperclip-build-lock.mjs' acquire
    npm.cmd --prefix 'C:/Users/tanzi/OneDrive/App Development/TFlex' run verify
    npm.cmd --prefix 'C:/Users/tanzi/OneDrive/App Development/TFlex' run test:e2e -- e2e/qa_native_pdf_open.spec.cjs
    & 'C:/Program Files/nodejs/node.exe' 'C:/Users/tanzi/OneDrive/App Development/TFlex/scripts/paperclip-build-lock.mjs' release

Acquire must return exit 0 before heavy work; release on every exit path. Never
hand-write lock JSON, copy timestamps, steal a lock by age, or treat a shell parser
error as a product defect. For complex filesystem logic, write a .mjs file with
the file tool and run it with the system Node executable. Inspect actual exit codes.

## Opening PDF fixtures — current app contract

Read `e2e/lib/helpers.cjs` before writing PDF-open logic. Use:

    const { launchApp } = require('./lib/launch.cjs');
    const { openSamplePath, hardClose } = require('./lib/helpers.cjs');
    await openSamplePath(win, app, absoluteFixturePath);

The helper validates the fixture, stubs Electron's MAIN-process showOpenDialog,
clicks the real Open control, waits for Intake classification, clicks the Intake
Tray's explicit Open button, waits for rendering and restores the native dialog.
Phase 118 changed generic Open to enqueue files; picking a path alone does not open it.
Electron's native picker does not emit a browser `filechooser` event. That event
applies to HTML file inputs. Do not wait for it when using the app's generic Open.

`e2e/qa_native_pdf_open.spec.cjs` is the passing current example. Older Phase 59/74
tests predate Intake; preserve their assertions but use the current shared helper.
For tests of Intake itself, use `e2e/phase118_intake.spec.cjs` so staging remains
observable before dispatch. Do not bypass application IPC or inject a fake document.

Inspect real selectors and fixture metadata. React component names such as
FlattenConfirmDialog are not CSS selectors. Do not skip required-field acceptance
because a sample lacks the required metadata; create a suitable fixture instead.
The native-open regression proves harness readiness, not full phase acceptance.
Resume the assigned acceptance checks and record actual product failures as defects.
