import { getCurrentAudioDevice, nextAudioDevice, splitDeviceName } from "./audio";
import { runQuick } from "./quick";

export default async function NextAudioOutput() {
  await runQuick(async () => {
    await nextAudioDevice();
    const current = await getCurrentAudioDevice();
    return current ? `🔊 ${splitDeviceName(current.name).title}` : "🔊 Switched audio output";
  });
}
