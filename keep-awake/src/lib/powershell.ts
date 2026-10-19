import { spawn } from "node:child_process";
import os from "node:os";

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
