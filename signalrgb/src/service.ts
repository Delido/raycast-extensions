import { environment, getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/*
 * Control of assets/signal-helper.exe (source in helper/), the background helper that
 * replaces SignalCompanion: mic mute mirror, battery alert, keyboard game mode,
 * CS2 Game State Integration and the audio router on port 3010.
 */

export const SERVICE_URL = "http://127.0.0.1:3010";

export interface HeadsetStatus {
  name: string;
  present: boolean;
  listening: boolean;
  hardwareMuted: boolean | null;
  battery: number | null;
  batteryAt?: string;
  batteryLow: boolean;
  lastAlertAt?: string;
  alertCount: number;
  windowsMuted: boolean | null;
  micName?: string;
  lastMuteChange?: string;
  lastMuteSource?: string;
}

export interface KeyboardStatus {
  name: string;
  present: boolean;
  gameMode: boolean | null;
  gameActive: boolean;
  game?: string;
  reportedAt?: string;
  lastError?: string;
}

export interface CS2State {
  connected: boolean;
  health?: number | null;
  armor?: number | null;
  team?: string | null;
  round?: number | null;
  round_phase?: string | null;
  map_phase?: string | null;
  weapon?: string | null;
  kills?: number | null;
  deaths?: number | null;
  bomb?: string | null;
}

export interface CS2Status {
  enabled: boolean;
  gameRunning: boolean;
  listening: boolean;
  httpsRunning: boolean;
  port: number;
  httpsPort: number;
  error?: string;
  caTrusted: string[] | null;
  caPatchedNow: boolean;
  posts: number;
  lastPostAt?: string;
  state: CS2State;
}

export interface TeamSpeakStatus {
  enabled: boolean;
  /** offline = TeamSpeak not running, approval = waiting for "Allow" in TeamSpeak, connected */
  state: "offline" | "approval" | "connected";
  servers: number;
  inputMuted: boolean | null;
  nickname?: string;
  lastError?: string;
  /** null = unknown, false = a key press didn't change TeamSpeak's mute */
  keyBound: boolean | null;
  /** why keyBound is false: the press did nothing, or TeamSpeak switched back on key release */
  keyProblem?: "no-effect" | "switches-back";
  lastPressAt?: string;
}

export interface ServiceStatus {
  version: string;
  pid: number;
  started: string;
  headset: HeadsetStatus;
  keyboard: KeyboardStatus;
  cs2: CS2Status;
  teamspeak?: TeamSpeakStatus;
}

const helperExe = () => join(environment.assetsPath, "signal-helper.exe");
export const serviceDataDir = () => join(environment.supportPath, "helper");
const configPath = () => join(environment.supportPath, "helper-config.json");

async function call<T>(path: string, init?: RequestInit, timeoutMs = 2500): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!response.ok || json.ok === false) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json;
}

export async function getServiceStatus(): Promise<ServiceStatus | undefined> {
  try {
    return await call<ServiceStatus>("/api/status", undefined, 1500);
  } catch {
    return undefined;
  }
}

/** Writes the helper config from the "Companion Service" preferences; the helper picks up changes within 3 s. */
export async function writeServiceConfig(prefs: Preferences.CompanionService) {
  const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : d);
  const config = {
    mic: {
      enabled: true,
      hardwareToWindows: prefs.micHardwareToWindows,
      windowsToHardware: prefs.micWindowsToHardware,
    },
    battery: {
      enabled: prefs.batteryAlert,
      threshold: num(prefs.batteryThreshold, 20),
      reAlertMinutes: num(prefs.batteryReAlert, 30),
      confirmSamples: 2,
      pollSeconds: 60,
      soundPath: join(environment.assetsPath, "battery_low.wav"),
    },
    gameMode: { enabled: prefs.gameMode },
    cs2: { enabled: prefs.cs2, port: 3000, httpsPort: 3443, token: "signalcompanion" },
    audio: { rotation: [] as string[] },
    teamspeak: { enabled: prefs.teamspeak, followTeamSpeak: prefs.teamspeakFollow },
  };
  const text = JSON.stringify(config, null, 2);
  await mkdir(environment.supportPath, { recursive: true });
  const current = await readFile(configPath(), "utf8").catch(() => "");
  if (current !== text) await writeFile(configPath(), text);
}

/** Starts the helper detached (it keeps running after Raycast's command ends). */
export async function startService(): Promise<void> {
  if (!existsSync(configPath())) await writeServiceConfig(getPreferenceValues<Preferences.CompanionService>());
  await mkdir(serviceDataDir(), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    execFile(
      helperExe(),
      ["launch", "-config", configPath(), "-data", serviceDataDir()],
      { windowsHide: true, timeout: 10000 },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const json = JSON.parse(stdout) as { ok: boolean; error?: string };
          if (!json.ok) return reject(new Error(json.error));
        } catch {
          // ignore
        }
        resolve();
      },
    );
  });
  // Wait until the API answers (or the port is taken by something else).
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await getServiceStatus()) return;
  }
  throw new Error("The helper did not start. Is SignalCompanion still running (port 3010)?");
}

export async function stopService() {
  await call("/api/quit", { method: "POST" });
}

export async function restartService() {
  await stopService().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 800));
  await startService();
}

export async function setMicMute(muted: boolean | "toggle") {
  const value = muted === "toggle" ? "toggle" : muted ? "1" : "0";
  return (await call<{ mic: { muted: boolean; name: string } }>(`/api/mic?muted=${value}`, { method: "POST" })).mic;
}

export async function readBatteryNow() {
  return (await call<{ battery: number }>("/api/battery", { method: "POST" }, 5000)).battery;
}

/** Sends TeamSpeak's remote mute key after `delay` seconds (to record it in TeamSpeak's key bindings). */
export async function pressTeamSpeakKey(delay = 0) {
  await call(`/api/teamspeak/press?delay=${delay}`, { method: "POST" });
}

/** Presses the key once; the result shows up as teamspeak.keyBound in the status. */
export async function testTeamSpeakKey() {
  await call("/api/teamspeak/test", { method: "POST" });
}

export async function testSound() {
  await call("/api/test-sound", { method: "POST" });
}

export async function getServiceLog(lines = 300): Promise<string[]> {
  return (await call<{ lines: string[] }>(`/api/log?lines=${lines}`)).lines;
}

/* ---------- CS2 setup (same files as SignalCompanion, so existing installs keep working) ---------- */

const CFG_NAME = "gamestate_integration_signalcompanion.cfg";

function regQuery(key: string, value: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("reg.exe", ["query", key, "/v", value], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(undefined);
      const match = stdout.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
      resolve(match?.[1].trim());
    });
  });
}

export async function locateCs2CfgDir(): Promise<string | undefined> {
  const steam =
    (await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath")) ??
    (await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"));
  if (!steam) return undefined;
  const roots = [steam];
  const vdf = await readFile(join(steam, "steamapps", "libraryfolders.vdf"), "utf8").catch(() => "");
  for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) roots.push(match[1].replace(/\\\\/g, "\\"));
  for (const root of roots) {
    const dir = join(root, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg");
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

export async function cs2CfgInstalled(): Promise<string | undefined> {
  const dir = await locateCs2CfgDir();
  return dir && existsSync(join(dir, CFG_NAME)) ? join(dir, CFG_NAME) : undefined;
}

export async function installCs2Cfg(port: number, token: string): Promise<string> {
  const dir = await locateCs2CfgDir();
  if (!dir) throw new Error("CS2 cfg folder not found (is CS2 installed via Steam?)");
  const content = [
    '"SignalCompanion CS2 Integration v1.2"',
    "{",
    `    "uri"       "http://127.0.0.1:${port}"`,
    '    "timeout"   "5.0"',
    '    "buffer"    "0.0"',
    '    "throttle"  "0.1"',
    '    "heartbeat" "10.0"',
    '    "auth"',
    "    {",
    `        "token" "${token}"`,
    "    }",
    '    "data"',
    "    {",
    '        "provider"            "1"',
    '        "map"                 "1"',
    '        "round"               "1"',
    '        "player_id"           "1"',
    '        "player_state"        "1"',
    '        "player_weapons"      "1"',
    '        "player_match_stats"  "1"',
    '        "bomb"                "1"',
    '        "phase_countdowns"    "1"',
    "    }",
    "}",
    "",
  ].join("\n");
  const path = join(dir, CFG_NAME);
  await writeFile(path, content, "utf8");
  return path;
}

export async function uninstallCs2Cfg() {
  const path = await cs2CfgInstalled();
  if (path) await rm(path);
}

async function effectsDir(): Promise<string> {
  const documents =
    (await regQuery("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders", "Personal")) ??
    join(process.env.USERPROFILE ?? "", "Documents");
  return join(documents, "WhirlwindFX", "Effects");
}

export async function effectInstalled(): Promise<boolean> {
  return existsSync(join(await effectsDir(), "cs2_reactive.html"));
}

export async function installEffect(): Promise<string> {
  const dir = await effectsDir();
  await mkdir(dir, { recursive: true });
  const source = join(environment.assetsPath, "cs2-effect");
  // SignalRGB only activates effects with CRLF line endings.
  const html = (await readFile(join(source, "cs2_reactive.html"), "utf8")).replace(/\r?\n/g, "\r\n");
  await writeFile(join(dir, "cs2_reactive.html"), html, "utf8");
  await copyFile(join(source, "cs2_reactive.png"), join(dir, "cs2_reactive.png"));
  return join(dir, "cs2_reactive.html");
}
