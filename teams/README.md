# Microsoft Teams

Personen finden, chatten, Nachrichten durchsuchen, den eigenen Status setzen und Meetings beitreten, direkt aus Raycast.

## Einrichtung

1. Einmal pro Organisation: App-Registrierung in Entra ID anlegen, siehe [docs/microsoft-app-registration.md](../docs/microsoft-app-registration.md). Die SharePoint-Extension nutzt dieselbe App, Teams braucht nur weitere Berechtigungen.
2. In Raycast beim ersten Start **Tenant ID** und **Client ID** dieser App-Registrierung eintragen.

3. Beim ersten Befehl öffnet sich die Microsoft-Anmeldung im Browser. Danach bleibst du angemeldet.

## Befehle

| Befehl | |
|---|---|
| **Search People** | Kollegen mit Teams-Status suchen (ohne Eingabe: häufige Kontakte); Chat öffnen, Nachricht senden (Ctrl/Cmd+M), Anruf, Videoanruf, E-Mail |
| **Search Chats** | Letzte Chats mit Vorschau; öffnen oder direkt antworten (Ctrl/Cmd+M) |
| **Teams & Channels** | Alle Teams und Kanäle; Kanal öffnen oder dort posten (Ctrl/Cmd+M) |
| **Search Messages** | Volltextsuche in Chats und Kanälen, mit Sprung zur Nachricht |
| **Set Status** | Verfügbar, Beschäftigt, Nicht stören, Gleich zurück, Abwesend, Offline, wahlweise mit Dauer; Statusnachricht |
| **Upcoming Meetings** | Die nächsten 7 Tage; laufende und bald beginnende Meetings markiert; Beitritt mit einem Klick |
| **Join Next Meeting** | Tritt dem laufenden oder dem nächsten Meeting der kommenden 30 Minuten bei. Passt gut auf ein Tastenkürzel |

Nachrichten schreibst du in einem Formular und schickst sie mit Ctrl/Cmd+Enter ab.

## Einstellungen

- **Open Links In**: Chats, Kanäle und Meetings in der Teams-App (Standard) oder im Browser öffnen.
