// Reads the lineups that csnades.gg shows on its public map pages. The site has no API: the nades
// are part of the Next.js RSC payload (self.__next_f.push chunks) embedded in each page.

export const SITE = "https://csnades.gg";

export type NadeType = "smoke" | "molotov" | "flashbang" | "he";
export type Team = "t" | "ct";

export interface MapInfo {
  slug: string;
  name: string;
}

// Premier Season Five map pool (since July 2026). Update when Valve rotates the pool.
export const PREMIER_MAPS: MapInfo[] = [
  { slug: "ancient", name: "Ancient" },
  { slug: "anubis", name: "Anubis" },
  { slug: "cache", name: "Cache" },
  { slug: "dust2", name: "Dust 2" },
  { slug: "inferno", name: "Inferno" },
  { slug: "mirage", name: "Mirage" },
  { slug: "nuke", name: "Nuke" },
];

export const OTHER_MAPS: MapInfo[] = [
  { slug: "overpass", name: "Overpass" },
  { slug: "train", name: "Train" },
  { slug: "vertigo", name: "Vertigo" },
];

export const NADE_TYPES: { type: NadeType; path: string; title: string }[] = [
  { type: "smoke", path: "smokes", title: "Smokes" },
  { type: "molotov", path: "molotovs", title: "Molotovs" },
  { type: "flashbang", path: "flashbangs", title: "Flashbangs" },
  { type: "he", path: "hegrenades", title: "HE Grenades" },
];

export interface Nade {
  id: string;
  map: string;
  type: NadeType;
  team: Team;
  from: string;
  to: string;
  technique: string;
  movement: string;
  precision: string;
  recommended: boolean;
  videoHq: string;
  videoLq: string;
  thumbnail: string;
  lineup: string;
  url: string;
}

interface RawNade {
  id?: string;
  slug?: string;
  type?: string;
  team?: string;
  titleFrom?: string;
  titleTo?: string;
  technique?: string;
  movement?: string;
  precision?: string;
  beginner?: boolean;
  assets?: {
    videoHq?: { mp4?: string };
    videoLq?: { mp4?: string };
    thumbnail?: string;
    lineup?: string;
  };
}

const CHUNK = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
const NADE_START = '{"id":"nade_';

function payloadOf(html: string): string {
  let payload = "";
  for (const m of html.matchAll(CHUNK)) payload += JSON.parse(`"${m[1]}"`) as string;
  return payload;
}

// Index of the brace closing the object that starts at `start`, skipping braces inside strings.
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

export function parseNades(html: string, map: string, type: NadeType, path: string): Nade[] {
  const payload = payloadOf(html);
  const nades: Nade[] = [];
  const seen = new Set<string>();
  for (let i = payload.indexOf(NADE_START); i !== -1; i = payload.indexOf(NADE_START, i + 1)) {
    const end = objectEnd(payload, i);
    if (end === -1) break;
    let raw: RawNade;
    try {
      raw = JSON.parse(payload.slice(i, end + 1)) as RawNade;
    } catch {
      continue;
    }
    const hq = raw.assets?.videoHq?.mp4;
    if (!raw.id || !raw.slug || !hq || raw.type !== type || seen.has(raw.id)) continue;
    seen.add(raw.id);
    nades.push({
      id: raw.id,
      map,
      type,
      team: raw.team === "ct" ? "ct" : "t",
      from: raw.titleFrom ?? "?",
      to: raw.titleTo ?? raw.slug,
      technique: raw.technique ?? "",
      movement: raw.movement ?? "",
      precision: raw.precision ?? "",
      recommended: raw.beginner === true,
      videoHq: hq,
      videoLq: raw.assets?.videoLq?.mp4 ?? hq,
      thumbnail: raw.assets?.thumbnail ?? "",
      lineup: raw.assets?.lineup ?? "",
      url: `${SITE}/${map}/${path}/${raw.slug}`,
    });
  }
  return nades;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Raycast-CS2-Nades", Accept: "text/html" },
  });
  if (res.status === 404) return "";
  if (!res.ok) throw new Error(`csnades.gg answered with HTTP ${res.status}`);
  return res.text();
}

export async function loadMap(map: string): Promise<Nade[]> {
  const pages = await Promise.all(
    NADE_TYPES.map(async ({ type, path }) => {
      // Smokes are the map's start page, the other types have their own sub page
      const html = await fetchPage(type === "smoke" ? `${SITE}/${map}` : `${SITE}/${map}/${path}`);
      return parseNades(html, map, type, path);
    }),
  );
  const nades = pages.flat();
  if (nades.length === 0) {
    throw new Error("No lineups found – csnades.gg may have changed its page format");
  }
  return nades;
}

const TECHNIQUE: Record<string, string> = {
  left: "Left click",
  right: "Right click",
  both: "Left + right click",
  left_jump: "Jump throw (left click)",
  right_jump: "Jump throw (right click)",
  both_jump: "Jump throw (left + right click)",
};

const MOVEMENT: Record<string, string> = {
  stationary: "Standing",
  running: "Running",
  walking: "Walking (Shift)",
  crouched_stationary: "Crouching",
  crouched_walking: "Crouch walking",
  crouched_running: "Crouch running",
};

const PRECISION: Record<string, string> = {
  loose: "Loose",
  precise: "Precise",
  very_precise: "Very precise",
};

function label(table: Record<string, string>, value: string): string {
  return table[value] ?? value.replace(/_/g, " ");
}

export const techniqueLabel = (v: string) => label(TECHNIQUE, v);
export const movementLabel = (v: string) => label(MOVEMENT, v);
export const precisionLabel = (v: string) => label(PRECISION, v);
export const typeTitle = (t: NadeType) => NADE_TYPES.find((n) => n.type === t)?.title ?? t;
export const mapName = (slug: string) => [...PREMIER_MAPS, ...OTHER_MAPS].find((m) => m.slug === slug)?.name ?? slug;
