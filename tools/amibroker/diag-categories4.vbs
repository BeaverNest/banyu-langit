' ===========================================================================
'  Diagnostic 4: the two cheap paths that might replace everything else.
'
'  WHY: the ASCII importer turns out to support SECTORNAME and INDUSTRYNAME, which accept a
'  NAME and create the sector/industry on the fly - unlike MARKET/GROUP which only take an ID.
'  Sector names alone may therefore be enough, with industry derived from them.
'
'  And there are two vendor files on disk that decide how much of GICS/ICB can be filled
'  honestly: gics.txt (45 KB) and icb.txt (4.7 KB) in the install folder. If they are a
'  ticker -> code table, GICS/ICB become real; if they are only the classification tree,
'  they are not, and filling those categories would mean inventing assignments.
'
'  READ-ONLY. Nothing is written or saved.
' ===========================================================================
Option Explicit

Dim fso, f, s, n, i, path

Set fso = CreateObject("Scripting.FileSystemObject")

' ---- 1. what is actually in gics.txt / icb.txt -------------------------
For Each path In Array("C:\Program Files (x86)\AmiBroker\gics.txt", _
                       "C:\Program Files (x86)\AmiBroker\icb.txt", _
                       "C:\Program Files (x86)\AmiBroker\broker.sectors", _
                       "C:\Program Files (x86)\AmiBroker\broker.industries")
  WScript.Echo "=============================================================="
  WScript.Echo path
  WScript.Echo "=============================================================="
  If Not fso.FileExists(path) Then
    WScript.Echo "  (missing)"
  Else
    Set f = fso.OpenTextFile(path, 1)
    n = 0
    Do While Not f.AtEndOfStream And n < 12
      s = f.ReadLine
      WScript.Echo "  |" + s
      n = n + 1
    Loop
    f.Close
    WScript.Echo "  ---- first " + CStr(n) + " line(s) shown ----"
  End If
  WScript.Echo ""
Next

' ---- 2. how many symbols and what the market census looks like --------
WScript.Echo "=============================================================="
WScript.Echo "database"
WScript.Echo "=============================================================="
Dim APP, st
On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  Err.Clear
  Set APP = CreateObject("Broker.Application")
End If
On Error GoTo 0
If Not APP Is Nothing Then
  WScript.Echo "Stocks.Count = " + CStr(APP.Stocks.Count)
  WScript.Echo "Markets.Count = " + CStr(APP.Markets.Count) + _
               " (0 and 255 are reserved in AmiBroker conventions)"
  WScript.Echo "Market 1 name = [" + APP.Markets.Item(1).Name + "]"
  ' spot-check three symbols across the two markets
  For i = 0 To APP.Stocks.Count - 1
    Set st = APP.Stocks.Item(i)
    If st.Ticker = "A" Or st.Ticker = "AAL" Or st.Ticker = "AADI.JK" Or st.Ticker = "AALI.JK" Then
      WScript.Echo "  " + st.Ticker + " -> MarketID=" + CStr(st.MarketID) + " GroupID=" + CStr(st.GroupID)
    End If
  Next
Else
  WScript.Echo "FAIL: no Broker.Application"
End If
On Error GoTo 0

WScript.Echo ""
WScript.Echo "Done - nothing was saved."
