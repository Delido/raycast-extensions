# Window Drag

Fenster mit **Alt + Maus ziehen** verschieben und in der Größe ändern, egal wo im Fenster du greifst, wie bei AltSnap. Nur für Windows.

| Aktion | Standard |
|---|---|
| **Verschieben** | Alt + **rechte** Maustaste gedrückt halten und ziehen |
| **Größe ändern** | Alt + **mittlere** Maustaste ziehen. Die Seite oder Ecke, die dem Mauszeiger am nächsten liegt, bewegt sich |

Taste und Maustasten sind einstellbar, ebenso Einrasten an den Bildschirmrändern, eine Ausschlussliste und ob das Fenster nach vorn geholt wird.

## Einschalten

Raycast **Settings → Extensions → Window Drag → Window Drag Service**: die Hintergrundaktualisierung einschalten. Dort liegen auch alle Einstellungen. Raycast startet den Helfer dann nach jedem Login innerhalb einer Minute und startet ihn neu, falls er beendet wird.

| Befehl | |
|---|---|
| **Window Drag Service** | Hintergrundbefehl, hält den Helfer am Laufen und überträgt die Einstellungen |
| **Toggle Window Drag** | Pausieren und fortsetzen, z. B. per Hotkey |

## Verhalten

- **Maximierte Fenster** werden beim Ziehen wiederhergestellt und hängen dabei passend am Mauszeiger.
- **Einrasten** an den Rändern des Bildschirms (15 px, einstellbar). Die unsichtbaren Fensterränder von Windows 10/11 werden berücksichtigt, die sichtbare Kante liegt also bündig am Rand.
- **Vollbild-Spiele und -Videos** werden ignoriert, dort funktioniert Alt + Klick normal. Weitere Programme schließt du unter *Excluded Programs* aus.
- Nach dem Ziehen öffnet sich weder das **Kontextmenü** (Rechtsklick) noch das **Alt-Menü** der Anwendung bzw. bei Win das Startmenü.
- Fenster von Programmen, die **als Administrator** laufen, lassen sich nicht verschieben, das verhindert Windows für normale Programme.

## Technik

Ein kleiner Helfer in Go (`assets/drag-helper.exe`, Quelltext in [helper/](helper/)) installiert einen Low-Level-Maus-Hook. Der Hook merkt sich nur die aktuelle Mausposition, ein eigener Thread verschiebt das Fenster jeweils an die neueste Position. Bei Mäusen mit 1000 Hz entsteht so kein Rückstau und kein Ruckeln. Der Helfer braucht keine Administratorrechte, hat kein Fenster und lauscht für Raycast nur auf `127.0.0.1:3011`.

Helfer neu bauen (Go 1.26 oder neuer): `npm run build:helper`, passiert bei `npm run dev` automatisch.
