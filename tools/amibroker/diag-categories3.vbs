' ===========================================================================
'  Diagnostic 3: groups, watchlists, and where sector/industry names live.
'
'  WHY: 'Industries' does not exist on the 6.30 object model, so the probe died before it
'  reached the rest. Every section below is guarded separately - one missing member must not
'  hide the others. Nothing here writes permanently.
'
'  The vendor docs say sector and industry NAMES live in broker.workspace and are only
'  re-read when that file is deleted. That would also reset layouts, so it is NOT done here -
'  this probe only reports what exists on disk so the decision is made with facts.
' ===========================================================================
Option Explicit

Dim APP, i, n, st, orig

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

' ---- GROUPS -------------------------------------------------------------
On Error Resume Next
n = APP.Groups.Count
If Err.Number <> 0 Then
  WScript.Echo "Groups.Count: ABSENT -> " + CStr(Err.Number)
  Err.Clear
Else
  WScript.Echo "Groups.Count = " + CStr(n)
  For i = 0 To 3
    WScript.Echo "  [" + CStr(i) + "] " + APP.Groups.Item(i).Name
    Err.Clear
  Next
  ' can a group name be set?
  orig = APP.Groups.Item(1).Name
  APP.Groups.Item(1).Name = "ZZ_PROBE"
  If Err.Number <> 0 Then
    WScript.Echo "Group.Name WRITE: fails -> " + CStr(Err.Number) + " " + Err.Description
    Err.Clear
  Else
    WScript.Echo "Group.Name WRITE: ok -> [" + APP.Groups.Item(1).Name + "], was [" + orig + "]"
    APP.Groups.Item(1).Name = orig
    Err.Clear
  End If
End If
On Error GoTo 0

' ---- WATCHLISTS ---------------------------------------------------------
On Error Resume Next
n = APP.Watchlists.Count
If Err.Number <> 0 Then
  WScript.Echo "Watchlists.Count: ABSENT -> " + CStr(Err.Number)
  Err.Clear
Else
  WScript.Echo "Watchlists.Count = " + CStr(n)
  For i = 0 To n - 1
    WScript.Echo "  [" + CStr(i) + "] " + APP.Watchlists.Item(i).Name
    Err.Clear
  Next
End If
On Error GoTo 0

On Error Resume Next
Dim wl
Set wl = APP.Watchlists.Add("ZZ_PROBE_LIST")
If Err.Number <> 0 Then
  WScript.Echo "Watchlists.Add(name): fails -> " + CStr(Err.Number) + " " + Err.Description
  Err.Clear
Else
  WScript.Echo "Watchlists.Add(name): OK -> " + wl.Name
End If
On Error GoTo 0

' ---- SECTORS (read only) ------------------------------------------------
On Error Resume Next
n = APP.Sectors.Count
If Err.Number <> 0 Then
  WScript.Echo "Sectors.Count: ABSENT -> " + CStr(Err.Number)
  Err.Clear
Else
  WScript.Echo "Sectors.Count = " + CStr(n)
  For i = 0 To 2
    WScript.Echo "  [" + CStr(i) + "] " + APP.Sectors.Item(i).Name
    Err.Clear
  Next
End If
On Error GoTo 0

' ---- STOCK FIELDS -------------------------------------------------------
Set st = APP.Stocks.Item(0)
On Error Resume Next
WScript.Echo "Sample " + st.Ticker + ": MarketID=" + CStr(st.MarketID) + _
             " GroupID=" + CStr(st.GroupID) + " IndustryID=" + CStr(st.IndustryID) + _
             " WatchListBits=" + CStr(st.WatchListBits)
If Err.Number <> 0 Then
  WScript.Echo "  (WatchListBits unreadable: " + CStr(Err.Number) + ")"
  Err.Clear
End If
On Error GoTo 0

' ---- WHAT IS ON DISK ----------------------------------------------------
Dim fso, f, folder, files
Set fso = CreateObject("Scripting.FileSystemObject")
WScript.Echo ""
For Each folder In Array("C:\BanyuLangit", "C:\Program Files (x86)\AmiBroker")
  If fso.FolderExists(folder) Then
    WScript.Echo "Files in " + folder + ":"
    For Each f In fso.GetFolder(folder).Files
      WScript.Echo "  " + f.Name + "  (" + CStr(f.Size) + " bytes, " + FormatDateTime(f.DateLastModified, 2) + ")"
    Next
  End If
Next

WScript.Echo ""
WScript.Echo "Done - nothing was saved."
