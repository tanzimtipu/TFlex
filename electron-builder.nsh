; TFlex installer custom NSIS include (Phase 38 item A, operator ruling 2026-09-25;
; hardened for DEF-346 after ADV-090).
;
; electron-builder includes this file via `nsis.include: electron-builder.nsh`.
; The path has no directory component, so electron-builder resolves it from the
; build-resources directory and, when absent there, from the project root
; (getResource -> path.resolve(projectDir, custom)); this file sits next to
; electron-builder.yml. It defines the documented `customInstall` hook, which
; electron-builder inserts at the end of the install section
; (templates/nsis/installSection.nsh) after the new files and the new
; per-machine registry entry are written.
;
; Job: remove the LEGACY per-user install (pre-1.30 releases) so a machine never
; keeps two copies of TFlex. That install wrote, all under the installing user's
; own profile/hive:
;   - directory    %LOCALAPPDATA%\Programs\TFlex
;   - uninstall    HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>
;   - install info HKCU\Software\<GUID>                       (InstallLocation etc.)
;   - ProgID       HKCU\Software\Classes\TFlex.pdf
;   - .pdf OpenWithProgids value pointing at that ProgID
; <GUID> is electron-builder's UUID.v5(appId, ns), unique to com.tflex.app
; (f890a78b-df18-5f38-8f11-e53795b72a9d) and exposed to this script as
; ${APP_GUID} / ${UNINSTALL_APP_KEY}.
;
; Safety (DEF-346): nothing is deleted unless the legacy TFlex install is
; proven, and every proof is exact, never a bare substring:
;   - the directory is removed only when it holds TFlex.exe AND (the NSIS
;     uninstaller "Uninstall TFlex.exe" OR the registry identity below), so a
;     directory merely named TFlex with some file called TFlex.exe is untouched;
;   - the uninstall entry is recognised only when DisplayName is exactly "TFlex"
;     or begins with exactly "TFlex " (product name plus separator);
;   - the install-info key only when InstallLocation is exactly the legacy path;
;   - the ProgID key only when shell\open\command points at the legacy exe.
; Ordering (DEF-346): the directory is removed BEFORE the registry entries. If
; RMDir /r fails (a running legacy TFlex.exe holds the file open) no registry
; entry is touched and the user is told to close TFlex and rerun - a silent
; half-cleanup (files kept, registry gone) is not allowed.
;
; Elevation/hive limitation (DEF-346): this per-machine installer runs elevated
; (RequestExecutionLevel admin). HKCU and $LOCALAPPDATA then resolve to the
; ELEVATING account, so a standard user who elevates with a DIFFERENT admin's
; credentials will not have their own legacy per-user install cleaned (and the
; admin's own profile is swept instead). This is the same limitation
; electron-builder's own HKCU uninstall sweep has. This script never writes into
; another user's hive.
;
; Every step is guarded and idempotent: a second run with no legacy install is a
; no-op. The surrounding install section already calls electron-builder's own
; uninstallOldVersion HKEY_CURRENT_USER sweep for a per-machine install; this
; hook is the belt-and-braces sweep for the cases that leaves behind (missing or
; broken legacy uninstaller, orphaned ProgID).
;
; The installer script is compiled twice: once for the uninstaller
; (BUILD_UNINSTALLER) and once for the real installer. The hook and its globals
; only exist in the latter; the guard keeps makensis from reporting the unused
; globals in the uninstaller pass (warnings are errors in this build).

!ifndef BUILD_UNINSTALLER

Var /GLOBAL tflexLegacyDisplayName
Var /GLOBAL tflexLegacyInstallLocation
Var /GLOBAL tflexLegacyProbe
Var /GLOBAL tflexLegacyProven
Var /GLOBAL tflexLegacyDirFailed

; --- Phase 49 fix — rebrand install directory (Jovrel 1.42.0).
;
; DEFECT: 1.41.0 (the first Jovrel installer) inherited the OLD per-machine
; TFlex install location and nested itself inside it, landing at
; "C:\Program Files\TFlex\Jovrel" instead of "C:\Program Files\Jovrel".
;
; Root cause (verified against the generated NSIS, not guessed):
;   1. electron-builder derives the install-info registry key from the appId
;      GUID (${APP_GUID} = f890a78b-...), which Phase 49 deliberately KEPT at
;      com.tflex.app so the new product replaces the old one in place.
;   2. In the installer's .onInit, initMultiUser -> setInstallModePerAllUsers
;      (templates/nsis/multiUser.nsh, "check registry for previous installation
;      path") reads HKLM "Software\<GUID>" InstallLocation and, when present,
;      copies it straight into $INSTDIR. For an upgrade over TFlex that value is
;      "C:\Program Files\TFlex".
;   3. The assisted installer (allowToChangeInstallationDirectory is true here)
;      defines instFilesPre as MUI_PAGE_CUSTOMFUNCTION_PRE
;      (templates/nsis/assistedInstaller.nsh). It runs
;        ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
;        ${If} $0 == ""
;          StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
;        ${EndIf}
;      APP_FILENAME is the new product dir name "Jovrel"; the inherited
;      "C:\Program Files\TFlex" does not contain it, so "\Jovrel" was appended:
;      exactly the observed "C:\Program Files\TFlex\Jovrel".
;
; customInit is inserted by installer.nsi immediately AFTER initMultiUser and
; BEFORE any page, so this is the supported place to correct the inherited
; value. Any $INSTDIR under the legacy TFlex root is reset to the canonical
; per-machine directory. A path the user chose on a previous Jovrel install
; (anything outside the TFlex root) is preserved, and the directory page still
; lets the user pick a custom path afterwards.
!macro customInit
  StrCpy $0 "$PROGRAMFILES64\TFlex"
  StrLen $1 $0
  StrCpy $2 $INSTDIR $1
  ${If} $2 == $0
    StrCpy $INSTDIR "$PROGRAMFILES64\Jovrel"
  ${EndIf}
!macroend

!macro customInstall
  ; --- 0. Prove the legacy per-user TFlex identity before touching anything.
  ;        All reads below are from HKCU / $LOCALAPPDATA, which under elevation
  ;        belong to the elevating account (see the limitation note above).
  StrCpy $tflexLegacyProven "0"
  StrCpy $tflexLegacyDirFailed "0"

  ; Identity A (exact): our appId GUID's install-info key records the legacy
  ; per-user directory as its InstallLocation. Exact equality, so another
  ; product's location can never satisfy it.
  ReadRegStr $tflexLegacyInstallLocation HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $tflexLegacyInstallLocation == "$LOCALAPPDATA\Programs\TFlex"
    StrCpy $tflexLegacyProven "1"
  ${EndIf}

  ; Identity B (exact boundary): our GUID's uninstall entry names the product
  ; "TFlex" or "TFlex <version>". Only the exact name or the first six
  ; characters "TFlex " (name plus separator) are accepted - a substring such
  ; as "NotTFlex" or a key for a product that merely contains "TFlex" cannot
  ; match.
  ReadRegStr $tflexLegacyDisplayName HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayName"
  ${If} $tflexLegacyDisplayName == "TFlex"
    StrCpy $tflexLegacyProven "1"
  ${EndIf}
  ${If} $tflexLegacyDisplayName != ""
    StrCpy $tflexLegacyProbe $tflexLegacyDisplayName 6
    ${If} $tflexLegacyProbe == "TFlex "
      StrCpy $tflexLegacyProven "1"
    ${EndIf}
  ${EndIf}

  ; --- 1. Legacy per-user install directory, removed BEFORE the registry so a
  ;        running legacy TFlex.exe (which makes RMDir /r fail) cannot leave the
  ;        registry gone while the files remain. Requires TFlex.exe plus either
  ;        the exact NSIS uninstaller name or the proven identity above.
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\TFlex\TFlex.exe"
    StrCpy $tflexLegacyProbe "0"
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\TFlex\Uninstall TFlex.exe"
      StrCpy $tflexLegacyProbe "1"
    ${EndIf}
    ${If} $tflexLegacyProven == "1"
      StrCpy $tflexLegacyProbe "1"
    ${EndIf}
    ${If} $tflexLegacyProbe == "1"
      ClearErrors
      RMDir /r "$LOCALAPPDATA\Programs\TFlex"
      IfErrors 0 tflexLegacyDirRemoved
        StrCpy $tflexLegacyDirFailed "1"
        MessageBox MB_ICONEXCLAMATION|MB_OK "TFlex could not remove the previous per-user installation in:$\r$\n$LOCALAPPDATA\Programs\TFlex$\r$\n$\r$\nA file there is in use - TFlex is most likely still running. Close TFlex and run this installer again. No registry entries were changed."
      tflexLegacyDirRemoved:
    ${EndIf}
  ${EndIf}
  ; --- 2. Registry entries, only when the legacy identity is proven AND the
  ;        directory step did not fail. The key names are our appId's unique
  ;        GUID, and the identity gate above is what makes their removal safe.
  ${If} $tflexLegacyDirFailed == "0"
  ${AndIf} $tflexLegacyProven == "1"
    ; 2a. Legacy per-user uninstall entry.
    ${If} $tflexLegacyDisplayName != ""
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    ${EndIf}

    ; 2b. Legacy per-user install-info key (InstallLocation etc.).
    ${If} $tflexLegacyInstallLocation != ""
      DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    ${EndIf}

    ; 2c. Legacy per-user .pdf ProgID, only when its shell\open\command
    ;     actually points at the legacy TFlex exe (full path, not a bare
    ;     product-name token). Its OpenWithProgids value goes with it.
    ReadRegStr $tflexLegacyProbe HKCU "Software\Classes\TFlex.pdf\shell\open\command" ""
    ${If} $tflexLegacyProbe != ""
      ${StrContains} $tflexLegacyInstallLocation "$LOCALAPPDATA\Programs\TFlex\TFlex.exe" "$tflexLegacyProbe"
      ${If} $tflexLegacyInstallLocation != ""
        DeleteRegKey HKCU "Software\Classes\TFlex.pdf"
        DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "TFlex.pdf"
      ${EndIf}
    ${EndIf}

    ; 2d. The .pdf default value is only cleared if it still points at our
    ;     ProgID (exact match); a real default handler is never disturbed.
    ReadRegStr $tflexLegacyProbe HKCU "Software\Classes\.pdf" ""
    ${If} $tflexLegacyProbe == "TFlex.pdf"
      DeleteRegValue HKCU "Software\Classes\.pdf" ""
    ${EndIf}
  ${EndIf}

  ; --- 3. Complete the Add/Remove Programs entry (Phase 40 packaging fix).
  ;        electron-builder's registryAddInstallInfo macro (templates/nsis/
  ;        include/installer.nsh) writes InstallLocation to the install-info key
  ;        "Software\<GUID>" only. The ARP uninstall key
  ;        "Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>" gets
  ;        DisplayName/UninstallString/DisplayVersion/DisplayIcon but NO
  ;        InstallLocation and NO DisplayPath, so Windows "Apps & features"
  ;        shows the install Location blank (qa measured this on the 1.30.0
  ;        per-machine install). Both missing values are known exactly here:
  ;        the install directory is $INSTDIR and the main executable is $appExe
  ;        (set to "$INSTDIR\${APP_EXECUTABLE_FILENAME}" at the top of
  ;        installSection.nsh, before this hook runs). SHELL_CONTEXT is the
  ;        exact root registryAddInstallInfo itself uses, so this lands in the
  ;        same hive as the rest of the entry: HKLM for this per-machine
  ;        install (SetShellVarContext all) and HKCU otherwise - never a
  ;        hand-picked hive.
  ;        Publisher is deliberately NOT written: electron-builder emits it only
  ;        when a COMPANY_NAME is configured, and this project declares no
  ;        author/company, so there is no known publisher value to invent.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayPath" "$appExe"

  ; --- 4. Rebrand leftover cleanup (Phase 49 fix).
  ;        An install that ran BEFORE this fix (1.41.0) nested itself at
  ;        "$PROGRAMFILES64\TFlex\Jovrel" and left the old TFlex parent behind.
  ;        Remove that stale nested install and the then-empty TFlex parent.
  ;        Safety, all exact, never a bare substring:
  ;          - the nested directory is removed only when it holds BOTH our
  ;            executables, by exact name: "Jovrel.exe" AND
  ;            "Uninstall Jovrel.exe" (a directory that merely has one
  ;            similarly named file is untouched);
  ;          - the nested directory is only touched when the CURRENT install
  ;            does not target inside the legacy TFlex root, so a user-chosen
  ;            custom path can never be the directory we delete;
  ;          - the parent is removed with a NON-RECURSIVE RMDir, which NSIS
  ;            can only ever complete on an EMPTY directory - any other
  ;            content makes it fail silently and the directory is left.
  StrCpy $0 "$PROGRAMFILES64\TFlex"
  StrLen $1 $0
  StrCpy $2 $INSTDIR $1
  ${If} $2 != $0
    ${If} ${FileExists} "$0\Jovrel\Jovrel.exe"
    ${AndIf} ${FileExists} "$0\Jovrel\Uninstall Jovrel.exe"
      ClearErrors
      RMDir /r "$0\Jovrel"
      IfErrors 0 tflexNestedDirRemoved
        MessageBox MB_ICONEXCLAMATION|MB_OK "Jovrel could not remove the previous nested installation in:$\r$\n$0\Jovrel$\r$\n$\r$\nA file there is in use - Jovrel is most likely still running. Close Jovrel and run this installer again. The TFlex folder was left in place."
        Goto tflexNestedCleanupDone
      tflexNestedDirRemoved:
    ${EndIf}
    ; Non-recursive: only removes the parent if nothing else is left inside it.
    RMDir "$0"
    tflexNestedCleanupDone:
  ${EndIf}

  ; --- 5. Phase 97 - register the eight non-pdf PDF-family types and the
  ;        acrobat: URL protocol as CANDIDATES ONLY, per-machine.
  ;        These eight types used to be `win.fileAssociations` rows, whose NSIS
  ;        APP_ASSOCIATE macro writes the extension's DEFAULT value
  ;        (FileAssociation.nsh:65-74) and silently changed Adobe's existing
  ;        per-machine defaults for eight types Jovrel cannot render (DEF-525).
  ;        Writing the `Software\Classes\acrobat` class root instead hijacked
  ;        Adobe's URL protocol (DEF-526). Only candidate slots are written here:
  ;        a `Jovrel.<ext>` / `Jovrel.acrobat` ProgID plus an OpenWithProgids
  ;        value and the RegisteredApplications/Capabilities model. No existing
  ;        default is touched. SHELL_CONTEXT is the exact root electron-builder's
  ;        own registry writes use (HKLM for this per-machine install). The
  ;        matching removal is customUnInstall below, defined OUTSIDE the
  ;        !ifndef BUILD_UNINSTALLER guard so it compiles in the uninstaller pass.
  ; --- 5a. Jovrel.<ext> ProgIDs + candidate OpenWithProgids values (x8).
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.aaui" "" "Acrobat User Interface"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.aaui\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.aaui\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.aaui\OpenWithProgids" "Jovrel.aaui" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.bpdx" "" "Acrobat Batch PDX"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.bpdx\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.bpdx\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.bpdx\OpenWithProgids" "Jovrel.bpdx" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.fdf" "" "Acrobat Forms Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.fdf\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.fdf\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.fdf\OpenWithProgids" "Jovrel.fdf" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.pdx" "" "Acrobat Catalog Index"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.pdx\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.pdx\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.pdx\OpenWithProgids" "Jovrel.pdx" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.rmf" "" "Acrobat Rights Management Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.rmf\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.rmf\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.rmf\OpenWithProgids" "Jovrel.rmf" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.sequ" "" "Acrobat Action File"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.sequ\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.sequ\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.sequ\OpenWithProgids" "Jovrel.sequ" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.xdp" "" "Acrobat XML Data Package"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.xdp\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.xdp\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.xdp\OpenWithProgids" "Jovrel.xdp" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.xfdf" "" "Acrobat Forms Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.xfdf\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.xfdf\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.xfdf\OpenWithProgids" "Jovrel.xfdf" ""
  ; --- 5b. The acrobat: URL protocol, as a candidate only. The Jovrel.acrobat
  ;         ProgID carries the command; the pre-existing Adobe class root is
  ;         only touched by adding a candidate OpenWithProgids value (DEF-526).
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.acrobat" "" "Jovrel acrobat Protocol"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.acrobat" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.acrobat\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Jovrel.acrobat\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\acrobat\OpenWithProgids" "Jovrel.acrobat" ""
  ; --- 5c. Register the app for Windows Settings > Default apps.
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Jovrel" "Software\Jovrel\Capabilities"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities" "ApplicationName" "Jovrel"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities" "ApplicationDescription" "Jovrel PDF studio"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".aaui" "Jovrel.aaui"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".bpdx" "Jovrel.bpdx"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".fdf" "Jovrel.fdf"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".pdx" "Jovrel.pdx"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".rmf" "Jovrel.rmf"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".sequ" "Jovrel.sequ"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".xdp" "Jovrel.xdp"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\FileAssociations" ".xfdf" "Jovrel.xfdf"
  WriteRegStr SHELL_CONTEXT "Software\Jovrel\Capabilities\URLAssociations" "acrobat" "Jovrel.acrobat"
!macroend

!endif

; Phase 97 - remove ONLY Jovrel's own candidate registration (DEF-525 / DEF-526).
; Defined OUTSIDE the !ifndef BUILD_UNINSTALLER guard above because
; electron-builder inserts customUnInstall from uninstaller.nsh during the
; uninstaller compile pass, where the install-only globals (and customInstall)
; do not exist. This macro uses no install-only globals ($appExe is not defined
; in that pass) and never deletes `Software\Classes\acrobat` itself, so a
; pre-existing third-party acrobat: registration is never disturbed.
!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.aaui\OpenWithProgids" "Jovrel.aaui"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.bpdx\OpenWithProgids" "Jovrel.bpdx"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.fdf\OpenWithProgids" "Jovrel.fdf"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdx\OpenWithProgids" "Jovrel.pdx"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.rmf\OpenWithProgids" "Jovrel.rmf"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.sequ\OpenWithProgids" "Jovrel.sequ"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.xdp\OpenWithProgids" "Jovrel.xdp"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.xfdf\OpenWithProgids" "Jovrel.xfdf"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\acrobat\OpenWithProgids" "Jovrel.acrobat"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.aaui"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.bpdx"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.fdf"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.pdx"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.rmf"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.sequ"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.xdp"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.xfdf"
  DeleteRegKey  SHELL_CONTEXT "Software\Classes\Jovrel.acrobat"
  DeleteRegKey  SHELL_CONTEXT "Software\Jovrel\Capabilities"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Jovrel"
!macroend
