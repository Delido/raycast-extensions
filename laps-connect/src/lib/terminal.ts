import { getPreferenceValues } from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Only allow characters that are safe to pass through to terminals and shells. */
export function safeArg(value: string): string {
  if (!/^[\w.@:%+=,/~\\-]+$/.test(value)) throw new Error(`Unsupported characters in "${value}"`);
  return value;
}

const RAYCAST_VARS =
  /^(ASSETS_PATH|SUPPORT_PATH|COMMAND_NAME|EXTENSION_NAME|FAVICON_PROVIDER|RAYCAST.*|NODE_ENV|NODE_PATH|NODE_COMPILE_CACHE|ELECTRON_RUN_AS_NODE|LC_ALL|TZ|TMPDIR)$/i;

/**
 * Raycast for Windows starts commands with a stripped environment (no ProgramData, APPDATA, …);
 * Win32-OpenSSH exits silently with code 255 without ProgramData. Rebuild the standard variables.
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
  set("ProgramFiles(x86)", `${drive}\\Program Files (x86)`);
  set("TMP", env.TEMP || os.tmpdir());
  set("OS", "Windows_NT");
  set("COMPUTERNAME", os.hostname().toUpperCase());
  set("PROCESSOR_ARCHITECTURE", process.arch === "arm64" ? "ARM64" : "AMD64");
  set("windir", env.SystemRoot || env.SYSTEMROOT || `${drive}\\WINDOWS`);
  return env;
}

export function detached(file: string, args: string[]) {
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

/**
 * Runs a PowerShell script hidden and waits for it; `input` is passed via stdin (never on the command line).
 * Not detached on purpose: a detached powershell.exe has no console on Windows and exits immediately.
 * Resolves with stdout; rejects with the error output if the script fails.
 */
export function runPowerShell(
  script: string,
  input: string,
  extraEnv: Record<string, string> = {},
  timeoutMs = 30_000,
) {
  return new Promise<string>((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...terminalEnv(), ...extraEnv } },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PowerShell helper timed out"));
    }, timeoutMs);
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const errors = err.replace(/#< CLIXML[\s\S]*?<\/Objs>/g, "").trim();
      if (code === 0 && !/^ERROR:/m.test(out)) resolve(out.trim());
      else reject(new Error((out.match(/^ERROR: (.*)$/m)?.[1] ?? errors) || `PowerShell exited with ${code}`));
    });
    child.stdin!.end(input, "utf8");
  });
}

const WT_PACKAGES: Record<string, string> = { wtpreview: "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe" };

function windowsTerminalExe(choice: string): string {
  const pkg = WT_PACKAGES[choice];
  if (!pkg) return "wt.exe";
  const exe = path.join(terminalEnv().LOCALAPPDATA!, "Microsoft", "WindowsApps", pkg, "wt.exe");
  try {
    fs.lstatSync(exe); // app execution alias: stat fails with EACCES, lstat works
  } catch {
    throw new Error("Windows Terminal Preview is not installed");
  }
  return exe;
}

const FOCUS_SCRIPT = `
$t = $env:FOCUS_TITLE
$ws = New-Object -ComObject WScript.Shell
for ($i = 0; $i -lt 40; $i++) { if ($ws.AppActivate($t)) { exit 0 }; Start-Sleep -Milliseconds 100 }
`;

/** Opens a command (e.g. ssh …) in a new terminal tab with a fixed title and brings it to the front. */
export async function openInTerminal(title: string, command: string[]) {
  const { terminal } = getPreferenceValues<Preferences>();
  command.forEach(safeArg);
  if (process.platform === "darwin") {
    await new Promise<void>((resolve, reject) =>
      execFile(
        "osascript",
        [
          "-e",
          'on run argv\ntell application "Terminal"\nactivate\ndo script (item 1 of argv)\nend tell\nend run',
          command.join(" "),
        ],
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    return;
  }
  if (terminal === "powershell") {
    await detached("cmd.exe", ["/c", "start", "", "powershell.exe", "-NoExit", "-Command", ...command]);
    return;
  }
  await detached(windowsTerminalExe(terminal ?? "wt"), [
    "-w",
    "0",
    "new-tab",
    "--title",
    title,
    "--suppressApplicationTitle",
    ...command,
  ]);
  void runPowerShell(FOCUS_SCRIPT, "", { FOCUS_TITLE: title }).catch(() => undefined);
}

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

export async function waitForPort(port: number, timeoutMs = 120_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** A free local TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
