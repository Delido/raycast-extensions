# SSH Sessions

Alle SSH-Hosts in Raycast finden und mit Enter im Terminal öffnen. Zusätzlich lassen sich Host-Listen zentral bereitstellen (OneDev-Repo, HTTPS-URL oder Dateifreigabe). **SSH-Keys bleiben immer lokal.**

## Was die Extension liest

- deine lokale `~/.ssh/config`
- die synchronisierten Team-Dateien in `~/.ssh/config.d/raycast-team-*.conf`

Ordner aus Kommentaren werden zu Gruppen: `# --- FIRMA\CLUSTER\DIENST ---` (wie im RDM-Export) oder `# section: …`. Pro Host optional `# description: …` und `# tags: …`.

## Befehle

| Befehl | |
|---|---|
| **Search SSH Hosts** | Suche nach Alias, Hostname, User, Ordner, Tags. Zuletzt genutzte Hosts oben. **Enter** = Verbindung im neuen Tab |
| **Manage SSH Sources** | Zentrale Quellen verwalten, persönliche Standards (eigener User, Key) setzen |
| **Sync SSH Sources** | Quellen jetzt abgleichen; läuft außerdem stündlich im Hintergrund |

Aktionen auf einem Host: in neuem Fenster verbinden (Ctrl/Cmd+O), als anderer User verbinden (Ctrl/Cmd+U), in VS Code öffnen (Ctrl/Cmd+Shift+V), SSH-Befehl/Hostname/Config-Block kopieren, Host hinzufügen (Ctrl/Cmd+N), lokale Config öffnen.

## Zentrale Quellen

**Manage SSH Sources → Add Source…**

| Typ | Angaben |
|---|---|
| **OneDev Repository** | Server-URL, Projektpfad, Branch, Datei oder Ordner (alle `*.conf`), Access Token (lesend) |
| **HTTPS URL** | URL einer Rohdatei, optional ein Auth-Header |
| **File / Share** | Datei oder Ordner, lokal oder als Netzwerkfreigabe |

- **Nur bei Änderungen:** OneDev prüft nur den letzten Commit des Branches, HTTPS nutzt ETag/Last-Modified, Dateien das Änderungsdatum. Heruntergeladen wird nur, wenn sich etwas geändert hat.
- **Offline:** Die letzte erfolgreich geladene Version bleibt als Cache in `~/.ssh/config.d/` liegen und wird weiter genutzt. Ein fehlgeschlagener Sync überschreibt nie etwas.
- **Einbindung in SSH:** Beim ersten Einrichten fügt die Extension nach Rückfrage einen markierten Block in `~/.ssh/config` ein (mit Backup). So funktionieren die Team-Hosts in jedem SSH-Client.
- **Reihenfolge:** eigene Hosts → Team-Hosts → persönliche Standards. Eigene Einträge übersteuern also Team-Hosts. Team-Hosts mit festem Login (`User root`) oder Jump-Host behalten diesen. Hosts ohne User bekommen deinen persönlichen Standard-User.
- **Sicherheit:** Optionen, die Befehle ausführen (`ProxyCommand`, `LocalCommand`, `Match exec`, `KnownHostsCommand`, `Include` …), werden in heruntergeladenen Dateien standardmäßig auskommentiert. `ProxyJump` bleibt erlaubt.

## Tunnel und Weboberflächen (Ersatz für RDM-„JumpHost“-Einträge)

Ein Host mit `DynamicForward` ist ein **SOCKS-Tunnel** (lila Symbol, Port als Tag). Mit `SessionType none` öffnet er keine Shell, sondern hält nur den Tunnel offen:

```
# web: https://10.0.20.5:8006
Host pve1-tunnel
    HostName 10.0.20.5
    User admin
    ProxyJump jump01
    DynamicForward 127.0.0.1:8201
    SessionType none
    ExitOnForwardFailure yes
```

- **Enter** startet den Tunnel in einem Terminal-Tab. Dort ggf. das Passwort des Jump-Hosts eingeben. Tab schließen beendet den Tunnel.
- **Open in Browser via Tunnel** startet den Tunnel, falls er noch nicht läuft, und wartet, bis er steht. Dann öffnet Edge oder Chrome (Einstellung *Tunnel Browser*) die `# web:`-Adresse in einem **eigenen Browserprofil**, das alles über den Tunnel schickt. Namensauflösung passiert auf der Gegenseite, interne Namen funktionieren also.

## Dateien per SFTP (direkt in Raycast)

**Browse Files (SFTP)** (Ctrl/Cmd+Shift+F) auf einem Host öffnet einen Dateibrowser in Raycast:

- Ordner mit Enter öffnen, `..` bzw. Ctrl/Cmd+↑ eine Ebene höher, Ctrl/Cmd+G springt zu einem Pfad. Die Suche filtert den aktuellen Ordner.
- Dateien: Vorschau (Text, die ersten 256 KB), **Download** in den Download-Ordner (Ctrl/Cmd+D) oder in einen beliebigen Ordner, Pfad kopieren, umbenennen, löschen.
- Ordner: **Dateien hochladen** (Ctrl/Cmd+U), neuen Ordner anlegen.

Die Verbindung nutzt dieselbe Konfiguration wie `ssh` (`ssh -G`), inklusive Jump-Hosts, Team-Hosts und persönlicher Standards:

- **Anmeldung:** zuerst der ssh-agent (unter Windows der OpenSSH-Agent), dann unverschlüsselte Keys aus `IdentityFile`, danach fragt Raycast nach dem Passwort. **Passwörter werden nicht gespeichert**, nur für die offene Verbindung im Speicher gehalten.
- **Host-Keys:** geprüft gegen deine `known_hosts`, wie bei `ssh`. Unbekannte Keys werden mit Fingerprint angezeigt (einmal vertrauen oder in `known_hosts` speichern). **Geänderte oder gesperrte Keys führen immer zum Abbruch.**
- Die Verbindung bleibt offen, solange der Browser offen ist. Esc schließt ihn und trennt die Verbindung.

Technischer Hinweis: Die SSH-Bibliothek `ssh2` wird vor dem Build mit `scripts/vendor-ssh2.mjs` gebündelt (`npm run dev` / `npm run build` erledigen das automatisch).

## Einstellungen

- **Terminal**: Automatisch (Windows Terminal bzw. Terminal.app), Windows Terminal Preview/Canary, PowerShell- oder cmd-Fenster, iTerm
- **Windows Terminal Profile**: optionales Profil für neue Tabs
- **Tunnel Browser**: Edge oder Chrome für „Open in Browser via Tunnel“
- **Auto Sync**: 15 Min / 1 Std / 4 Std / nur manuell
- **Security**: Befehls-Optionen aus Team-Quellen deaktivieren (Standard: an)

