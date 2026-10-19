import { CalendarEvent, graph } from "./graph";

/** Upcoming calendar events (times in UTC) from shortly in the past up to `days` ahead. */
export async function getUpcomingEvents(days: number): Promise<CalendarEvent[]> {
  const start = new Date(Date.now() - 60 * 60_000).toISOString();
  const end = new Date(Date.now() + days * 86_400_000).toISOString();
  const select = "id,subject,start,end,isAllDay,isCancelled,isOnlineMeeting,onlineMeeting,location,organizer,webLink";
  const result = await graph<{ value: CalendarEvent[] }>(
    `me/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100&$select=${select}`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } },
  );
  return result.value
    .filter((e) => !e.isCancelled && new Date(`${e.end.dateTime}Z`).getTime() > Date.now())
    .map((e) => ({ ...e, start: { dateTime: `${e.start.dateTime}Z` }, end: { dateTime: `${e.end.dateTime}Z` } }));
}

export function joinUrl(event: CalendarEvent): string | undefined {
  if (event.onlineMeeting?.joinUrl) return event.onlineMeeting.joinUrl;
  // Some invitations only carry the Teams link in the location.
  const match = event.location?.displayName?.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/\S+/);
  return match?.[0];
}
