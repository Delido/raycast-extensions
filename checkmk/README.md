# Checkmk

Hosts und Services in Checkmk suchen, Probleme bestätigen oder in eine Downtime setzen und bei neuen Problemen benachrichtigt werden.

## Einrichtung

1. In Checkmk einen Benutzer für Raycast anlegen oder den eigenen nutzen (**Setup → Users**). Empfohlen ist ein **Automation Secret**.
   - Zum Suchen und für Benachrichtigungen reicht Lesezugriff.
   - Für Acknowledge und Downtimes braucht der Benutzer die entsprechenden Rechte auf den Hosts, z. B. die Rolle *Normal monitoring user*.
2. In Raycast beim ersten Start eintragen:
   - **Site URL** inklusive Site-Name: `https://monitoring.example.com/mysite`
   - **Username** und **Automation Secret / Password**
   - Bei internem Zertifikat **Allow self-signed certificates** anhaken.

## Befehle

| Befehl | |
|---|---|
| **Show Problems** | Unbehandelte (oder alle) Host- und Service-Probleme, die schlimmsten zuerst |
| **Search Hosts** | Suche nach Name, Alias oder IP; Filter: alle, down, mit Service-Problemen; weiter zu den Services eines Hosts |
| **Search Services** | Suche nach Host und/oder Service (`web01 cpu`); Filter: Problems, Unhandled, CRIT, WARN, UNKNOWN |
| **Problem Monitor** | Prüft im Hintergrund und benachrichtigt bei neuen Problemen |

Aktionen auf Hosts und Services: in Checkmk öffnen, **Acknowledge** (Ctrl/Cmd+Shift+A), **Downtime** von 30 Minuten bis 1 Woche (Ctrl/Cmd+D), Check-Ausgabe ansehen, Status kopieren.

## Problem Monitor

Den Monitor startest du, indem du **Problem Monitor** einmal von Hand ausführst. Dabei zeigt er auch den aktuellen Stand. Danach läuft er im Hintergrund. Einstellen lässt er sich in den Einstellungen des Befehls:

- **Check Every**: 1–30 Minuten
- **Minimum Severity**: nur CRIT / CRIT + UNKNOWN / ab WARN
- Host-Ausfälle melden, bestätigte Probleme und Downtimes ignorieren, Erholungen melden
- **Regex-Filter** für Hosts, Services und auszuschließende Services
- **Notification**: Windows-/macOS-Benachrichtigung oder Raycast-HUD

Gemeldet werden nur **neue** Probleme oder solche, die schlimmer werden (WARN → CRIT). Bei mehr als drei auf einmal kommt eine Sammelmeldung. Ein Klick auf die Benachrichtigung öffnet Checkmk.
