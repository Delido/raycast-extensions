import { LaunchProps } from "@raycast/api";
import { setBrightness } from "./api";
import { runQuick } from "./quick";

export default async function SetBrightness(props: LaunchProps<{ arguments: Arguments.SetBrightness }>) {
  await runQuick(async () => {
    const value = Number(props.arguments.brightness.replace("%", "").trim());
    if (!Number.isFinite(value)) throw new Error("Enter a number between 0 and 100");
    const brightness = Math.round(Math.min(100, Math.max(0, value)));
    await setBrightness(brightness);
    return `☀️ Brightness ${brightness}%`;
  });
}
