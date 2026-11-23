; v0.47.0 (Expérimental): « Ranger dans ToolBox » in the Explorer's right click
; (files and folders) and in « Envoyer vers », per user (HKCU, no administrator).
; ADR 0059. The SAME names as electron/shell-integration.ts (Réglages ›
; Général removes them or puts them back). Removed by the uninstaller (checked
; by the Windows CI: scripts/uninstall-keeps-data.ps1). An update keeps
; Thomas's choice (HKCU\Software\ToolBox ShellMenu = off: not put back).

!macro toolboxMenuFor ROOT
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ToolBox.Ranger" "" "Ranger dans ToolBox"
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ToolBox.Ranger" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ToolBox.Ranger" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ToolBox.Ranger\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --ranger "%1"'
!macroend

!macro customInstall
  ReadRegStr $0 HKCU "Software\ToolBox" "ShellMenu"
  StrCmp $0 "off" toolboxMenuDone
    !insertmacro toolboxMenuFor "*"
    !insertmacro toolboxMenuFor "Directory"
    CreateShortCut "$APPDATA\Microsoft\Windows\SendTo\Ranger dans ToolBox.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--ranger" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  toolboxMenuDone:
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first: the entries stay (same place, same program).
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\*\shell\ToolBox.Ranger"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\ToolBox.Ranger"
    Delete "$APPDATA\Microsoft\Windows\SendTo\Ranger dans ToolBox.lnk"
    DeleteRegValue HKCU "Software\ToolBox" "ShellMenu"
    DeleteRegKey /ifempty HKCU "Software\ToolBox"
  ${endIf}
!macroend
