# SignalRGB: lokale Schnittstellen

Was SignalRGB auf dem PC anbietet und wie man Sensoren, Beleuchtung und den App-Zustand aus eigenen Programmen abgreift. Ermittelt mit **SignalRGB 2.5.80 unter Windows (Stand 18.10.2026)**, ausprobiert gegen eine laufende Installation mit Pro-Konto.

Kurz:

| Zweck | Schnittstelle | Doku | Anmeldung |
|---|---|---|---|
| Beleuchtung, Effekte, Helligkeit, Layouts | REST, `http://127.0.0.1:16038/api/v1` | offiziell | Pro-Konto in der App |
| **Sensoren**, Lüfter, Makros, gesamter App-Zustand | WebSocket „WebPipe“, `ws://127.0.0.1:16036`, Qt-QWebChannel | **nicht dokumentiert** | keine |
| Mobile Remote (Handy) | Firebase + WebRTC, im Datenkanal derselbe QWebChannel | nicht dokumentiert | SignalRGB-Konto |

Für Sensoren ist die **WebPipe** der richtige Weg. Die Mobile Remote braucht man dafür nicht, sie transportiert nur dasselbe Protokoll übers Internet.

---

## 1. REST-API (offiziell)

Doku: <https://docs.signalrgb.com/developer/signalrgb-api/introduction/>

- Basis-URL: `http://127.0.0.1:16038/api/v1`
- Die meisten Endpunkte brauchen **SignalRGB Pro** und ein angemeldetes Konto, sonst kommt `403`.
- Antworten haben die Form `{"api_version":"1.0","data":{…},"id":<n>,"method":"…","params":{…},"status":"ok"}`.
- Fehler kommen als `{"errors":[{"title":"…","detail":"…"}]}` mit passendem HTTP-Status (404, 409 …).
- Port 16038 lauscht auf **allen Interfaces** (`::`), ist also auch im LAN erreichbar, wenn die Firewall das zulässt.

| Methode | Pfad | Body | Bemerkung |
|---|---|---|---|
| GET | `lighting` | | `attributes`: `enabled`, `global_brightness`, `name`, `playlist`, `queue[]`; `id` = Effekt-ID |
| PATCH | `lighting/global_brightness` | `{"global_brightness":73}` | GET auf diesen Pfad liefert 404 |
| PATCH | `lighting/enabled` | `{"enabled":false}` | aus = alle Geräte schwarz; GET liefert 404 |
| GET | `lighting/effects` | | `items[]` mit `id`, `attributes.name`, `links.apply` (ca. 10 KB bei 49 Effekten) |
| GET | `lighting/effects/{id}` | | `description`, `image` (URL), `publisher`, `parameters`, `uses_audio/video/input/meters`, `favorite` |
| POST | `lighting/effects/{id}/apply` | | Effekt anwenden |
| GET | `lighting/effects/{id}/presets` | | `items[].id` = Preset-Name |
| PATCH | `lighting/effects/{id}/presets` | `{"preset":"Name"}` | |
| GET / POST | `lighting/next`, `lighting/previous` | | GET zeigt nur an, POST wendet an; `409` wenn es keinen nächsten/vorigen gibt |
| POST | `lighting/shuffle` | | Zufallseffekt |
| GET | `lighting/playlists` | | nicht in der Doku, funktioniert |
| GET | `scenes/layouts` | | `items[].id` = Layout-Name |
| GET / PATCH | `scenes/current_layout` | `{"layout":"Name"}` | |
| GET | `app` | | `version`, `build`, `authorized` (= Pro ok); nicht in der Doku |

> **Achtung, Doku-Fehler:** Die Doku schreibt teils `lighting/effect/{id}/…` (Singular). Tatsächlich funktioniert nur **`lighting/effects/{id}/…`** (Plural), der Singular liefert 404.

Effekt-IDs sind Firebase-Keys (`-Me3BsMN_hIlzeJwFbMs`). Lokale Effekte heißen wie ihre Datei (`cs2_reactive.html`), sie deshalb URL-kodieren.

```sh
curl http://127.0.0.1:16038/api/v1/lighting
curl -X PATCH -H "Content-Type: application/json" -d '{"global_brightness":40}' http://127.0.0.1:16038/api/v1/lighting/global_brightness
curl -X POST http://127.0.0.1:16038/api/v1/lighting/next
```

---

## 2. WebPipe: QWebChannel über WebSocket (nicht dokumentiert)

- Adresse: `ws://127.0.0.1:16036/` (Server-Header: `SignalRGB WebPipe`), nur an `127.0.0.1` gebunden.
- **Keine Anmeldung.** Jeder lokale Prozess hat vollen Zugriff, auch schreibend.
- Protokoll: **Qt WebChannel** (dasselbe wie `qwebchannel.js`). Jede Nachricht ist ein JSON-Text-Frame.
- Funktioniert ohne Pro für das Lesen. Ob Schreibmethoden ohne Pro gehen, ist nicht getestet.

### 2.1 Nachrichtentypen

| `type` | Name | Richtung | Inhalt |
|---|---|---|---|
| 1 | signal | Server → Client | `{type:1, object, signal, args}` |
| 2 | propertyUpdate | Server → Client | `{type:2, data:[{object, signals:{…}, properties:{"<index>": value}}]}` |
| 3 | init | Client → Server | `{type:3, id:0}` |
| 4 | idle | Client → Server | `{type:4}`: „bereit für die nächsten Updates“ |
| 6 | invokeMethod | Client → Server | `{type:6, id, object, method:<index>, args:[…]}` |
| 7 | connectToSignal | Client → Server | `{type:7, object, signal:<index>}` |
| 8 | disconnectFromSignal | Client → Server | `{type:8, object, signal:<index>}` |
| 9 | setProperty | Client → Server | `{type:9, object, property:<index>, value}` |
| 10 | response | Server → Client | `{type:10, id, data}`: Antwort auf init und invokeMethod |

### 2.2 Ablauf

1. Verbinden, `{"type":3,"id":0}` senden.
2. Die Antwort `type 10, id 0` enthält **alle Objekte mit allen Eigenschaftswerten**, etwa **9 MB**, bei mir nach ca. 650 ms. Davon sind `devices` ca. 6 MB, `catalog` 2 MB, `lighting` 360 KB, `monitor` 340 KB.
3. `{"type":4}` senden. Danach schickt der Server `type 2`-Updates für **alle** Objekte.
4. **Nach jedem `type 2` wieder `{"type":4}` senden**, sonst kommen keine weiteren Updates.

Die Update-Rate liegt bei ca. 1 Hz pro Sensor und **ca. 400 KB/s** insgesamt, weil jedes Sensor-Update den kompletten Verlauf mitschickt. Wer nur gelegentlich Werte braucht, verbindet sich kurz, liest die Init-Antwort und trennt wieder. Wer live anzeigen will, hält die Verbindung offen. Init alle paar Sekunden zu wiederholen ist dagegen teuer.

Beim WebSocket-Client das Limit für Nachrichtengröße anheben, die Init-Antwort ist größer als manche Standardwerte (Node `ws`: `maxPayload`).

### 2.3 Aufbau eines Objekts in der Init-Antwort

```jsonc
"monitor": {
  "methods":    [["getValueByName", 11], ["getValueByName(QString)", 11], …],   // [Name, Methodenindex]
  "signals":    [["tempSensorsChanged", 3], …],                                  // [Name, Signalindex]
  "properties": [[1, "sensors", ["tempSensorsChanged", 3], [ …Wert… ]], …],      // [Index, Name, [Notify-Signal, Index], Wert]
  "enums": {}
}
```

Eigenschaften, die selbst Qt-Objekte sind, kommen als Referenz mit eigener `id`. Updates (`type 2`) beziehen sich auf diese `id`:

```jsonc
{ "__QObject*__": true, "id": "{001c7ba1-ee0d-470a-935f-2c07e308411f}", "data": { "methods": […], "signals": […], "properties": […] } }
```

Methoden werden mit dem **Index** aufgerufen, nicht mit dem Namen. Auch Eigenschaften in Updates sind über den **Index** angegeben (`"4": 68`). Die Zuordnung Index ↔ Name liefert die Init-Antwort, also nicht hart kodieren.

### 2.4 Verfügbare Objekte

Top-Level-Objekte: `catalog`, `devices`, `layout`, `lifecycle`, `lighting`, `macros`, `monitor`, `onboarding`, `storage`, `user`, `windows`.

Die nützlichsten Teile:

| Objekt | Eigenschaften | Methoden |
|---|---|---|
| **monitor** | `sensors` (alle), `tempsensors` (nur Temperaturen), `fanControllerDevices`, `fanCurves`, `motherboard`, `highlightedSensor1..3`, `monitoringDisabled`, `fanControlDisabled`, `gpuFanControl` | `getValueByName(name)`, `getSensor(uid)`, `getSensorHistory(uid)`, `FanControllerDevices()`, `GetMotherboard()`, `createCurve`, `deleteCurve`, `hasCurve` |
| **lighting** | `currentEffect`, `currentEffectDesc`, `allEffectNames`, `active`, `frameRate`, `canvasDisabled`, `queue`, `activePlaylist`, `hasPrevious` | `setUserEffect(QString,QString,bool)`, `goForward()`, `goBackward()`, `goCrazy()` (= Zufall), `startPlaylist(name)`, `stopPlaylist()`, `getCanvasImage()`, `setFrameRate(int)` |
| **layout** | `layouts`, `current`, `brightness`, `gridSize` | `loadLayout(name)`, `saveLayout(name)` |
| **devices** | `lightingEndpoints`, `fans` | `getAvailableDevices()`, `getDevicesWithLcd()`, `getLcdImage(…)`, `setAioTheme(…)` |
| **macros** | `macrosEnabled` | `getMacroblocks()`, `triggerMacroblock(id)`, … |
| **user** | `signedIn`, `isPro`, `email`, `uid`, `name`, … | ⚠ enthält Kontodaten, nicht loggen |

Die Mobile Remote nutzt davon `monitor.sensors`, `monitor.highlightedSensor1..3`, `monitor.getValueByName`, `lighting.currentEffect`, `lighting.allEffectNames`, `lighting.setUserEffect(<effekt>, "MobileRemote_Apply", true)`, `lighting.goForward`, `goBackward`, `goCrazy`, `lighting.getCanvasImage` und die Signale `sensorsChanged` und `currEffectChanged`.

### 2.5 Sensor-Objekt

Jedes Element in `monitor.sensors` ist ein QObject mit diesen Eigenschaften (Index in Klammern, so bei 2.5.80):

| Eigenschaft | Beispiel | |
|---|---|---|
| `uid` (1) | `"Corsair Commander Core:Pump"` | `Gruppe:Name`, **nicht immer eindeutig** (z. B. „CPU Fan“ doppelt); eindeutig ist die QObject-`id` |
| `name` (2) | `"Pump"` | |
| `group` (3) | `"Corsair Commander Core"` | Gerät bzw. „System“, „Network“, „Disk“ |
| `value` (4) | `2789` | Zahl |
| `valueStr` (5) | `"2789rpm"`, `"68°C"` | formatiert, ohne Leerzeichen |
| `unit` (6) | `rpm` | gesehen: `%`, `C`, `rpm`, `W`, `V`, `Mhz`, `mb`, `MB/s`, `ms` |
| `max` (7), `min` (8) | `3000`, `0` | Skala, nicht gemessenes Maximum |
| `type` (9) | `SpeedProvider` | `TemperatureProvider`, `SpeedProvider`, `LoadProvider`, `MemoryProvider`, `PowerProvider`, `VoltageProvider`, `ClockProvider`, `DataRateProvider`, `LatencyProvider` |
| `history` (10) | `{seconds:[60], minutes:[60], fiveMinutes:[60], hours:[8]}` | **ältester Wert zuerst, neuester am Ende** |

Ein Update für einen Sensor sieht so aus:

```json
{"object":"{d69df89e-…}","properties":{"4":68,"5":"68°C","7":100,"10":{"seconds":[…],"minutes":[…],"fiveMinutes":[…],"hours":[…]}}}
```

Auf meinem System (i9-13900K, RTX 4070 Ti, ASUS ROG STRIX B760-F, Corsair Commander Core) waren es 68 Sensoren:

- **System:** CPU Load, Memory Load
- **CPU:** 32 Kerne, CPU Temperature, Package Temp, Package Power
- **GPU:** Core-, Hotspot- und Memory-Junction-Temperatur, Takt, Last, VRAM, Spannung
- **Corsair:** Pumpe, Fan 1–6, Liquid Temperature, Temperature Probe
- **Mainboard:** CPU Fan, Fan Load 1–7
- **Netzwerk:** Ping, Down, Up
- **Disk:** Read, Write

Lesbar ist das nur, wenn in SignalRGB unter **Settings → Monitoring** das Monitoring aktiv ist.

### 2.6 Methodenaufrufe

```json
→ {"type":6,"id":2,"object":"monitor","method":11,"args":["CPU Package Temp"]}
← {"type":10,"id":2,"data":"81°C"}
```

- `getValueByName(name)` liefert `valueStr` (String) und geht über den **Namen**, nicht die uid. Bei doppelten Namen ist nicht klar, welcher Sensor gemeint ist.
- `getSensor("Corsair Commander Core:Pump")` lieferte `null`. Welches Argument die Methode erwartet, ist unklar.
- Schreibende Methoden (`setUserEffect`, `loadLayout`, `triggerMacroblock`, `createCurve` …) habe ich **nicht getestet**. Für Licht lieber die offizielle REST-API nehmen.

### 2.7 Minimalbeispiel Node.js (Sensoren live)

```js
import WebSocket from "ws"; // Node 22+: auch das eingebaute globale WebSocket

const ws = new WebSocket("ws://127.0.0.1:16036/", { maxPayload: 256 * 1024 * 1024 });
const sensors = new Map(); // QObject-id -> { names: {index: name}, values: {name: value} }

ws.on("open", () => ws.send(JSON.stringify({ type: 3, id: 0 })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 10 && msg.id === 0) {
    const prop = msg.data.monitor.properties.find((p) => p[1] === "sensors");
    for (const ref of prop[3]) {
      const props = ref.data.properties;
      sensors.set(ref.id, {
        names: Object.fromEntries(props.map((p) => [p[0], p[1]])),
        values: Object.fromEntries(props.map((p) => [p[1], p[3]])),
      });
    }
    ws.send(JSON.stringify({ type: 4 }));
  } else if (msg.type === 2) {
    for (const u of msg.data) {
      const s = sensors.get(u.object);
      if (!s) continue; // Update eines anderen Objekts
      for (const [i, v] of Object.entries(u.properties ?? {})) s.values[s.names[i]] = v;
      console.log(`${s.values.group} / ${s.values.name}: ${s.values.valueStr}`);
    }
    ws.send(JSON.stringify({ type: 4 })); // wichtig, sonst kommen keine weiteren Updates
  }
});
```

### 2.8 Minimalbeispiel Python (einmal auslesen)

```python
import json, websocket  # pip install websocket-client

ws = websocket.create_connection("ws://127.0.0.1:16036/", timeout=10)
ws.send(json.dumps({"type": 3, "id": 0}))
init = json.loads(ws.recv())
ws.close()

sensors = next(p[3] for p in init["data"]["monitor"]["properties"] if p[1] == "sensors")
for ref in sensors:
    s = {p[1]: p[3] for p in ref["data"]["properties"]}
    print(f'{s["group"]:<40} {s["name"]:<30} {s["valueStr"]}')
```

Eine fertige TypeScript-Umsetzung mit Live-Updates steht in [signalrgb/src/webpipe.ts](../signalrgb/src/webpipe.ts).

---

## 3. Mobile Remote (zum Verständnis)

Gefunden durch Auswertung der Web-App unter `https://remote.signalrgb.com`, einer Flutter-Web-App (`main.dart.js`). **Rekonstruiert, nicht selbst nachgebaut oder getestet.**

1. **Anmeldung:** Firebase Auth, E-Mail und Passwort, Firebase-Projekt `whirlwindengine`.
2. **Signaling:** über die Firebase Realtime Database (`https://whirlwindengine.firebaseio.com`):
   - `users/{uid}`: Kontodaten
   - `devices/{uid}`: die PCs des Kontos
   - `devices/{uid}/{pc}/requests`: das Handy legt mit `push()` eine Verbindungsanfrage an, der Key ist die Verbindungs-ID
   - `devices/{uid}/{pc}/connections/{id}/rem_desc`: SDP des Handys
   - `devices/{uid}/{pc}/connections/{id}/answers`: ICE-Kandidaten des Handys (mit `push()`)
   - `…/connections/{id}/host_desc` und `host_candidates`: Antwort des PCs
3. **WebRTC:** STUN `stun:stun.l.google.com:19302`. Der PC öffnet den Datenkanal (das Handy empfängt das `datachannel`-Event).
4. **Im Datenkanal:** dasselbe QWebChannel-Protokoll wie in Abschnitt 2.

Mit eingeschalteter Remote öffnet SignalRGB zusätzlich UDP-Ports (bei mir 59114/59115) für WebRTC. Neue lokale HTTP- oder WebSocket-Ports kommen dadurch nicht dazu. Für Zugriff vom selben PC oder aus dem LAN ist die Remote also unnötig. Sie lohnt sich nur, wenn man von unterwegs ohne VPN zugreifen will. Dann müsste man Firebase-Anmeldung, Signaling und WebRTC selbst nachbauen, und das kann bei jedem Update brechen.

---

## 4. Weitere Ports auf dem PC

| Port | Prozess | Was |
|---|---|---|
| 16034 (alle Interfaces) | SignalRgb | HTTP, `/` antwortet `SignalApi Active`; sonst nichts gefunden |
| 16036 (localhost) | SignalRgb | **WebPipe** (Abschnitt 2) |
| 16037 (localhost) | SignalRgb | HTTP, 404 auf alles Getestete |
| 16038 (alle Interfaces) | SignalRgb | **REST-API** (Abschnitt 1) |
| 16039 (localhost) | SignalRgbService | WebSocket, HTTP nur mit POST; nicht untersucht |
| 17320 (localhost), UDP 5568 | SignalRGBBridge | gehört zu SignalRGB Wallpaper; UDP 5568 ist der sACN/E1.31-Port |

Nicht von SignalRGB, aber auf diesem PC daneben installiert: **SignalCompanion** (Python-Tool):

- `127.0.0.1:3010`: Audio-Ausgabe, `GET /devices`, `/current`, `/next`, `/prev`, `/set?id=`, `/set?name=`, `/set?i=`, Antworten `{"ok":true,…}`
- `127.0.0.1:3443` (HTTPS): CS2-Spielstatus (`health`, `armor`, `round_phase` …)
- `127.0.0.1:3000`: 404

---

## 5. Hinweise

- Die WebPipe ist **intern**. Namen, Indizes und Struktur können sich mit jedem SignalRGB-Update ändern. Indizes immer aus der Init-Antwort lesen und nach Eigenschaftsnamen suchen.
- Die WebPipe ist ohne Anmeldung für jeden lokalen Prozess erreichbar, auch schreibend (Makros, Lüfterkurven, Effekte). Beim Weiterreichen in andere Programme oder ins Netz entsprechend absichern.
- Das `user`-Objekt enthält E-Mail, uid und weitere Kontodaten. Die Init-Antwort deshalb nicht ungefiltert loggen oder speichern.
- REST-API und Port 16034 lauschen auf allen Netzwerk-Interfaces.
