; Instalador Windows GFARM, compilado pelo GitHub Actions.
; A instalação do painel NÃO instala/move/limpa PostgreSQL, banco, uploads
; ou o servidor já em uso. O caminho do repositório é distinto e gravável.

#define MyAppName "GFARM"
#define MyAppVersion "1.3.0"
#define MyAppExeName "PAINEL_ESTQ.exe"

[Setup]
AppId=GFARM.Painel.Windows
AppName={#MyAppName} - Painel de Controle
AppVersion={#MyAppVersion}
AppPublisher=GFARM
DefaultDirName={sd}\Programas\GFARM
DefaultGroupName=GFARM
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
UninstallDisplayName=GFARM - Painel de Controle
OutputDir=..\..\dist\setup
OutputBaseFilename=GFARM_Instalador
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
ShowLanguageDialog=no
DisableWelcomePage=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce

[Files]
Source: "..\..\dist\PAINEL_ESTQ.exe"; DestDir: "{app}"; DestName: "PAINEL_ESTQ.exe"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\GFARM - Painel de Controle"; Filename: "{app}\PAINEL_ESTQ.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\GFARM - Painel de Controle"; Filename: "{app}\PAINEL_ESTQ.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKLM; Subkey: "Software\GFARM"; ValueType: string; ValueName: "PainelPasta"; ValueData: "{app}"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\PAINEL_ESTQ.exe"; Description: "Abrir GFARM - Painel de Controle"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
function ContemDadosDoServidor(Dir: String): Boolean;
begin
  Result :=
    FileExists(AddBackslash(Dir) + 'backend\.env') or
    FileExists(AddBackslash(Dir) + 'backend\run_production.py') or
    DirExists(AddBackslash(Dir) + '.git') or
    DirExists(AddBackslash(Dir) + 'uploads') or
    DirExists(AddBackslash(Dir) + 'backend\alembic');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if ContemDadosDoServidor(WizardDirValue) then
    begin
      MsgBox('Esta pasta contém arquivos de um servidor GFARM/ESTQ já existente.' + #13#10 +
        'O instalador nunca substitui o servidor e os dados reais.' + #13#10 +
        'Escolha outra pasta para o PAINEL. O painel localizará a instalação em uso.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;
