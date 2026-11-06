' Prove the newest session the exporter published is actually IN the AmiBroker
' database.
'
' WHY THIS EXISTS: every gate before it answers "did the file parse" and "does
' some foreign flow exist". On 2026-11-02 the IDX delta never landed, the import
' of an older delta returned rc=0, verify-idx-aux.vbs printed OK against 30 Oct
' bars, and the run still ended with "import complete". Nobody could have found
' the reason from the log.
'
' The reference date is manifest.json, written by the same export run that writes
' the CSVs - so it describes what was PUBLISHED, not what we hoped for.
'
' WHY EVERYTHING IS INLINE AND NOT IN A PROBE FUNCTION: a VBScript Function that
' takes the Broker.Application object as an argument receives Nothing. Measured
' here: the same Stock object read at top level reports 8903 bars, and read
' through a function it reports "isnothing=True". The first version of this gate
' therefore declared every probe MISSING against a perfectly healthy database.
' Singletons work, objects passed across a VBScript function boundary do not.
' (verify-idx-aux.vbs hit the same class of bug and documents it for the same
' reason: a helper that looked correct returned garbage.)
'
' ZERO SESSIONS OF SLACK, EVERY MARKET. usMax is already the newest CLOSED US
' session - a 19:25 WIB export runs before the US open, so it can only publish
' the previous US day. An earlier version allowed US one extra session on top of
' that; the tolerance masked a permanently stale US feed for days while printing
' "ok". A tolerance wider than the source's own lag is not a tolerance, it is an
' excuse.
'
' Usage: cscript //nologo verify-freshness.vbs [dir]
' Exit:  0 = every probe holds the published session, 1 = something is behind.
Option Explicit

Dim fso, DIR, mpath, ts, txt, bad, evaluated
Set fso = CreateObject("Scripting.FileSystemObject")

DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count > 0 Then DIR = WScript.Arguments(0)
If Right(DIR, 1) <> "\" Then DIR = DIR & "\"

mpath = DIR & "manifest.json"
If Not fso.FileExists(mpath) Then
  WScript.Echo "FAIL: manifest.json missing - cannot judge freshness"
  WScript.Quit 1
End If
Set ts = fso.OpenTextFile(mpath, 1)
txt = ts.ReadAll
ts.Close

Dim idxMax, usMax, glMax, secMax
' Bound each block by the NEXT top-level key. A terminator like "rows": does not
' work: the manifest writes "rows": 796273 with a space, so a literal match cuts
' the block in the wrong place (first version reported "no date_max").
idxMax = BlockDateMax(txt, """idx""", """ihsg""")
usMax = BlockDateMax(txt, """us""", """delta""")
glMax = BlockDateMax(txt, """global""", """__end__""")
' Sector-index block. The exporter writes it BEFORE "global", so "global" bounds it and the
' global block keeps end-of-file as its own terminator.
secMax = BlockDateMax(txt, """idx_sectors""", """global""")

If idxMax = "" And usMax = "" And glMax = "" And secMax = "" Then
  WScript.Echo "FAIL: manifest carries no date_max - cannot judge freshness"
  WScript.Quit 1
End If

Dim APP
On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  Err.Clear
  Set APP = CreateObject("Broker.Application")
End If
On Error GoTo 0
If APP Is Nothing Then
  WScript.Echo "FAIL: Broker.Application unavailable - is AmiBroker running?"
  WScript.Quit 1
End If
APP.LoadDatabase "C:\BanyuLangit"

WScript.Echo "---- freshness vs published manifest ----"

Dim names, wants, allowed
' COAL is a probe again. It was pulled out once because it lagged while every other series was
' current - the right response was to fix the SOURCE, not to stop looking. The cause was a wrong
' pin in market-rails/instruments.json (USDIDR). With the rail green, COAL reaches the same
' session as everything else and belongs in the gate.
' TIN / CPO / RUBBER stay out on purpose: they publish with a declared source lag
' (custom_tickers.expected_lag_sessions), which is a property of Investing's publication
' schedule, not of this pipeline. They are watched by check-series-freshness.js against that
' declared lag, which is the correct comparison for a lagging source.
' IDXENERGY.JK is the sector-index probe. The failure mode these 44 series invite is "imported
' once, never again": the file lands, imports cleanly on day one, and then stops being pulled.
' One probe from that file turns that silence into a red gate.
names = Array("JKSE", "BBCA.JK", "AAPL", "ID10Y", "COAL", "IDXENERGY.JK")
' ZERO slack for every market, including US. The old "1 session for US" rule was a mask, not a
' tolerance: the manifest's usMax is already the newest CLOSED US session (a 19:25 WIB export
' runs before the US open, so it can only ever publish the previous US day). Allowing one more
' session on top of that meant a permanently stale US feed passed the gate every night - which
' is exactly what happened: delta_recent.csv was never imported after delta_idx_aux.csv
' appeared, AAPL sat one session behind, and this gate printed "ok".
allowed = Array("0", "0", "0", "0", "0", "0")
wants = Array(idxMax, idxMax, usMax, glMax, glMax, secMax)

bad = 0
evaluated = 0

' ---- locate the probes with ONE pass over the collection ------------------
' APP.Stocks.Item(<string VARIABLE>) returns Nothing on this build, while
' Item("literal") and Item(CStr(v)) work. Measured: five spellings, only the raw
' variable form fails - a VBScript/COM by-reference quirk, not an AmiBroker bug.
' A single linear pass sidesteps it entirely, and it is the same pattern
' verify-idx-aux.vbs already uses for exactly this reason.
Dim pos(5), j, t
For i = 0 To UBound(names)
  pos(i) = -1
Next
For j = 0 To APP.Stocks.Count - 1
  t = APP.Stocks.Item(j).Ticker
  For i = 0 To UBound(names)
    If t = names(i) Then pos(i) = j
  Next
Next

Dim i, ticker, want, st, n, q, got, lag, d, dbNewest
dbNewest = Empty
For i = 0 To UBound(names)
  ticker = names(i)
  want = wants(i)

  If want = "" Then
    WScript.Echo "  " & ticker & " SKIP - manifest has no date_max for its market"
  Else
    evaluated = evaluated + 1

    Set st = Nothing
    If pos(i) >= 0 Then Set st = APP.Stocks.Item(pos(i))
    n = 0
    If Not (st Is Nothing) Then n = st.Quotations.Count

    If st Is Nothing Then
      WScript.Echo "  " & ticker & " MISSING from the database"
      bad = bad + 1
    ElseIf n = 0 Then
      WScript.Echo "  " & ticker & " holds no bars"
      bad = bad + 1
    Else
      On Error Resume Next
      Set q = st.Quotations(n - 1)
      got = q.Date
      On Error GoTo 0
      ' Track the newest bar actually present. The pull decision for the NEXT run reads this
      ' value (needs-full.vbs): "how stale is the database" can only be answered by looking at
      ' the database, and this gate is already looking.
      If IsDate(got) Then
        If Not IsDate(dbNewest) Then
          dbNewest = got
        ElseIf CDate(got) > CDate(dbNewest) Then
          dbNewest = got
        End If
      End If

      ' Count only weekdays: a weekend between the last bar and today is not lag.
      lag = 0
      d = got
      Do While DateValue(d) < DateValue(want) And lag <= 60
        d = DateAdd("d", 1, d)
        If Weekday(d) <> 1 And Weekday(d) <> 7 Then lag = lag + 1
      Loop

      If lag > CInt(allowed(i)) Then
        WScript.Echo "  " & ticker & " LAG " & lag & " session(s): database " & _
          FormatDate(got) & ", published " & FormatDate(want)
        bad = bad + 1
      Else
        WScript.Echo "  " & ticker & " " & FormatDate(got) & " ok"
      End If
    End If
  End If
Next

If evaluated = 0 Then
  WScript.Echo "FAIL: no probe could be evaluated"
  WriteState DIR, "failed"
  WScript.Quit 1
End If
If bad > 0 Then
  WScript.Echo "FAIL: " & bad & " probe(s) are behind the published export - the import did not land"
  ' Record the failure. needs-full.vbs reads this file, and a red gate means the delta could not
  ' repair the database: the next run must fetch the full snapshot instead of repeating the same
  ' attempt and failing the same way every evening.
  WriteState DIR, "failed"
  WScript.Quit 1
End If
WScript.Echo "OK: AmiBroker holds the newest published session in every market"
WriteState DIR, "ok " & FormatDate(dbNewest)
WScript.Quit 0

' ---- helpers -------------------------------------------------------------
' Leave a one-line verdict for the next run's pull decision (needs-full.vbs).
' Deliberately silent on failure: a gate that cannot write its memo must still report its own
' verdict, and the advisor treats a missing memo as FULL (the slow but safe direction).
Sub WriteState(DIR_, verdict)
  Dim p, f2
  On Error Resume Next
  p = DIR_ & "last_import_ok.txt"
  Set f2 = CreateObject("Scripting.FileSystemObject").CreateTextFile(p, True)
  If Err.Number = 0 Then
    f2.WriteLine Left(Replace(verdict, vbCr, ""), 40)
    f2.Close
  End If
  Err.Clear
  On Error GoTo 0
End Sub


Function FormatDate(d)
  FormatDate = Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2)
End Function

' Pull "date_max" out of the JSON block that starts at key, e.g. """idx""".
' nextKey bounds the block ("__end__" means "to the end of the file").
Function BlockDateMax(blob, key, nextKey)
  Dim p, seg, q, e
  BlockDateMax = ""
  p = InStr(blob, key)
  If p = 0 Then Exit Function
  seg = Mid(blob, p)
  If nextKey <> "__end__" Then
    e = InStr(seg, nextKey)
    If e > 0 Then seg = Left(seg, e - 1)
  End If
  p = InStr(seg, """date_max""")
  If p = 0 Then Exit Function
  seg = Mid(seg, p)
  p = InStr(seg, ":")
  If p = 0 Then Exit Function
  seg = Mid(seg, p)
  p = InStr(seg, """")
  If p = 0 Then Exit Function
  seg = Mid(seg, p + 1)
  q = InStr(seg, """")
  If q = 0 Then Exit Function
  BlockDateMax = Left(seg, q - 1)
End Function
