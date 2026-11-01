import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/*
 * Windows helper assets/win-auth/win-auth.exe (source in helpers/win-auth, shared by several extensions):
 * - Windows Hello: creates a key on this PC and signs a challenge with it. The signature is deterministic,
 *   so a key derived from it can only be produced again with Windows Hello on this device.
 * - Microsoft sign-in through the Windows account broker (WAM): single sign-on with the work account of
 *   Windows, MFA in the Windows dialog. The app registration needs the redirect URI
 *   ms-appx-web://microsoft.aad.brokerplugin/<client id>.
 */

const exe = () => join(environment.assetsPath, "win-auth", "win-auth.exe");

export class WinAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function run(args: string[], timeout = 120_000): Promise<Record<string, string | boolean>> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32" || !existsSync(exe())) {
      reject(new WinAuthError("Needs Windows and the win-auth helper (npm run dev builds it)", "unavailable"));
      return;
    }
    execFile(exe(), args, { timeout, windowsHide: true }, (error, stdout) => {
      let json: Record<string, string | boolean> | undefined;
      try {
        json = JSON.parse(stdout.trim().split("\n").pop() || "{}");
      } catch {
        // no JSON
      }
      if (json?.error) reject(new WinAuthError(String(json.error), String(json.code ?? "")));
      else if (error && !json) reject(new WinAuthError(error.message, "failed"));
      else resolve(json ?? {});
    });
  });
}

export const hello = {
  async available(): Promise<boolean> {
    try {
      return (await run(["hello", "status"], 15_000)).available === true;
    } catch {
      return false;
    }
  },
  async create(name: string) {
    await run(["hello", "create", "--name", name]);
  },
  async sign(name: string, challenge: Buffer): Promise<Buffer> {
    const result = await run(["hello", "sign", "--name", name, "--data", challenge.toString("base64")]);
    return Buffer.from(String(result.signature), "base64");
  },
  async remove(name: string) {
    await run(["hello", "delete", "--name", name], 15_000).catch(() => undefined);
  },
};

const tokens = new Map<string, { token: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

/**
 * Access token for the scopes, silently with the Windows account or with the Windows sign-in dialog.
 * Kept in memory until shortly before it expires; concurrent callers share one sign-in.
 */
export function windowsToken(tenantId: string, clientId: string, scopes: string[]): Promise<string> {
  const key = `${tenantId}|${clientId}|${scopes.join(" ")}`;
  const cached = tokens.get(key);
  if (cached && cached.expires - Date.now() > 5 * 60_000) return Promise.resolve(cached.token);
  let request = pending.get(key);
  if (!request) {
    request = run(
      ["token", "--tenant", tenantId, "--client", clientId, "--scopes", scopes.join(" "), "--cache", ssoCache()],
      300_000,
    )
      .then((result) => {
        const token = String(result.accessToken);
        tokens.set(key, { token, expires: Date.parse(String(result.expiresOn)) || Date.now() + 30 * 60_000 });
        return token;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

export async function windowsSignOut(tenantId: string, clientId: string) {
  tokens.clear();
  await run(["signout", "--tenant", tenantId, "--client", clientId, "--cache", ssoCache()], 30_000).catch(
    () => undefined,
  );
}

const ssoCache = () => join(environment.supportPath, "windows-sign-in");
