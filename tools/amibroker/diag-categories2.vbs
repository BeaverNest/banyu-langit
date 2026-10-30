' ===========================================================================
'  Diagnostic 2: industries, sectors, watchlists.
'
'  WHY: markets turned out to be 256 empty slots whose names ARE writable over OLE, and
'  Stock.MarketID/GroupID are writable too. That path is exact and needs no ASCII import.
'  Before writing the assigner I need to know whether the same holds for Industry/Sector -
'  the stock already reports IndustryID=102, so something may already be populated - and
'  whether a watchlist can be created and named, or only found if it already exists.
'
'  Every write is applied to a slot or a single symbol and then restored. Nothing is saved.
' ===========================================================================
Option Explicit

Dim APP, i, st, name1

On Error Resume Next
Set APP = GetObject(, "Broker.Application")
If Err.Number <> 0 Then
  Err.Clear
  Set APP = CreateObject("Broker.Application")
End If
On Error GoTo 0
If APP Is Nothing Then
  WScript.Echo "FAIL: no Broker.Application"
  WScript.Quit 2
End If

' ---- industries ---------------------------------------------------------
WScript.Echo "Industries.Count = " + CStr(APP.Industries.Count)
For i = 0 To 4
  On Error Resume Next
  WScript.Echo "  [" + CStr(i) + "] " + APP.Industries.Item(i).Name
  If Err.Number <> 0 Then WScript.Echo "  [" + CStr(i) + "] <error " + CStr(Err.Number) + ">"
  Err.Clear
Next
On Error GoTo 0

On Error Resume Next
name1 = APP.Industries.Item(1).Name
APP.Industries.Item(1).Name = "ZZ_PROBE"
If Err.Number <> 0 Then
  WScript.Echo "Industry.Name WRITE: fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  WScript.Echo "Industry.Name WRITE: ok -> [" + APP.Industries.Item(1).Name + "], was [" + name1 + "]"
  APP.Industries.Item(1).Name = name1
  Err.Clear
End If
On Error GoTo 0

' ---- sectors ------------------------------------------------------------
On Error Resume Next
WScript.Echo "Sectors.Count = " + CStr(APP.Sectors.Count)
For i = 0 To 3
  WScript.Echo "  [" + CStr(i) + "] " + APP.Sectors.Item(i).Name
  Err.Clear
Next
name1 = APP.Sectors.Item(1).Name
APP.Sectors.Item(1).Name = "ZZ_PROBE"
If Err.Number <> 0 Then
  WScript.Echo "Sector.Name WRITE: fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  WScript.Echo "Sector.Name WRITE: ok -> [" + APP.Sectors.Item(1).Name + "]"
  APP.Sectors.Item(1).Name = name1
  Err.Clear
End If
On Error GoTo 0

' ---- stocks: is SectorID a property at all? -----------------------------
Set st = APP.Stocks.Item(0)
On Error Resume Next
Dim sid
sid = st.SectorID
If Err.Number <> 0 Then
  WScript.Echo "Stock.SectorID READ: absent -> " + CStr(Err.Number)
  Err.Clear
Else
  WScript.Echo "Stock.SectorID READ: ok -> " + CStr(sid)
End If
On Error GoTo 0

' ---- watchlists ---------------------------------------------------------
On Error Resume Next
Dim wlCount
wlCount = APP.Watchlists.Count
If Err.Number <> 0 Then
  WScript.Echo "Watchlists.Count: fails -> " + CStr(Err.Number)
  Err.Clear
Else
  WScript.Echo "Watchlists.Count = " + CStr(wlCount)
  For i = 0 To wlCount - 1
    WScript.Echo "  [" + CStr(i) + "] " + APP.Watchlists.Item(i).Name
  Next
End If
Err.Clear
On Error GoTo 0

' Try to create one: Add() may not exist, in which case we learn that now.
On Error Resume Next
Dim wl
Set wl = APP.Watchlists.Add("ZZ_PROBE_LIST")
If Err.Number <> 0 Then
  WScript.Echo "Watchlists.Add(name): fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  WScript.Echo "Watchlists.Add(name): ok -> " + wl.Name
End If
On Error GoTo 0

WScript.Echo ""
WScript.Echo "Done - nothing was saved. Close AmiBroker without saving to discard the probe list."
