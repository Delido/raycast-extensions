import { showHUD } from "@raycast/api";
import { lock } from "./vault";

export default async function Lock() {
  await lock();
  await showHUD("🔒 Paperless locked");
}
