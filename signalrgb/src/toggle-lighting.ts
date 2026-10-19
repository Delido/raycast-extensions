import { getLighting, setEnabled } from "./api";
import { runQuick } from "./quick";

export default async function ToggleLighting() {
  await runQuick(async () => {
    const { enabled } = await getLighting();
    await setEnabled(!enabled);
    return enabled ? "💡 Lighting off" : "💡 Lighting on";
  });
}
