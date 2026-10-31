import { LocalStorage, showHUD, showToast, Toast } from "@raycast/api";
import { rename } from "node:fs/promises";
import type { Done } from "./lib/rename";

export const UNDO_KEY = "last-rename";

/** Restores the names of the last bulk rename (in reverse order, so folders come back before their items). */
export async function undoLast(): Promise<{ restored: number; failed: number }> {
  const raw = await LocalStorage.getItem<string>(UNDO_KEY);
  const done = raw ? (JSON.parse(raw) as Done[]) : [];
  let restored = 0;
  let failed = 0;
  for (const step of [...done].reverse()) {
    try {
      await rename(step.to, step.from);
      restored++;
    } catch {
      failed++;
    }
  }
  await LocalStorage.removeItem(UNDO_KEY);
  await showToast({
    style: failed ? Toast.Style.Failure : Toast.Style.Success,
    title: restored ? `Restored ${restored} name${restored === 1 ? "" : "s"}` : "Nothing to undo",
    message: failed ? `${failed} could not be restored (moved or renamed meanwhile)` : undefined,
  });
  return { restored, failed };
}

export default async function UndoRename() {
  const { restored, failed } = await undoLast();
  await showHUD(
    restored
      ? `↩ Restored ${restored} name${restored === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`
      : "Nothing to undo",
  );
}
