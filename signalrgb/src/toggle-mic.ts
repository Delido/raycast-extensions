import { showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { setMicMute } from "./service";

export default async function ToggleMic() {
  try {
    const mic = await setMicMute("toggle");
    await showHUD(mic.muted ? "🔇 Microphone muted" : "🎤 Microphone live");
  } catch (error) {
    await showFailureToast(error, { title: "Companion service not running" });
  }
}
