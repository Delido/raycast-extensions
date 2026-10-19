import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type HostKeyStatus = "ok" | "unknown" | "mismatch" | "revoked";

/** Key type from an SSH public key blob (first length-prefixed string). */
export function keyType(blob: Buffer): string {
  const len = blob.readUInt32BE(0);
  return blob.subarray(4, 4 + len).toString("ascii");
}

/** OpenSSH-style fingerprint, e.g. "SHA256:abc…" */
export function fingerprint(blob: Buffer): string {
  return `SHA256:${crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** Does a known_hosts host field (comma list, hashed, wildcards, negation) match the name? */
function hostFieldMatches(field: string, name: string): boolean {
  if (field.startsWith("|1|")) {
    const [, , salt, hash] = field.split("|");
    if (!salt || !hash) return false;
    const digest = crypto.createHmac("sha1", Buffer.from(salt, "base64")).update(name).digest("base64");
    return digest === hash;
  }
  let matched = false;
  for (const pattern of field.split(",")) {
    if (pattern.startsWith("!")) {
      if (globToRegex(pattern.slice(1)).test(name)) return false;
    } else if (globToRegex(pattern).test(name)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Checks the server's host key against the known_hosts files, following OpenSSH:
 * a matching name with a different key of the same type is a mismatch (possible MITM).
 */
export function checkHostKey(name: string, blob: Buffer, files: string[]): HostKeyStatus {
  const type = keyType(blob);
  const b64 = blob.toString("base64");
  let sameTypeOtherKey = false;
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/\s+/);
      let marker = "";
      if (parts[0].startsWith("@")) marker = parts.shift()!;
      const [hosts, kType, kData] = parts;
      if (!hosts || !kType || !kData) continue;
      if (marker === "@cert-authority") continue;
      if (!hostFieldMatches(hosts, name)) continue;
      if (marker === "@revoked") {
        if (kData === b64) return "revoked";
        continue;
      }
      if (kData === b64) return "ok";
      if (kType === type) sameTypeOtherKey = true;
    }
  }
  return sameTypeOtherKey ? "mismatch" : "unknown";
}

/** Appends the key to the user's known_hosts (plain, like HashKnownHosts no). */
export function addKnownHost(name: string, blob: Buffer, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = "";
  try {
    const existing = fs.readFileSync(file, "utf8");
    if (existing.length && !existing.endsWith("\n")) prefix = "\n";
  } catch {
    // new file
  }
  fs.appendFileSync(file, `${prefix}${name} ${keyType(blob)} ${blob.toString("base64")}\n`);
}
