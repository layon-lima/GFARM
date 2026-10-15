Option Explicit
Dim fso, shell, folder, script, command, result
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(folder, "PREPARAR_GFARM.ps1")
If Not fso.FileExists(script) Then
  MsgBox "PREPARAR_GFARM.ps1 precisa estar ao lado deste iniciador.", vbCritical, "GFARM"
  WScript.Quit 1
End If
If MsgBox("Compilar e instalar o GFARM completo com o GFARM Control?" & vbCrLf & _
  "Podera solicitar login do GitHub e permissoes do Windows. PostgreSQL nao sera apagado.", _
  vbYesNo + vbQuestion, "GFARM") <> vbYes Then
  WScript.Quit 0
End If
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & script & Chr(34)
result = shell.Run(command, 1, True)
If result <> 0 Then
  MsgBox "Falha na preparacao. Verifique a janela de diagnostico. O banco nao foi alterado.", vbExclamation, "GFARM"
Else
  MsgBox "Preparacao concluida. Confira os atalhos GFARM e GFARM Control.", vbInformation, "GFARM"
End If
