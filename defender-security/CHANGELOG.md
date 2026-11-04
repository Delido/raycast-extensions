# Changelog

## [Schneller und robuster] - 2026-11-04

- Private Geräte sind in Report, Suche und Top-Maßnahmen zunächst ausgeblendet und über den Filter einblendbar. Erkannt über die neue Einstellung „Private Geräte“ (Gruppe oder #Tag) oder automatisch an „privat“, „private“ oder „BYOD“ im Gruppen- bzw. Tagnamen
- Suche: Gerätefilter (Gruppe / Tag / alle außer …) wie in den Top-Maßnahmen
- Suche und Top-Maßnahmen: Die Detailansicht wird nur noch für den ausgewählten Eintrag berechnet – vorher für jede Zeile, was bei großen Mandanten sehr langsam war
- Lange Abrufe: Läuft das Anmelde-Token ab, wird automatisch neu angemeldet; Netzwerkfehler werden wiederholt
- Top-Maßnahmen: Filter „nur Tag …“
- Ältere datierte Reports werden aufgeräumt (Einstellung „Ältere Reports“, Standard: 30 behalten)
- Fundstellen werden auch bei sehr vielen Versionen der richtigen Installation zugeordnet
- Ein ungültiger Zeitstempel in den Änderungen bricht den Lauf nicht mehr ab

## [Alle außer …] - 2026-11-01

- Report und Top-Maßnahmen: „Alle Gruppen außer …“ und „Alle Geräte außer Tag …“, z. B. um private Geräte auszublenden
- Der Report merkt sich den Gruppen- und Tag-Filter beim nächsten Öffnen

## [Initial Version] - 2026-10-30
