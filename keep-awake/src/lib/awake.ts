import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runPowerShell, terminalEnv } from "./powershell";

export interface AwakeState {
  token: string;
  startedAt: number;
  /** Unix ms; 0 = indefinitely */
  until: number;
  teams: boolean;
  display: boolean;
}

// The state file is the only link to the background helper: it keeps running while the file exists and
// holds its token, and touches the file every 5 seconds as a heartbeat. Stopping = deleting the file.
const stateFile = () => path.join(environment.supportPath, "keep-awake.json");

// Windows: hold an execution state (no sleep, optionally display on) and press F15 after 60 s idle.
const WINDOWS_HELPER = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Awake {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static uint IdleSeconds() {
    var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i);
    if (!GetLastInputInfo(ref i)) return 0;
    return unchecked((uint)Environment.TickCount - i.dwTime) / 1000;
  }
  public static void TapF15() { keybd_event(0x7E, 0, 0, UIntPtr.Zero); keybd_event(0x7E, 0, 2, UIntPtr.Zero); }
}
"@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED (| ES_DISPLAY_REQUIRED)
$flags = if ($env:KA_DISPLAY -eq '1') { [uint32]2147483651 } else { [uint32]2147483649 }
$until = [int64]$env:KA_UNTIL
$file = $env:KA_STATE
while ($true) {
  try {
    if (-not (Test-Path -LiteralPath $file)) { break }
    $state = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($state.token -ne $env:KA_TOKEN) { break }
    if ($until -gt 0 -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $until) { break }
    [void][Awake]::SetThreadExecutionState($flags)
    if ($env:KA_TEAMS -eq '1' -and [Awake]::IdleSeconds() -ge 60) { [Awake]::TapF15() }
    (Get-Item -LiteralPath $file).LastWriteTime = Get-Date
  } catch {}
  Start-Sleep -Seconds 5
}
[void][Awake]::SetThreadExecutionState([uint32]2147483648)
`;

// Starts the helper as a separate hidden process (a detached powershell.exe without console exits at once).
const WINDOWS_LAUNCHER = `
try {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([Console]::In.ReadToEnd()))
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
  'OK'
} catch { 'ERROR: ' + $_.Exception.Message }
`;

// macOS: caffeinate lives as long as this shell; key code 113 = F15 via System Events.
const MAC_HELPER = `
caffeinate -i $([ "$KA_DISPLAY" = 1 ] && echo -d) -w $$ &
while :; do
  [ -f "$KA_STATE" ] || break
  grep -q "\\"token\\":\\"$KA_TOKEN\\"" "$KA_STATE" || break
  now=$(( $(date +%s) * 1000 ))
  [ "$KA_UNTIL" -gt 0 ] && [ "$now" -ge "$KA_UNTIL" ] && break
  if [ "$KA_TEAMS" = 1 ]; then
    idle=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
    [ "\${idle:-0}" -ge 60 ] && osascript -e 'tell application "System Events" to key code 113' >/dev/null 2>&1
  fi
  touch "$KA_STATE"
  sleep 5
done
`;

/** Current state, or undefined if Keep Awake is off, expired or its helper is no longer running. */
export function getState(): AwakeState | undefined {
  let state: AwakeState;
  let touched: number;
  try {
    state = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as AwakeState;
    touched = fs.statSync(stateFile()).mtimeMs;
  } catch {
    return undefined;
  }
  if (state.until > 0 && Date.now() >= state.until) {
    fs.rmSync(stateFile(), { force: true });
    return undefined;
  }
  // no heartbeat for 30 s (startup grace included): helper died
  if (Date.now() - Math.max(touched, state.startedAt) > 30_000) return undefined;
  return state;
}

function writeState(state: AwakeState) {
  fs.mkdirSync(environment.supportPath, { recursive: true });
  const tmp = `${stateFile()}.${state.token}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, stateFile());
}

/** Starts Keep Awake (replaces a running one). minutes = 0: indefinitely. */
export async function start(minutes: number, teams?: boolean): Promise<AwakeState> {
  const prefs = getPreferenceValues<Preferences>();
  const state: AwakeState = {
    token: crypto.randomUUID(),
    startedAt: Date.now(),
    until: minutes > 0 ? Date.now() + minutes * 60_000 : 0,
    teams: teams ?? prefs.teamsPresence !== false,
    display: prefs.keepDisplayOn !== false,
  };
  writeState(state); // the old helper (other token) exits on its next check
  const env = {
    KA_STATE: stateFile(),
    KA_TOKEN: state.token,
    KA_UNTIL: String(state.until),
    KA_TEAMS: state.teams ? "1" : "0",
    KA_DISPLAY: state.display ? "1" : "0",
  };
  try {
    if (process.platform === "win32") {
      await runPowerShell(WINDOWS_LAUNCHER, WINDOWS_HELPER, env);
    } else {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("/bin/sh", ["-c", MAC_HELPER], {
          detached: true,
          stdio: "ignore",
          env: { ...terminalEnv(), ...env },
        });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    }
  } catch (e) {
    fs.rmSync(stateFile(), { force: true });
    throw e;
  }
  return state;
}

/** Stops Keep Awake; the helper exits within 5 seconds and releases the power request. */
export function stop() {
  fs.rmSync(stateFile(), { force: true });
}

export function formatUntil(state: AwakeState): string {
  if (!state.until) return "indefinitely";
  const until = new Date(state.until);
  const time = until.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return until.toDateString() === new Date().toDateString()
    ? `until ${time}`
    : `until ${until.toLocaleDateString("de-DE", { weekday: "short" })} ${time}`;
}
