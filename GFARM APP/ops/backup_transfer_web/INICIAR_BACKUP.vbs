' Inicia o GFARM Backup Web no navegador sem janela de prompt.
Option Explicit
Dim fso, shell, projeto, script, python, item, options, args
Set fso=CreateObject("Scripting.FileSystemObject")
Set shell=CreateObject("WScript.Shell")
projeto="C:\Users\User\Documents\Layon\PROJETOS PYTHON\PROJETO"
script=fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName),"painel_backup.py")
If Not fso.FileExists(script) Then
 MsgBox "painel_backup.py deve ficar na mesma pasta deste iniciador.",16,"GFARM"
 WScript.Quit 2
End If
options=Array( _
 fso.BuildPath(projeto,".venv\Scripts\pythonw.exe"), _
 fso.BuildPath(projeto,"backend\.venv\Scripts\pythonw.exe"), _
 shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python313\pythonw.exe", _
 shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python314\pythonw.exe" _
)
python=""
For Each item In options
 If fso.FileExists(item) Then
  python=item
  Exit For
 End If
Next
If python="" Then
 MsgBox "Python nao encontrado. Use o iniciador de diagnostico (.cmd).",16,"GFARM"
 WScript.Quit 3
End If
args=Chr(34) & python & Chr(34) & " " & Chr(34) & script & Chr(34) & " " & Chr(34) & projeto & Chr(34)
shell.Run args,0,False
