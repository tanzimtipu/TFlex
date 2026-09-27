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
!macroend

!endif
