import { environment, getPreferenceValues } from "@raycast/api";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

/* Talks to assets/mtr-probe.exe (source in probe/), which sends the ICMP packets. */

export type HopStatus = "reply" | "ttl-expired" | "timeout" | "unreachable" | string;

export interface ProbeHop {
  ttl: number;
  addr?: string;
  rtt?: number;
  status: HopStatus;
}

export interface ProbeRound {
  round: number;
  time: number;
  hops: ProbeHop[];
}

export interface ProbeHandlers {
  onStart?: (ip: string) => void;
  onRound: (round: ProbeRound) => void;
  onHost?: (addr: string, name: string) => void;
  onError: (error: Error) => void;
  onExit?: () => void;
}

export interface ProbeOptions {
  rounds?: number;
  intervalMs?: number;
}

export function probeSettings() {
  const prefs = getPreferenceValues<Preferences>();
  const num = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    timeoutMs: num(prefs.timeout, 1000),
    maxHops: Math.min(64, num(prefs.maxHops, 30)),
    size: num(prefs.packetSize, 64),
  };
}

/** Starts the probe; returns a function that stops it. */
export function startProbe(target: string, options: ProbeOptions, handlers: ProbeHandlers): () => void {
  const settings = probeSettings();
  const args = [
    "-target",
    target,
    "-rounds",
    String(options.rounds ?? 0),
    "-interval",
    String(options.intervalMs ?? 1000),
    "-timeout",
    String(settings.timeoutMs),
    "-maxhops",
    String(settings.maxHops),
    "-size",
    String(settings.size),
  ];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(join(environment.assetsPath, "mtr-probe.exe"), args, { windowsHide: true });
  } catch (error) {
    handlers.onError(error as Error);
    return () => undefined;
  }

  let stopped = false;
  let failed = false;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: { type: string; [key: string]: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    switch (message.type) {
      case "start":
        handlers.onStart?.(String(message.ip));
        break;
      case "round":
        handlers.onRound(message as unknown as ProbeRound);
        break;
      case "host":
        handlers.onHost?.(String(message.addr), String(message.name));
        break;
      case "error":
        failed = true;
        handlers.onError(new Error(String(message.message)));
        break;
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("error", (error) => {
    failed = true;
    handlers.onError(error);
  });
  child.on("exit", (code) => {
    if (!stopped && !failed && code !== 0) {
      handlers.onError(new Error(stderr.trim() || `mtr-probe exited with code ${code}`));
    }
    handlers.onExit?.();
  });

  return () => {
    stopped = true;
    child.kill();
  };
}

export interface ProbeResult {
  ip: string;
  rounds: ProbeRound[];
  hosts: Record<string, string>;
}

/** Runs a fixed number of rounds and resolves with all of them. */
export function runProbe(target: string, rounds: number, intervalMs: number): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const result: ProbeResult = { ip: "", rounds: [], hosts: {} };
    let error: Error | undefined;
    startProbe(
      target,
      { rounds, intervalMs },
      {
        onStart: (ip) => (result.ip = ip),
        onRound: (round) => result.rounds.push(round),
        onHost: (addr, name) => (result.hosts[addr] = name),
        onError: (e) => (error ??= e),
        onExit: () => (error && result.rounds.length === 0 ? reject(error) : resolve(result)),
      },
    );
  });
}
