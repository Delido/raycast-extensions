# Bulk Rename

Viele Dateien auf einmal umbenennen, wie mit PowerRename aus den PowerToys, mit Live-Vorschau und Rückgängig.

## Benutzung

1. Dateien oder Ordner im Datei-Explorer (oder Finder) markieren.
2. In Raycast **Bulk Rename** öffnen: Die Auswahl wird übernommen. Alternativ wählst du die Dateien im Formular aus.
3. Suchen, Ersetzen und Optionen einstellen. Die Vorschau zeigt sofort, wie die Namen werden (**Ctrl+P** zeigt alle).
4. **Enter** benennt um. Danach bietet die Meldung **Undo** an, sonst später **Undo Last Bulk Rename**.

## Optionen

| Option | Bedeutung |
|---|---|
| Search For | Text oder regulärer Ausdruck. Leer = der ganze Name wird ersetzt |
| Replace With | Neuer Text, mit Platzhaltern (siehe unten) |
| Use regular expressions | JavaScript-Syntax, Gruppen mit `$1`, `$2` … im Ersetzen |
| Match all occurrences | Jede Fundstelle ersetzen, nicht nur die erste |
| Case sensitive | Groß/klein beim Suchen beachten |
| Apply To | Nur Name, nur Endung oder beides |
| Text Case | klein, GROSS, Title Case oder Jedes Wort Groß |
| Include | Dateien, Ordner, Inhalt markierter Ordner |

## Platzhalter im Ersetzen-Feld

| Platzhalter | Ergebnis |
|---|---|
| `${}` | fortlaufende Nummer 1, 2, 3 … |
| `${start=10,increment=5,padding=3}` | 010, 015, 020 … |
| `$YYYY` `$YY` `$MM` `$M` `$MMMM` `$MMM` `$DD` `$D` `$DDDD` `$DDD` | Datum der Erstellung |
| `$hh` `$mm` `$ss` `$fff` | Uhrzeit der Erstellung |
| `${rstringalnum=8}` `${rstringalpha=8}` `${rstringdigit=8}` `${ruuidv4}` | Zufall |
| `$$` | ein `$` |

Beispiel: Suchen leer, Ersetzen `Urlaub $YYYY-$MM-$DD ${padding=3}` → `Urlaub 2026-07-14 001.jpg`, `… 002.jpg` …

## Sicherheit

- Konflikte (zwei Dateien mit gleichem neuen Namen, Name bereits vorhanden) und ungültige Namen werden übersprungen und in der Vorschau angezeigt.
- Tauschen (`a` → `b`, `b` → `a`) funktioniert über einen Zwischennamen.
- Ordner werden nach ihrem Inhalt umbenannt, Rückgängig läuft in umgekehrter Reihenfolge.
