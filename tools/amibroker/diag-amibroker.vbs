' ===========================================================================
'  Diagnostic: why does Import() return without error but store nothing?
'
'  Runs four variants of a tiny 4-line import and reports Stocks.Count after
'  each, so the failure is isolated to format / line endings / OLE rather than
'  guessed at. Read the output top to bottom; the first variant that moves the
'  count is the one that works.
'
'  USAGE:  cscript //nologo diag-amibroker.vbs
' ===========================================================================

Option Explicit

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")
Dim DIR : DIR = fso.GetParentFolderName(WScript.ScriptFullName)
Dim APP, VER

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

On Error Resume Next
VER = APP.Version
Err.Clear
On Error GoTo 0

WScript.Echo "AmiBroker version : " + CStr(VER)
WScript.Echo "DatabasePath      : " + CStr(APP.DatabasePath)
WScript.Echo "Symbols before    : " + CStr(APP.Stocks.Count)
WScript.Echo ""

' ---- test fixture ---------------------------------------------------------
Dim rows
rows = Array( _
  "AAA,2026-10-01,100,110,90,105,1000", _
  "AAA,2026-10-02,105,115,95,110,1100", _
  "BBB,2026-10-01,50,55,45,52,2000", _
  "BBB,2026-10-02,52,57,47,54,2100")

WriteText DIR + "\t_lf.csv", Join(rows, Chr(10)) + Chr(10)
WriteText DIR + "\t_crlf.csv", Join(rows, Chr(13) + Chr(10)) + Chr(13) + Chr(10)

' Minimal format: no $DEBUG, no $OVERWRITE, nothing that can be rejected.
WriteText DIR + "\t_min.format", _
  "$FORMAT Ticker,Date_YMD,Open,High,Low,Close,Volume" + vbCrLf + _
  "$SEPARATOR ," + vbCrLf + _
  "$AUTOADD 1" + vbCrLf

' The format we ship, for comparison.
WriteText DIR + "\t_full.format", _
  "$FORMAT Ticker,Date_YMD,Open,High,Low,Close,Volume" + vbCrLf + _
  "$SEPARATOR ," + vbCrLf + _
  "$SKIPLINES 0" + vbCrLf + _
  "$AUTOADD 1" + vbCrLf + _
  "$BREAKONERR 1" + vbCrLf + _
  "$DEBUG 1" + vbCrLf

' ---- variants -------------------------------------------------------------
TryImport "LF   + minimal format", DIR + "\t_lf.csv", DIR + "\t_min.format"
TryImport "CRLF + minimal format", DIR + "\t_crlf.csv", DIR + "\t_min.format"
TryImport "CRLF + shipped format", DIR + "\t_crlf.csv", DIR + "\t_full.format"
TryImport "LF   + shipped format", DIR + "\t_lf.csv", DIR + "\t_full.format"
' No format argument at all: AmiBroker uses its internal defaults.
TryImport "CRLF + no format arg ", DIR + "\t_crlf.csv", ""

WScript.Echo ""
WScript.Echo "Symbols after     : " + CStr(APP.Stocks.Count)

' ---- import.log -----------------------------------------------------------
Dim logPath, i
logPath = "C:\Program Files\AmiBroker\import.log"
If fso.FileExists(logPath) Then
  WScript.Echo ""
  WScript.Echo "---- import.log (last 20 lines) ----"
  Dim lines : lines = Split(fso.OpenTextFile(logPath, 1).ReadAll, vbCrLf)
  For i = 0 To UBound(lines)
    If i >= UBound(lines) - 20 Then WScript.Echo "  " + lines(i)
  Next
Else
  WScript.Echo ""
  WScript.Echo "No import.log at " + logPath + " (so $DEBUG never ran)"
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
    WScript.Echo label + "  ERR " + CStr(Err.Number) + " " + Err.Description
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  after = APP.Stocks.Count
  Dim mark : mark = ""
  If after > before Then mark = "   <== WORKS"
  WScript.Echo label + "  rc=" + CStr(rc) + "  symbols " + CStr(before) + " -> " + CStr(after) + mark
End Sub

Sub WriteText(path, content)
  Dim f : Set f = fso.CreateTextFile(path, True, False)
  f.Write content
  f.Close
End Sub
