# Snipe-IT

Assets, Benutzer, Lizenzen, Zubehör und Verbrauchsmaterial in Snipe-IT durchsuchen und Assets aus- oder einchecken.

## Einrichtung

1. In Snipe-IT: oben rechts auf deinen Namen → **Manage API Keys → Create New Token** und das Token kopieren.
2. In Raycast beim ersten Start eintragen:
   - **Snipe-IT URL**: z. B. `https://assets.example.com`
   - **API Token**
   - Bei internem Zertifikat **Allow self-signed certificates** anhaken.

Du siehst und darfst in Raycast genau das, was deine Snipe-IT-Berechtigungen erlauben.

## Befehle

| Befehl | |
|---|---|
| **Search Assets** | Hardware nach Name, Asset-Tag, Seriennummer, Modell oder Person suchen; ohne Eingabe die zuletzt geänderten. Filter: Deployed, Ready to Deploy, Pending, Undeployable, Archived, Requestable |
| **Look up Asset** | Asset-Tag oder Seriennummer direkt als Argument eingeben (z. B. per Barcode-Scanner). Bei einem Treffer öffnet sich sofort die Detailansicht |
| **Search Users** | Benutzer mit Anzahl zugewiesener Assets, Lizenzen und Zubehörteile; Liste aller zugewiesenen Dinge |
| **Search Licenses** | Freie und belegte Plätze, Ablaufdatum (bald ablaufende orange, abgelaufene rot), Detailansicht mit Ctrl/Cmd+Y |
| **Accessories & Consumables** | Bestand von Zubehör und Verbrauchsmaterial; „Low Stock“ zeigt alles, was am oder unter dem Mindestbestand ist |
| **Audits Due** | Assets mit überfälliger oder bald fälliger Prüfung |

## Aktionen auf Assets

- **Show Details**: Status, Zuweisung, Standort, Modell, Kauf, Garantie, Audit-Termine, benutzerdefinierte Felder
- **Check out** (Ctrl/Cmd+Shift+O): an eine Person oder einen Standort, mit Rückgabedatum und Notiz
- **Check In** (Ctrl/Cmd+Shift+I): mit Notiz
- Asset-Tag (Ctrl/Cmd+Shift+C), Seriennummer oder URL kopieren, in Snipe-IT öffnen

Den Produktschlüssel einer Lizenz kannst du nur kopieren, wenn deine Snipe-IT-Rechte ihn anzeigen.
