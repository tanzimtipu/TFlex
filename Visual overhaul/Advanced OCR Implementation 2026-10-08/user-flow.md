# User flow

## Set up voluntarily

Preferences → Documents → Text recognition → Advanced OCR → Set up.

Show supported languages, exact download/installed size and “Documents stay on this device. Internet is needed to download the OCR pack.” Download begins only after clicking Download and set up. Basic OCR remains available throughout setup.

Downloading → Verifying → Installing → Testing → Ready.

Use percentage/bytes where known, an indeterminate indicator only where progress is unknown, and stage text throughout. Offer Cancel during download and a safe cancellation policy during activation. After success show “Advanced OCR is ready”, the installed pack/languages and “Use Advanced OCR by default” (initially off). Offer Enable and Done without launching recognition automatically.

## Discover from an existing OCR action

Edit dock OCR / Edit context Recognize text / existing menu command → the same Recognize text dialog.

The engine selector shows Basic OCR ready to run. A quiet inline row says “Optional: Advanced OCR may improve recognition on difficult scans” with Set up. Do not open a separate promotional modal before this dialog. Do not use a badge count, recurring toast or mandatory warning. Set up opens the exact Preferences section; Cancel/Back restores the OCR dialog's page scope, language and DPI draft. Setting up does not recognize or modify the PDF.

## Use after installation

Recognize text → Engine: Basic OCR / Advanced OCR → Language → Pages → Recognize.

Advanced is enabled only for installed/supported languages and a healthy runtime. Each job has an explicit page scope and affected-page count. The user can switch engines for this job without altering the saved default. Progress is contained within the existing OCR job surface; completed results lead to the existing Review suspects action.

## Failure and removal

Setup failure → keep Basic OCR ready, show the failed stage and Retry/Cancel.

Recognition failure → preserve the PDF, explain briefly, offer Retry / Use Basic OCR with the same scope. No silent engine switch or automatic reprocessing of completed pages.

Preferences → Advanced OCR: installed version/languages/size, default choice, language-pack management, Repair, Remove. Removing a pack restores Basic as the effective engine; removal confirmation identifies only the app-owned files that will be removed. Cancelling removal changes nothing.
