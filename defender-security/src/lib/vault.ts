import { LocalStorage } from "@raycast/api";
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, ScryptOptions } from "crypto";

// Zugangsdaten werden mit einem Schlüssel aus dem Benutzerpasswort verschlüsselt (scrypt + AES-256-GCM)
// und erst dann in Raycasts LocalStorage abgelegt. Das Passwort selbst wird nirgends gespeichert.

export interface Credentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
}

interface VaultRecord {
  v: 1;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  tag: string;
  ct: string;
  created: string;
  tenantName: string;
}

const VAULT_KEY = "vault.v1";
const FAILURES_KEY = "vault.failures";
const AAD = Buffer.from("defender-schwachstellen/vault/v1");
// OWASP-Empfehlung für scrypt: N=2^17, r=8, p=1 (128 MiB, ca. 0,3–1 s pro Versuch)
const KDF = { N: 2 ** 17, r: 8, p: 1 };
export const MIN_PASSWORD_LENGTH = 12;

function deriveKey(password: string, salt: Buffer, kdf: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scryptCallback(password.normalize("NFC"), salt, 32, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function vaultInfo(): Promise<{ tenantName: string; created: Date } | null> {
  const raw = await LocalStorage.getItem<string>(VAULT_KEY);
  if (!raw) return null;
  const rec = JSON.parse(raw) as VaultRecord;
  return { tenantName: rec.tenantName, created: new Date(rec.created) };
}

export async function saveVault(creds: Credentials, tenantName: string, password: string) {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = await deriveKey(password, salt, KDF);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(JSON.stringify(creds), "utf8"), cipher.final()]);
  key.fill(0);
  const rec: VaultRecord = {
    v: 1,
    kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
    created: new Date().toISOString(),
    tenantName,
  };
  await LocalStorage.setItem(VAULT_KEY, JSON.stringify(rec));
  await LocalStorage.removeItem(FAILURES_KEY);
}

export async function deleteVault() {
  await LocalStorage.removeItem(VAULT_KEY);
  await LocalStorage.removeItem(FAILURES_KEY);
}

// Nach 3 Fehlversuchen wächst die Wartezeit: 15 s, 30 s, 60 s … bis maximal 15 Minuten.
async function lockoutRemaining(): Promise<number> {
  const raw = await LocalStorage.getItem<string>(FAILURES_KEY);
  if (!raw) return 0;
  const { count, last } = JSON.parse(raw) as { count: number; last: number };
  if (count < 3) return 0;
  const wait = Math.min(15 * 60, 15 * 2 ** (count - 3)) * 1000;
  return Math.max(0, last + wait - Date.now());
}

async function registerFailure() {
  const raw = await LocalStorage.getItem<string>(FAILURES_KEY);
  const count = raw ? (JSON.parse(raw) as { count: number }).count + 1 : 1;
  await LocalStorage.setItem(FAILURES_KEY, JSON.stringify({ count, last: Date.now() }));
}

export async function unlockVault(password: string): Promise<Credentials> {
  const raw = await LocalStorage.getItem<string>(VAULT_KEY);
  if (!raw) throw new Error("Es sind noch keine Zugangsdaten hinterlegt.");
  const wait = await lockoutRemaining();
  if (wait > 0) throw new Error(`Zu viele Fehlversuche. Bitte in ${Math.ceil(wait / 1000)} s erneut versuchen.`);

  const rec = JSON.parse(raw) as VaultRecord;
  const key = await deriveKey(password, Buffer.from(rec.kdf.salt, "base64"), rec.kdf);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(rec.iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(rec.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(rec.ct, "base64")), decipher.final()]);
    await LocalStorage.removeItem(FAILURES_KEY);
    return JSON.parse(plain.toString("utf8")) as Credentials;
  } catch {
    // GCM-Prüfung schlägt fehl: falsches Passwort (oder manipulierte Daten)
    await registerFailure();
    throw new Error("Passwort falsch.");
  } finally {
    key.fill(0);
  }
}
