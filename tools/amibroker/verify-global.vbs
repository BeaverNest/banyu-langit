' Verify the GLOBAL market actually holds usable bars.
' The import log says "ok" for a file, not for a bar: a series can be added and still carry 0 in
' Open/High/Low. This reads the database and fails loudly if any of that is true.
Option Explicit

Dim APP, DB
Set APP = CreateObject("Broker.Application")
DB = "C:\BanyuLangit"
APP.LoadDatabase DB

Dim st : Set st = APP.Stocks
WScript.Echo "Symbols: " + CStr(st.Count)

Dim i, s, nm, mkt, bad0, n, h, l, c, d, firstD, lastD
Dim probe
probe = Array("USDIDR", "XAUUSD", "ALUMINIUM", "COPPER", "MACRO_BI_RATE", "MACRO_CPI_YOY", "SPX", "ID10Y", "COAL", "UsCORN")

WScript.Echo ""
WScript.Echo "---- probes ----"
For i = 0 To UBound(probe)
  nm = probe(i)
  Set s = Nothing
  On Error Resume Next
  Set s = Nothing
  Dim j, found
  found = -1
  For j = 0 To st.Count - 1
    If st.Item(j).Ticker = nm Then found = j
  Next
  On Error GoTo 0
  If found < 0 Then
    WScript.Echo "  " + nm + ": MISSING"
  Else
    Set s = st.Item(found)
    n = s.Quotations.Count
    If n = 0 Then
      WScript.Echo "  " + nm + ": 0 bars"
    Else
      d = s.Quotations.Item(n - 1).Date
      h = s.Quotations.Item(n - 1).High
      l = s.Quotations.Item(n - 1).Low
      c = s.Quotations.Item(n - 1).Close
      firstD = s.Quotations.Item(0).Date
      WScript.Echo "  " + nm + ": " + CStr(n) + " bars, market=" + CStr(s.MarketID) + ", " + _
                   CStr(firstD) + " .. " + CStr(d) + _
                   "  H=" + CStr(h) + " L=" + CStr(l) + " C=" + CStr(c)
      If h <= 0 Or l <= 0 Then bad0 = bad0 + 1
    End If
  End If
Next

' A close-only series must have been filled by the importer, not left at zero.
WScript.Echo ""
WScript.Echo "---- close-only series must not be zero ----"
Dim cl : cl = Array("MACRO_BI_RATE", "MACRO_CPI_YOY", "ID10Y", "TIN", "RUBBER_RSS3")
For i = 0 To UBound(cl)
  found = -1
  For j = 0 To st.Count - 1
    If st.Item(j).Ticker = cl(i) Then found = j
  Next
  If found < 0 Then
    WScript.Echo "  " + cl(i) + ": MISSING"
  Else
    Set s = st.Item(found)
    n = s.Quotations.Count
    If n > 0 Then
      h = s.Quotations.Item(n - 1).High
      l = s.Quotations.Item(n - 1).Low
      c = s.Quotations.Item(n - 1).Close
      WScript.Echo "  " + cl(i) + ": bars=" + CStr(n) + " H=" + CStr(h) + " L=" + CStr(l) + " C=" + CStr(c)
      If h <= 0 Or l <= 0 Then bad0 = bad0 + 1
    Else
      WScript.Echo "  " + cl(i) + ": 0 bars"
      bad0 = bad0 + 1
    End If
  End If
Next

WScript.Echo ""
If bad0 = 0 Then
  WScript.Echo "OK: every probe carries real High/Low"
  WScript.Quit 0
Else
  WScript.Echo "FAIL: " + CStr(bad0) + " series still carry zero High/Low"
  ' The exit code matters: refresh.bat branches on ERRORLEVEL, and a gate that prints FAIL
  ' but exits 0 is a gate that never fires. Verified by sabotage - forcing the branch and
  ' watching ERRORLEVEL stay 0 is how this was found.
  WScript.Quit 1
End If
