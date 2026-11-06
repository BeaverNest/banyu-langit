' Decide how much of the export this refresh has to download.
'
' WHY THIS EXISTS: pull.bat fetches the whole payload whenever a file looks newer, and the
' exporter rewrites every CSV on each publish - so an ordinary evening re-downloads ~434 MB
' (nine part files + deltas) to pick up ~5 MB of new rows. Measured 2026-11-06: the launcher
' spent 1 h 31 min on that transfer and the import it fed still took the delta branch, i.e.
' none of the nine part files was read.
'
' The part files are the 10-year snapshot. ONLY a full import reads them. So the question
' "full or delta" decides the transfer, and it must be answered from what the database
' actually holds, not from a habit.
'
' WHY NOT ASK sync-amibroker.vbs DIRECTLY: it decides full-vs-delta after it has already
' imported the delta, and reaching that answer requires starting AmiBroker over OLE. This
' advisor must run BEFORE the pull, on a machine where AmiBroker may be closed, so it reads
' two small files instead:
'   last_full_import.txt  - written by sync after a full import it verified
'   last_import_ok.txt    - written by verify-freshness.vbs with the newest bar it found, or
'                           the word "failed" when the gate was red
'
' FAIL-SAFE DIRECTION: every unknown answers FULL. A wrong FULL costs an hour of bandwidth; a
' wrong DELTA would leave a stale chart that still reports success. Only the slow direction is
' allowed to be wrong.
'
' Usage: cscript //nologo needs-full.vbs [import-dir]
' Exit:  0 = the delta is enough (pull.bat quick), 1 = full snapshot needed,
'        2 = cannot tell (caller must treat as full).
Option Explicit

Dim fso, DIR, stateF, okF, txt, lastFull, ageDays, okTxt, parts, dbDate, gapDays, reason
Set fso = CreateObject("Scripting.FileSystemObject")

DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count > 0 Then DIR = WScript.Arguments(0)
If Right(DIR, 1) <> "\" Then DIR = DIR & "\"

' Keep these two equal to the same names in sync-amibroker.vbs. check-tools.sh compares them:
' an advisor that predicts a rule different from the one the importer applies is worse than no
' advisor, because it makes the slow-but-safe answer look like a bug.
Const FULL_REIMPORT_DAYS = 14
Const GAP_LIMIT_DAYS = 20

stateF = DIR & "last_full_import.txt"
okF = DIR & "last_import_ok.txt"
reason = ""

' ---- 1. when was the last full snapshot imported? --------------------------
If Not fso.FileExists(stateF) Then
  WScript.Echo "needs-full: no last_full_import.txt -> FULL (unknown history state)"
  WScript.Quit 2
End If
txt = Trim(fso.OpenTextFile(stateF, 1).ReadAll)
If Not IsDate(txt) Then
  WScript.Echo "needs-full: last_full_import.txt is not a date ('" & txt & "') -> FULL"
  WScript.Quit 2
End If
lastFull = CDate(txt)
ageDays = DateDiff("d", lastFull, Date)
If ageDays >= FULL_REIMPORT_DAYS Then
  WScript.Echo "needs-full: last full import " & ageDays & " days ago (limit " & _
    FULL_REIMPORT_DAYS & ") -> FULL"
  WScript.Quit 1
End If

' ---- 2. did the last verified import land, and how old is its newest bar? --
If Not fso.FileExists(okF) Then
  WScript.Echo "needs-full: no last_import_ok.txt -> FULL (no verified import on record)"
  WScript.Quit 2
End If
okTxt = Trim(fso.OpenTextFile(okF, 1).ReadAll)
parts = Split(okTxt, " ")
' The verdict token is checked BEFORE the token count: a red gate writes the single word
' "failed", and answering that with "unreadable" (exit 2) hides the fact that we know exactly
' why the snapshot is needed. Both are a full pull, but the log has to say which one it was.
If LCase(parts(0)) <> "ok" Then
  ' A red freshness gate recorded this. The delta alone could not repair the database last
  ' time, so the next run must take the snapshot rather than repeat the same attempt.
  WScript.Echo "needs-full: last freshness gate was '" & parts(0) & "' -> FULL"
  WScript.Quit 1
End If
If UBound(parts) < 1 Then
  WScript.Echo "needs-full: last_import_ok.txt unreadable ('" & okTxt & "') -> FULL"
  WScript.Quit 2
End If
If Not IsDate(parts(1)) Then
  WScript.Echo "needs-full: no usable bar date in last_import_ok.txt ('" & okTxt & "') -> FULL"
  WScript.Quit 2
End If

' The delta carries 30 sessions. Past ~20 calendar days a delta-only run leaves a hole no
' later run ever fills, so the snapshot has to come down (the "laptop was off for a month" case).
dbDate = CDate(parts(1))
gapDays = DateDiff("d", dbDate, Date)
If gapDays > GAP_LIMIT_DAYS Then
  WScript.Echo "needs-full: newest bar " & gapDays & " days old (limit " & GAP_LIMIT_DAYS & _
    ") - delta cannot bridge it -> FULL"
  WScript.Quit 1
End If

WScript.Echo "needs-full: last full " & ageDays & "d ago, newest bar " & gapDays & _
  "d old -> DELTA (snapshot not needed)"
WScript.Quit 0
