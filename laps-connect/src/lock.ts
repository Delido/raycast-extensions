import { showHUD } from "@raycast/api";
import { lock } from "./lib/vault";

export default async function Lock() {
  await lock();
  await showHUD("🔒 LAPS Connect locked");
}
