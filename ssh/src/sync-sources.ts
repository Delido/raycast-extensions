import { environment, LaunchType, showHUD } from "@raycast/api";
import { syncAll } from "./lib/sources";

/** Background sync (hourly). Unchanged sources cost one small request; failures keep the cache. */
export default async function SyncSources() {
  const manual = environment.launchType === LaunchType.UserInitiated;
  const results = await syncAll();
  if (!manual) return;
  if (!results.length) {
    await showHUD("No SSH sources configured – use “Manage SSH Sources”");
    return;
  }
  const updated = results.filter((r) => r.status === "updated").length;
  const errors = results.filter((r) => r.status === "error");
  await showHUD(
    errors.length
      ? `${errors.map((e) => e.source.name).join(", ")} unreachable – cached hosts kept`
      : updated
        ? `SSH: ${updated} source(s) updated`
        : "SSH sources up to date",
  );
}
