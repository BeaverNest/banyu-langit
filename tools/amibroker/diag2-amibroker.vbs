' ===========================================================================
'  Diagnostic v2: the format argument is being ignored.
'
'  Symptom that identified this: Import() returns 0 (documented as "ok"),
'  Stocks.Count never moves, and no import.log appears even though the format
'  has $DEBUG 1. That combination means the format file was never loaded -
'  AmiBroker fell back to its built-in space-separated default, every comma
'  line failed, and nothing was logged because the shipped format never ran.
'
'  Documented OLE return codes: 0=ok, 4=no file, 2/3=bad data (see import.log).
'
'  This tests the marshalling workarounds reported for exactly this bug:
'    1. variables as-is          (known to fail)
'    2. parentheses around vars  (forces by-value marshalling)
'    3. Const literal paths      (the fix that worked in the forum thread)
'    4. format name only         (relative resolution against Formats\)
'
'  USAGE:  cscript //nologo diag2-amibroker.vbs
' ===========================================================================

Option Explicit

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")
Dim DIR : DIR = fso.GetParentFolderName(WScript.ScriptFullName)

' Literal paths, declared Const so they marshal as values rather than as
' references into the script's variable storage.
Dim FULL_FMT, FULL_CSV
FULL_FMT = DIR + "\t_min.format"
FULL_CSV = DIR + "\t_crlf.csv"

Dim APP
On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  Err.Clear
  Set APP = CreateObject("Broker.Application")
End If
On Error GoTo 0

If APP Is Nothing Then
  WScript.Echo "FAIL: no Broker.Application"
  WScript.Quit 2
End If

' A hidden automation instance is known to drop import results; show it.
On Error Resume Next
APP.Visible = True
Err.Clear
On Error GoTo 0

WScript.Echo "AmiBroker  : " + CStr(APP.Version)
WScript.Echo "Database   : " + CStr(APP.DatabasePath)
WScript.Echo "Symbols    : " + CStr(APP.Stocks.Count)
WScript.Echo ""

' ---- fixture --------------------------------------------------------------
Dim rows : rows = Array( _
  "AAA,2026-10-01,100,110,90,105,1000", _
  "AAA,2026-10-02,105,115,95,110,1100", _
  "BBB,2026-10-01,50,55,45,52,2000", _
  "BBB,2026-10-02,52,57,47,54,2100")

WriteText FULL_CSV, Join(rows, Chr(10)) + Chr(10)
WriteText FULL_FMT, _
  "$FORMAT Ticker,Date_YMD,Open,High,Low,Close,Volume" + vbCrLf + _
  "$SEPARATOR ," + vbCrLf + _
  "$AUTOADD 1" + vbCrLf + _
  "$BREAKONERR 1" + vbCrLf + _
  "$DEBUG 1" + vbCrLf

' ---- variants -------------------------------------------------------------
Dim csvPath, fmtPath
csvPath = FULL_CSV
fmtPath = FULL_FMT

' 1. plain variables (this is what sync-amibroker.vbs does today)
TryImport "1 plain variables      ", csvPath, fmtPath

' 2. parentheses: forces by-value marshalling of the Variant
TryImportParen "2 parenthesised        ", csvPath, fmtPath

' 3. Const literals
TryImport "3 CStr() coercion       ", CStr(FULL_CSV), CStr(FULL_FMT)

' 4. format by bare name, resolved against the AmiBroker dir
TryImport "4 bare format name     ", FULL_CSV, "t_min.format"

' 5. no format argument at all - must use built-in space default and fail loudly
TryImport "5 no format argument   ", FULL_CSV, ""

WScript.Echo ""
WScript.Echo "Symbols now: " + CStr(APP.Stocks.Count)

Dim logPath : logPath = "C:\Program Files\AmiBroker\import.log"
If fso.FileExists(logPath) Then
  WScript.Echo ""
  WScript.Echo "---- import.log exists ----"
  WScript.Echo Left(fso.OpenTextFile(logPath, 1).ReadAll, 2000)
Else
  WScript.Echo ""
  WScript.Echo "No import.log -> \$DEBUG never executed -> format never loaded."
End If

WScript.Quit 0

' ---------------------------------------------------------------------------
Sub TryImport(label, dataFile, fmtFile)
  Dim rc, before, after
  before = APP.Stocks.Count
  rc = -1
  On Error Resume Next
  If fmtFile = "" Then
    rc = APP.Import(0, dataFile)
  Else
    rc = APP.Import(0, dataFile, fmtFile)
  End If
  If Err.Number <> 0 Then
    WScript.Echo label + " ERR " + CStr(Err.Number) + " " + Err.Description
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  after = APP.Stocks.Count
  Report label, rc, before, after
End Sub

Sub TryImportParen(label, dataFile, fmtFile)
  Dim rc, before, after
  before = APP.Stocks.Count
  rc = -1
  On Error Resume Next
  rc = APP.Import(0, (dataFile), (fmtFile))
  If Err.Number <> 0 Then
    WScript.Echo label + " ERR " + CStr(Err.Number) + " " + Err.Description
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  after = APP.Stocks.Count
  Report label, rc, before, after
End Sub

Sub Report(label, rc, before, after)
  Dim mark : mark = ""
  If after > before Then mark = "   <== WORKS"
  WScript.Echo label + " rc=" + CStr(rc) + "  symbols " + CStr(before) + " -> " + CStr(after) + mark
End Sub

Sub WriteText(path, content)
  Dim f : Set f = fso.CreateTextFile(path, True, False)
  f.Write content
  f.Close
End Sub
