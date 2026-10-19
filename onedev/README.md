# OneDev

Projekte, Issues, Pull Requests und Builds auf einem OneDev-Server durchsuchen.

## Einrichtung

1. In OneDev: **My Account → Access Tokens → Add** und das Token kopieren.
2. In Raycast beim ersten Start eintragen:
   - **Server URL**: z. B. `https://onedev.example.com`
   - **Access Token**

## Befehle

| Befehl | |
|---|---|
| **Search Projects** | Projekte suchen; von dort zu Issues (Ctrl/Cmd+I), Pull Requests (Ctrl/Cmd+R) oder Builds (Ctrl/Cmd+B) |
| **Search Issues** | Filter: Open, Assigned to Me, Submitted by Me, Watched by Me, Mentioned Me, All; Detailansicht mit Beschreibung |
| **Search Pull Requests** | Filter: Open, To Be Reviewed by Me, Submitted by Me, Assigned to Me, Merged, All |
| **Search Builds** | Filter: All, Running, Failed, Successful, Submitted by Me; Build-Log direkt öffnen |

Der Suchtext wird als unscharfe OneDev-Suche (`~text~`) geschickt. Der Filter „Open“ bei Issues sucht nach dem Status `Open`. Wer eigene Statusnamen nutzt, nimmt „All“.
