; GFARM - Instalador Windows em 3 etapas.
; Dependencias e interface estao no pacote, sem uso de aplicativos antigos.
#define AppName "GFARM"
#define AppVersion "2.0.0"

[Setup]
AppId={{F07ED2B2-26D1-4B38-AE42-A6043556E6E8}
AppName={#AppName} + GFARM Control
AppVersion={#AppVersion}
AppPublisher=GFARM
DefaultDirName={autopf}\GFARM
DefaultGroupName=GFARM
UninstallDisplayName=GFARM e GFARM Control
OutputDir=build
OutputBaseFilename=GFARM_Instalador_Definitivo
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=build\GFARM.ico
UninstallDisplayIcon={app}\GFARM.exe
DisableProgramGroupPage=yes
ChangesAssociations=no
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalhos dos dois aplicativos na área de trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce

[Dirs]
Name: "{commonappdata}\GFARM"

[Files]
Source: "build\GFARM.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM-Control.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM-Control.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM_APP.zip"; DestDir: "{app}"; Flags: ignoreversion
Source: "install_windows.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\GFARM"; Filename: "{app}\GFARM.exe"; IconFilename: "{app}\GFARM.ico"
Name: "{autoprograms}\GFARM Control"; Filename: "{app}\GFARM-Control.exe"; Parameters: "--open"; IconFilename: "{app}\GFARM-Control.ico"
Name: "{autodesktop}\GFARM"; Filename: "{app}\GFARM.exe"; IconFilename: "{app}\GFARM.ico"; Tasks: desktopicon
Name: "{autodesktop}\GFARM Control"; Filename: "{app}\GFARM-Control.exe"; Parameters: "--open"; IconFilename: "{app}\GFARM-Control.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\GFARM-Control.exe"; Parameters: "--open"; Description: "Abrir GFARM Control para configurar PostgreSQL"; Flags: postinstall skipifsilent nowait

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/End /TN ""GFARM Control"""; Flags: runhidden; RunOnceId: "GFARMControlStopTask"
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""GFARM Control"" /F"; Flags: runhidden; RunOnceId: "GFARMControlRemoveTask"

[Code]
var
  Stage1: TWizardPage;
  PasswordPage: TInputQueryWizardPage;
  Stage3: TWizardPage;

function PasswordNeeded(): Boolean;
begin
  Result := not FileExists(ExpandConstant('{commonappdata}\GFARM\control-auth.json'));
end;

procedure InitializeWizard;
var
  Txt: TNewStaticText;
begin
  Stage1 := CreateCustomPage(wpSelectDir, '1/3 — INSTALAR GFARM',
    'O GFARM será instalado como aplicativo convencional do Windows.');
  Txt := TNewStaticText.Create(Stage1);
  Txt.Parent := Stage1.Surface;
  Txt.AutoSize := False;
  Txt.WordWrap := True;
  Txt.Width := Stage1.SurfaceWidth;
  Txt.Height := 130;
  Txt.Caption := 'A instalação terá dois atalhos independentes: GFARM e GFARM Control.' + #13#10#13#10 +
    'O GFARM será instalado com frontend, backend Python e dependências.' + #13#10 +
    'Os arquivos operacionais ficarão separados, em ProgramData\GFARM.' + #13#10#13#10 +
    'Não serão criados dados fictícios e o banco PostgreSQL existente não será apagado.';

  PasswordPage := CreateInputQueryPage(Stage1.ID, '2/3 — GFARM CONTROL',
    'Senha do painel independente de administração.',
    'Defina a senha que será utilizada para atualizar, fazer backup e controlar o servidor.');
  PasswordPage.Add('Senha administrativa (mínimo de 12 caracteres):', True);
  PasswordPage.Add('Confirmar senha:', True);

  Stage3 := CreateCustomPage(PasswordPage.ID, '3/3 — CONFIGURAR SERVIDOR',
    'Conectar ao PostgreSQL local sem perder os dados existentes.');
  Txt := TNewStaticText.Create(Stage3);
  Txt.Parent := Stage3.Surface;
  Txt.AutoSize := False;
  Txt.WordWrap := True;
  Txt.Width := Stage3.SurfaceWidth;
  Txt.Height := 180;
  Txt.Caption := 'O instalador detectará o PostgreSQL, mas não criará nem substituirá um banco automaticamente.' + #13#10#13#10 +
    'Ao terminar, o GFARM Control será aberto. Na área SERVIDOR você informará os dados de conexão do banco atual.' + #13#10#13#10 +
    'Se já houver dados no PostgreSQL 18, eles continuarão onde estão.' + #13#10 +
    'A interface só iniciará após a conexão estar corretamente configurada.';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = PasswordPage.ID) and PasswordNeeded() then
  begin
    if Length(PasswordPage.Values[0]) < 12 then
    begin
      MsgBox('Informe uma senha de pelo menos 12 caracteres.', mbError, MB_OK);
      Result := False;
    end
    else if PasswordPage.Values[0] <> PasswordPage.Values[1] then
    begin
      MsgBox('As senhas do GFARM Control não coincidem.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  P, Arguments: String;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;

  if PasswordNeeded() then
  begin
    P := ExpandConstant('{commonappdata}\GFARM\control-password.tmp');
    if not SaveStringToFile(P, PasswordPage.Values[0], False) then
      RaiseException('Não foi possível preparar a senha do GFARM Control.');
    WizardForm.StatusLabel.Caption := '2/3 — Configurando GFARM Control...';
    if (not Exec(ExpandConstant('{app}\GFARM-Control.exe'),
      '--setup-password-file "' + P + '"', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
      RaiseException('Falha ao configurar a senha do GFARM Control. Código: ' + IntToStr(ResultCode));
  end;

  WizardForm.StatusLabel.Caption := '1/3 e 3/3 — Instalando GFARM, dependências e serviço do Windows...';
  Arguments := '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\install_windows.ps1') + '" -InstallDir "' +
    ExpandConstant('{app}') + '" -PayloadZip "' +
    ExpandConstant('{app}\GFARM_APP.zip') + '"';
  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Arguments, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or
    (ResultCode <> 0) then
    RaiseException('Falha na instalação GFARM. Código: ' + IntToStr(ResultCode) +
      '. Veja o registro em C:\ProgramData\GFARM\instalacao.log.');

  WizardForm.StatusLabel.Caption := 'GFARM instalado — abra o Control para conectar ao PostgreSQL.';
end;
