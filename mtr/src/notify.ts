import { showHUD } from "@raycast/api";
import { execFile } from "node:child_process";

// AppUserModelID of Raycast for Windows, so notifications appear as coming from Raycast.
const WINDOWS_APP_ID = "Raycast.Raycast_qypenmj9wpt2a!Raycast";

const WINDOWS_SCRIPT = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$e = { param($s) [System.Security.SecurityElement]::Escape($s) }
$launch = if ($env:MTR_URL) { " activationType=""protocol"" launch=""$(& $e $env:MTR_URL)""" } else { "" }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast$launch><visual><binding template=""ToastGeneric""><text>$(& $e $env:MTR_TITLE)</text><text>$(& $e $env:MTR_BODY)</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
try { $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:MTR_APPID); $notifier.Show($toast) }
catch { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast) }
`;

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, timeout: 15000, windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

/** Shows a native system notification (Windows toast / macOS notification), falling back to a Raycast HUD. */
export async function notify(title: string, body: string, options: { style: "system" | "hud"; url?: string }) {
  if (options.style === "system") {
    try {
      if (process.platform === "win32") {
        const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
        await run(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
          { MTR_TITLE: title, MTR_BODY: body, MTR_URL: options.url ?? "", MTR_APPID: WINDOWS_APP_ID },
        );
        return;
      }
      if (process.platform === "darwin") {
        await run("osascript", [
          "-e",
          "on run argv",
          "-e",
          'display notification (item 2 of argv) with title (item 1 of argv) sound name "Basso"',
          "-e",
          "end run",
          title,
          body,
        ]);
        return;
      }
    } catch {
      // fall through to HUD
    }
  }
  await showHUD(`${title}: ${body}`);
}
