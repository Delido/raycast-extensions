import { environment, getPreferenceValues, LocalStorage } from "@raycast/api";
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Only allow characters that are safe to pass through to terminals and shells. */
export function safeArg(value: string): string {
  if (!/^[\w.@:%+=,/~-]+$/.test(value)) throw new Error(`Unsupported characters in "${value}"`);
  return value;
}

export function sshArgs(alias: string, user?: string): string[] {
  return [...(user ? ["-l", safeArg(user)] : []), safeArg(alias)];
}

export function sshCommand(alias: string, user?: string): string {
  return ["ssh", ...sshArgs(alias, user)].join(" ");
}

// Variables Raycast sets for its own Node runtime – they must not leak into terminal sessions.
const RAYCAST_VARS =
  /^(ASSETS_PATH|SUPPORT_PATH|COMMAND_NAME|EXTENSION_NAME|FAVICON_PROVIDER|RAYCAST.*|NODE_ENV|NODE_PATH|NODE_COMPILE_CACHE|ELECTRON_RUN_AS_NODE|LC_ALL|TZ|TMPDIR)$/i;

/**
 * Raycast for Windows starts commands with a stripped environment (no ProgramData, APPDATA, …).
 * Windows Terminal passes that environment on to the new tab, and Win32-OpenSSH exits silently
 * with code 255 when ProgramData is missing. Rebuild the standard Windows variables.
 */
export function terminalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!RAYCAST_VARS.test(key)) env[key] = value;
  if (process.platform !== "win32") return env;

  const has = (key: string) => Object.keys(env).some((k) => k.toLowerCase() === key.toLowerCase());
  const set = (key: string, value: string) => {
    if (!has(key)) env[key] = value;
  };
  const drive = env.SystemDrive || env.SYSTEMDRIVE || "C:";
  const profile = env.USERPROFILE || os.homedir();
  set("ProgramData", `${drive}\\ProgramData`);
  set("ALLUSERSPROFILE", `${drive}\\ProgramData`);
  set("APPDATA", `${profile}\\AppData\\Roaming`);
  set("LOCALAPPDATA", `${profile}\\AppData\\Local`);
  set("ProgramFiles", `${drive}\\Program Files`);
  set("ProgramW6432", `${drive}\\Program Files`);
  set("ProgramFiles(x86)", `${drive}\\Program Files (x86)`);
  set("CommonProgramFiles", `${drive}\\Program Files\\Common Files`);
  set("CommonProgramW6432", `${drive}\\Program Files\\Common Files`);
  set("CommonProgramFiles(x86)", `${drive}\\Program Files (x86)\\Common Files`);
  set("PUBLIC", `${drive}\\Users\\Public`);
  set("TMP", env.TEMP || os.tmpdir());
  set("OS", "Windows_NT");
  set("COMPUTERNAME", os.hostname().toUpperCase());
  set("PROCESSOR_ARCHITECTURE", process.arch === "arm64" ? "ARM64" : "AMD64");
  set("NUMBER_OF_PROCESSORS", String(os.cpus().length));
  set("windir", env.SystemRoot || env.SYSTEMROOT || `${drive}\\WINDOWS`);
  return env;
}

function detached(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: terminalEnv(),
      cwd: os.homedir(),
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function osascript(script: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile("osascript", ["-e", script, ...args], (error) => (error ? reject(error) : resolve()));
  });
}

const WT_PACKAGES: Record<string, string> = {
  wtpreview: "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe",
  wtcanary: "Microsoft.WindowsTerminalCanary_8wekyb3d8bbwe",
};

/**
 * Every Windows Terminal flavour installs its own wt.exe alias in its package folder;
 * the global "wt.exe" points to whichever one is enabled under "App execution aliases".
 */
function windowsTerminalExe(choice: string): string {
  const pkg = WT_PACKAGES[choice];
  if (!pkg) return "wt.exe";
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const exe = path.join(localAppData, "Microsoft", "WindowsApps", pkg, "wt.exe");
  // App execution aliases are reparse points: existsSync/stat fail with EACCES, lstat works.
  try {
    fs.lstatSync(exe);
  } catch {
    throw new Error(
      `${choice === "wtpreview" ? "Windows Terminal Preview" : "Windows Terminal Canary"} is not installed`,
    );
  }
  return exe;
}

// Windows' focus-stealing protection keeps the (already running) Windows Terminal in the background
// when a background process adds a tab. AppActivate by window title (= host name, thanks to
// --suppressApplicationTitle) brings it to the front; the ALT-key trick is the fallback.
const FOCUS_SCRIPT = `
$t = $env:FOCUS_TITLE
$ws = New-Object -ComObject WScript.Shell
for ($i = 0; $i -lt 40; $i++) {
  if ($ws.AppActivate($t)) { exit 0 }
  Start-Sleep -Milliseconds 100
}
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);
}
"@
$p = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}
`;

/**
 * Brings the terminal window with the given title to the foreground (Windows only, fire and forget).
 * Not detached: a detached powershell.exe has no console on Windows and exits immediately.
 */
function focusWindow(title: string) {
  if (process.platform !== "win32") return;
  const encoded = Buffer.from(FOCUS_SCRIPT, "utf16le").toString("base64");
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    stdio: "ignore",
    windowsHide: true,
    env: { ...terminalEnv(), FOCUS_TITLE: title },
  })
    .on("error", () => undefined)
    .unref();
}

/** Opens an SSH session in the configured terminal. */
export async function openSession(alias: string, options: { user?: string; newWindow?: boolean } = {}) {
  const { terminal, wtProfile } = getPreferenceValues<Preferences>();
  const args = sshArgs(alias, options.user);
  const title = options.user ? `${options.user}@${alias}` : alias;
  const choice = terminal === "auto" || !terminal ? (process.platform === "darwin" ? "terminal" : "wt") : terminal;

  if (process.platform === "win32") {
    if (choice === "powershell") {
      await detached("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit", "-Command", "ssh", ...args]);
    } else if (choice === "cmd") {
      await detached("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", "ssh", ...args]);
    } else {
      // --suppressApplicationTitle keeps the host name; remote shells would otherwise set "user@host: ~"
      const wtArgs = ["-w", options.newWindow ? "new" : "0", "new-tab", "--title", title, "--suppressApplicationTitle"];
      if (wtProfile?.trim()) wtArgs.push("--profile", wtProfile.trim());
      const exe = windowsTerminalExe(choice); // throws if an explicitly chosen flavour is missing
      try {
        await detached(exe, [...wtArgs, "ssh", ...args]);
        focusWindow(title);
      } catch {
        // Windows Terminal not installed → plain console window
        await detached("cmd.exe", ["/c", "start", "", "ssh", ...args]);
      }
    }
  } else if (process.platform === "darwin") {
    const command = ["ssh", ...args].join(" ");
    if (choice === "iterm") {
      await osascript(
        `on run argv
          tell application "iTerm"
            activate
            if ${options.newWindow ? "true" : "(count of windows) = 0"} then
              create window with default profile command (item 1 of argv)
            else
              tell current window to create tab with default profile command (item 1 of argv)
            end if
          end tell
        end run`,
        [command],
      );
    } else {
      await osascript(
        `on run argv
          tell application "Terminal"
            activate
            do script (item 1 of argv)
          end tell
        end run`,
        [command],
      );
    }
  } else {
    await detached("x-terminal-emulator", ["-e", "ssh", ...args]);
  }
  await recordUsage(alias);
}

/** Opens VS Code Remote-SSH on the host (needs the "code" CLI in PATH). */
export async function openInVSCode(alias: string) {
  const target = `ssh-remote+${safeArg(alias)}`;
  if (process.platform === "win32") await detached("cmd.exe", ["/c", "code", "--remote", target, "/"]);
  else await detached("code", ["--remote", target, "/"]);
  await recordUsage(alias);
}

// ---------- SOCKS tunnels + browser ----------

/** True when something listens on 127.0.0.1:port (i.e. the tunnel is up). */
export function isPortOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Waits until the tunnel port is open (the user may have to type the jump host password first). */
export async function waitForPort(port: number, timeoutMs = 120_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function browserExecutable(): { file: string; name: string } | undefined {
  const { browser } = getPreferenceValues<Preferences>();
  if (process.platform === "darwin") {
    return browser === "edge"
      ? { file: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", name: "Microsoft Edge" }
      : { file: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", name: "Google Chrome" };
  }
  const env = terminalEnv();
  const candidates =
    browser === "chrome"
      ? [
          `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : [
          `${env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ];
  const file = candidates.find((c) => fs.existsSync(c));
  return file ? { file, name: browser === "chrome" ? "Chrome" : "Edge" } : undefined;
}

/**
 * Opens the URL in a separate browser profile that routes everything through the SOCKS tunnel
 * (like RDM's embedded browser). DNS is resolved on the far side, so internal names work.
 */
export async function openBrowserViaTunnel(url: string, port: number) {
  const exe = browserExecutable();
  if (!exe) throw new Error("Browser not found – check the “Tunnel Browser” preference");
  const profile = path.join(environment.supportPath, `browser-profile-${port}`);
  fs.mkdirSync(profile, { recursive: true });
  await detached(exe.file, [
    `--user-data-dir=${profile}`,
    `--proxy-server=socks5://127.0.0.1:${port}`,
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ]);
}

// ---------- recently used ----------

const USAGE_KEY = "usage";
type Usage = Record<string, { count: number; last: number }>;

export async function getUsage(): Promise<Usage> {
  const raw = await LocalStorage.getItem<string>(USAGE_KEY);
  return raw ? (JSON.parse(raw) as Usage) : {};
}

async function recordUsage(alias: string) {
  const usage = await getUsage();
  usage[alias] = { count: (usage[alias]?.count ?? 0) + 1, last: Date.now() };
  await LocalStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

/** Frecency: frequent and recent hosts first. */
export function frecency(entry?: { count: number; last: number }): number {
  if (!entry) return 0;
  const days = (Date.now() - entry.last) / 86_400_000;
  return entry.count / (1 + days / 7);
}
