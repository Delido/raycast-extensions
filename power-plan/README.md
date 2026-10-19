# Power Plan

Windows-Energiesparpläne aus Raycast wechseln und automatisch umschalten lassen: Läuft ein Spiel, gilt der Spiele-Plan (Standard: Höchstleistung), sonst der Plan für den Alltag (Standard: Energiesparmodus). Nur für Windows.

## Befehle

| Befehl | |
|---|---|
| **Power Plans** | Alle Pläne mit dem aktiven. Plan aktivieren, als Spiele-Plan (Ctrl+Shift+G) oder Alltags-Plan (Ctrl+Shift+I) festlegen. Ganz oben steht der Status der Automatik: an/aus, pausiert, gerade erkanntes Spiel. Automatik ein/aus (Ctrl+Shift+T), pausieren für 30 min / 1 h / 3 h / bis morgen früh (Ctrl+Shift+P) |
| **Game Detection** | Welche laufenden Programme als Spiel zählen und warum. Programme als Spiel markieren oder ausschließen, eigene Regeln wieder entfernen |
| **Automatic Power Plan** | Läuft im Hintergrund alle 10 Sekunden und schaltet um |
| **Toggle Automatic Power Plan** | Automatik ein- oder ausschalten, gut für einen eigenen Hotkey |

## Einschalten

In Raycast **Settings → Extensions → Power Plan → Automatic Power Plan** die Hintergrundaktualisierung einschalten. Dort lässt sich auch einstellen:

- **Switch Back After (s)**: wie lange nach dem Beenden des letzten Spiels gewartet wird, bevor der Alltags-Plan zurückkommt (Standard 60 s). So wird nicht umgeschaltet, wenn ein Spiel neu startet oder der Launcher kurz übernimmt.
- **Notify on Switch**: Hinweis beim automatischen Wechsel (Standard aus, damit im Spiel nichts aufpoppt)
- **Always enforce the automatic plan**: Standardmäßig bleibt ein von Hand gewählter Plan aktiv, bis das nächste Spiel startet oder endet. Mit dieser Option stellt die Automatik ihren Plan nach spätestens 10 Sekunden wieder her.

## Spielerkennung

Ein Programm zählt als Spiel, wenn es
1. **in einer Spielbibliothek liegt**: `steamapps\common`, Epic Games, GOG, Xbox (`XboxGames`), Riot Games, Ubisoft, EA/Origin, Battle.net, Amazon Games, auf jedem Laufwerk. Weitere Ordner trägst du unter **Additional Game Folders** ein, z. B. `D:\Games`.
2. **auf deiner Liste steht** („Treat as Game“ in Game Detection).
3. optional **im Vordergrund im Vollbild läuft** (Einstellung **Treat fullscreen apps as games**, Standard aus). Browser, Videoplayer und ähnliche Programme sind dabei ausgenommen.

Launcher und Hilfsprogramme (Steam, Epic Launcher, Anti-Cheat, Crash-Reporter, Wallpaper Engine …) sind ausgenommen, auch wenn sie in einem Spielordner liegen. Was trotzdem fälschlich erkannt wird, schließt du mit „Never Treat as Game“ aus.

## Tastatur-Game-Mode

Bei jeder Prüfung meldet die Extension dem Companion-Dienst der **SignalRGB**-Extension, ob ein Spiel läuft. Der schaltet damit den Hardware-Game-Mode der Tastatur. Das passiert auch, wenn die Energieplan-Automatik aus oder pausiert ist. Läuft der Dienst nicht, passiert nichts.

## Technik

- Pläne lesen und setzen und Prozesse auflisten macht der kleine Helfer `assets/power-helper.exe` (Go, Quelltext in [helper/](helper/)). Er nutzt `powrprof.dll` (`PowerEnumerate`, `PowerSetActiveScheme`) und die Windows-Prozess-API, braucht **keine Administratorrechte** und läuft pro Prüfung unter einer halben Sekunde.
- Die Pläne werden über ihre GUIDs erkannt, die Namen kommen von Windows, also auf Deutsch. Fehlt Höchstleistung, nimmt die Extension „Ultimative Leistung“ oder Ausbalanciert. Fehlt Energiesparmodus, nimmt sie Ausbalanciert.
- Den **Energiemodus** aus den Windows-11-Einstellungen („Beste Energieeffizienz“ / „Beste Leistung“) ändert die Extension nicht, nur den klassischen Energiesparplan.

Helfer neu bauen (Go 1.26 oder neuer):

```sh
npm run build:helper
```
