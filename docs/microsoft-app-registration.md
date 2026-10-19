# Microsoft-App-Registrierung für SharePoint und Teams

Die Extensions **SharePoint** und **Microsoft Teams** greifen über Microsoft Graph auf Microsoft 365 zu. Dafür braucht es **eine** App-Registrierung in Microsoft Entra ID, die beide Extensions gemeinsam nutzen. Ein Administrator legt sie einmal pro Organisation an. Das dauert etwa 5 Minuten.

## Was die App darf

- Nur **delegierte** Berechtigungen. Die App handelt immer im Namen der angemeldeten Person und sieht nur, was diese Person auch in SharePoint und Teams sieht.
- Keine Anwendungsberechtigungen und kein Client Secret. Die Anmeldung läuft als Public Client mit PKCE.
- Schreibend sind nur: Nachrichten **als die angemeldete Person** senden, 1:1-Chats anlegen und den **eigenen** Teams-Status setzen.
- Die Tokens liegen verschlüsselt lokal in Raycast. Daten fließen nur zwischen Raycast und Microsoft Graph.

## 1. App registrieren

**Entra Admin Center → Applications → App registrations → New registration**

- Name: z. B. `Raycast`
- Supported account types: **Accounts in this organizational directory only (Single tenant)**
- Redirect URI: leer lassen → **Register**

## 2. Anmeldung konfigurieren

**Authentication → Add a platform → Mobile and desktop applications**

- Custom redirect URI: `https://raycast.com/redirect?packageName=Extension`
- Unter *Advanced settings* **Allow public client flows = Yes** setzen und speichern.

Wichtig: Die URI muss unter **Mobile and desktop applications** stehen, nicht unter *Web* oder *Single-page application*. Sonst schlägt die Anmeldung mit AADSTS7000218 bzw. AADSTS9002327 fehl.

## 3. Berechtigungen

**API permissions → Add a permission → Microsoft Graph → Delegated permissions**

| Berechtigung | Extension | Wofür |
|---|---|---|
| `offline_access` | beide | Angemeldet bleiben |
| `User.Read` | beide | Eigenes Profil |
| `Files.Read.All` | SharePoint | Dokumente durchsuchen |
| `Sites.Read.All` | SharePoint | Seiten und Sites durchsuchen |
| `User.ReadBasic.All` | Teams | Kollegen suchen |
| `People.Read` | Teams | Häufige Kontakte vorschlagen |
| `Presence.Read.All` | Teams | Status von Kollegen anzeigen |
| `Presence.ReadWrite` | Teams | Eigenen Status setzen |
| `Team.ReadBasic.All` | Teams | Eigene Teams auflisten |
| `Channel.ReadBasic.All` | Teams | Kanäle auflisten |
| `Chat.Read` | Teams | Eigene Chats lesen und durchsuchen |
| `Chat.Create` | Teams | 1:1-Chat öffnen bzw. anlegen |
| `ChatMessage.Send` | Teams | Nachricht in einen Chat senden |
| `ChannelMessage.Read.All` | Teams | Kanalnachrichten durchsuchen (nur in eigenen Teams) |
| `ChannelMessage.Send` | Teams | Nachricht in einen Kanal posten |
| `Calendars.Read` | Teams | Anstehende Meetings, „Join Next Meeting“ |

Wer nur SharePoint nutzt, braucht nur die ersten vier.

Danach **Grant admin consent for <Organisation>** klicken. Dann sehen die Benutzer keine Zustimmungsabfrage mehr. `ChannelMessage.Read.All` erfordert in jedem Fall eine Administratorzustimmung.

## 4. Werte an die Benutzer weitergeben

Aus der Übersicht der App-Registrierung:

- **Application (client) ID** → in Raycast als *Client ID*
- **Directory (tenant) ID** → in Raycast als *Tenant ID*

Beide Werte sind nicht geheim.

## Optional: Zugriff auf eine Gruppe beschränken

**Enterprise applications → Raycast → Properties → Assignment required = Yes**, danach unter *Users and groups* die gewünschte Gruppe zuweisen.

## Zurücknehmen

Die App-Registrierung löschen oder unter *Enterprise applications* deaktivieren. Damit sind alle Raycast-Anmeldungen sofort ungültig.

## Fehler bei der Anmeldung

| Meldung | Ursache |
|---|---|
| AADSTS50011 | Redirect-URI stimmt nicht exakt überein (Schritt 2) |
| AADSTS65001 / „Administratorgenehmigung erforderlich“ | Admin consent fehlt (Schritt 3) |
| AADSTS7000218 | URI unter *Web* statt *Mobile and desktop*, oder „Allow public client flows“ steht nicht auf *Yes* |
| AADSTS9002327 | URI unter *Single-page application* eingetragen |
| „Missing permission“ in Raycast | Eine Berechtigung aus Schritt 3 fehlt oder hat noch keinen Admin consent |
