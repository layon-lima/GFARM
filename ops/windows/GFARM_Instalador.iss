; INSTALADOR DO SISTEMA GFARM. Inclui o painel/assistente que baixa o ERP do
; GitHub, instala dependências e configura banco novo com autorização.
; Nunca sobrescreve servidor já em uso ou restaura banco automaticamente.

#define MyAppName "GFARM"
#define MyAppVersion "1.4.0"
#define MyAppExeName "PAINEL_ESTQ.exe"

[Setup]
AppId=GFARM.Painel.Windows
AppName={#MyAppName} - Sistema de Estoque
AppVersion={#MyAppVersion}
AppPublisher=GFARM
DefaultDirName={sd}\Programas\GFARM
DefaultGroupName=GFARM
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
UninstallDisplayName=GFARM - Sistema de Estoque
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

[Dirs]
; Os arquivos do sistema são instalados em {app}\Servidor pelo assistente.
; Não concedemos acesso a todos os usuários às credenciais do PostgreSQL.
Name: "{app}\Servidor"

[INI]
; Marca a localização selecionada pelo usuário no instalador para que o
; painel nunca volte a procurar apenas em Documentos.
Filename: "{app}\gfarm-install.ini"; Section: "GFARM"; Key: "Servidor"; String: "{app}\Servidor"

[Icons]
Name: "{autoprograms}\GFARM - Painel de Controle"; Filename: "{app}\PAINEL_ESTQ.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\GFARM - Painel de Controle"; Filename: "{app}\PAINEL_ESTQ.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKLM; Subkey: "Software\GFARM"; ValueType: string; ValueName: "PainelPasta"; ValueData: "{app}"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\PAINEL_ESTQ.exe"; Description: "Instalar e configurar o programa GFARM agora"; Parameters: "--install-gfarm"; Flags: nowait postinstall skipifsilent runascurrentuser

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
        'Escolha outra pasta para o GFARM. O assistente localizará a instalação em uso.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;
