# CS2 Nades

Smoke-, Molotov-, Flash- und HE-Lineups für die **Counter-Strike-2-Premier-Maps** direkt in Raycast, mit Lineup-Bild und Video.

Alle Lineups, Bilder und Videos stammen von **[csnades.gg](https://csnades.gg)** und werden beim Öffnen live von dort geladen. Dieses Repository enthält keine Inhalte von csnades.gg. Jedes Lineup verlinkt auf seine Seite bei csnades.gg.

## Bedienung

Im Dropdown oben rechts wählst du die Map. Die Liste ist nach Smokes, Molotovs, Flashbangs und HE-Granaten gruppiert. Rechts siehst du das Lineup-Bild (wohin zielen), den Landepunkt, die Wurftechnik (z. B. Jump Throw), die Bewegung und die nötige Genauigkeit.

| Taste | Aktion |
|---|---|
| **Enter** | HQ-Video im Browser abspielen |
| **Ctrl+O** | Lineup auf csnades.gg öffnen |
| **Ctrl+L** | Video in niedriger Qualität |
| **Ctrl+I** | Lineup-Bild groß öffnen |
| **Ctrl+Shift+T** | Seite wechseln: T + CT → T → CT |
| **Ctrl+Shift+E** | Nur empfohlene Lineups (von csnades.gg als die wichtigsten markiert) |
| **Ctrl+R** | Neu laden |
| **Ctrl+Shift+F** | ffmpeg per winget installieren (nur wenn es fehlt) |

Die Suche findet Ziel und Wurfposition, z. B. `jungle`, `window`, `ct`, `flash`. Ein Stern markiert empfohlene Lineups, sie stehen in jeder Gruppe oben. In den Einstellungen kannst du festlegen, dass beim Start nur empfohlene gezeigt werden.

## Video in Raycast

Raycast kann keine Videos abspielen, aber animierte GIFs anzeigen. Die Extension wandelt darum das Video des ausgewählten Lineups mit **ffmpeg** in ein GIF um (480 px, 10 fps, ohne Ton, etwa 5 Sekunden) und zeigt es rechts über dem Lineup-Bild. Umgewandelt wird nur der ausgewählte Eintrag, beim Weiterscrollen bricht die Umwandlung ab. Fertige GIFs liegen im Support-Ordner der Extension (höchstens 500 MB, die ältesten werden zuerst gelöscht).

ffmpeg wird automatisch gefunden (PATH, winget, Chocolatey, Scoop, Homebrew). Fehlt es, installiert **Ctrl+Shift+F** unter Windows `Gyan.FFmpeg.Essentials` per winget. In den Einstellungen lässt sich das Video abschalten oder ein eigener ffmpeg-Pfad angeben.

## Map-Pool

Premier Season Five (seit Juli 2026): Ancient, Anubis, Cache, Dust 2, Inferno, Mirage, Nuke. Dazu Overpass, Train und Vertigo. Rotiert Valve den Pool, wird `PREMIER_MAPS` in [src/csnades.ts](src/csnades.ts) angepasst.

## Technik

csnades.gg hat keine API. Die Extension lädt pro Map die vier öffentlichen Seiten (`/<map>`, `/<map>/molotovs`, `/flashbangs`, `/hegrenades`) und liest die Lineups aus den Next.js-Daten der Seite. Ergebnisse werden zwischengespeichert und im Hintergrund aktualisiert. Ändert csnades.gg das Seitenformat, zeigt die Extension einen Hinweis statt einer leeren Liste.
