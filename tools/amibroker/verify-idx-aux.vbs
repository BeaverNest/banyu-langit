' Verify IDX foreign flow actually landed in AmiBroker as Aux1/Aux2.
'
' rc=0 from Import() means the FILE parsed, not that the values arrived - this pipeline has
' already shipped a gate that printed OK against an empty database. So read the bars back.
'
' WHY ONE PASS AND NOT A LOOKUP FUNCTION: a helper function that loops over Stocks works in
' verify-global.vbs only because it inlines the loop. An earlier version of THIS script declared
' a Function and assigned to its own name inside a For loop; VBScript silently returned -1 for
' every probe but the first, so BBRI was found and BBCA/UNVR/TLKM all reported MISSING against a
' database that had them. One linear pass, collect into an array, then judge.
'
' WScript.Quit 1 on failure is load-bearing: refresh.bat branches on ERRORLEVEL. Without it the
' gate prints FAIL and returns 0, which is the exact defect verify-global.vbs had.
Option Explicit

Dim APP, st, i, j, s, q, bad, found
Set APP = CreateObject("Broker.Application")
APP.LoadDatabase "C:\BanyuLangit"
Set st = APP.Stocks

Dim probe
probe = Array("BBRI.JK", "BBCA.JK", "UNVR.JK", "TLKM.JK", "ASII.JK", "GOTO.JK")
Dim idx(10)
For i = 0 To UBound(probe)
  idx(i) = -1
Next

' Single pass over the collection, no function call, no On Error inside the loop.
Dim t
For j = 0 To st.Count - 1
  t = st.Item(j).Ticker
  For i = 0 To UBound(probe)
    If t = probe(i) Then idx(i) = j
  Next
Next

bad = 0
WScript.Echo "---- IDX foreign flow readback ----"
For i = 0 To UBound(probe)
  If idx(i) < 0 Then
    WScript.Echo "  " + probe(i) + " MISSING"
    bad = bad + 1
  Else
    Set s = st.Item(idx(i))
    Dim nBars, nFlow
    nBars = s.Quotations.Count
    nFlow = 0
    For Each q In s.Quotations
      If CStr(q.Aux2) = "1" Then nFlow = nFlow + 1
    Next
    WScript.Echo "  " + s.Ticker + " bars=" + CStr(nBars) + " bars_with_flow=" + CStr(nFlow)
    If nBars > 100 And nFlow = 0 Then
      WScript.Echo "    FAIL: no bar carries the published flag"
      bad = bad + 1
    End If
    If nBars > 0 Then
      Set q = s.Quotations.Item(nBars - 1)
      WScript.Echo "    last " + CStr(q.Date) + " AUX1=" + CStr(q.Aux1) + " AUX2=" + CStr(q.Aux2)
    End If
  End If
Next

WScript.Echo ""
If bad > 0 Then
  WScript.Echo "FAIL: IDX foreign flow did not land cleanly (" + CStr(bad) + " problems)"
  WScript.Quit 1
End If
WScript.Echo "OK: IDX foreign flow present in Aux1/Aux2"
WScript.Quit 0
