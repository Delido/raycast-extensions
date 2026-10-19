import { open, showHUD, showToast, Toast } from "@raycast/api";
import { teamsLink } from "./graph";
import { getUpcomingEvents, joinUrl } from "./meetings-api";

/** Joins the running meeting, or the next one starting within the next 30 minutes. */
export default async function JoinNextMeeting() {
  try {
    const events = (await getUpcomingEvents(1)).filter((e) => !e.isAllDay && joinUrl(e));
    const now = Date.now();
    const candidate = events.find((e) => new Date(e.start.dateTime).getTime() - now < 30 * 60_000);
    if (!candidate) {
      const next = events[0];
      await showHUD(
        next
          ? `No meeting right now – next: ${next.subject} at ${new Date(next.start.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "No Teams meetings in the next 24 hours",
      );
      return;
    }
    await open(teamsLink(joinUrl(candidate)!));
    await showHUD(`Joining: ${candidate.subject}`);
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Could not join meeting", message: (error as Error).message });
  }
}
