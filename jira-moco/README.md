# Jira MOCO Time Tracking

Zeit auf Jira-Vorgängen erfassen und mit einem Schritt doppelt buchen: als **Worklog im Jira-Vorgang** und als **Leistung in [MOCO](https://www.mocoapp.com)** auf dem Job des Vorgangs. Mehrere Timer gleichzeitig, zwischen denen du wechselst, sie pausierst und später buchst.

## Einrichtung

Beim ersten Start von **Track Time** öffnet sich der Assistent (später auch über **Set Up Jira and MOCO**). Jeder Schritt bekommt einen grünen Haken, sobald er erledigt ist:

1. **Jira Cloud verbinden**: Jira-Adresse (`firma.atlassian.net`), deine Atlassian-E-Mail und ein API-Token. Den Token erzeugst du unter [id.atlassian.com → Sicherheit → API-Token](https://id.atlassian.com/manage-profile/security/api-tokens), der Assistent öffnet die Seite.
2. **Felder wählen**: welches Jira-Feld die **Jobnummer** enthält und welches den **Auftrag**. Felder mit „Job“ bzw. „Auftrag“ im Namen sind vorausgewählt.
3. **MOCO verbinden**: MOCO-Adresse (`firma.mocoapp.com`) und entweder deine MOCO-E-Mail und dein Passwort (die Extension holt damit deinen persönlichen API-Key und speichert nur den) oder direkt den API-Key aus MOCO → Profil → Integrationen, z. B. bei Anmeldung mit Google oder Microsoft.
4. **Test**: zeigt für deine zuletzt angesehenen Jira-Vorgänge, welche Jobnummer und welcher Auftrag gelesen werden und welches MOCO-Projekt und welche Leistung daraus werden.

### So wird zugeordnet

- **Jobnummer → MOCO-Projekt**: Verglichen wird mit der Projektnummer (*Identifier*) deiner MOCO-Projekte, also den Projekten, in denen du buchen darfst. Groß/klein und Leerzeichen spielen keine Rolle. `P1234 Website` findet `P1234`, `1234` findet `P1234`, wenn es eindeutig ist.
- **Auftrag → Leistung**: Verglichen wird mit den Leistungen des Projekts, erst exakt, dann eindeutiger Teiltreffer. Hat ein Projekt nur eine Leistung, wird diese genommen.
- Steht die Jobnummer in einem anderen Text, etwa in der Zusammenfassung `[P1234] Relaunch`, wählst du dieses Feld und trägst in den Einstellungen ein **Job Number Pattern** ein, z. B. `\[(\w+)\]`. Die erste Klammergruppe ist dann die Jobnummer. Für den Auftrag gibt es das **Order Pattern**.
- Findet sich nichts, wählst du Projekt und Leistung beim Buchen aus. Die Extension merkt sich die Wahl für diesen Vorgang.

## Befehle

| Befehl | |
|---|---|
| **Track Time** | Vorgänge suchen (Key wie `ABC-123` oder Stichwort; ohne Eingabe die zuletzt in Jira angesehenen), Timer starten, pausieren, wechseln, buchen, Zeit manuell nachtragen |
| **Pause or Resume Timer** | Pausiert den laufenden Timer oder setzt den zuletzt benutzten fort, gut auf einen Hotkey. Mit aktivierter Hintergrundaktualisierung zeigt der Befehl in der Raycast-Suche den laufenden Timer an (`▶ ABC-123 0:42`) und hält das Symbol im Infobereich am Laufen. |
| **Booked Time** | Alle Buchungen aus der Extension nach Tagen mit Status für Jira und MOCO, dazu deine heutige Summe in MOCO. Fehlgeschlagene Teile erneut buchen, Buchung rückgängig machen. |
| **Set Up Jira and MOCO** | Der Einrichtungsassistent |

### Timer

- **Enter** auf einem Vorgang startet den Timer. Hat der Vorgang schon einen, läuft dieser weiter.
- **Enter** auf einem Timer pausiert ihn oder setzt ihn fort. Standardmäßig läuft immer nur ein Timer: Startest du einen anderen, pausiert der laufende. Abschalten lässt sich das in den Einstellungen (**Only one timer runs at a time**).
- **Ctrl/Cmd+B** bucht und beendet den Timer, **Ctrl/Cmd+E** setzt eine Notiz (sie wird zur Buchungsbeschreibung), **Ctrl/Cmd+T** korrigiert die Zeit, wenn du vergessen hast, ihn zu starten oder zu stoppen. **Ctrl/Cmd+Shift+P** pausiert alle.
- **Ctrl/Cmd+L** auf einem Vorgang trägt Zeit ohne Timer nach.
- **Ohne Jira-Vorgang**, etwa für Meetings oder interne Arbeit: Tipp ins Suchfeld, woran du arbeitest, und wähl **Start Timer „…“** ganz unten. Alternativ legt **Ctrl/Cmd+N** den Timer mit MOCO-Projekt und Leistung an. Gebucht wird so ein Timer nur in MOCO. Mit **Ctrl/Cmd+J** weist du ihm später doch noch einen Vorgang zu. Hat der Vorgang schon einen Timer, werden beide zusammengeführt.
- Timer bleiben gespeichert, auch wenn Raycast oder der Rechner neu startet.

### Symbol im Infobereich (Windows)

Unten rechts in der Taskleiste zeigt ein Symbol den aktuellen Timer:

- **grün** mit Minuten (`42`, ab einer Stunde `1:23`): ein Timer läuft
- **orange**: alle Timer pausiert, angezeigt wird der zuletzt benutzte
- **grau**: kein Timer

**Linksklick** pausiert den laufenden Timer oder setzt den zuletzt benutzten fort. **Rechtsklick** öffnet ein Menü mit allen Timern zum Wechseln (der laufende ist abgehakt), **Pause**, **Buchen** des laufenden Timers (öffnet direkt das Buchungsformular in Raycast), **Track Time**, **Booked Time** und **Hide Tray Icon**. Fährst du mit der Maus darüber, siehst du bis zu vier Timer mit ihrer Zeit.

Das Symbol startet, sobald du **Track Time** öffnest oder einen Timer änderst. Damit es nach einem Neustart von selbst wiederkommt, schalte beim Befehl **Pause or Resume Timer** die Hintergrundaktualisierung ein (Raycast → Settings → Extensions). Ausgeblendet bleibt es, bis du in **Track Time** **Show Tray Icon** wählst. Windows legt neue Symbole manchmal in den Überlauf (Pfeil nach oben): Ziehe es von dort in die Taskleiste.

Das Hilfsprogramm `assets/jira-moco-tray.exe` (Quelle in [tray/](tray/), Go) wird beim Bauen erzeugt, wenn Go installiert ist, sonst lädt der Installer es aus dem Release. Fehlt es, funktioniert alles andere trotzdem. Raycast und das Symbol teilen sich die Timer in einer Datei im Datenordner der Extension.

### Buchen

Das Formular ist vorausgefüllt: Dauer (gerundet nach der Einstellung **Round Booked Time**, z. B. auf 15 Minuten), Beschreibung, Startzeit, MOCO-Projekt und Leistung, abrechenbar laut Projekt und Leistung. Die Dauer nimmt `1:30`, `1h 30m`, `1.5` (Stunden) oder `90` (Minuten).

Gebucht wird gleichzeitig (ohne Jira-Vorgang nur in MOCO):

- **Jira**: Worklog mit Startzeit, Dauer und der Beschreibung als Kommentar. Beobachter werden standardmäßig nicht benachrichtigt (Einstellung **Notify watchers**).
- **MOCO**: Leistung am Tag der Startzeit mit Projekt, Leistung, Dauer und Beschreibung, verknüpft mit dem Jira-Vorgang (Key und Link).

Schlägt eine Seite fehl, ist die andere trotzdem gebucht. Der Timer ist dann beendet, und unter **Booked Time** buchst du den fehlenden Teil mit einem Klick nach. Schlagen beide fehl, bleibt der Timer bestehen.

## Datenschutz

Zugangsdaten (Jira-Token, MOCO-API-Key) und die Buchungsliste liegen im verschlüsselten Raycast-Speicher dieser Extension. Die Timer (Vorgang, Notiz, Zeiten) liegen in `timers.json` im Datenordner der Extension, damit das Symbol im Infobereich sie lesen kann. Das MOCO-Passwort wird nur einmal zum Abholen des API-Keys verwendet und nicht gespeichert. Die Extension spricht nur mit deiner Jira-Cloud-Instanz und deinem MOCO-Konto.
