# Changelog


## [Downtimes and Soft States] - 2026-11-07

- Services count as in downtime while their host is in a downtime (they were still listed and notified)
- Problem Monitor: separate settings for acknowledged problems and downtimes, new setting for HARD only or HARD and SOFT states
- Problem lists mark SOFT states
## [Fixes] - 2026-11-04

- Problem Monitor: no more "recovered" notifications for services whose host just went down, or for problems that were acknowledged or filtered out
- Services of a host that is down are hidden in the unhandled view and the monitor also when the host is acknowledged
- An invalid regular expression in the settings is reported as such, not as "Checkmk not reachable"
- Acknowledge is only offered for hosts that have a problem (downtimes can still be scheduled for any host)

## [Initial Version] - 2026-10-16
