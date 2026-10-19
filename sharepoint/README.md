# SharePoint

SharePoint-Seiten und -Dokumente mit dem eigenen Microsoft-365-Konto durchsuchen. Jeder findet nur, was er auch in SharePoint sehen darf.

## Einrichtung

1. Einmal pro Organisation: App-Registrierung in Entra ID anlegen, siehe [docs/microsoft-app-registration.md](../docs/microsoft-app-registration.md).
2. In Raycast beim ersten Start **Tenant ID** und **Client ID** dieser App-Registrierung eintragen.

3. Beim ersten Suchen öffnet sich die Microsoft-Anmeldung im Browser und leitet über raycast.com zurück zu Raycast. Danach bleibst du angemeldet.

## Suche

- Standardmäßig werden nur **SharePoint-Seiten** gesucht. Über das Dropdown oben rechts wechselst du zu *Documents & Pages*, *Documents*, *Word*, *PDF*, *Excel*, *PowerPoint* oder *Sites*.
- Teilwörter funktionieren: „Troublesh“ findet „Troubleshooting“.
- Erweiterte Suchsyntax (KQL) ist möglich, z. B. `author:"Max Muster"`, `"genauer Satz"`, `filetype:pdf`.
- Vorschau mit hervorgehobenen Treffern: Ctrl/Cmd+Y.
- Dokumente öffnen im Browser oder direkt in Word, Excel oder PowerPoint (Ctrl/Cmd+O).

## Einstellungen

- **Limit Search To** (optional): Suche auf eine Site beschränken. Die URL der Site genügt, z. B. `https://contoso.sharepoint.com/sites/Doku`. Eigene KQL-Einschränkungen gehen auch, z. B. `path:"…"`.
