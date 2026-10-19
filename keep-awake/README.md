# Keep Awake

Hält den eigenen Rechner wach: kein Standby, Bildschirm bleibt an. Optional bleibt der Teams-Status auf **Verfügbar**.

## Befehle

| Befehl | Was er macht |
|---|---|
| **Keep Awake** | Zeigt den Status und startet für 30 Min, 1, 2, 4, 8 Std oder unbegrenzt. Mit **Ctrl+T** / **Cmd+T** startest du ohne bzw. mit Teams-Präsenz (das Gegenteil deiner Einstellung). Gestoppt wird über den Status-Eintrag oder das Aktionsmenü (**Ctrl+K** / **Cmd+K**). |
| **Toggle Keep Awake** | Schaltet ein (mit der Standarddauer) oder aus. Ideal mit eigenem Tastenkürzel, z. B. in Raycast unter **Settings → Extensions → Keep Awake**. |

Ein neuer Start ersetzt einen laufenden. Läuft die Zeit ab, gelten wieder die normalen Energieeinstellungen.

## Einstellungen

| Einstellung | Standard | Bedeutung |
|---|---|---|
| **Teams Presence** | an | Drückt nach 60 Sekunden ohne Eingabe die Taste **F15**. Die gibt es auf normalen Tastaturen nicht, sie löst also nichts aus. Für Windows (und Teams) gilt das aber als Aktivität. |
| **Display** | an | Bildschirm bleibt an. Aus: Nur der Standby wird verhindert. |
| **Default Duration** | unbegrenzt | Dauer für „Toggle Keep Awake“ |

> **Achtung:** Mit Teams-Präsenz sperrt sich der Rechner auch **nicht mehr automatisch**. Sperr ihn selbst, wenn du weggehst (**Win+L** bzw. **Ctrl+Cmd+Q**). Ohne Teams-Präsenz greift die automatische Sperre weiterhin.

## Wie es funktioniert

- **Windows:** Ein versteckter PowerShell-Prozess hält per `SetThreadExecutionState` eine Energieanforderung, das ist dieselbe Funktion, die Videoplayer nutzen. Nur bei aktiver Teams-Präsenz drückt er F15, und auch nur, wenn seit 60 Sekunden keine Eingabe kam.
- **macOS:** `caffeinate` verhindert den Ruhezustand. Die F15-Taste kommt über `osascript`. Dafür braucht Raycast beim ersten Mal die Berechtigung unter **Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen**.
- Gesteuert wird alles über eine Statusdatei im Support-Ordner der Extension. Stoppen löscht die Datei. Der Hintergrundprozess beendet sich dann innerhalb von 5 Sekunden und gibt die Energieanforderung frei. Nach einem Neustart des Rechners ist Keep Awake aus.
- Zugeklappte Laptops gehen je nach Energieeinstellung trotzdem in den Standby. Das lässt sich per Software nicht sauber verhindern.
