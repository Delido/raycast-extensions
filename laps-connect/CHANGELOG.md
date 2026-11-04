# Changelog

## [Fixes] - 2026-11-04

- Device names are shortened to Windows' 15 characters: m-mustermann + -LAP → M-MUSTERMAN-LAP (before, the LAPS lookup found nothing for long names)
- Auto-lock works while the Connect view is open – the 15-second check no longer counted as use
- The Lock command also runs every minute in the background and ends expired sessions, so the decrypted UniFi key does not stay in storage (enable background refresh for "Lock LAPS Connect" once)
- LAPS lookup only uses an exact device name; with several entries of the same name the most recent backup wins
- WireGuard users are found when the first WireGuard network has none
- Change Password and Replace UniFi Key count wrong passwords and respect the lockout
- New passwords need at least 12 characters and use a stronger key derivation; existing passwords keep working
- The RDP address is checked before mstsc is started

## [SSH as Other User] - 2026-10-30

- New action to connect via SSH with any user name

## [Initial Version] - 2026-10-17
