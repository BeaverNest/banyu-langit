' ===========================================================================
'  Banyu Langit -> AmiBroker headless EOD import (OLE automation)
'
'  Runs from Windows Task Scheduler, so it does NOT need AmiBroker to be open.
'  It starts AmiBroker itself through its OLE interface, imports, refreshes,
'  and quits.
'
'  WHY NOT JUST WRITE INTO AMIBROKER'S DATABASE FOLDER:
'  an AmiBroker database is a directory of proprietary binary files (broker.master,
'  broker.workspace, plus per-symbol files under 0-9/a-z/_ subfolders). The vendor
'  documents "you should not touch files in an AmiBroker database". There is no
'  watched drop-folder: the only supported ingest paths are the ASCII importer and
'  the OLE Import() method, and this script uses the second one.
'
'  USAGE:  cscript //nologo sync-amibroker.vbs
'  Exit codes: 0 ok, 2 could not start/attach AmiBroker or an import failed.
' ===========================================================================

Option Explicit

Dim IMPORT_DIR, FMT_DIR, STATE_FILE, APP
IMPORT_DIR = "C:\AmibrokerData\import"
FMT_DIR    = "C:\Program Files\AmiBroker\Formats"
STATE_FILE = IMPORT_DIR + "\last_full_import.txt"

' Re-import the 332 MB history only when the laptop has been away long enough that the
' 30-session delta can no longer cover the gap. Any shorter absence is served by the delta.
Const FULL_REIMPORT_DAYS = 20

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FileExists(IMPORT_DIR + "\delta_recent.csv") Then
  WScript.Echo "FAIL: " + IMPORT_DIR + "\delta_recent.csv not found - did the rsync task run?"
  WScript.Quit 2
End If

' ---- start or attach to AmiBroker -----------------------------------------
On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  Err.Clear
  Set APP = CreateObject("Broker.Application")
End If
On Error GoTo 0

If APP Is Nothing Then
  WScript.Echo "FAIL: could not start Broker.Application (is AmiBroker installed?)"
  WScript.Quit 2
End If

' Keep the window out of the way while it works; this is cosmetic only.
On Error Resume Next
APP.Visible = False
Err.Clear
On Error GoTo 0

Dim fmt : fmt = FMT_DIR + "\banyulangit.format"
If Not fso.FileExists(fmt) Then
  WScript.Echo "FAIL: format file not found: " + fmt
  WScript.Quit 2
End If

' ---- delta first: newest bars land in seconds, before any big import -------
Dim failed, f
failed = 0
failed = failed + ImportOne(IMPORT_DIR + "\delta_recent.csv", fmt)
failed = failed + ImportOne(IMPORT_DIR + "\delta_index.csv", fmt)

' ---- full snapshot only when the delta cannot cover the gap ----------------
Dim doFull, lastFull, ageDays
doFull = True
If fso.FileExists(STATE_FILE) Then
  Dim t : t = fso.OpenTextFile(STATE_FILE, 1).ReadAll
  If IsDate(Trim(t)) Then
    lastFull = CDate(Trim(t))
    ageDays = DateDiff("d", lastFull, Date)
    If ageDays < FULL_REIMPORT_DAYS Then doFull = False
  End If
End If

If doFull Then
  WScript.Echo "Full re-import (last full: " + CStr(ageDays) + " days ago or never)"
  Dim i, p
  For i = 1 To 5
    p = IMPORT_DIR + "\us_part0" + CStr(i) + ".csv"
    If fso.FileExists(p) Then failed = failed + ImportOne(p, fmt)
  Next
  For i = 1 To 4
    p = IMPORT_DIR + "\idx_part0" + CStr(i) + ".csv"
    If fso.FileExists(p) Then failed = failed + ImportOne(p, fmt)
  Next
  failed = failed + ImportOne(IMPORT_DIR + "\index_ihsg.csv", fmt)

  If failed = 0 Then
    Dim out : Set out = fso.CreateTextFile(STATE_FILE, True)
    out.WriteLine FormatDateTime(Date, 2)
    out.Close
  End If
Else
  WScript.Echo "Delta import only (last full " + CStr(ageDays) + " days ago)"
End If

' ---- make the new bars visible --------------------------------------------
On Error Resume Next
APP.RefreshAll
Err.Clear
On Error GoTo 0

If failed > 0 Then
  WScript.Echo "FAIL: " + CStr(failed) + " file(s) failed to import"
  WScript.Quit 2
End If

WScript.Echo "OK: AmiBroker import complete"
WScript.Quit 0

' ---------------------------------------------------------------------------
Function ImportOne(path, formatPath)
  Dim rc
  On Error Resume Next
  ' Type must be 0. One file per call - the API does not accept a list.
  rc = APP.Import(0, path, formatPath)
  If Err.Number <> 0 Then
    WScript.Echo "  FAIL " + fso.GetFileName(path) + ": " + Err.Description
    Err.Clear
    ImportOne = 1
    Exit Function
  End If
  On Error GoTo 0
  WScript.Echo "  ok " + fso.GetFileName(path)
  ImportOne = 0
End Function
