' Verify that every file the manifest describes is on disk at the size the
' exporter declared.
'
' WHY: on 2026-11-02 delta_idx_aux.csv stayed at its 31 Oct content while every
' other file refreshed. The import consumed the stale delta, the bars for that
' session never landed, and every existing gate still printed OK because they
' only assert that *some* foreign flow exists - not that it is today's.
'
' The manifest is written by the same run that writes the CSVs, so its byte
' counts are a statement about what the server published. Comparing them to the
' laptop turns "the pull reported success" into "the data on disk is the data
' that was published".
'
' WHY VBSCRIPT AND NOT POWERSHELL: every other gate in this pipeline is .vbs, and
' the PowerShell version of this one failed on the laptop with "Cannot dot-source
' this command because it was defined in a different language mode" - an error
' that had nothing to do with the check itself. A gate that cannot run is worse
' than no gate, because the log still looks like it tried.
'
' Usage: cscript //nologo verify-pull.vbs [dir]
' Exit:  0 = every declared file matches, 1 = mismatch or unreadable manifest.
Option Explicit

Dim DIR, fso, mpath, ts, txt, chain, m, name, bytes_, bad, total, f, size
Set fso = CreateObject("Scripting.FileSystemObject")

DIR = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count > 0 Then DIR = WScript.Arguments(0)
If Right(DIR, 1) <> "\" Then DIR = DIR & "\"

mpath = DIR & "manifest.json"
If Not fso.FileExists(mpath) Then
  WScript.Echo "FAIL: manifest.json missing - cannot verify the pull"
  WScript.Quit 1
End If

Set ts = fso.OpenTextFile(mpath, 1)
txt = ts.ReadAll
ts.Close

' The manifest is a flat JSON object with repeated {"file": X, "rows": N, "bytes": M}
' records. Parse those pairs in order rather than pulling in a JSON library: the
' shape is fixed by the exporter and this gate must not fail because a parser did.
bad = 0
total = 0
chain = txt
Do
  m = InStr(chain, """file""")
  If m = 0 Then Exit Do
  chain = Mid(chain, m)

  name = JsonString(chain, """file""")
  If name = "" Then Exit Do

  bytes_ = JsonNumber(chain, """bytes""")
  If bytes_ < 0 Then
    WScript.Echo "  " & name & " declared with no byte count - manifest is malformed"
    bad = bad + 1
    Exit Do
  End If

  total = total + 1
  If Not fso.FileExists(DIR & name) Then
    WScript.Echo "  " & name & " MISSING (manifest declares " & bytes_ & " bytes)"
    bad = bad + 1
  Else
    size = fso.GetFile(DIR & name).Size
    If size <> bytes_ Then
      WScript.Echo "  " & name & " STALE " & size & " bytes on disk, manifest says " & bytes_
      bad = bad + 1
    End If
  End If

  ' Advance past this record so the next "file" key is the next entry.
  chain = Mid(chain, InStr(chain, """bytes""") + 7)
Loop

If total = 0 Then
  WScript.Echo "FAIL: manifest declares no files - refusing to call this verified"
  WScript.Quit 1
End If

' A per-file size match can still hide a whole-export lag, so report the publish
' time as well. It is not a pass/fail criterion: verify-freshness.vbs owns that.
Dim pub
pub = JsonString(txt, """all""")
If pub <> "" Then WScript.Echo "  manifest rebuilt " & pub

If bad > 0 Then
  WScript.Echo "FAIL: " & bad & " of " & total & " file(s) on disk do not match the published manifest"
  WScript.Quit 1
End If
WScript.Echo "OK: all " & total & " manifest files on disk match their declared size"
WScript.Quit 0

' ---- helpers -------------------------------------------------------------
' Return the string value that follows key, or "" when absent.
Function JsonString(blob, key)
  Dim p, q, startAt
  JsonString = ""
  p = InStr(blob, key)
  If p = 0 Then Exit Function
  startAt = p + Len(key)
  q = InStr(startAt, blob, ":")
  If q = 0 Then Exit Function
  q = InStr(q, blob, """")
  If q = 0 Then Exit Function
  startAt = q + 1
  q = InStr(startAt, blob, """")
  If q = 0 Then Exit Function
  JsonString = Mid(blob, startAt, q - startAt)
End Function

' Return the integer value that follows key, or -1 when absent/not numeric.
Function JsonNumber(blob, key)
  Dim p, q, startAt, i, ch, digits
  JsonNumber = -1
  p = InStr(blob, key)
  If p = 0 Then Exit Function
  startAt = p + Len(key)
  q = InStr(startAt, blob, ":")
  If q = 0 Then Exit Function
  startAt = q + 1
  digits = ""
  For i = startAt To Len(blob)
    ch = Mid(blob, i, 1)
    If ch >= "0" And ch <= "9" Then
      digits = digits & ch
    ElseIf digits <> "" Then
      Exit For
    ElseIf ch <> " " Then
      Exit Function
    End If
  Next
  If digits = "" Then Exit Function
  JsonNumber = CDbl(digits)
End Function
