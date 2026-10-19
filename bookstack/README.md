# BookStack

Das BookStack-Wiki durchsuchen und Seiten direkt in Raycast lesen.

## Einrichtung

1. In BookStack: **Profil → Edit Profile → API Tokens → Create Token**. Die Rolle braucht die Berechtigung „Access System API“.
2. In Raycast beim ersten Start eintragen:
   - **BookStack URL**: z. B. `https://wiki.example.com`
   - **Token ID** und **Token Secret**

## Befehle

| Befehl | |
|---|---|
| **Search BookStack** | Volltextsuche mit Typfilter (Seiten, Kapitel, Bücher, Regale) und Vorschau (Ctrl/Cmd+Y). Die BookStack-Suchsyntax funktioniert, z. B. `[tag=value]` |
| **Recently Updated Pages** | Zuletzt geänderte Seiten |
| **Browse Books** | Buch → Kapitel → Seiten; Seiten werden als Markdown in Raycast angezeigt |
| **Browse Shelves** | Regale und ihre Bücher |

Seiten lassen sich als Markdown kopieren (Ctrl/Cmd+M) oder direkt im Editor öffnen (Ctrl/Cmd+E).
