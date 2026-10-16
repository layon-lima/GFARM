; GFARM - Instalador Windows em 3 etapas.
; Instalador leve: baixa os arquivos do GFARM diretamente do GitHub privado.
#define AppName "GFARM"
#define AppVersion "2.1.0"

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
CloseApplications=no
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalhos dos dois aplicativos na área de trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce

[Dirs]
Name: "{commonappdata}\GFARM"

[Files]
; Extrair o preflight antes dos EXEs para minimizar tempo com solid compression.
Source: "preinstall_guard.ps1"; Flags: dontcopy
Source: "build\GFARM.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM-Control.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\GFARM-Control.ico"; DestDir: "{app}"; Flags: ignoreversion
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
  ModePage: TWizardPage;
  RepairOption: TNewRadioButton;
  ReinstallOption: TNewRadioButton;
  PasswordPage: TInputQueryWizardPage;
  Stage3: TWizardPage;

function PasswordNeeded(): Boolean;
begin
  Result := not FileExists(ExpandConstant('{commonappdata}\GFARM\control-auth.json'));
end;

function PreviousInstallation(): Boolean;
begin
  Result := FileExists(ExpandConstant('{commonappdata}\GFARM\control.json')) or
    FileExists(ExpandConstant('{app}\GFARM-Control.exe'));
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = PasswordPage.ID) and not PasswordNeeded();
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Parameters: String;
  ExitCode: Integer;
  Details: AnsiString;
  Report: String;
begin
  Result := '';
  ExtractTemporaryFile('preinstall_guard.ps1');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\preinstall_guard.ps1') + '" -InstallDir "' +
    ExpandConstant('{app}') + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Parameters, '', SW_SHOWNORMAL, ewWaitUntilTerminated, ExitCode) then
    Result := 'Nao foi possivel iniciar a preparacao do instalador.'
  else if ExitCode <> 0 then
  begin
    Report := ExpandConstant('{commonappdata}\GFARM\preinstall-last-error.txt');
    if LoadStringFromFile(Report, Details) and (Trim(Details) <> '') then
      Result := 'INSTALACAO INTERROMPIDA PARA PROTEGER OS DADOS:' + #13#10 + #13#10 +
        Copy(Trim(Details), 1, 700)
    else
      Result := 'Falha na preparacao do GFARM. Consulte o arquivo:' + #13#10 +
        ExpandConstant('{commonappdata}\GFARM\preinstall.log');
  end;
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
    'O GFARM será baixado do GitHub privado durante a instalação; poderá pedir autenticação.' + #13#10 +
    'Os arquivos operacionais ficam em ProgramData\GFARM.' + #13#10#13#10 +
    'O instalador pode reparar ou reinstalar os programas, mas NUNCA apaga PostgreSQL, fotos, XMLs, senhas ou backups.';

  ModePage := CreateCustomPage(Stage1.ID, 'MODO DE INSTALACAO',
    'Escolha como tratar uma instalacao GFARM existente.');
  RepairOption := TNewRadioButton.Create(ModePage);
  RepairOption.Parent := ModePage.Surface;
  RepairOption.Left := 0;
  RepairOption.Top := 8;
  RepairOption.Width := ModePage.SurfaceWidth;
  RepairOption.Height := 22;
  RepairOption.Caption := 'REPARAR / INSTALAR POR CIMA';
  RepairOption.Checked := True;
  Txt := TNewStaticText.Create(ModePage);
  Txt.Parent := ModePage.Surface;
  Txt.Left := 22;
  Txt.Top := 33;
  Txt.Width := ModePage.SurfaceWidth - 25;
  Txt.Height := 42;
  Txt.WordWrap := True;
  Txt.Caption := 'Mantem o codigo instalado. Repara os iniciadores e dependencias; preserva banco, fotos, backups e senha.';
  ReinstallOption := TNewRadioButton.Create(ModePage);
  ReinstallOption.Parent := ModePage.Surface;
  ReinstallOption.Left := 0;
  ReinstallOption.Top := 91;
  ReinstallOption.Width := ModePage.SurfaceWidth;
  ReinstallOption.Height := 22;
  ReinstallOption.Caption := 'REINSTALAR OS PROGRAMAS';
  ReinstallOption.Enabled := PreviousInstallation();
  Txt := TNewStaticText.Create(ModePage);
  Txt.Parent := ModePage.Surface;
  Txt.Left := 22;
  Txt.Top := 116;
  Txt.Width := ModePage.SurfaceWidth - 25;
  Txt.Height := 62;
  Txt.WordWrap := True;
  Txt.Caption := 'Baixa os programas atuais em pasta nova. Preserva o banco PostgreSQL, imagens, XMLs, backups, configuracoes e senha.';

  PasswordPage := CreateInputQueryPage(ModePage.ID, '2/3 — GFARM CONTROL',
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
  P, Arguments, InstallMode: String;
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
  InstallMode := 'Repair';
  if ReinstallOption.Checked and ReinstallOption.Enabled then
    InstallMode := 'Reinstall';
  Arguments := '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\install_windows.ps1') + '" -InstallDir "' +
    ExpandConstant('{app}') + '" -Mode ' + InstallMode;
  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Arguments, '', SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode)) or
    (ResultCode <> 0) then
    RaiseException('Falha na instalação GFARM. Código: ' + IntToStr(ResultCode) +
      '. Confira o log GFARM-Instalacao.log na pasta Documentos Publicos do Windows.');

  WizardForm.StatusLabel.Caption := 'GFARM instalado — abra o Control para conectar ao PostgreSQL.';
end;
