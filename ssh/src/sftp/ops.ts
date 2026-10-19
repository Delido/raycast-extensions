import type { FileEntry, SFTPWrapper, Stats } from "ssh2";

export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  isLink: boolean;
  size: number;
  mtime: Date;
  mode: string;
  owner: string;
}

export function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`;
}

export function parentPath(p: string): string {
  const parent = p.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
  return parent || "/";
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

function call<T>(fn: (cb: (err: Error | null | undefined, result: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, result) => (err ? reject(err) : resolve(result))));
}

export const realpath = (sftp: SFTPWrapper, p: string) => call<string>((cb) => sftp.realpath(p, cb));
export const stat = (sftp: SFTPWrapper, p: string) => call<Stats>((cb) => sftp.stat(p, cb));

export async function list(sftp: SFTPWrapper, dir: string): Promise<RemoteEntry[]> {
  const entries = await call<FileEntry[]>((cb) => sftp.readdir(dir, cb));
  const result = await Promise.all(
    entries
      .filter((e) => e.filename !== "." && e.filename !== "..")
      .map(async (e) => {
        const type = (e.attrs.mode ?? 0) & S_IFMT;
        const isLink = type === S_IFLNK || e.longname.startsWith("l");
        let isDir = type === S_IFDIR || e.longname.startsWith("d");
        if (isLink) {
          try {
            isDir = (await stat(sftp, joinPath(dir, e.filename))).isDirectory();
          } catch {
            // broken link
          }
        }
        const parts = e.longname.split(/\s+/);
        return {
          name: e.filename,
          path: joinPath(dir, e.filename),
          isDir,
          isLink,
          size: e.attrs.size ?? 0,
          mtime: new Date((e.attrs.mtime ?? 0) * 1000),
          mode: parts[0] ?? "",
          owner: parts.length > 3 ? `${parts[2]}:${parts[3]}` : "",
        };
      }),
  );
  return result.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

export function download(
  sftp: SFTPWrapper,
  remote: string,
  local: string,
  onProgress?: (done: number, total: number) => void,
) {
  return call<void>((cb) =>
    sftp.fastGet(remote, local, { step: (done, _chunk, total) => onProgress?.(done, total) }, cb),
  );
}

export function upload(
  sftp: SFTPWrapper,
  local: string,
  remote: string,
  onProgress?: (done: number, total: number) => void,
) {
  return call<void>((cb) =>
    sftp.fastPut(local, remote, { step: (done, _chunk, total) => onProgress?.(done, total) }, cb),
  );
}

export const rename = (sftp: SFTPWrapper, from: string, to: string) => call<void>((cb) => sftp.rename(from, to, cb));
export const remove = (sftp: SFTPWrapper, p: string) => call<void>((cb) => sftp.unlink(p, cb));
export const rmdir = (sftp: SFTPWrapper, p: string) => call<void>((cb) => sftp.rmdir(p, cb));
export const mkdir = (sftp: SFTPWrapper, p: string) => call<void>((cb) => sftp.mkdir(p, cb));

/** Reads at most maxBytes from the start of a file. */
export function readHead(sftp: SFTPWrapper, p: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(p, { start: 0, end: maxBytes - 1 });
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("error", reject);
    stream.on("close", () => resolve(Buffer.concat(chunks)));
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
