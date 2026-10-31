' Verify SYMBOL INFORMATION actually landed in the database.
'
' The import log says "ok" for a FILE, not for a field. $OVERWRITE 1 can be silently wrong and
' still return rc=0, so this reads the values back from disk and fails loudly.
Option Explicit

Dim APP, st, i, s, found
Set APP = CreateObject("Broker.Application")
APP.LoadDatabase "C:\BanyuLangit"
Set st = APP.Stocks

WScript.Echo "Symbols: " + CStr(st.Count)

Function FindIdx(ticker)
  Dim k
  FindIdx = -1
  For k = 0 To st.Count - 1
    If st.Item(k).Ticker = ticker Then FindIdx = k
  Next
End Function

WScript.Echo ""
WScript.Echo "---- symbol information probes ----"
Dim probe : probe = Array("UNVR.JK", "BBRI.JK", "AAPL", "XAUUSD", "JKSE")
Dim bad : bad = 0
Dim j
For i = 0 To UBound(probe)
  j = FindIdx(probe(i))
  If j < 0 Then
    WScript.Echo "  " + probe(i) + ": MISSING SYMBOL"
    bad = bad + 1
  Else
    Set s = st.Item(j)
    WScript.Echo "  " + probe(i)
    WScript.Echo "     FullName = [" + CStr(s.FullName) + "]"
    WScript.Echo "     Alias    = [" + CStr(s.Alias) + "]"
    WScript.Echo "     Currency = [" + CStr(s.Currency) + "]"
    WScript.Echo "     Address  = [" + Left(CStr(s.Address), 60) + "]"
    If Len(CStr(s.FullName)) = 0 Then
      WScript.Echo "     -> FAIL: FullName is empty"
      bad = bad + 1
    End If
  End If
Next

WScript.Echo ""
WScript.Echo "---- fill counts ----"
Dim nFull, nAlias, nCur, k
nFull = 0 : nAlias = 0 : nCur = 0
For k = 0 To st.Count - 1
  If Len(CStr(st.Item(k).FullName)) > 0 Then nFull = nFull + 1
  If Len(CStr(st.Item(k).Alias)) > 0 Then nAlias = nAlias + 1
  If Len(CStr(st.Item(k).Currency)) > 0 Then nCur = nCur + 1
Next
WScript.Echo "  FullName filled: " + CStr(nFull) + " / " + CStr(st.Count)
WScript.Echo "  Alias    filled: " + CStr(nAlias) + " / " + CStr(st.Count)
WScript.Echo "  Currency filled: " + CStr(nCur) + " / " + CStr(st.Count)

WScript.Echo ""
If bad = 0 Then
  WScript.Echo "OK: symbol information present"
  WScript.Quit 0
Else
  WScript.Echo "FAIL: " + CStr(bad) + " probe(s) missing symbol information"
  WScript.Quit 1
End If
