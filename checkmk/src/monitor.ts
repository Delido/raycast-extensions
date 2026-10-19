import { environment, getPreferenceValues, LaunchType, LocalStorage, showHUD } from "@raycast/api";
import { getHosts, getServices, getSiteUrl, hostUrl, isHandled, Query, serviceUrl } from "./api";
import { notify } from "./notify";

interface Problem {
  label: string;
  state: string;
  output: string;
  url: string;
  severity: number;
}

const KNOWN_KEY = "known-problems";
const LAST_CHECK_KEY = "last-check";
const ERROR_KEY = "last-error";

const SERVICE_LABELS: Record<number, string> = { 1: "WARN", 2: "CRIT", 3: "UNKNOWN" };
const SERVICE_SEVERITY: Record<number, number> = { 1: 1, 3: 2, 2: 3 };
const HOST_LABELS: Record<number, string> = { 1: "DOWN", 2: "UNREACHABLE" };

const MIN_STATES: Record<string, string[]> = {
  crit: ["2"],
  "crit-unknown": ["2", "3"],
  warn: ["1", "2", "3"],
};

function regex(pattern: string | undefined): RegExp | undefined {
  if (!pattern?.trim()) return undefined;
  try {
    return new RegExp(pattern.trim(), "i");
  } catch {
    throw new Error(`Invalid regular expression: ${pattern}`);
  }
}

async function collectProblems(prefs: Preferences.Monitor): Promise<Record<string, Problem>> {
  const hostRe = regex(prefs.hostFilter);
  const serviceRe = regex(prefs.serviceFilter);
  const excludeRe = regex(prefs.serviceExclude);
  const states = MIN_STATES[prefs.minSeverity] ?? MIN_STATES.crit;

  const serviceQuery: Query = {
    op: "or",
    expr: states.map((s) => ({ op: "=", left: "state", right: s })),
  };
  const [hosts, services] = await Promise.all([
    prefs.includeHosts ? getHosts({ op: "!=", left: "state", right: "0" }) : Promise.resolve([]),
    getServices(serviceQuery),
  ]);

  const problems: Record<string, Problem> = {};
  const downHosts = new Set<string>();

  for (const host of hosts) {
    if (!host.has_been_checked) continue;
    if (hostRe && !hostRe.test(host.name)) continue;
    if (prefs.ignoreHandled && isHandled(host)) continue;
    downHosts.add(host.name);
    problems[`host:${host.name}`] = {
      label: host.name,
      state: HOST_LABELS[host.state] ?? "DOWN",
      output: host.plugin_output,
      url: hostUrl(host.name),
      severity: 10,
    };
  }

  for (const service of services) {
    if (!service.has_been_checked) continue;
    if (hostRe && !hostRe.test(service.host_name)) continue;
    if (serviceRe && !serviceRe.test(service.description)) continue;
    if (excludeRe && excludeRe.test(service.description)) continue;
    if (prefs.ignoreHandled && isHandled(service)) continue;
    if (downHosts.has(service.host_name)) continue; // already reported via the host
    problems[`svc:${service.host_name}|${service.description}`] = {
      label: `${service.host_name} – ${service.description}`,
      state: SERVICE_LABELS[service.state] ?? String(service.state),
      output: service.plugin_output,
      url: serviceUrl(service.host_name, service.description),
      severity: SERVICE_SEVERITY[service.state] ?? 0,
    };
  }
  return problems;
}

async function readJson<T>(key: string): Promise<T | undefined> {
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export default async function Monitor() {
  const prefs = getPreferenceValues<Preferences.Monitor>();
  const style = prefs.notificationStyle === "hud" ? "hud" : "system";
  const manual = environment.launchType === LaunchType.UserInitiated;

  // The command is scheduled every minute; honour the configured check interval.
  const intervalMs = Number(prefs.checkEvery || "1") * 60_000;
  const lastCheck = Number((await LocalStorage.getItem<string>(LAST_CHECK_KEY)) ?? 0);
  if (!manual && Date.now() - lastCheck < intervalMs - 10_000) return;
  await LocalStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

  let current: Record<string, Problem>;
  try {
    current = await collectProblems(prefs);
  } catch (error) {
    const message = (error as Error).message;
    const previousError = await LocalStorage.getItem<string>(ERROR_KEY);
    await LocalStorage.setItem(ERROR_KEY, message);
    if (manual) await showHUD(`Checkmk not reachable: ${message}`);
    else if (!previousError) await notify("Checkmk not reachable", message, { style });
    return;
  }
  if (await LocalStorage.getItem(ERROR_KEY)) {
    await LocalStorage.removeItem(ERROR_KEY);
    if (!manual) await notify("Checkmk reachable again", "Monitoring resumed", { style });
  }

  const known = await readJson<Record<string, Problem>>(KNOWN_KEY);
  await LocalStorage.setItem(KNOWN_KEY, JSON.stringify(current));

  const problemsUrl = `${getSiteUrl()}/check_mk/index.py?start_url=${encodeURIComponent("view.py?view_name=svcproblems")}`;
  const total = Object.keys(current).length;

  if (!known) {
    // First run: one summary instead of a notification storm.
    if (total > 0)
      await notify("Checkmk", `${total} current problem${total === 1 ? "" : "s"}`, { style, url: problemsUrl });
    else if (manual) await showHUD("Checkmk: no problems");
    return;
  }

  const fresh = Object.entries(current)
    .filter(([key, problem]) => !known[key] || problem.severity > known[key].severity)
    .map(([, problem]) => problem)
    .sort((a, b) => b.severity - a.severity);
  const recovered = Object.entries(known)
    .filter(([key]) => !current[key])
    .map(([, problem]) => problem);

  if (fresh.length > 0 && fresh.length <= 3) {
    for (const problem of fresh) {
      await notify(`${problem.state}: ${problem.label}`, problem.output || problem.state, { style, url: problem.url });
    }
  } else if (fresh.length > 3) {
    const lines = fresh.slice(0, 4).map((p) => `${p.state} ${p.label}`);
    if (fresh.length > 4) lines.push(`…and ${fresh.length - 4} more`);
    await notify(`Checkmk: ${fresh.length} new problems`, lines.join("\n"), { style, url: problemsUrl });
  }

  if (prefs.notifyRecovery && recovered.length > 0) {
    const body =
      recovered.length <= 3 ? recovered.map((p) => p.label).join("\n") : `${recovered.length} problems are OK again`;
    await notify(`Checkmk: recovered`, body, { style, url: problemsUrl });
  }

  if (manual && fresh.length === 0) {
    await showHUD(
      total === 0 ? "Checkmk: no problems" : `Checkmk: ${total} problem${total === 1 ? "" : "s"}, nothing new`,
    );
  }
}
