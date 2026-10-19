# MTR

Traceroute wie WinMTR direkt in Raycast: Verlust und Latenz pro Hop live, dazu Ziele, die im Hintergrund überwacht werden, mit Verlauf, Alarmen, Erkennung von Routenwechseln und einem HTML-Bericht. Nur für Windows.

## Befehle

| Befehl | |
|---|---|
| **Trace Route** | Live-Traceroute. Ziel als Argument (`Trace Route 1.1.1.1`) oder aus Überwachten und Zuletzt verwendeten wählen. Pro Hop: Verlust, Ø-Latenz, Verlauf der letzten Proben (× = verloren). Detailansicht mit Graph, Best/Avg/Worst/Last, StDev, Jitter und allen Adressen, wenn der Hop lastverteilt ist. Pausieren (Ctrl+P), zurücksetzen (Ctrl+Shift+R), als Text kopieren wie in WinMTR (Ctrl+Shift+C), Ziel überwachen (Ctrl+S) |
| **Monitored Targets** | Überwachte Ziele mit Status, Graph (1 h / 24 h / 7 Tage), aktueller Route und Ereignissen. Ziel hinzufügen (Ctrl+N), sofort prüfen (Ctrl+R), Bericht öffnen (Ctrl+O), Live-Trace starten |
| **Background Monitor** | Prüft alle Ziele im Hintergrund, speichert den Verlauf und schickt Benachrichtigungen |
| **Open MTR Report** | Öffnet den HTML-Bericht im Browser |

## Hintergrund-Überwachung einschalten

1. In **Monitored Targets** Ziele hinzufügen, z. B. den Router, `1.1.1.1` und einen Server, der dir wichtig ist.
2. In Raycast **Settings → Extensions → MTR → Background Monitor** die Hintergrundaktualisierung einschalten. Dort stellst du auch ein, wie oft geprüft wird (1–15 Minuten).

Jede Prüfung schickt pro Ziel 10 Proberunden im Abstand von einer Sekunde (einstellbar unter „Probes per Check“), also etwa 10 Sekunden pro Prüfung. Alle Ziele laufen parallel.

**Benachrichtigungen** gibt es, wenn ein Ziel
- nicht mehr antwortet (🔴),
- Verlust oder Latenz über der Schwelle hat (🟠, Standard 20 % bzw. 150 ms),
- wieder in Ordnung ist (🟢),
- eine andere Route nimmt (🔀). Damit Lastverteilung keinen Fehlalarm auslöst, muss die neue Route zweimal hintereinander auftauchen. Hops ohne Antwort (`*`) zählen nicht als Änderung.

## HTML-Bericht

Der Bericht liegt im Datenordner der Extension (`report.html`) und wird nach jeder Hintergrundprüfung neu geschrieben. Im Browser lädt er sich jede Minute neu und funktioniert so als lokale Status-Seite. Er zeigt pro Ziel den Status, Graphen über 24 Stunden und 7 Tage (Ø-Latenz, Min/Max-Band, Verlust als rote Balken, Lücken = keine Messung) sowie die aktuelle Route und die Ereignisse.

## Technik

- Raycast-Extensions laufen in Node.js, und Node kann keine ICMP-Pakete mit eigenem TTL senden. Das übernimmt der kleine Helfer `assets/mtr-probe.exe` (Go, Quelltext in [probe/](probe/)). Er nutzt wie WinMTR die Windows-ICMP-API (`IcmpSendEcho`) und braucht **keine Administratorrechte**. Die Extension startet ihn bei Bedarf und beendet ihn wieder. Ein eigenes Programm oder ein Dienst läuft nicht.
- Pro Runde gehen die Pakete im Abstand von 15 ms raus. Viele Router (z. B. die Fritz!Box) beantworten „TTL abgelaufen“ nur etwa einmal pro Sekunde. Wer „Live Trace Interval“ unter 1000 ms setzt, sieht deshalb an solchen Hops Verlust, der in Wirklichkeit keiner ist. Das gilt bei jedem MTR. Entscheidend ist der Verlust am Ziel.
- Bisher nur IPv4.
- Daten: Ziele und Status im Raycast-LocalStorage, Verlauf als JSON-Lines-Datei pro Ziel im Datenordner der Extension. Ältere Daten löscht die Extension nach „Keep History“ (Standard 7 Tage).

Helfer neu bauen (Go 1.26 oder neuer):

```sh
npm run build:helper
```
