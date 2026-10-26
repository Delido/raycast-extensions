import { closeMainWindow, launchCommand, LaunchType } from "@raycast/api";
import { execShellNoStream } from "#root/src/api/shell.js";
import { getAssetsPath } from "./helpers/extension_helper.js";
import { execFile } from "child_process";
import { promisify } from "util";

// Captures all monitors with .NET, since Windows has no screencapture CLI.
// SetProcessDPIAware keeps the capture at full resolution on scaled displays.
const captureScreenWindows = async (path) => {
  const script = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Name U -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[W.U]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save('${path.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()`;
  await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
};

// Note how this command is a very special case: it is a "no-view" type command,
// which means it does not return any UI view, and instead calls askAI to handle the rendering.
// This is because the function is async, and async functions are only permitted in no-view commands.
export default async function AskAboutScreenContent(props) {
  await closeMainWindow();
  const path = `${getAssetsPath()}/screenshot.png`;
  if (process.platform === "win32") {
    await captureScreenWindows(path);
  } else {
    await execShellNoStream(`/usr/sbin/screencapture "${path}"`);
  }

  await launchCommand({
    name: "askAI",
    type: LaunchType.UserInitiated,
    context: {
      props: props,
      params: {
        commandId: "askAboutScreenContent",
        allowPaste: true,
        requireQuery: true,
        showFormText: "Query",
        defaultFiles: [path],
      },
    },
  });
}
