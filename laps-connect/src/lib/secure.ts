import { Clipboard, getPreferenceValues } from "@raycast/api";
import { runPowerShell } from "./terminal";

// Puts the secret (read from stdin) on the clipboard, excluded from the Windows clipboard history
// and cloud clipboard, verifies it, then starts a separate hidden cleanup process that clears the
// clipboard after N seconds if it still holds the secret. The cleanup process only gets the
// SHA-256 of the secret, never the secret itself.
const CLIPBOARD_SCRIPT = `
try {
  $secret = [Console]::In.ReadToEnd()
  Add-Type -AssemblyName System.Windows.Forms
  $zero = [byte[]](0,0,0,0)
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetText($secret)
  $data.SetData('ExcludeClipboardContentFromMonitorProcessing', (New-Object System.IO.MemoryStream (,$zero)))
  $data.SetData('CanIncludeInClipboardHistory', (New-Object System.IO.MemoryStream (,$zero)))
  $data.SetData('CanUploadToCloudClipboard', (New-Object System.IO.MemoryStream (,$zero)))
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  if ([System.Windows.Forms.Clipboard]::GetText() -ne $secret) { throw 'clipboard could not be set' }

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($secret))) -replace '-', ''
  # absolute deadline, so the startup time of the cleanup process does not add to the delay
  $until = (Get-Date).ToUniversalTime().AddSeconds([int]$env:CLEAR_AFTER).Ticks
  $cleanup = @"
Add-Type -AssemblyName System.Windows.Forms
while ((Get-Date).ToUniversalTime().Ticks -lt $until) { Start-Sleep -Milliseconds 500 }
\`$t = [System.Windows.Forms.Clipboard]::GetText()
\`$h = [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes(\`$t))) -replace '-', ''
if (\`$h -eq '$hash') { [System.Windows.Forms.Clipboard]::Clear() }
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanup))
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -NonInteractive -STA -EncodedCommand $encoded"
  'OK'
} catch { 'ERROR: ' + $_.Exception.Message }
`;

/** Copies a secret to the clipboard without history and clears it automatically. */
export async function copySecret(secret: string) {
  const { clipboardSeconds } = getPreferenceValues<Preferences>();
  const seconds = Number(clipboardSeconds || "30");
  if (process.platform === "win32") {
    await runPowerShell(CLIPBOARD_SCRIPT, secret, { CLEAR_AFTER: String(seconds) });
    return seconds;
  }
  await Clipboard.copy(secret, { concealed: true });
  setTimeout(async () => {
    if ((await Clipboard.readText()) === secret) await Clipboard.clear();
  }, seconds * 1000);
  return seconds;
}

// Stores RDP credentials for TERMSRV/<host> via CredWrite (no password on any command line),
// starts mstsc and lets a separate hidden process delete the credential after 20 seconds.
// Input (stdin) is JSON.
const RDP_SCRIPT = `
try {
  $in = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Cred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWrite(ref CREDENTIAL c, int flags);
  public static void Write(string target, string user, string secret) {
    var c = new CREDENTIAL { Type = 1, TargetName = target, UserName = user, Persist = 1,
      CredentialBlobSize = secret.Length * 2, CredentialBlob = Marshal.StringToCoTaskMemUni(secret) };
    try { if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(); }
    finally { Marshal.ZeroFreeCoTaskMemUnicode(c.CredentialBlob); }
  }
}
"@
  $target = 'TERMSRV/' + $in.host
  [Cred]::Write($target, $in.user, $in.secret)
  Start-Process mstsc.exe -ArgumentList "/v:$($in.address)"
  $cleanup = "Start-Sleep -Seconds 20; cmdkey /delete:$target | Out-Null"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanup))
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -NonInteractive -EncodedCommand $encoded"
  'OK'
} catch { 'ERROR: ' + $_.Exception.Message }
`;

/** Starts a Remote Desktop session with temporarily stored credentials (Windows only). */
export async function startRdp(address: string, user: string, secret: string) {
  if (process.platform !== "win32") throw new Error("RDP with stored credentials is only supported on Windows");
  const host = address.replace(/:\d+$/, "");
  await runPowerShell(RDP_SCRIPT, JSON.stringify({ address, host, user, secret }));
}
