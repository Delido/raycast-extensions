# LAPS Connect

Für Admins: findet zu einem Benutzer die **WireGuard-IP** seines Rechners (UniFi-Gateway), ruft das **Windows-LAPS-Passwort** des Rechners aus Microsoft Entra ab und verbindet per **SSH** oder **RDP**, optional über einen Jump-Host.

Einrichtung der Entra-App und des UniFi-Keys: [docs/laps-connect-setup.md](../docs/laps-connect-setup.md).

## So funktioniert die Zuordnung

```
WireGuard-Benutzer in UniFi:  S-DOE       → feste Tunnel-IP 10.10.0.x
Rechner in Entra (LAPS):      S-DOE-LAP   (Name + Suffix "-LAP")
```

Angezeigt werden nur WireGuard-Einträge ohne Zusatz (`S-DOE`, nicht `S-DOE-PRIV`), per Einstellung *WireGuard Name Filter* (Standard `^.-[^-]+$`). Grün markiert = gerade per WireGuard verbunden (soweit UniFi das liefert).

## Aktionen

| Aktion | |
|---|---|
| **SSH with LAPS** (Enter) | LAPS-Passwort in die Zwischenablage, Windows Terminal öffnet `ssh <laps-konto>@<ip>`. Bei der Passwortabfrage **Rechtsklick** zum Einfügen |
| **RDP with LAPS** (Ctrl/Cmd+R) | Remotedesktop meldet sich direkt mit dem LAPS-Konto an |
| **SSH with Own Login** (Ctrl/Cmd+O) | SSH mit deinem eigenen Login, z. B. für Mac/Linux ohne LAPS |
| **Show LAPS Password** (Ctrl/Cmd+Shift+P) | Konto und Passwort anzeigen |
| Copy IP / Copy Device Name | |
| Refresh | Ctrl/Cmd+Shift+R |
| Lock LAPS Connect | Ctrl/Cmd+L |

Mit **Jump Host** in den Einstellungen (Alias aus `~/.ssh/config` oder `user@host:port`) läuft SSH über `ssh -J`, RDP über einen lokalen SSH-Tunnel (es öffnet sich ein Tunnel-Tab, danach Remotedesktop auf `127.0.0.1:<port>`).

## Sicherheit

- **Eigenes Passwort:** LAPS Connect hat ein eigenes Passwort. Der UniFi-API-Key wird damit verschlüsselt gespeichert (scrypt + AES-256-GCM) und steht nicht in den Raycast-Einstellungen. Ohne Entsperren zeigt die Extension keine Geräte an und ruft keine LAPS-Passwörter ab.
- **Auto-Lock** nach 5 Minuten ohne Nutzung (einstellbar), sofort sperren mit **Lock LAPS Connect** oder Ctrl/Cmd+L. Nach 5 falschen Passwörtern ist 60 s Pause.
- Optional **On Lock → Also sign out of Microsoft**: Dann braucht jeder Abruf nach dem Entsperren eine neue Microsoft-Anmeldung inklusive MFA.
- Passwort ändern und den UniFi-Key tauschen geht im Aktionsmenü (Abschnitt *Security*). Passwort vergessen: im Sperrbildschirm *Reset* und den Key neu eingeben.
- Eigene Entra-App, **nur für eine Admin-Gruppe** freigegeben, nur delegierte Rechte. Ein Passwort erhält nur, wer zusätzlich eine Entra-Rolle zum Lesen von LAPS-Passwörtern hat.
- **Jeder Abruf** steht im Entra-Audit-Log.
- LAPS-Passwörter werden **nie gespeichert**. In der Zwischenablage landen sie **ohne Windows-Zwischenablage-Verlauf und ohne Cloud-Sync** und werden nach 15/30/60 Sekunden automatisch gelöscht.
- RDP: Die Anmeldedaten werden über die Windows-API direkt in den Anmeldespeicher geschrieben (kein Passwort auf einer Kommandozeile) und nach 20 Sekunden wieder gelöscht.
- SSH prüft den Host-Key pro **Gerät** (`HostKeyAlias=<GERÄT>-LAP`), nicht pro WireGuard-IP.
- UniFi wird nur gelesen, mit dem Key eines **View-Only**-Benutzers. Die WireGuard-Liste kommt aus der nicht offiziell dokumentierten v2-API von UniFi Network. Nach UniFi-Updates bitte kurz prüfen.

## Einstellungen

Tenant ID, Client ID, UniFi URL (Pflicht) · Auto-Lock After · On Lock (Microsoft abmelden) · Allow self-signed certificate · Jump Host · WireGuard Name Filter · Windows Device Suffix (`-LAP`) · Clear Clipboard After · Terminal (Windows Terminal / Preview / PowerShell)
