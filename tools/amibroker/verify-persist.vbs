' ===========================================================================
'  Cold-start persistence check, deliberately standalone.
'
'  WHY SEPARATE FROM sync-amibroker.vbs: an inline verify branch kept failing with
'  "Object variable not set" because it shared state with the import path (APP handles
'  invalidated by Quit, Dim blocks inside branches, early exits). A 40-line script with one
'  job has one code path and cannot inherit that bug.
'
'  WHAT IT PROVES: identical CSV data imported twice reported OK twice, yet the second run
'  started from zero bars. The bars were in memory only. This script kills broker.exe, starts
'  a new instance, and reads a bar count. A new process can only see what reached disk.
'
'  USAGE:  cscript //nologo verify-persist.vbs
'  Exit:   0 = data survived restart, 2 = it did not, 3 = could not test
' ===========================================================================

Option Explicit

Const MIN_BARS = 60          ' the export's own minimum per ticker
Const KILL_WAIT_MS = 5000

Dim fso, svc, procs, p, killed
Set fso = CreateObject("Scripting.FileSystemObject")

' ---- 1. kill anything running -------------------------------------------
killed = 0
On Error Resume Next
Set svc = GetObject("winmgmts:\\.\root\cimv2")
If Err.Number <> 0 Then
  WScript.Echo "FAIL: WMI unavailable (" + Err.Description + ") - cannot close AmiBroker"
  WScript.Quit 3
End If
Err.Clear
Set procs = svc.ExecQuery("SELECT * FROM Win32_Process WHERE Name='broker.exe'")
If Err.Number <> 0 Then
  WScript.Echo "FAIL: could not enumerate broker.exe (" + Err.Description + ")"
  WScript.Quit 3
End If
For Each p In procs
  If p.Terminate() = 0 Then killed = killed + 1
Next
Err.Clear
On Error GoTo 0

WScript.Echo "closed " + CStr(killed) + " broker.exe process(es)"
WScript.Sleep KILL_WAIT_MS

' ---- 2. cold start -------------------------------------------------------
Dim app, tries, bars, count, st
Set app = Nothing
On Error Resume Next
Set app = CreateObject("Broker.Application")
If Err.Number <> 0 Then
  WScript.Echo "FAIL: could not start AmiBroker (" + Err.Description + ")"
  WScript.Quit 3
End If
Err.Clear
On Error GoTo 0

bars = 0
count = 0
tries = 0
Do While tries < 30
  On Error Resume Next
  count = app.Stocks.Count
  bars = 0
  If count > 0 Then
    Set st = app.Stocks(0)
    bars = st.Quotations.Count
  End If
  Err.Clear
  On Error GoTo 0
  If bars >= MIN_BARS Then Exit Do
  WScript.Sleep 1000
  tries = tries + 1
Loop

' ---- 3. report -----------------------------------------------------------
WScript.Echo "cold start: " + CStr(count) + " symbols, first symbol holds " + CStr(bars) + " bars"

If bars >= MIN_BARS Then
  WScript.Echo "PERSISTENT: data survived a full restart"
  WScript.Quit 0
Else
  WScript.Echo "FAIL: bars vanished after restart - the import never reached disk"
  WScript.Quit 2
End If
