# Einrichtung von LAPS Connect

[LAPS Connect](../laps-connect/) braucht zwei Dinge: eine **Entra-App**, über die Admins Windows-LAPS-Passwörter lesen, und einen **API-Key für das UniFi-Gateway**, das die WireGuard-Benutzer kennt. Beides legt ein Administrator einmal an.

## 1. Entra-App (Microsoft Graph)

Eine eigene App, getrennt von der für SharePoint und Teams. So bleibt der Zugriff auf LAPS-Passwörter auf Admins beschränkt.

**Entra Admin Center → Applications → App registrations → New registration**

- Name: z. B. `Raycast LAPS Connect`
- Supported account types: **Accounts in this organizational directory only (Single tenant)**
- Redirect URI: leer lassen → **Register**

**Authentication → Add a platform → Mobile and desktop applications**

- Custom redirect URI: `https://raycast.com/redirect?packageName=Extension`
- Unter *Advanced settings* **Allow public client flows = Yes**

**API permissions → Add a permission → Microsoft Graph → Delegated permissions**

| Berechtigung | Wofür |
|---|---|
| `offline_access` | Angemeldet bleiben |
| `User.Read` | Eigenes Profil |
| `DeviceLocalCredential.Read.All` | LAPS-Passwörter lesen |

Danach **Grant admin consent** klicken. Es gibt nur delegierte Berechtigungen und kein Client Secret.

**Auf Admins beschränken:** **Enterprise applications → Raycast LAPS Connect → Properties → Assignment required = Yes**, dann unter **Users and groups** nur die Admin-Gruppe zuweisen.

**Rolle zum Lesen:** Die Graph-Berechtigung allein reicht nicht. Die angemeldete Person braucht zusätzlich eine Entra-Rolle mit `microsoft.directory/deviceLocalCredentials/password/read`, z. B. *Cloud Device Administrator* oder *Intune Administrator*, besser eine eigene Rolle nur mit diesem Recht.

In Raycast trägst du **Directory (tenant) ID** als *Tenant ID* und **Application (client) ID** als *Client ID* ein. Jeder Abruf eines Passworts steht im Entra-Audit-Log.

## 2. UniFi-API-Key

LAPS Connect liest die WireGuard-Benutzer und ihre festen Tunnel-IPs nur.

1. In UniFi einen eigenen Benutzer mit Rolle **View Only** für die Network-App anlegen.
2. Als dieser Benutzer anmelden: **UniFi Network → Settings → Control Plane → Integrations → Create API Key**.
3. In Raycast die **UniFi URL** des Gateways eintragen, z. B. `https://192.168.1.1`. Den Key fragt LAPS Connect beim ersten Start ab und speichert ihn **mit deinem LAPS-Connect-Passwort verschlüsselt**, nicht in den Raycast-Einstellungen.

Die Liste der WireGuard-Benutzer kommt aus der nicht offiziell dokumentierten v2-API von UniFi Network. Nach UniFi-Updates kurz prüfen, ob sie noch geladen wird.

## 3. Namensschema

LAPS Connect ordnet WireGuard-Benutzer und Rechner über den Namen zu: aus dem WireGuard-Benutzer `S-DOE` wird der Rechner `S-DOE-LAP` (Einstellung *Windows Device Suffix*). Welche WireGuard-Einträge angezeigt werden, steuert *WireGuard Name Filter* (Standard `^.-[^-]+$`, also z. B. `S-DOE`, aber nicht `S-DOE-PRIV`). Passe beides an euer eigenes Schema an.
