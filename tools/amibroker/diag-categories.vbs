' ===========================================================================
'  Diagnostic: can market/group assignment and NAMING be done over OLE?
'
'  WHY: the first category import returned rc=0 for both files and changed nothing. All 2,378
'  symbols stayed in market 0 ("Undefined"), which proves the MARKET field was not applied.
'  The vendor docs say MARKET/GROUP take an ID (number), not a name - and the database has no
'  markets named "US"/"IDX" to match against anyway.
'
'  Three unknowns, each cheap to answer here:
'    1. What markets exist, and are their names settable via OLE?
'    2. Is Stock.MarketID writable, so assignment can skip ASCII entirely?
'    3. Is Stock.GroupID writable for the same reason?
'
'  Read-only until the explicit "probe write" section: assignments are set on ONE symbol and
'  then restored, so a failed probe cannot leave the database scrambled.
' ===========================================================================
Option Explicit

Dim APP, i, st, n, probe

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

WScript.Echo "AmiBroker : " + CStr(APP.Version)
WScript.Echo "Database  : " + APP.DatabasePath
WScript.Echo ""

' ---- 1. markets ---------------------------------------------------------
WScript.Echo "Markets.Count = " + CStr(APP.Markets.Count)
For i = 0 To APP.Markets.Count - 1
  WScript.Echo "  [" + CStr(i) + "] " + APP.Markets.Item(i).Name
Next
WScript.Echo ""

' ---- 2. is Market.Name writable? ---------------------------------------
' Set market 1's name and read it back. Restore immediately.
Dim origName
origName = APP.Markets.Item(1).Name
Err.Clear
On Error Resume Next
APP.Markets.Item(1).Name = "US"
If Err.Number <> 0 Then
  WScript.Echo "Market.Name WRITE: fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  WScript.Echo "Market.Name WRITE: ok -> now [" + APP.Markets.Item(1).Name + "]"
  APP.Markets.Item(1).Name = origName
  Err.Clear
End If
On Error GoTo 0
WScript.Echo ""

' ---- 3. sample symbol ---------------------------------------------------
Set st = APP.Stocks.Item(0)
WScript.Echo "Sample symbol : " + st.Ticker
WScript.Echo "  MarketID=" + CStr(st.MarketID) + "  GroupID=" + CStr(st.GroupID) + "  IndustryID=" + CStr(st.IndustryID)
WScript.Echo ""

' ---- 4. probe write MarketID -------------------------------------------
Dim origM, origG
origM = st.MarketID
origG = st.GroupID

Err.Clear
On Error Resume Next
st.MarketID = 1
If Err.Number <> 0 Then
  WScript.Echo "Stock.MarketID WRITE: fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  Dim backM
  backM = st.MarketID
  WScript.Echo "Stock.MarketID WRITE: ok -> " + CStr(origM) + " becomes " + CStr(backM)
  st.MarketID = origM
  Err.Clear
End If
On Error GoTo 0

' ---- 5. probe write GroupID --------------------------------------------
Err.Clear
On Error Resume Next
st.GroupID = 1
If Err.Number <> 0 Then
  WScript.Echo "Stock.GroupID  WRITE: fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  WScript.Echo "Stock.GroupID  WRITE: ok -> " + CStr(origG) + " becomes " + CStr(st.GroupID)
  st.GroupID = origG
  Err.Clear
End If
On Error GoTo 0

WScript.Echo ""
WScript.Echo "Restored sample: MarketID=" + CStr(st.MarketID) + "  GroupID=" + CStr(st.GroupID)
WScript.Echo "Done - nothing was saved."
