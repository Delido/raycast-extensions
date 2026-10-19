import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { join } from "node:path";

/* Wrapper around assets/power-helper.exe (source in helper/). */

export interface Plan {
  guid: string;
  name: string;
}

export interface Process {
  pid: number;
  name: string;
  path?: string;
}

export interface Foreground {
  pid: number;
  name?: string;
  path?: string;
  title?: string;
  class?: string;
  fullscreen: boolean;
}

export interface Status {
  plans: Plan[];
  active: string;
  processes: Process[];
  foreground?: Foreground | null;
  notificationState?: string;
}

// Well-known GUIDs of the Windows default plans
export const BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e";
export const HIGH_PERFORMANCE = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
export const POWER_SAVER = "a1841308-3541-4fab-bc81-f71556f20b4a";
export const ULTIMATE = "e9a42b02-d5df-448d-aa00-03f14749eb61";

function run<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      join(environment.assetsPath, "power-helper.exe"),
      args,
      { windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        let json: { ok?: boolean; error?: string } | undefined;
        try {
          json = JSON.parse(stdout);
        } catch {
          // handled below
        }
        if (json?.ok === false) return reject(new Error(json.error ?? "power-helper failed"));
        if (error || !json) return reject(error ?? new Error("power-helper returned no data"));
        resolve(json as T);
      },
    );
  });
}

export function getStatus(): Promise<Status> {
  return run<Status>(["status"]);
}

export function getPlans(): Promise<Pick<Status, "plans" | "active">> {
  return run(["plans"]);
}

export async function setPlan(guid: string): Promise<void> {
  await run(["setplan", guid]);
}

export function planName(plans: Plan[], guid: string | undefined): string {
  return plans.find((p) => p.guid === guid)?.name ?? "Unknown plan";
}
