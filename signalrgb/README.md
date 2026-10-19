# SignalRGB

PC-Sensoren live aus [SignalRGB](https://signalrgb.com) anzeigen, Beleuchtungseffekte wechseln, Helligkeit und Layouts steuern. Nur für Windows.

## Voraussetzungen

- SignalRGB läuft auf demselben PC.
- Für Effekte, Helligkeit und Layouts brauchst du **SignalRGB Pro** und musst angemeldet sein (Vorgabe der offiziellen API).
- Für die Sensoren muss in SignalRGB das Monitoring aktiv sein (**Settings → Monitoring**).

Einrichten musst du nichts, die Standardadressen passen. Ändern kannst du sie unter **Settings → Extensions → SignalRGB**.

## Befehle

| Befehl | |
|---|---|
| **PC Sensors** | Alle Sensoren live, nach Gerät gruppiert: CPU-/GPU-Temperaturen, Lüfter und Pumpe, Last, Takt, Leistung, Netzwerk, Disk. Filter nach Kategorie, Favoriten anheften (Ctrl+Shift+P), Detailansicht mit Verlauf (Sekunden, Minuten, 5-Minuten-Schritte, Stunden) |
| **Lighting Effects** | Effekte durchsuchen und anwenden, Presets (Ctrl+P), Details mit Vorschaubild (Ctrl+D), vor/zurück (Ctrl+→/←), Zufall, an/aus, Helligkeit, Layout |
| **Next Effect** / **Previous Effect** / **Random Effect** | Effekt wechseln, ohne Fenster, gut für eigene Hotkeys |
| **Toggle Lighting** | Beleuchtung an oder aus |
| **Set Brightness** | Helligkeit direkt setzen, z. B. `Set Brightness 40` |
| **Switch Audio Output** | Standard-Audioausgabe wählen |
| **Next Audio Output** | Zur nächsten Audioausgabe wechseln (alle aktiven Ausgabegeräte der Reihe nach) |
| **Headset & Companion** | Akku und Mikrofon des Headsets, Game Mode der Tastatur, CS2-Status und Einrichtung, Dienst starten/stoppen, Log |
| **Toggle Microphone Mute** | Mikrofon stumm/frei (Windows und Headset), gut für einen Hotkey |
| **Companion Service** | Hintergrundbefehl, hält den Companion-Dienst am Laufen |

## Wie es funktioniert

| Teil | Schnittstelle |
|---|---|
| Effekte, Helligkeit, Layouts | Offizielle [SignalRGB Local API](https://docs.signalrgb.com/developer/signalrgb-api/introduction/) unter `http://127.0.0.1:16038` |
| Sensoren | „WebPipe“ unter `ws://127.0.0.1:16036`. Dort stellt SignalRGB seine internen Objekte per Qt-QWebChannel bereit. Dieselbe Schnittstelle nutzt die Mobile Remote, nur über WebRTC. Für die Extension brauchst du die Mobile Remote nicht |
| Headset, Tastatur, CS2, Audio | Companion-Dienst `assets/signal-helper.exe` (siehe unten) |

Die WebPipe ist **nicht dokumentiert**. Ein SignalRGB-Update kann sie ändern, dann funktioniert „PC Sensors“ nicht mehr, bis die Extension angepasst ist. Beim Öffnen von „PC Sensors“ lädt die Extension einmal den Zustand der App (etwa 9 MB, unter einer Sekunde). Danach kommen nur noch die Änderungen, ungefähr einmal pro Sekunde.

## Companion-Dienst (Ersatz für SignalCompanion)

Einige Funktionen müssen dauerhaft laufen, das kann eine Raycast-Extension allein nicht. Dafür startet der Befehl **Companion Service** den kleinen Hintergrunddienst `assets/signal-helper.exe` (Go, Quelltext in [helper/](helper/)). Er hat kein Fenster und kein Tray-Icon. Raycast prüft jede Minute, ob er läuft, und startet ihn bei Bedarf neu.

**Einmal einschalten:** Raycast **Settings → Extensions → SignalRGB → Companion Service** → Hintergrundaktualisierung an. Dort liegen auch alle Einstellungen. SignalCompanion muss vorher beendet bzw. deinstalliert sein, weil beide Port 3010 nutzen.

| Funktion | |
|---|---|
| **Mic Mute** | Mute-Taste am Headset → Windows-Mikrofon stumm (Discord, Teams usw. bekommen kein Signal). Umgekehrt schaltet ein Mute in Windows auch das Headset stumm. |
| **Battery Alert** | Akku wird jede Minute gelesen. Unter der Schwelle (Standard 20 %) und nach zwei Bestätigungsmessungen spielt ein Ton, optional mit Windows-Benachrichtigung. Wiederholung alle 30 min, bis geladen wird. |
| **Keyboard Game Mode** | Hardware-Game-Mode der Tastatur, solange ein Spiel läuft. Welche Programme Spiele sind, erkennt die **Power Plan**-Extension (deren Hintergrundbefehl muss an sein). Kommt 60 s keine Meldung, schaltet der Game Mode ab. |
| **CS2 Integration** | Empfänger für CS2 Game State Integration (`:3000`) und HTTPS-Brücke für den Effekt „CS2 Reactive“ (`:3443`). Beide laufen **nur, solange `cs2.exe` läuft** (plus 30 s). GSI-Config und Effekt lassen sich in **Headset & Companion** installieren. |
| **Audio-Router** | Dieselbe API wie SignalCompanion unter `http://127.0.0.1:3010`: `/next`, `/prev`, `/set?name=…`, `/current`, `/devices`. Makros in SignalRGB funktionieren weiter. |

Unterstützte Geräte (wie in SignalCompanion): Corsair Virtuoso XT Wireless (`1b1c:0a64`) und Corsair Vanguard Pro 96 (`1b1c:2b0e`).

Die Zertifikate für die HTTPS-Brücke werden aus SignalCompanion übernommen (`%APPDATA%\SignalCompanion\certs`), wenn vorhanden. SignalRGB vertraut ihnen dann schon. Sonst erzeugt der Dienst neue und trägt sie in SignalRGBs `cacert.pem` ein; danach SignalRGB einmal neu starten.

Daten und Log: `%LOCALAPPDATA%\Raycast\extensions\signalrgb\helper\` (Log auch über **Headset & Companion → Show Log**).

Dienst neu bauen (Go 1.26 oder neuer):

```sh
npm run build:helper
```
