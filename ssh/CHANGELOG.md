# Changelog

## [Fixes] - 2026-11-04

- Editing a host keeps repeated options (several LocalForward, a second IdentityFile …) – before, only the first one was saved
- Editing or deleting a host no longer removes the "# section:" heading or comments of the host below it
- Saving a team host to a file on a share aborts when the file cannot be read, instead of replacing it with just this host; a backup (.raycast-backup-last) is written next to it
- SFTP: file names from the server can no longer write outside the download folder (e.g. "..\Startup\x.bat")
- SFTP: two-factor logins (password and verification code) work, and a wrong password is asked again
- Security option also blocks ForwardAgent, StrictHostKeyChecking no, UserKnownHostsFile and catch-all "Host *" blocks from team sources – they would override your own defaults
- Syncing several sources at once no longer loses their sync state
- Copy Config Block includes the web URL; the host form checks port, host and user

## [Edit Hosts] - 2026-10-31

- Edit and delete hosts in Raycast; adding and editing ask where to save: only for you (~/.ssh/config, overrides a team host) or for the team (commit to the OneDev repository / file on the share)
- Hide team hosts just for you, show them again later
- Connecting to a team host without the Include block in ~/.ssh/config offers to add it (ssh could not resolve the alias)

## [Initial Version] - 2026-10-17
