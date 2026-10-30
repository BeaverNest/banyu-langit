' ===========================================================================
'  assign-categories.vbs - name markets/groups and assign every symbol.
'
'  WHAT THIS DOES
'    1. Names market 1 = US and market 2 = IDX  (Markets is the only category
'       collection the 6.30 object model exposes).
'    2. Reads category_assign.csv and sets Stock.MarketID / Stock.GroupID.
'    3. Saves, then re-reads from the saved database and prints a census.
'
'  WHAT THIS DOES NOT DO
'    Sectors and industries. Those have no OLE property at all on 6.30 - the
'    ASCII importer's SECTORNAME/INDUSTRYNAME fields are the only route, and
'    sync-amibroker.vbs imports them.
'
'  WHY IT IS RESUMABLE
'    Writing 2,377 symbols one at a time takes minutes, and AmiBroker is a GUI
'    process that the user may close mid-run. Assignments already applied are
'    skipped on the next run, so a half-finished pass is never a half-assigned
'    database: it is simply an unfinished one that the next run continues.
'
'  Usage:  cscript //nologo assign-categories.vbs [path\to\category_assign.csv]
' ===========================================================================
Option Explicit

Const DB_PATH = "C:\BanyuLangit\"
Const GROUP_CHUNK_REPORT = 250

Dim APP, fso, csvPath, ts, line, parts, applied, skipped, unknown, sawSymbol
Dim key, targetM, targetG, st, doneMap, idxMap, symIdx

Set fso = CreateObject("Scripting.FileSystemObject")

csvPath = "category_assign.csv"
If WScript.Arguments.Count > 0 Then csvPath = WScript.Arguments(0)
If Not fso.FileExists(csvPath) Then
  WScript.Echo "FAIL: cannot find " + csvPath
  WScript.Quit 2
End If

On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  Err.Clear
  Set APP = CreateObject("Broker.Application")
End If
On Error GoTo 0
If APP Is Nothing Then
  WScript.Echo "FAIL: Broker.Application unavailable - is AmiBroker installed?"
  WScript.Quit 2
End If

On Error Resume Next
APP.LoadDatabase DB_PATH
Err.Clear
On Error GoTo 0

WScript.Echo "Database : " + APP.DatabasePath
WScript.Echo "Symbols  : " + CStr(APP.Stocks.Count)

' ---- 1. name the markets ------------------------------------------------
' Only 1 and 2 are used. 0 already means "Undefined" and 255 is reserved.
Dim nameIdx, nameNm
On Error Resume Next
If fso.FileExists("category_names.csv") Then
  Set ts = fso.OpenTextFile("category_names.csv", 1)
  Do While Not ts.AtEndOfStream
    line = Trim(ts.ReadLine)
    If Len(line) > 0 Then
      parts = Split(line, ",")
      If UBound(parts) >= 2 And parts(0) = "MARKET" Then
        nameIdx = CLng(parts(1))
        nameNm = parts(2)
        APP.Markets.Item(nameIdx).Name = nameNm
        If Err.Number <> 0 Then
          WScript.Echo "  market " + CStr(nameIdx) + " rename FAILED: " + CStr(Err.Number)
          Err.Clear
        Else
          WScript.Echo "  market " + CStr(nameIdx) + " = " + APP.Markets.Item(nameIdx).Name
        End If
      End If
    End If
  Loop
  ts.Close
End If
Err.Clear
On Error GoTo 0

' ---- 2. apply assignments ----------------------------------------------
' A dict of ticker -> "m,g" built from what is ALREADY correct in the database,
' so a re-run costs one pass over Symbols instead of writing all of them again.
Set doneMap = CreateObject("Scripting.Dictionary")
Set idxMap = CreateObject("Scripting.Dictionary")
Dim i2, st2, curKey
On Error Resume Next
For i2 = 0 To APP.Stocks.Count - 1
  Set st2 = APP.Stocks.Item(i2)
  curKey = st2.Ticker
  If Err.Number = 0 And Len(curKey) > 0 Then
    doneMap(curKey) = CStr(st2.MarketID) + "," + CStr(st2.GroupID)
    idxMap(curKey) = i2
  Else
    Err.Clear
  End If
Next
On Error GoTo 0
WScript.Echo "Existing assignments read: " + CStr(doneMap.Count)

applied = 0 : skipped = 0 : unknown = 0
Set ts = fso.OpenTextFile(csvPath, 1)
Do While Not ts.AtEndOfStream
  line = Trim(ts.ReadLine)
  If Len(line) > 0 Then
    parts = Split(line, ",")
    If UBound(parts) >= 2 Then
      key = parts(0)
      targetM = CLng(parts(1))
      targetG = CLng(parts(2))
      ' Stocks.Item does NOT accept a ticker string (it yields a Stock whose fields are empty,
      ' so every write fails with "Object required" 424) and Stocks.Find does not exist at all
      ' in 6.30 (error 438). The only reliable handle is the numeric index, taken from the same
      ' single pass that built doneMap.
      sawSymbol = False
      On Error Resume Next
      symIdx = -1
      If idxMap.Exists(key) Then symIdx = idxMap(key)
      Err.Clear
      If symIdx >= 0 Then
        Set st = APP.Stocks.Item(symIdx)
        If Err.Number = 0 Then sawSymbol = True
        Err.Clear
      End If
      On Error GoTo 0

      If Not sawSymbol Then
        unknown = unknown + 1
      ElseIf doneMap.Exists(key) And doneMap(key) = CStr(targetM) + "," + CStr(targetG) Then
        skipped = skipped + 1
      Else
        On Error Resume Next
        st.MarketID = targetM
        st.GroupID = targetG
        If Err.Number <> 0 Then
          WScript.Echo "  FAIL " + key + ": " + CStr(Err.Number) + " " + Err.Description
          Err.Clear
        Else
          applied = applied + 1
        End If
        On Error GoTo 0
        If applied Mod GROUP_CHUNK_REPORT = 0 And applied > 0 Then
          WScript.Echo "  ... " + CStr(applied) + " assigned"
        End If
      End If
    End If
  End If
Loop
ts.Close

WScript.Echo ""
WScript.Echo "assigned=" + CStr(applied) + "  already-correct=" + CStr(skipped) + "  missing-symbol=" + CStr(unknown)

' ---- 3. save and verify from the database, not from memory -------------
If applied > 0 Then
  WScript.Echo "Saving database ..."
  On Error Resume Next
  APP.SaveDatabase
  Err.Clear
  On Error GoTo 0
  WScript.Echo "Saved."
Else
  WScript.Echo "Nothing to save."
End If

WScript.Echo ""
' ---- 3b. reload from DISK before counting --------------------------------

' Counting straight after SaveDatabase would count the in-memory objects that were just set.
' That is how the persistence check lied earlier in this project: "was 2378" came from a live
' instance and proved memory, not disk. Force a re-read so the census answers the question
' that matters - did the assignment survive?
WScript.Echo "Reloading from disk to verify ..."
On Error Resume Next
Dim reOk
reOk = APP.LoadDatabase(DB_PATH)
If Err.Number <> 0 Then
  WScript.Echo "  reload raised " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
End If
On Error GoTo 0
WScript.Echo "Symbols after reload: " + CStr(APP.Stocks.Count)

WScript.Echo ""
WScript.Echo "---- census (read back from disk) ----"
Dim mCount, gCount, mid2, gid2, st4, nm, k
Set mCount = CreateObject("Scripting.Dictionary")
Set gCount = CreateObject("Scripting.Dictionary")
On Error Resume Next
For i2 = 0 To APP.Stocks.Count - 1
  Set st4 = APP.Stocks.Item(i2)
  mid2 = -1 : gid2 = -1
  mid2 = st4.MarketID
  gid2 = st4.GroupID
  If Err.Number = 0 Then
    If mCount.Exists(mid2) Then mCount(mid2) = mCount(mid2) + 1 Else mCount(mid2) = 1
    If gCount.Exists(gid2) Then gCount(gid2) = gCount(gid2) + 1 Else gCount(gid2) = 1
  Else
    Err.Clear
  End If
Next
On Error GoTo 0

For Each k In mCount.Keys
  nm = "?"
  On Error Resume Next
  nm = APP.Markets.Item(k).Name
  Err.Clear
  On Error GoTo 0
  WScript.Echo "  market " + CStr(k) + " (" + nm + "): " + CStr(mCount(k)) + " symbols"
Next
For Each k In gCount.Keys
  WScript.Echo "  group " + CStr(k) + ": " + CStr(gCount(k)) + " symbols"
Next

' ---- 4. gate ------------------------------------------------------------
' A category pass that did nothing looks exactly like one that worked: every chart still draws
' and every quote is intact. Fail loudly when either market is still empty.
Dim usCount, idxCount
usCount = 0 : idxCount = 0
If mCount.Exists(1) Then usCount = mCount(1)
If mCount.Exists(2) Then idxCount = mCount(2)

WScript.Echo ""
If usCount = 0 Or idxCount = 0 Then
  WScript.Echo "FAIL: market census empty after reload (US=" + CStr(usCount) + ", IDX=" + CStr(idxCount) + ")"
  WScript.Echo "      the assignment did not survive to disk."
  WScript.Quit 2
End If
WScript.Echo "OK: markets assigned and persisted (US=" + CStr(usCount) + ", IDX=" + CStr(idxCount) + ")"
WScript.Quit 0
