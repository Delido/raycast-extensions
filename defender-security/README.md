# Defender Schwachstellen (Raycast-Extension)

Raycast-Extension für Windows, die alle offenen Schwachstellen aus **Microsoft Defender Vulnerability Management** abruft, priorisiert und als interaktiven HTML-Report darstellt.

## Befehle

| Befehl | Was er tut |
|---|---|
| **Defender-Zugangsdaten verwalten** | beim ersten Mal Tenant-ID, Client-ID, Secret und ein eigenes Report-Passwort eingeben; danach Secret erneuern oder Passwort ändern |
| **Schwachstellen-Report aktualisieren** | fragt das Report-Passwort ab, holt die Daten aus Defender und erzeugt den Report |
| **Schwachstellen durchsuchen** | CVE-ID, Software, Gerätename, Gruppe, Tag oder Pfad eintippen; die Detailansicht zeigt betroffene Geräte und Fundstellen |
| **Top-Maßnahmen** | Updates nach Priorität, filterbar nach Gerätegruppe |
| **Schwachstellen-Report öffnen** | öffnet den aktuellen Report im Browser |

Aus jedem Eintrag führt „Im Report öffnen“ direkt in die passende Detailansicht. Weitere Aktionen öffnen Defender oder NVD oder kopieren CVE, Gerätenamen und Fundstellen.

## Der Report

- **Übersicht:** Top-10-Maßnahmen, Matrix Schweregrad × Exploit (ein Klick filtert), Alter der offenen Funde, Neues seit dem letzten Lauf
- **Maßnahmen:** Updates pro Software nach Priorität
- **CVEs:** mit Links zu Defender, NVD und MSRC
- **Geräte:** mit Gruppe, Tags und Exposure
- **Gruppen:** Funde pro Gerätegruppe und Heatmap Gruppe × Software
- **Verlauf:** offene Funde über die Zeit, neue und behobene Funde pro Tag, Liste der seit dem letzten Lauf behobenen Funde

Die Filter wirken auf alle Ansichten. Die Detailansicht zeigt auch die **Fundstellen**, also die Datei- und Registry-Pfade, an denen Defender die verwundbare Software gefunden hat. Jede Tabelle lässt sich als CSV exportieren. „Alle Funde als CSV“ liefert eine Arbeitsliste mit Version, KB und Fundstellen.

**Neu seit dem letzten Lauf:** Ab dem zweiten Lauf werden neue Funde mit „NEU“ markiert, und behobene werden aufgelistet. Beim ersten Lauf gilt stattdessen „von Defender in den letzten 7 Tagen erstmals gesehen“ als neu.

**Direktlinks:** z. B. `aktuell.html#cve=CVE-2026-12345`, `#dev=pc-01.corp.local`, `#sw=google|chrome`, `#group=Server`, `#q=AppData` oder `#trend`.

### Wie die Priorität berechnet wird

Für jeden Fund (eine CVE auf einem Gerät) gilt: `Gewicht Schweregrad × Faktor Exploit`

- Schweregrad: Kritisch 10 · Hoch 5 · Mittel 2 · Niedrig 0,5
- Exploit: keiner 1 · öffentlich 1,5 · verifiziert 2,5 · in Exploit-Kit 3

Die Priorität einer Software, eines Geräts oder einer Gruppe ist die Summe über ihre Funde. Ein Update, das 45 CVEs auf 110 Geräten schließt, steht damit vor einem Nischenprogramm mit einer kritischen Lücke auf zwei Rechnern.

## Einrichtung

### 1. App-Registrierung in Entra ID

1. Entra Admin Center → **App-Registrierungen** → **Neue Registrierung**.
2. **API-Berechtigungen** → Berechtigung hinzufügen → **Von meiner Organisation verwendete APIs** → `WindowsDefenderATP` (nicht Microsoft Graph) → **Anwendungsberechtigungen**:

   | Berechtigung | Wofür | Pflicht |
   |---|---|---|
   | `Vulnerability.Read.All` | Schwachstellen pro Gerät, Änderungen der letzten 14 Tage | ja |
   | `Machine.Read.All` | Geräte-Tags, Exposure-Level | empfohlen |
   | `SecurityRecommendation.Read.All` | Empfehlungstext und Zielversion je Software | empfohlen |

3. **Administratorzustimmung erteilen**.
4. **Zertifikate & Geheimnisse** → **Neuer geheimer Clientschlüssel**. Den **Wert** kopieren, nicht die Geheimnis-ID.

Fehlen die optionalen Berechtigungen, läuft der Report trotzdem. Er zeigt dann einen Hinweis und blendet Tags bzw. Empfehlungstexte aus.

### 2. Extension installieren

Einmalig, Node.js wird benötigt:

```powershell
cd defender-security
npm install
npm run dev
```

`npm run dev` registriert die Extension in Raycast. Danach „Defender-Zugangsdaten verwalten“ ausführen.

Einstellungen der Extension:

- **Report-Ordner:** optional. Ohne Angabe liegen die Reports im Datenordner der Extension (`%LOCALAPPDATA%\Raycast\extensions\defender-schwachstellen\reports`).
- **Demodaten:** erzeugt einen Report mit Beispieldaten, ganz ohne Zugangsdaten.

### Secret erneuern

Neues Secret in Entra anlegen, dann in **„Defender-Zugangsdaten verwalten“** das aktuelle Report-Passwort und das neue Secret eintragen. Tenant-ID und Client-ID bleiben erhalten. Das neue Secret wird vor dem Speichern geprüft. Danach das alte Secret in Entra löschen.

## Wie die Zugangsdaten geschützt sind

- Tenant-ID, Client-ID und Secret werden mit einem Schlüssel verschlüsselt, der aus dem Report-Passwort abgeleitet wird (scrypt mit N=2¹⁷, r=8, p=1; AES-256-GCM). Erst das Ergebnis landet in Raycasts lokalem Speicher, den Raycast zusätzlich verschlüsselt.
- Das Report-Passwort wird nirgends gespeichert. Ohne Passwort lässt sich das Secret auch dann nicht nutzen, wenn jemand die Raycast-Datenbank kopiert. Jeder Rateversuch kostet durch scrypt Rechenzeit und Speicher.
- Nach drei falschen Passwörtern wächst die Wartezeit (15 s, 30 s, 60 s … bis 15 min).
- Die Zugangsdaten werden nur für den Abruf im Arbeitsspeicher entschlüsselt. Sie stehen weder im Report noch im Protokoll.
- Lesen, Suchen und Öffnen funktioniert ohne Passwort. Die Reports selbst sind nicht verschlüsselt, weil sie im Browser lesbar sein müssen. Sie listen auf, welche Geräte welche Lücken haben, also nur gezielt weitergeben.
- Passwort vergessen: Zugangsdaten über „Alle Zugangsdaten neu eingeben“ neu hinterlegen.

## Grenzen und Leistung

- Raycast erlaubt pro Befehl 100 MB Arbeitsspeicher. Getestet unter dieser Grenze mit 4.000 Geräten und 192.000 Funden: Report aktualisieren mit höchstens etwa 80 MB, Suche mit etwa 30 MB.
- Die Export-API wird in Seiten zu 5.000 Zeilen abgerufen. Sie ist auf 30 Aufrufe pro Minute begrenzt, bei HTTP 429 wartet die Extension automatisch.
- Die Delta-API liefert höchstens 14 Tage. Ein längerer Verlauf entsteht nur, wenn der Report regelmäßig aktualisiert wird (ein Eintrag pro Tag).
