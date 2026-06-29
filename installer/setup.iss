#define MyAppName "CUTODSAN_FOR_DRG"
#define MyAppVersion "1.5.0"
#define MyAppExeName "CUTODSAN_FOR_DRG.exe"
[Setup]
AppId={{B6F1D1F4-6C2A-4E1E-9F0E-7B2C2B6B9F11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=CUTODSAN_FOR_DRG-Setup-Full
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
ShowLanguageDialog=no

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "redist\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: dontcopy deleteafterinstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\ถอนการติดตั้ง {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "กำลังติดตั้งส่วนประกอบที่จำเป็น (Visual C++ Runtime)..."; Check: VCRedistNeedsInstall; Flags: waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "เปิดโปรแกรม {#MyAppName}"; Flags: nowait postinstall skipifsilent; Check: ShouldLaunchAfterInstall

[Code]
function ShouldLaunchAfterInstall: Boolean;
var
  I: Integer;
  Param: String;
begin
  // กันไม่ให้โปรแกรมเปิดขึ้นเองตอนติดตั้งแบบ silent/unattended
  Result := True;
  for I := 1 to ParamCount do
  begin
    Param := Uppercase(ParamStr(I));
    if (Param = '/SILENT') or (Param = '/VERYSILENT') then
    begin
      Result := False;
      Exit;
    end;
  end;
end;

function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  Result := True;
  if RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Installed', Installed) then
  begin
    if Installed = 1 then
      Result := False;
  end;
end;

procedure KillRunningApp;
var
  ResultCode: Integer;
begin
  // ปิดโปรแกรมที่กำลังรันอยู่ก่อน ไม่ให้ไฟล์ .exe ถูกล็อกตอนเขียนทับ/ถอนการติดตั้ง
  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM "{#MyAppExeName}" /T', '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode);
end;

procedure SilentlyUninstallPrevious;
var
  UninstallString: String;
  ResultCode: Integer;
  RegPath: String;
begin
  RegPath := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B6F1D1F4-6C2A-4E1E-9F0E-7B2C2B6B9F11}_is1';
  UninstallString := '';
  if not RegQueryStringValue(HKCU, RegPath, 'UninstallString', UninstallString) then
    RegQueryStringValue(HKLM, RegPath, 'UninstallString', UninstallString);

  if UninstallString <> '' then
  begin
    KillRunningApp;
    UninstallString := RemoveQuotes(UninstallString);
    Exec(UninstallString, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
  end;
end;

function InitializeSetup: Boolean;
begin
  SilentlyUninstallPrevious;
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  // กันไว้อีกชั้น เผื่อโปรแกรมถูกเปิดขึ้นมาใหม่ระหว่างขั้นตอนติดตั้ง (เช่นจาก Run entry ของเวอร์ชันเดิม)
  KillRunningApp;
  Result := '';
end;
