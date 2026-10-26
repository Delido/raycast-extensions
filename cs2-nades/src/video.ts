// Turns a lineup video into an animated GIF with ffmpeg, because Raycast can show GIFs in the detail
// pane but cannot play videos. GIFs are cached in the support folder.

import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Nade } from "./csnades";

const CACHE_DIR = join(environment.supportPath, "videos");
const CACHE_LIMIT = 500 * 1024 * 1024;
const WIN = process.platform === "win32";
const EXE = WIN ? "ffmpeg.exe" : "ffmpeg";
// winget's portable FFmpeg packages (Gyan builds)
const WINGET_PACKAGES = join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");

// 10 fps and 480 px keep a 17 s clip around 5 MB and the conversion around 5 s
const FILTER =
  "fps=10,scale=480:-2:flags=bicubic,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];" +
  "[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle";

async function wingetFfmpeg(): Promise<string | undefined> {
  try {
    for (const pkg of await readdir(WINGET_PACKAGES)) {
      if (!pkg.startsWith("Gyan.FFmpeg")) continue;
      for (const build of await readdir(join(WINGET_PACKAGES, pkg))) {
        const exe = join(WINGET_PACKAGES, pkg, build, "bin", EXE);
        if (existsSync(exe)) return exe;
      }
    }
  } catch {
    // no winget packages folder
  }
}

export async function findFfmpeg(custom?: string): Promise<string | undefined> {
  if (custom?.trim()) return existsSync(custom.trim()) ? custom.trim() : undefined;
  // Raycast does not hand every variable to extensions, so known install folders are checked too
  const path = process.env.PATH ?? process.env.Path ?? "";
  const candidates = [
    ...path.split(delimiter).map((dir) => join(dir, EXE)),
    join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", EXE),
    join("C:", "ProgramData", "chocolatey", "bin", EXE),
    join(homedir(), "scoop", "shims", EXE),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  return found ?? (WIN ? wingetFfmpeg() : undefined);
}

export const canInstallFfmpeg = WIN;

export function installFfmpeg(): Promise<void> {
  const winget = join(homedir(), "AppData", "Local", "Microsoft", "WindowsApps", "winget.exe");
  const args = ["install", "--id", "Gyan.FFmpeg.Essentials", "-e", "--silent", "--disable-interactivity"];
  args.push("--accept-source-agreements", "--accept-package-agreements");
  return new Promise((resolve, reject) =>
    execFile(winget, args, { timeout: 10 * 60 * 1000, windowsHide: true }, (err, stdout) => {
      // winget exits non-zero when the package is already installed
      if (err && !/installed|installiert/i.test(stdout))
        reject(new Error(stdout.trim().split("\n").pop() || err.message));
      else resolve();
    }),
  );
}

function gifPath(nade: Nade): string {
  return join(CACHE_DIR, `${nade.id}.gif`);
}

export function cachedGif(nade: Nade): string | undefined {
  const file = gifPath(nade);
  return existsSync(file) ? file : undefined;
}

export function fileUrl(file: string): string {
  return pathToFileURL(file).href;
}

export async function makeGif(nade: Nade, ffmpeg: string, signal: AbortSignal): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = gifPath(nade);
  // Unique name: an aborted run may still be cleaning up when the same lineup is selected again
  const tmp = `${file}.${Date.now()}.part`;
  // The short preview clip has the whole throw and is a third of the size of the LQ video
  const source = nade.videoLq.replace(/lq\.mp4$/, "thumbnail.mp4");
  const args = ["-v", "error", "-y", "-i", source, "-vf", FILTER, "-loop", "0", "-f", "gif", tmp];
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(ffmpeg, args, { signal, timeout: 120_000, windowsHide: true }, (err, _out, stderr) =>
        err ? reject(new Error(stderr.trim().split("\n").pop() || err.message)) : resolve(),
      ),
    );
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  void prune();
  return file;
}

async function prune() {
  const files = await Promise.all(
    (await readdir(CACHE_DIR)).map(async (name) => {
      const s = await stat(join(CACHE_DIR, name));
      return { name, size: s.size, time: s.mtimeMs };
    }),
  );
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files.sort((a, b) => a.time - b.time)) {
    if (total <= CACHE_LIMIT) break;
    await rm(join(CACHE_DIR, f.name), { force: true });
    total -= f.size;
  }
}
