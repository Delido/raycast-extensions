import { Cache, environment, getPreferenceValues, LocalStorage } from "@raycast/api";
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/*
 * The API token is stored encrypted with the user's password (scrypt + AES-256-GCM), never in the
 * preferences. Unlocking keeps the token in a session that expires after the auto-lock time.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const VAULT_KEY = "vault";
const SESSION_KEY = "session";
const FAILS_KEY = "unlock-fails";
const MAX_FAILS = 5;
const LOCKOUT_MS = 30_000;

interface Vault {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

interface Session {
  token: string;
  lastUsed: number;
}

export class LockedError extends Error {
  constructor() {
    super("Paperless is locked");
  }
}

function autoLockMs(): number {
  const { autoLock } = getPreferenceValues<Preferences>();
  return Math.max(1, Number(autoLock) || 15) * 60_000;
}

async function deriveKey(password: string, salt: Buffer) {
  return scrypt(password.normalize("NFC"), salt, 32, KDF);
}

export async function hasVault(): Promise<boolean> {
  return !!(await LocalStorage.getItem<string>(VAULT_KEY));
}

export async function createVault(token: string, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const vault: Vault = {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  await LocalStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  await startSession(token);
}

async function decrypt(password: string): Promise<string | undefined> {
  const raw = await LocalStorage.getItem<string>(VAULT_KEY);
  if (!raw) throw new Error("Not set up yet");
  const vault = JSON.parse(raw) as Vault;
  const key = await deriveKey(password, Buffer.from(vault.salt, "base64"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(vault.iv, "base64"));
    decipher.setAuthTag(Buffer.from(vault.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(vault.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return undefined; // wrong password (GCM authentication failed)
  }
}

/** Seconds until another attempt is allowed, 0 if allowed now. */
export async function lockoutRemaining(): Promise<number> {
  const raw = await LocalStorage.getItem<string>(FAILS_KEY);
  if (!raw) return 0;
  const { count, last } = JSON.parse(raw) as { count: number; last: number };
  if (count < MAX_FAILS) return 0;
  return Math.max(0, Math.ceil((last + LOCKOUT_MS - Date.now()) / 1000));
}

export async function unlock(password: string): Promise<boolean> {
  if ((await lockoutRemaining()) > 0) return false;
  const token = await decrypt(password);
  if (!token) {
    const raw = await LocalStorage.getItem<string>(FAILS_KEY);
    const fails = raw ? (JSON.parse(raw) as { count: number }).count : 0;
    await LocalStorage.setItem(FAILS_KEY, JSON.stringify({ count: fails + 1, last: Date.now() }));
    return false;
  }
  await LocalStorage.removeItem(FAILS_KEY);
  await startSession(token);
  return true;
}

async function startSession(token: string) {
  const session: Session = { token, lastUsed: Date.now() };
  await LocalStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** The token if unlocked; extends the session (auto-lock counts from the last use). */
export async function getToken(): Promise<string> {
  const raw = await LocalStorage.getItem<string>(SESSION_KEY);
  if (!raw) throw new LockedError();
  const session = JSON.parse(raw) as Session;
  if (Date.now() - session.lastUsed > autoLockMs()) {
    await lock();
    throw new LockedError();
  }
  if (Date.now() - session.lastUsed > 30_000) {
    await LocalStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, lastUsed: Date.now() }));
  }
  return session.token;
}

export async function isUnlocked(): Promise<boolean> {
  try {
    await getToken();
    return true;
  } catch {
    return false;
  }
}

/** Ends the session and removes everything cached from documents. */
export async function lock() {
  await LocalStorage.removeItem(SESSION_KEY);
  await rm(join(environment.supportPath, "thumbs"), { recursive: true, force: true });
  new Cache().clear();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
  const token = await decrypt(oldPassword);
  if (!token) return false;
  await createVault(token, newPassword);
  return true;
}

/** Forgets token and password completely. */
export async function resetVault() {
  await lock();
  await LocalStorage.removeItem(VAULT_KEY);
  await LocalStorage.removeItem(FAILS_KEY);
}
