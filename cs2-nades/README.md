# CS2 Nades

Smoke-, Molotov-, Flash- und HE-Lineups für die **Counter-Strike-2-Premier-Maps** direkt in Raycast, mit Lineup-Bild und Video.

Alle Lineups, Bilder und Videos stammen von **[csnades.gg](https://csnades.gg)** und werden beim Öffnen live von dort geladen. Dieses Repository enthält keine Inhalte von csnades.gg. Jedes Lineup verlinkt auf seine Seite bei csnades.gg.

## Bedienung

Im Dropdown oben rechts wählst du die Map. Die Liste ist nach Smokes, Molotovs, Flashbangs und HE-Granaten gruppiert. Rechts siehst du das Lineup-Bild (wohin zielen), den Landepunkt, die Wurftechnik (z. B. Jump Throw), die Bewegung und die nötige Genauigkeit.

| Taste | Aktion |
|---|---|
| **Enter** | Video abspielen (HQ-MP4 im Browser) |
| **Ctrl+O** | Lineup auf csnades.gg öffnen |
| **Ctrl+L** | Video in niedriger Qualität |
| **Ctrl+I** | Lineup-Bild groß öffnen |
| **Ctrl+Shift+T** | Seite wechseln: T + CT → T → CT |
| **Ctrl+Shift+E** | Nur empfohlene Lineups (von csnades.gg als die wichtigsten markiert) |
| **Ctrl+R** | Neu laden |

Die Suche findet Ziel und Wurfposition, z. B. `jungle`, `window`, `ct`, `flash`. Ein Stern markiert empfohlene Lineups, sie stehen in jeder Gruppe oben. In den Einstellungen kannst du festlegen, dass beim Start nur empfohlene gezeigt werden.

Raycast kann Videos nicht selbst abspielen, darum öffnet Enter das MP4 im Browser.

## Map-Pool

Premier Season Five (seit Juli 2026): Ancient, Anubis, Cache, Dust 2, Inferno, Mirage, Nuke. Dazu Overpass, Train und Vertigo. Rotiert Valve den Pool, wird `PREMIER_MAPS` in [src/csnades.ts](src/csnades.ts) angepasst.

## Technik

csnades.gg hat keine API. Die Extension lädt pro Map die vier öffentlichen Seiten (`/<map>`, `/<map>/molotovs`, `/flashbangs`, `/hegrenades`) und liest die Lineups aus den Next.js-Daten der Seite. Ergebnisse werden zwischengespeichert und im Hintergrund aktualisiert. Ändert csnades.gg das Seitenformat, zeigt die Extension einen Hinweis statt einer leeren Liste.
