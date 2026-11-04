import { getPreferenceValues, LocalStorage } from "@raycast/api";
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

/*
 * Extra lock for LAPS Connect. The UniFi API key is stored encrypted with the user's password
 * (scrypt + AES-256-GCM), never in the preferences. Unlocking starts a session that ends after
 * the auto-lock time; without it the extension neither lists devices nor reads LAPS passwords.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

interface Kdf {
  N: number;
  r: number;
  p: number;
}
/** Vaults created before v2 stored no parameters; they keep working with these. */
const KDF_V1: Kdf = { N: 2 ** 15, r: 8, p: 1 };
// OWASP recommendation for scrypt (128 MiB, well under a second), same as Defender Schwachstellen
const KDF: Kdf = { N: 2 ** 17, r: 8, p: 1 };
export const MIN_PASSWORD_LENGTH = 12;

const VAULT_KEY = "vault";
const SESSION_KEY = "session";
const FAILS_KEY = "unlock-fails";
const MAX_FAILS = 5;
const LOCKOUT_MS = 60_000;

interface Vault {
  v: 1 | 2;
  /** missing in v1 vaults (KDF_V1) */
  kdf?: Kdf;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

interface Session {
  secret: string;
  lastUsed: number;
}

export class LockedError extends Error {
  constructor() {
    super("LAPS Connect is locked");
  }
}

function autoLockMs(): number {
  const { autoLock } = getPreferenceValues<Preferences>();
  return Math.max(1, Number(autoLock) || 5) * 60_000;
}

async function deriveKey(password: string, salt: Buffer, kdf: Kdf) {
  return scrypt(password.normalize("NFC"), salt, 32, { ...kdf, maxmem: 256 * 1024 * 1024 });
}

export async function hasVault(): Promise<boolean> {
  return !!(await LocalStorage.getItem<string>(VAULT_KEY));
}

export async function createVault(secret: string, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, KDF);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const vault: Vault = {
    v: 2,
    kdf: KDF,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  await LocalStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  await startSession(secret);
}

async function decrypt(password: string): Promise<string | undefined> {
  const raw = await LocalStorage.getItem<string>(VAULT_KEY);
  if (!raw) throw new Error("Not set up yet");
  const vault = JSON.parse(raw) as Vault;
  const key = await deriveKey(password, Buffer.from(vault.salt, "base64"), vault.kdf ?? KDF_V1);
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

/**
 * Decrypts with the password, honouring the lockout and counting failures – the one way in,
 * used by unlock, change password and replace key alike.
 */
async function attempt(password: string): Promise<string | undefined> {
  if ((await lockoutRemaining()) > 0) return undefined;
  const secret = await decrypt(password);
  if (!secret) {
    const raw = await LocalStorage.getItem<string>(FAILS_KEY);
    const fails = raw ? (JSON.parse(raw) as { count: number }).count : 0;
    await LocalStorage.setItem(FAILS_KEY, JSON.stringify({ count: fails + 1, last: Date.now() }));
    return undefined;
  }
  await LocalStorage.removeItem(FAILS_KEY);
  return secret;
}

export async function unlock(password: string): Promise<boolean> {
  const secret = await attempt(password);
  if (!secret) return false;
  await startSession(secret);
  return true;
}

async function startSession(secret: string) {
  const session: Session = { secret, lastUsed: Date.now() };
  await LocalStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** The current session, or undefined (an expired one is removed). Does not extend the session. */
async function readSession(): Promise<Session | undefined> {
  const raw = await LocalStorage.getItem<string>(SESSION_KEY);
  if (!raw) return undefined;
  const session = JSON.parse(raw) as Session;
  if (Date.now() - session.lastUsed > autoLockMs()) {
    await lock();
    return undefined;
  }
  return session;
}

/** The UniFi API key if unlocked; extends the session (auto-lock counts from the last use). */
export async function getSecret(): Promise<string> {
  const session = await readSession();
  if (!session) throw new LockedError();
  if (Date.now() - session.lastUsed > 15_000) {
    await LocalStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, lastUsed: Date.now() }));
  }
  return session.secret;
}

/** Only checks – an open view polling this must not keep the session alive. */
export async function isUnlocked(): Promise<boolean> {
  return !!(await readSession());
}

/** Removes an expired session (background run of the Lock command), so the key does not stay on disk. */
export async function lockIfExpired(): Promise<boolean> {
  const hadSession = !!(await LocalStorage.getItem<string>(SESSION_KEY));
  return hadSession && !(await readSession());
}

/** Ends the session; optionally also forgets the Microsoft sign-in. */
export async function lock() {
  await LocalStorage.removeItem(SESSION_KEY);
  const { signOutOnLock } = getPreferenceValues<Preferences>();
  if (signOutOnLock) {
    const { signOut } = await import("./graph"); // loaded lazily: graph itself checks the lock
    await signOut().catch(() => undefined);
  }
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
  const secret = await attempt(oldPassword);
  if (!secret) return false;
  await createVault(secret, newPassword);
  return true;
}

/** Replaces the stored UniFi API key (requires the current password). */
export async function replaceSecret(password: string, secret: string): Promise<boolean> {
  if (!(await attempt(password))) return false;
  await createVault(secret, password);
  return true;
}

/** Forgets key and password completely. */
export async function resetVault() {
  await lock();
  await LocalStorage.removeItem(VAULT_KEY);
  await LocalStorage.removeItem(FAILS_KEY);
}
