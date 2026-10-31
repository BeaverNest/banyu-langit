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
' The format file does NOT need to live in Program Files. OLE Import() takes the format path
' as an explicit argument, so it can sit next to the data - which matters because
' C:\Program Files is not writable for a normal user and copying there needs admin.
FMT_DIR    = IMPORT_DIR
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

' Hide the window ONLY if this script started AmiBroker. When launched from the owner's
' shortcut, AmiBroker is already running and visible - hiding it would make the program
' disappear the moment he opens it.
Dim startedHere
startedHere = False
On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  startedHere = True
  Err.Clear
End If
On Error GoTo 0

If startedHere Then
  On Error Resume Next
  APP.Visible = False
  Err.Clear
  On Error GoTo 0
Else
  WScript.Echo "Attached to the running AmiBroker instance (window left visible)"
End If

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

' LoadDatabase returns before the switch completes; confirm it actually landed rather than
' trusting the call. Reading DatabasePath too early still reports the old database.
Dim sw, okDb, tries
okDb = False
tries = 0
Do While tries < 30
  On Error Resume Next
  sw = APP.DatabasePath
  Err.Clear
  On Error GoTo 0
  If InStr(1, CStr(sw), "BanyuLangit", vbTextCompare) > 0 Then
    okDb = True
    Exit Do
  End If
  WScript.Sleep 500
  tries = tries + 1
Loop

If Not okDb Then
  WScript.Echo "FAIL: still on '" + CStr(sw) + "' after 15s - refusing to import elsewhere."
  WScript.Quit 2
End If

If Not fso.FolderExists(DB_PATH) Then
  WScript.Echo "FAIL: database folder " + DB_PATH + " does not exist."
  WScript.Echo "      Create it once in AmiBroker: File -> New Database -> " + DB_PATH
  WScript.Quit 2
End If

Const FULL_REIMPORT_DAYS = 14
' Below this, the database is too shallow to be a real history - it was built from a delta.
' The export enforces a 60-bar minimum per ticker, so anything under 60 is unambiguous.
Const MIN_HISTORY_BARS = 60

' ---- wait for the database to finish loading -------------------------------
' CreateObject starts a fresh AmiBroker and loads the database asynchronously. Reading
' Stocks.Count immediately returns 0 even when the database is full - observed as
' "was 0" against 2,266 symbols. Any decision made on that reading is wrong, and worse,
' it is wrong in the direction that looks healthy.
Dim ready, waited, lastCount, curCount, stable
ready = False
waited = 0
lastCount = -1
stable = 0
Do While waited < 20
  On Error Resume Next
  curCount = APP.Stocks.Count
  If Err.Number <> 0 Then
    curCount = -1
    Err.Clear
  End If
  On Error GoTo 0
  ' "Loaded" is not "has symbols": a brand new database legitimately holds zero, and waiting
  ' for a non-zero count burned the full 60s on every run of an empty database.
  If curCount = lastCount And curCount >= 0 Then
    stable = stable + 1
    If stable >= 2 Then
      ready = True
      Exit Do
    End If
  Else
    stable = 0
  End If
  lastCount = curCount
  WScript.Sleep 1000
  waited = waited + 1
Loop

If Not ready Then
  WScript.Echo "WARN: database count did not stabilise in 20s (last reading: " + CStr(lastCount) + ")."
End If

Dim fmt : fmt = FMT_DIR + "\banyulangit.format"
If Not fso.FileExists(fmt) Then
  WScript.Echo "FAIL: format file not found: " + fmt
  WScript.Echo "      It should have been pulled with the data. Re-run pull.bat."
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
' symBefore must be read with a real error check. The log showed "was 0" against a database
' that already held 2,266 symbols, which silently disabled the "count fell" guard: any number
' is >= 0, so the comparison could never fire.
Dim failed, symBefore, symAfter
failed = 0
symBefore = -1
On Error Resume Next
Err.Clear
symBefore = APP.Stocks.Count
If Err.Number <> 0 Then
  WScript.Echo "WARN: could not read symbol count before import (" + Err.Description + ")"
  symBefore = -1
  Err.Clear
End If
On Error GoTo 0
WScript.Echo "Symbols before import: " + CStr(symBefore)
failed = failed + ImportOne(IMPORT_DIR + "\delta_recent.csv", fmt)
failed = failed + ImportOne(IMPORT_DIR + "\delta_index.csv", fmt)

' ---- full snapshot only when the delta cannot cover the gap ----------------
' A delta holds 30 sessions of bars. Twenty days was wrong on two counts: it re-imported
' 337 MB while the delta could still have covered the gap, and it did not account for the
' sessions the laptop missed. 14 sessions leaves 16 sessions of slack.
Dim doFull, lastFull, ageDays, dbEmpty, maxBars
doFull = True
ageDays = 9999
dbEmpty = True
On Error Resume Next
dbEmpty = (APP.Stocks.Count = 0)
Err.Clear
On Error GoTo 0

' History is measured, not remembered. The state file lied once already: a broken run stored
' nothing yet still recorded a successful full import, so the next run "helpfully" served only
' the 30-session delta and left 2,266 symbols with 30 bars each. A database that has no
' history is not a database with history, whatever the file says.
maxBars = MaxBarsInDatabase()
If maxBars > 0 Then
  WScript.Echo "Deepest symbol holds " + CStr(maxBars) + " bars"
End If

Dim forceFull
forceFull = False
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "full" Then forceFull = True
End If

If forceFull Then
  WScript.Echo "Forced full import (argument)"
ElseIf dbEmpty Then
  ' An empty database MUST get the full snapshot: the delta alone would leave 10 years missing
  ' while reporting success, which is the failure mode this whole script exists to avoid.
  WScript.Echo "Empty database - full import required"
ElseIf maxBars > 0 And maxBars < MIN_HISTORY_BARS Then
  ' Symbols exist but none carries real history: this database was built from a delta only.
  WScript.Echo "Shallow database (" + CStr(maxBars) + " bars max) - full import required"
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

  ' NOTE: the state file is written AFTER the verification gate below, not here. Writing it
  ' on "no error" is what previously recorded a successful full import that stored nothing,
  ' which then made the next run skip the full import entirely.
Else
  WScript.Echo "Delta import only (last full " + CStr(ageDays) + " days ago)"
End If

' ---- GLOBAL block: imported on EVERY run, never behind the full/delta switch --------------
' These series are not part of the equity snapshot. The first version put this import inside the
' full branch only, and because the state file already marked the last full as today, every
' later run took the delta branch: the market stayed empty while the log printed OK. The block
' is 75 symbols, so there is no reason to gate it.
Dim fmtClose : fmtClose = FMT_DIR + "\banyulangit-close.format"
If fso.FileExists(IMPORT_DIR + "\global_all.csv") Then
  failed = failed + ImportOne(IMPORT_DIR + "\global_all.csv", fmt)
End If
' Close-only bars need their OWN format: the source never had Open/High/Low for them, and
' importing 0 into those fields would silently corrupt every candle and moving average.
If fso.FileExists(IMPORT_DIR + "\global_close.csv") Then
  failed = failed + ImportOne(IMPORT_DIR + "\global_close.csv", fmtClose)
End If

' ---- SYMBOL INFORMATION: full name, alias, address, website, currency ---------------------
' Its own format because it needs $NOQUOTES 1 (no date, no price) and $OVERWRITE 1 (every
' symbol already exists, so $AUTOADD alone would change nothing but still report success).
Dim fmtInfo : fmtInfo = FMT_DIR + "\banyulangit-symbolinfo.format"
If fso.FileExists(IMPORT_DIR + "\symbol_info.csv") Then
  failed = failed + ImportOne(IMPORT_DIR + "\symbol_info.csv", fmtInfo)
End If

' ---- categories: sector / industry -------------------------------------
' Market and group are NOT here: the ASCII importer takes a numeric ID for those and discards
' a name without an error, while SECTORNAME/INDUSTRYNAME accept a name and create it. Market
' and group assignment is done by assign-categories.vbs over OLE instead.
'
' Order: sector file first, then industry. INDUSTRYNAME attaches the industry to the sector
' named in the SAME row, so industries land under the right sector; a symbol's sector in
' AmiBroker is derived from its industry, so the sector-only pass is a fallback for symbols
' whose industry is unknown.
'
' Runs on BOTH the full and delta paths. A newly listed symbol must get its categories the
' same night it gets its quotes, otherwise it sits in Undefined with a chart that still draws.
Dim catFmt : catFmt = FMT_DIR + "\banyulangit-sector.format"
Dim indFmt : indFmt = FMT_DIR + "\banyulangit-industry.format"
If fso.FileExists(catFmt) Then
  Dim cp
  cp = IMPORT_DIR + "\categories_sector.csv"
  If fso.FileExists(cp) Then failed = failed + ImportOne(cp, catFmt)
  If fso.FileExists(indFmt) Then
    cp = IMPORT_DIR + "\categories_industry.csv"
    If fso.FileExists(cp) Then failed = failed + ImportOne(cp, indFmt)
  End If
Else
  WScript.Echo "WARN: banyulangit-sector.format missing - categories skipped"
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

' ---- prove the data actually landed ---------------------------------------
' OLE Import() returns no error even when every line is rejected (wrong separator, missing
' format, bad dates). The first build reported "ok" eleven times against an empty database.
' Counting symbols is cheap and it is the only evidence available from inside this script.
symAfter = -1
On Error Resume Next
symAfter = APP.Stocks.Count
Err.Clear
On Error GoTo 0

If symAfter <= 0 Then
  WScript.Echo "FAIL: import reported no errors but the database holds " + CStr(symAfter) + " symbols."
  WScript.Echo "      The format file was probably rejected: check " + fmt
  WScript.Echo "      and look for import.log next to the AmiBroker executable."
  WScript.Quit 2
End If

If symBefore > 0 And symAfter < symBefore Then
  WScript.Echo "FAIL: symbol count fell from " + CStr(symBefore) + " to " + CStr(symAfter)
  WScript.Quit 2
End If

' A count above zero is weak evidence: $AUTOADD creates the symbol row before accepting a
' single quote. The manifest states how many tickers the export contains, so compare against
' it. Three symbols against 2,378 expected is the failure this catches.
Dim expected
expected = ExpectedSymbols()
If expected > 0 Then
  If symAfter < expected * 0.95 Then
    WScript.Echo "FAIL: " + CStr(symAfter) + " symbols present, manifest expects " + CStr(expected)
    WScript.Echo "      Quotes were created but data was rejected. Check import.log."
    WScript.Quit 2
  End If
  ' IHSG is a single index symbol and carries no "tickers" field in the manifest, so the sum
  ' is short by one. Allow a small slack rather than pinning the file schema.
  WScript.Echo "Manifest expects about " + CStr(expected) + " symbols - OK"
Else
  WScript.Echo "WARN: manifest.json missing or unreadable, symbol count not cross-checked"
End If

' Verification passed. Only now is it safe to record that a full import happened.
If doFull Then
  Dim out : Set out = fso.CreateTextFile(STATE_FILE, True)
  out.WriteLine FormatDateTime(Date, 2)
  out.Close
End If

' Report a known symbol's bar count. Symbols existing is weaker evidence than bars existing:
' $AUTOADD creates the symbol before any quote is accepted.
Dim probe
probe = ""
On Error Resume Next
If APP.Stocks.Count > 0 Then
  Dim st : Set st = APP.Stocks(0)
  probe = CStr(st.Ticker) + "=" + CStr(st.Quotations.Count) + " bars"
End If
Err.Clear
On Error GoTo 0

WScript.Echo "Symbols in database: " + CStr(symAfter) + " (was " + CStr(symBefore) + ")"
If probe <> "" Then WScript.Echo "First symbol: " + probe

' ---- persist ---------------------------------------------------------------
' ---- market census (informational) ---------------------------------------
' ONE pass over the symbols, not one pass per market slot.
' WHY THIS WAS REWRITTEN: the previous version looped mIdx = 0..255 and called a helper per
' slot. That helper ended with `On Error GoTo 0`, which resets error handling for the CALLER
' as well, so the first unexpected error aborted the whole script - right after the imports,
' before SaveDatabase. The symptom was a run that printed the census line for market 0 and
' then exited 1 with no "Saving database" at all. It also made 256 x 2,378 = 608,000 OLE calls
' for information a single pass answers.
Dim mIdx, mName, mCount, censusHits, stc, midc
Dim cKeys, cVals
Set cKeys = CreateObject("Scripting.Dictionary")
On Error Resume Next
For mIdx = 0 To APP.Stocks.Count - 1
  Set stc = APP.Stocks.Item(mIdx)
  midc = -1
  If Err.Number = 0 Then midc = stc.MarketID
  If Err.Number = 0 Then
    If cKeys.Exists(midc) Then cKeys(midc) = cKeys(midc) + 1 Else cKeys(midc) = 1
  End If
  Err.Clear
Next
On Error GoTo 0

If cKeys.Count = 0 Then
  WScript.Echo "  no market assignment present yet"
Else
  For Each mIdx In cKeys.Keys
    mName = "?"
    On Error Resume Next
    mName = APP.Markets.Item(mIdx).Name
    Err.Clear
    On Error GoTo 0
    WScript.Echo "  market " + CStr(mIdx) + " (" + mName + "): " + CStr(cKeys(mIdx)) + " symbols"
  Next
End If

' SaveDatabase() is not optional. Without it the imported bars exist only in the running
' instance: the script reports 2,518 bars, the process ends, and the next run finds 30 again.
' That is what made every run re-import 337 MB while looking successful.
'
' Verify the save by re-reading a bar count afterwards, because SaveDatabase returns no status
' and a silent failure here reintroduces the exact bug it is meant to fix.
WScript.Echo "Saving database ..."
APP.SaveDatabase
WScript.Sleep 2000

Dim savedBars, savedTries
savedBars = 0
savedTries = 0
Do While savedTries < 15
  On Error Resume Next
  If APP.Stocks.Count > 0 Then
    Dim sv : Set sv = APP.Stocks(0)
    savedBars = sv.Quotations.Count
  End If
  Err.Clear
  On Error GoTo 0
  If savedBars >= MIN_HISTORY_BARS Then Exit Do
  WScript.Sleep 1000
  savedTries = savedTries + 1
Loop

If savedBars < MIN_HISTORY_BARS Then
  WScript.Echo "FAIL: after SaveDatabase the first symbol holds " + CStr(savedBars) + " bars."
  WScript.Echo "      The import is in memory only and will be lost when AmiBroker exits."
  WScript.Quit 2
End If
WScript.Echo "In memory: first symbol holds " + CStr(savedBars) + " bars"
' That reading is from the live object, NOT from disk. It proves the import worked; it does not
' prove the save did. Only a fresh process reading the database proves persistence, so the
' wrapper (import.bat) runs this script's output through a second, independent check below.
WScript.Echo "NOTE: re-run to confirm - a persistent database reports these bars as 'before'."

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
  ' Parentheses are LOAD-BEARING. Without them VBScript marshals the strings by reference and
  ' AmiBroker 6.30 silently ignores the format file, falls back to its space-separated
  ' default, rejects every comma line, and still returns 0 ("ok"). Parentheses force by-value
  ' marshalling. Proven with diag2-amibroker.vbs: identical data and format, 0->0 without
  ' them, 0->2 with them.
  rc = APP.Import(0, (path), (formatPath))
  If Err.Number <> 0 Then
    WScript.Echo "  FAIL " + fso.GetFileName(path) + ": " + Err.Description
    Err.Clear
    ImportOne = 1
    Exit Function
  End If
  On Error GoTo 0
  ' Documented return codes: 0=ok, 4=no file, 2/3=bad data (details in import.log).
  ' The old version printed "ok" without looking at rc at all.
  If rc <> 0 Then
    WScript.Echo "  FAIL " + fso.GetFileName(path) + ": Import() returned " + CStr(rc)
    ImportOne = 1
    Exit Function
  End If
  WScript.Echo "  ok " + fso.GetFileName(path) + " (rc=0)"
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

' ---------------------------------------------------------------------------
' Sum the "tickers" fields in manifest.json. VBScript has no JSON parser, but the manifest is
' machine-written with one field per line, so a regex over the raw text is reliable enough
' for a count check - and a miss degrades to a WARN, never to a false pass.
Function ExpectedSymbols()
  Dim total, re, txt
  ExpectedSymbols = 0
  If Not fso.FileExists(IMPORT_DIR + "\manifest.json") Then Exit Function
  On Error Resume Next
  txt = fso.OpenTextFile(IMPORT_DIR + "\manifest.json", 1).ReadAll
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0
  Set re = New RegExp
  re.Global = True
  re.IgnoreCase = True
  re.Pattern = """tickers""\s*:\s*([0-9]+)"
  Dim m, totalN
  totalN = 0
  For Each m In re.Execute(txt)
    totalN = totalN + CLng(m.SubMatches(0))
  Next
  ExpectedSymbols = totalN
End Function

' ---------------------------------------------------------------------------
' Deepest bar count found by sampling the collection. Sampling beats scanning: 2,378 symbols
' read one by one over OLE is slow, and the answer only needs to distinguish "has history"
' from "only a delta". A miss returns 0, which is treated as unknown and never as a pass.
Function MaxBarsInDatabase()
  Dim total, i, best, n
  MaxBarsInDatabase = 0
  On Error Resume Next
  total = APP.Stocks.Count
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  If total = 0 Then
    On Error GoTo 0
    Exit Function
  End If

  best = 0
  ' First, last and middle: cheap and spread across the collection.
  For i = 0 To 2
    Select Case i
      Case 0 : n = 0
      Case 1 : n = Int(total / 2)
      Case 2 : n = total - 1
    End Select
    Dim st, q
    Set st = APP.Stocks(n)
    If Err.Number = 0 Then
      Set q = st.Quotations
      If Err.Number = 0 Then
        If q.Count > best Then best = q.Count
      End If
      Err.Clear
    End If
    Err.Clear
  Next
  On Error GoTo 0
  MaxBarsInDatabase = best
End Function
