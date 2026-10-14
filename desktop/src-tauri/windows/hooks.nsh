; The app in "Open with" of .md and .markdown files, for the NSIS installer (tauri.conf.json: bundle > windows > nsis).
; Not with bundle > fileAssociations, which makes the app the default one of the extension: it is only added to the
; extension's OpenWithProgids. The same as file-associations.wxs for the MSI.

!define MDDV_PROGID "MarkdownDesignDocViewer.Markdown"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${MDDV_PROGID}" "" "Markdown"
  WriteRegStr SHCTX "Software\Classes\${MDDV_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${MDDV_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "${MDDV_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "${MDDV_PROGID}" ""
  ; SHCNE_ASSOCCHANGED, SHCNF_IDLIST
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only the values of the app: the extensions' keys may hold those of other apps.
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "${MDDV_PROGID}"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "${MDDV_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\${MDDV_PROGID}"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
!macroend
