; Move mutable data beside INSTDIR before an old uninstaller can remove the directory.
!include installer-command-dir.nsh

!macro clientRename SOURCE DESTINATION
  ClearErrors
  Rename "${SOURCE}" "${DESTINATION}"
  ${if} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Cannot preserve client data. Close the client and its browsers, then retry. Data remains at ${SOURCE}."
    Abort
  ${endif}
!macroend

!macro clientProtectData
  !insertmacro clientRestoreCommandInstallDir
  ReadRegStr $R8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R8 != ""
  ${andIf} $R8 != $INSTDIR
    !ifdef CLIENT_LITE_INSTALLER
    ; assistedInstaller.nsh appends APP_FILENAME to a selected folder that
    ; does not already contain it. Accept only that exact generated child path.
    ${if} $INSTDIR == "$R8\${APP_FILENAME}"
      StrCpy $INSTDIR $R8
    ${else}
      MessageBox MB_OK|MB_ICONSTOP "Upgrade in the existing installation directory: $R8"
      Abort
    ${endif}
    !else
      MessageBox MB_OK|MB_ICONSTOP "Upgrade in the existing installation directory: $R8"
      Abort
    !endif
  ${endif}
  ${if} ${FileExists} "$INSTDIR\user-data"
    ${if} ${FileExists} "$INSTDIR.data-upgrade\user-data"
      MessageBox MB_OK|MB_ICONSTOP "Both current and recovery data exist. Preserve both directories before retrying."
      Abort
    ${endif}
    CreateDirectory "$INSTDIR.data-upgrade"
    !insertmacro clientRename "$INSTDIR\user-data" "$INSTDIR.data-upgrade\user-data"
  ${endif}
  ; Only the legacy layout kept runtime data beside bridge code. A second upgrade
  ; before first launch must retain the original snapshot instead of adding code again.
  ${ifNot} ${FileExists} "$INSTDIR.data-upgrade\user-data\.storage-layout.json"
  ${andIfNot} ${FileExists} "$INSTDIR.data-upgrade\user-data\legacy-bridge"
  ${andIf} ${FileExists} "$INSTDIR\resources\doubao-bridge"
    ${if} ${FileExists} "$INSTDIR.data-upgrade\doubao-bridge"
      MessageBox MB_OK|MB_ICONSTOP "Legacy bridge recovery data already exists. Preserve it before retrying."
      Abort
    ${endif}
    CreateDirectory "$INSTDIR.data-upgrade"
    !insertmacro clientRename "$INSTDIR\resources\doubao-bridge" "$INSTDIR.data-upgrade\doubao-bridge"
  ${endif}
!macroend

; Preserve electron-builder's process check, then protect data in the install section.
; Opening or cancelling the installer must not move an existing user's files.
!include getProcessInfo.nsh
Var pid
!macro customCheckAppRunning
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    !insertmacro clientProtectData
  !endif
!macroend

; The standard install section skips CHECK_APP_RUNNING in the elevated child.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Section "-Protect elevated client data"
      !insertmacro clientRestoreCommandInstallDir
      ${if} ${UAC_IsInnerInstance}
        !insertmacro CHECK_APP_RUNNING
      ${endif}
    SectionEnd
  !endif
!macroend

!macro clientRestoreData
  ${if} ${FileExists} "$INSTDIR.data-upgrade\user-data"
    ${if} ${FileExists} "$INSTDIR\user-data"
      MessageBox MB_OK|MB_ICONSTOP "Recovery will not overwrite existing client data."
      Abort
    ${endif}
    !insertmacro clientRename "$INSTDIR.data-upgrade\user-data" "$INSTDIR\user-data"
  ${endif}
  ${if} ${FileExists} "$INSTDIR.data-upgrade\doubao-bridge"
    CreateDirectory "$INSTDIR\user-data"
    ${if} ${FileExists} "$INSTDIR\user-data\legacy-bridge"
      MessageBox MB_OK|MB_ICONSTOP "A bridge recovery snapshot already exists. Preserve it before retrying."
      Abort
    ${endif}
    !insertmacro clientRename "$INSTDIR.data-upgrade\doubao-bridge" "$INSTDIR\user-data\legacy-bridge"
  ${endif}
  RMDir "$INSTDIR.data-upgrade"
  CreateDirectory "$INSTDIR\user-data\updates"
!macroend

; electron-builder first stages the running installer in LocalAppData. Move that cache
; beside the application only after the install directory is ready.
!macro customInstall
  !insertmacro clientRestoreData
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  !insertmacro copyFile "$EXEPATH" "$INSTDIR\user-data\updates\${APP_INSTALLER_STORE_FILE}"
  ${ifNot} ${Errors}
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    ${StdUtils.GetParentPath} $R5 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    RMDir "$R5"
  ${endif}
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

; Keep user-data after uninstall. Delete only known application files and resources.
!macro customRemoveFiles
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE*"
  Delete "$INSTDIR\version"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\swiftshader"
  RMDir "$INSTDIR"
!macroend
