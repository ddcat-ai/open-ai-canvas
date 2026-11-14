; NSIS 安装向导定制（精简版）：默认安装路径指向 D:\PeekReel（无 D 盘保持内置默认）。
!define CLIENT_LITE_INSTALLER
!include installer-storage.nsh
!macro preInit
  !insertmacro clientCaptureCommandInstallDir
  ${ifNot} ${isUpdated}
    ${if} ${FileExists} "D:\"
      StrCpy $INSTDIR "D:\PeekReel"
    ${endIf}
  ${endIf}
!macroend
