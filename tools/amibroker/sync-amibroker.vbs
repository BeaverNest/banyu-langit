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

Dim IMPORT_DIR, FMT_DIR, STATE_FILE, APP, DB_PATH
' Derive the import folder from where this script lives, so moving the folder does not
' require editing paths. Hardcoded paths were the first thing to rot in the old build.
IMPORT_DIR = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
FMT_DIR    = "C:\Program Files\AmiBroker\Formats"
STATE_FILE = IMPORT_DIR + "\last_full_import.txt"
' The owner's database directory. AmiBroker opens whichever database was last active, so an
' import can land in the default "data" database and look successful while C:\BanyuLangit stays
' untouched. Always verify DatabasePath before importing.
DB_PATH    = "C:\BanyuLangit\"

' Re-import the 332 MB history only when the delta can no longer cover the gap.
' See the decision block below for the exact rule.

Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FileExists(IMPORT_DIR + "\delta_recent.csv") Then
  WScript.Echo "FAIL: " + IMPORT_DIR + "\delta_recent.csv not found - did the pull task run?"
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

' ---- force the database, do not inherit "last used" ------------------------
' AmiBroker opens whichever database was active last time. Importing into that one "succeeds"
' while C:\BanyuLangit stays empty, which is the worst kind of failure: silent and plausible.
Dim cur
cur = ""
On Error Resume Next
cur = APP.DatabasePath
Err.Clear
On Error GoTo 0

If InStr(1, cur, "BanyuLangit", vbTextCompare) = 0 Then
  On Error Resume Next
  APP.SaveDatabase
  APP.LoadDatabase(DB_PATH)
  If Err.Number <> 0 Then
    WScript.Echo "FAIL: could not switch database to " + DB_PATH + " (" + Err.Description + ")"
    WScript.Quit 2
  End If
  Err.Clear
  On Error GoTo 0
  WScript.Echo "Switched database: '" + CStr(cur) + "' -> " + DB_PATH
End If

If Not fso.FolderExists(DB_PATH) Then
  WScript.Echo "FAIL: database folder " + DB_PATH + " does not exist."
  WScript.Echo "      Create it once in AmiBroker: File -> New Database -> " + DB_PATH
  WScript.Quit 2
End If

Const FULL_REIMPORT_DAYS = 14

Dim fmt : fmt = FMT_DIR + "\banyulangit.format"
If Not fso.FileExists(fmt) Then
  WScript.Echo "FAIL: format file not found: " + fmt
  WScript.Echo "      Copy it from " + IMPORT_DIR + "\banyulangit.format"
  WScript.Quit 2
End If

' AmiBroker's ASCII importer cannot open a path with non-ASCII characters. The user account
' here is "KoberuSO" (ASCII) but %LOCALAPPDATA% or a renamed profile can break it, and the
' error AmiBroker returns for that is generic. Fail early with the real reason.
If Not IsAscii(IMPORT_DIR) Then
  WScript.Echo "FAIL: import folder contains non-ASCII characters: " + IMPORT_DIR
  WScript.Echo "      Move it to e.g. C:\AmibrokerData\import and re-run."
  WScript.Quit 2
End If

' ---- delta first: newest bars land in seconds, before any big import -------
Dim failed, f
failed = 0
failed = failed + ImportOne(IMPORT_DIR + "\delta_recent.csv", fmt)
failed = failed + ImportOne(IMPORT_DIR + "\delta_index.csv", fmt)

' ---- full snapshot only when the delta cannot cover the gap ----------------
' A delta holds 30 sessions of bars. Twenty days was wrong on two counts: it re-imported
' 337 MB while the delta could still have covered the gap, and it did not account for the
' sessions the laptop missed. 14 sessions leaves 16 sessions of slack.
Dim doFull, lastFull, ageDays, dbEmpty
doFull = True
ageDays = 9999
dbEmpty = True
On Error Resume Next
dbEmpty = (APP.Stocks.Count = 0)
Err.Clear
On Error GoTo 0

' An empty database MUST get the full snapshot: the delta alone would leave 10 years missing
' while reporting success, which is the failure mode this whole script exists to avoid.
If dbEmpty Then
  WScript.Echo "Empty database - full import required"
ElseIf fso.FileExists(STATE_FILE) Then
  Dim t : t = fso.OpenTextFile(STATE_FILE, 1).ReadAll
  If IsDate(Trim(t)) Then
    lastFull = CDate(Trim(t))
    ageDays = DateDiff("d", lastFull, Date)
    If ageDays < FULL_REIMPORT_DAYS Then doFull = False
  End If
End If

If doFull Then
  WScript.Echo "Full import (last full: " + CStr(ageDays) + " days ago)"
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

Dim finalDb
finalDb = ""
On Error Resume Next
finalDb = APP.DatabasePath
Err.Clear
On Error GoTo 0
WScript.Echo "OK: AmiBroker import complete -> " + CStr(finalDb)
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

' ---------------------------------------------------------------------------
' True when every character is 7-bit. Used to reject a path the importer cannot open.
Function IsAscii(txt)
  Dim i, cc
  IsAscii = True
  For i = 1 To Len(txt)
    cc = AscW(Mid(txt, i, 1))
    If cc < 0 Then cc = cc + 65536
    If cc > 127 Then
      IsAscii = False
      Exit Function
    End If
  Next
End Function
