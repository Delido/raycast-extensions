import { showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { togglePause } from "./service";

export default async function ToggleWindowDrag() {
  try {
    const status = await togglePause();
    await showHUD(status.paused ? "⏸ Window Drag paused" : "▶️ Window Drag active");
  } catch (error) {
    await showFailureToast(error, { title: "Window Drag is not running" });
  }
}
