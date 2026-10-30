import { Toast, closeMainWindow, showToast } from "@raycast/api";
import { openReport, reportHtmlPath } from "./lib/data";

export default async function Command() {
  try {
    await openReport();
    await closeMainWindow();
  } catch {
    await showToast({
      style: Toast.Style.Failure,
      title: "Kein Report gefunden",
      message: `${reportHtmlPath()} fehlt. Zuerst „Schwachstellen-Report aktualisieren“ ausführen.`,
    });
  }
}
