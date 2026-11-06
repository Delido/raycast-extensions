# Changelog

## [Initial Version] - 2026-11-06

- Several timers per Jira issue: start, pause, resume, switch, correct the time, add a note
- Timers without Jira issue (booked to MOCO only); assign an issue later, timers on the same issue are merged
- Book to Jira (worklog) and MOCO (activity on the job's project and task) in one step, or log time manually
- Job number and order are read from Jira fields (optional regular expression) and matched to MOCO projects and tasks; manual choices are remembered per issue
- Booked Time: per-day list with Jira/MOCO status, retry of failed parts, undo, today's MOCO total
- Tray icon on Windows (Go helper): running time on the icon, click to pause/resume, menu to switch timers and book; timers moved to a file shared with it
- Pause or Resume Timer command with live status in the root search
- Setup wizard with live test on recently viewed issues; MOCO API key fetched from email and password
