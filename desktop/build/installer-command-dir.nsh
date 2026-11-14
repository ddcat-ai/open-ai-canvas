; NSIS parses /D itself before .onInit. StdUtils detects the switch but truncates
; unquoted paths containing spaces, so retain NSIS's original value instead.
Var clientCommandInstallDir
!macro clientCaptureCommandInstallDir
  StrCpy $clientCommandInstallDir ""
  ${If} ${Silent}
    ${StdUtils.GetParameter} $R9 "D" ""
    ${If} $R9 != ""
      StrCpy $clientCommandInstallDir $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend

!macro clientRestoreCommandInstallDir
  ${If} $clientCommandInstallDir != ""
    StrCpy $INSTDIR $clientCommandInstallDir
  ${EndIf}
!macroend
