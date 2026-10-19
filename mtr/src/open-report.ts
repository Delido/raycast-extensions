import { open, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { writeReport } from "./report";

export default async function OpenReport() {
  try {
    await open(await writeReport());
    await showHUD("Report opened in your browser");
  } catch (error) {
    await showFailureToast(error, { title: "Could not create the report" });
  }
}
