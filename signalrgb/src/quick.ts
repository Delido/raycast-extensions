import { showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { stepEffect } from "./api";

/** Shared body of the no-view commands: run, then show the result as HUD. */
export async function runQuick(action: () => Promise<string>) {
  try {
    await showHUD(await action());
  } catch (error) {
    await showFailureToast(error, { title: "SignalRGB" });
  }
}

export function quickStep(direction: "next" | "previous" | "shuffle") {
  return runQuick(async () => `🎨 ${(await stepEffect(direction)).name}`);
}
