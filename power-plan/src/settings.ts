import { getPreferenceValues, LocalStorage } from "@raycast/api";
import { BALANCED, HIGH_PERFORMANCE, Plan, POWER_SAVER, Process, Status, ULTIMATE } from "./helper";

export interface Settings {
  enabled: boolean;
  gamePlan?: string;
  idlePlan?: string;
  /** exe names (lower case) that always count as games */
  customGames: string[];
  /** exe names (lower case) that never count as games */
  excluded: string[];
  pausedUntil?: number;
}

const KEY = "settings";

const DEFAULTS: Settings = { enabled: true, customGames: [], excluded: [] };

export async function getSettings(): Promise<Settings> {
  const raw = await LocalStorage.getItem<string>(KEY);
  return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}) };
}

export async function updateSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...changes };
  await LocalStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Game plan: High performance, else Ultimate, else Balanced. */
export function gamePlanOf(settings: Settings, plans: Plan[]): string | undefined {
  const has = (guid?: string) => !!guid && plans.some((p) => p.guid === guid);
  if (has(settings.gamePlan)) return settings.gamePlan;
  return [HIGH_PERFORMANCE, ULTIMATE, BALANCED].find(has);
}

/** Idle plan: Power saver, else Balanced. */
export function idlePlanOf(settings: Settings, plans: Plan[]): string | undefined {
  const has = (guid?: string) => !!guid && plans.some((p) => p.guid === guid);
  if (has(settings.idlePlan)) return settings.idlePlan;
  return [POWER_SAVER, BALANCED].find(has);
}

export function isPaused(settings: Settings): boolean {
  return !!settings.pausedUntil && settings.pausedUntil > Date.now();
}

/* ---------- game detection ---------- */

/** Path fragments of game libraries; matched case-insensitively against the exe path. */
const LIBRARY_PATHS = [
  "\\steamapps\\common\\",
  "\\epic games\\",
  "\\gog galaxy\\games\\",
  "\\gog games\\",
  "\\xboxgames\\",
  "\\riot games\\",
  "\\ubisoft game launcher\\games\\",
  "\\ea games\\",
  "\\origin games\\",
  "\\battle.net\\games\\",
  "\\amazon games\\library\\",
];

/** Launchers, helpers and tools that live in game folders but aren't games. */
const BUILTIN_EXCLUDES = [
  "steam.exe",
  "steamwebhelper.exe",
  "steamservice.exe",
  "steamerrorreporter.exe",
  "steamerrorreporter64.exe",
  "gameoverlayui.exe",
  "gameoverlayui64.exe",
  "epicgameslauncher.exe",
  "epicwebhelper.exe",
  "epiconlineservices*.exe",
  "eosoverlayrenderer*.exe",
  "unrealcefsubprocess.exe",
  "crashreportclient.exe",
  "easyanticheat*.exe",
  "start_protected_game.exe",
  "beservice*.exe",
  "battleye*.exe",
  "riotclientservices.exe",
  "riotclientux*.exe",
  "riotclientcrashhandler.exe",
  "vgtray.exe",
  "galaxyclient*.exe",
  "gogalaxy*.exe",
  "upc.exe",
  "ubisoftconnect.exe",
  "uplaywebcore.exe",
  "eadesktop.exe",
  "eabackgroundservice.exe",
  "battle.net*.exe",
  "agent.exe",
  "amazon games*.exe",
  "wallpaper32.exe",
  "wallpaper64.exe",
  "webwallpaper32.exe",
  "ui32.exe",
  "cefsharp.browsersubprocess.exe",
  "crashpad_handler.exe",
  "unitycrashhandler*.exe",
  "vc_redist*.exe",
  "dxsetup.exe",
];

/** Apps that are often fullscreen but aren't games (only used for fullscreen detection). */
const NOT_GAMES_FULLSCREEN = [
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
  "vivaldi.exe",
  "vlc.exe",
  "mpc-hc*.exe",
  "mpv.exe",
  "potplayer*.exe",
  "explorer.exe",
  "applicationframehost.exe",
  "raycast.exe",
  "code.exe",
  "powerpnt.exe",
  "teams.exe",
  "ms-teams.exe",
  "zoom.exe",
  "jellyfin*.exe",
  "plex*.exe",
  "netflix*.exe",
  "searchhost.exe",
  "lockapp.exe",
  "shellexperiencehost.exe",
  "startmenuexperiencehost.exe",
  "textinputhost.exe",
];

function matches(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((pattern) => {
    if (!pattern.includes("*")) return pattern === lower;
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(lower);
  });
}

export type Reason = "library" | "custom" | "fullscreen";

export interface Detection {
  process: Process;
  reason: Reason;
  detail: string;
}

export function extraLibraries(): string[] {
  const { extraLibraries } = getPreferenceValues<Preferences>();
  return (extraLibraries ?? "")
    .split(/[;\n]/)
    .map((p) => p.trim().toLowerCase().replace(/\//g, "\\").replace(/\\?$/, "\\"))
    .filter((p) => p.length > 1);
}

export function libraryOf(path: string | undefined, extra: string[]): string | undefined {
  if (!path) return undefined;
  const lower = path.toLowerCase();
  return LIBRARY_PATHS.find((fragment) => lower.includes(fragment)) ?? extra.find((root) => lower.startsWith(root));
}

export function isExcluded(name: string, settings: Settings): boolean {
  return matches(name, settings.excluded) || matches(name, BUILTIN_EXCLUDES);
}

/** Returns running games, one entry per exe name. */
export function detectGames(status: Status, settings: Settings): Detection[] {
  const { detectFullscreen } = getPreferenceValues<Preferences>();
  const extra = extraLibraries();
  const found = new Map<string, Detection>();

  for (const process of status.processes) {
    const key = process.name.toLowerCase();
    if (found.has(key) || matches(key, settings.excluded)) continue;
    if (matches(key, settings.customGames)) {
      found.set(key, { process, reason: "custom", detail: "On your game list" });
      continue;
    }
    if (matches(key, BUILTIN_EXCLUDES)) continue;
    const library = libraryOf(process.path, extra);
    if (library)
      found.set(key, { process, reason: "library", detail: `In game library (${library.replace(/\\/g, " ").trim()})` });
  }

  const fg = status.foreground;
  if (detectFullscreen && fg?.fullscreen && fg.name) {
    const key = fg.name.toLowerCase();
    if (!found.has(key) && !isExcluded(key, settings) && !matches(key, NOT_GAMES_FULLSCREEN)) {
      found.set(key, {
        process: { pid: fg.pid, name: fg.name, path: fg.path },
        reason: "fullscreen",
        detail: `Fullscreen in the foreground${fg.title ? `: ${fg.title}` : ""}`,
      });
    }
  }
  return [...found.values()];
}

/** "Cyberpunk2077.exe" -> "Cyberpunk2077" */
export function displayName(process: Process): string {
  return process.name.replace(/\.exe$/i, "");
}
