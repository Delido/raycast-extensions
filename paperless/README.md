# Paperless-ngx

Dokumente in [Paperless-ngx](https://docs.paperless-ngx.com) durchsuchen, bearbeiten, herunterladen und hochladen.

## Einrichtung

1. In Paperless: **Mein Profil → API-Auth-Token** erzeugen und kopieren.
2. In Raycast die **Server URL** eintragen, z. B. `https://paperless.example.com`.
3. Beim ersten Öffnen eines Befehls fragt die Extension nach dem **API-Token** und einem **Passwort**, das du selbst festlegst.

## Schutz

Einmal eingerichtet, soll nicht jeder, der an deinem entsperrten PC sitzt, deine Dokumente sehen können:

- Das API-Token wird **mit deinem Passwort verschlüsselt** gespeichert (scrypt + AES-256-GCM). In den Raycast-Einstellungen steht es nicht. Ohne Passwort kommt niemand an das Token und damit an Paperless.
- Jeder Befehl fragt erst nach dem Passwort. Danach bleibt Paperless offen, bis es **Auto-Lock After** lang (Standard 15 min) nicht benutzt wurde.
- **Sperren** sofort mit dem Befehl **Lock Paperless** oder Ctrl/Cmd+L in einer Dokumentliste. Dabei werden auch die zwischengespeicherten Vorschaubilder gelöscht.
- Nach 5 falschen Passwörtern ist 30 s Pause.
- **Passwort ändern**: Aktionsmenü eines Dokuments → Change Password.
- **Passwort vergessen**: Im Sperrbildschirm „Reset“ wählen, dann ein neues API-Token eingeben. Eine Wiederherstellung gibt es absichtlich nicht.

Nicht geschützt sind Dateien, die du herunterlädst. Sie liegen ganz normal im Download-Ordner.

## Befehle

| Befehl | |
|---|---|
| **Search Documents** | Volltextsuche mit Paperless-Syntax (z. B. `rechnung 2025`, `tag:versicherung`, `correspondent:telekom`). Ohne Suchtext erscheinen die neuesten Dokumente. Filter nach Dokumenttyp, Tag oder Korrespondent. Detailansicht mit Vorschaubild, Treffer-Ausschnitt und Metadaten (Ctrl/Cmd+D) |
| **Inbox** | Alle Dokumente mit einem Posteingangs-Tag. Bearbeiten und mit „Remove from Inbox“ (Ctrl/Cmd+Shift+I) aus dem Posteingang nehmen |
| **Lock Paperless** | Sofort sperren und Vorschaubilder löschen |
| **Upload Document** | Eine oder mehrere Dateien hochladen, optional mit Titel, Datum, Korrespondent, Dokumenttyp und Tags. Dateien, die im Explorer/Finder markiert sind, werden vorausgewählt. Der Befehl wartet, bis Paperless die Datei verarbeitet hat, und bietet dann „Open in Paperless“ an |

## Aktionen auf einem Dokument

| Aktion | Kürzel |
|---|---|
| Im Browser öffnen | Enter |
| Herunterladen und öffnen | Ctrl/Cmd+O |
| Details ein/aus | Ctrl/Cmd+D |
| Bearbeiten (Titel, Datum, Korrespondent, Typ, Tags, ASN) | Ctrl/Cmd+E |
| Ähnliche Dokumente | Ctrl/Cmd+Shift+M |
| Original herunterladen, im Ordner zeigen, Link/Titel/ASN kopieren | Aktionsmenü |
| Paperless sperren | Ctrl/Cmd+L |

Heruntergeladen wird das archivierte PDF (mit Texterkennung), „Download Original“ holt die ursprünglich hochgeladene Datei.
