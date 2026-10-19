# AMP

Game-Server in [CubeCoders AMP](https://cubecoders.com/AMP) aus Raycast steuern: Instanzen starten und stoppen, Konsole, Spieler, Backups, Zeitpläne und Einstellungen, neue Server anlegen.

## Einrichtung

In Raycast beim ersten Start eintragen:

- **Panel URL**: Adresse deines AMP-Panels (ADS), z. B. `http://amp.example.com:8080`
- **Username** und **Password** deines AMP-Kontos

Die Extension meldet sich über die AMP-API an. Sie kann nur, was dein AMP-Benutzer auch im Panel darf.

## Befehle

| Befehl | |
|---|---|
| **Manage Servers** | Alle Instanzen mit Status und Auslastung. Server starten, stoppen, neu starten, killen, aktualisieren. Instanzen starten/stoppen/löschen, alle auf einmal starten, stoppen oder updaten. Details mit Spielern, Konsole, Backups, Zeitplan und Einstellungen |
| **Create Game Server** | Neue Instanz aus der Anwendungsliste von AMP anlegen, Filter nach Kategorie |

## In der Detailansicht einer Instanz

| Bereich | |
|---|---|
| **Console** | Konsole live mitlesen und Befehle senden |
| **Players** | Wer gerade online ist |
| **Backups** | Backup erstellen, wiederherstellen, löschen |
| **Schedule** | Geplante Aufgaben ansehen, sofort ausführen, an/aus schalten |
| **Settings** | Einstellungen der Instanz durchsuchen und ändern |

Außerdem: Verbindungsadresse kopieren, Instanz im AMP-Panel öffnen, Name und Beschreibung bearbeiten, Autostart umschalten.
