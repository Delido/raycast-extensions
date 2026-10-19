import { getPreferenceValues } from "@raycast/api";
import WebSocket from "ws";

/*
 * SignalRGB exposes its internal Qt objects over a QWebChannel on a local WebSocket
 * ("SignalRGB WebPipe"). The mobile remote talks the same protocol over WebRTC.
 * It is undocumented, so everything here is read defensively.
 */

// QWebChannel message types
const PROPERTY_UPDATE = 2;
const INIT = 3;
const IDLE = 4;
const RESPONSE = 10;

type QProperty = [index: number, name: string, notify: unknown, value: unknown];

interface QObjectData {
  methods?: [string, number][];
  signals?: [string, number][];
  properties?: QProperty[];
}

interface QObjectRef {
  id: string;
  data: QObjectData;
}

interface PropertyUpdate {
  object: string;
  properties?: Record<string, unknown>;
}

export interface SensorHistory {
  seconds: number[];
  minutes: number[];
  fiveMinutes: number[];
  hours: number[];
}

export interface Sensor {
  /** QWebChannel object id, unique per app run */
  id: string;
  /** Stable id like "Corsair Commander Core:Pump" (not always unique) */
  uid: string;
  name: string;
  group: string;
  value: number;
  valueStr: string;
  unit: string;
  min: number;
  max: number;
  type: string;
  history: SensorHistory;
}

const EMPTY_HISTORY: SensorHistory = { seconds: [], minutes: [], fiveMinutes: [], hours: [] };

export function getWebPipeUrl(): string {
  const { webPipeUrl } = getPreferenceValues<Preferences>();
  return (webPipeUrl || "ws://127.0.0.1:16036").trim().replace(/\/+$/, "") + "/";
}

function toSensor(id: string, props: Record<string, unknown>): Sensor {
  const history = (props.history ?? {}) as Partial<SensorHistory>;
  return {
    id,
    uid: String(props.uid ?? ""),
    name: String(props.name ?? ""),
    group: String(props.group ?? ""),
    value: Number(props.value ?? 0),
    valueStr: String(props.valueStr ?? ""),
    unit: String(props.unit ?? ""),
    min: Number(props.min ?? 0),
    max: Number(props.max ?? 0),
    type: String(props.type ?? ""),
    history: { ...EMPTY_HISTORY, ...history },
  };
}

interface TrackedSensor {
  sensor: Sensor;
  // property index -> property name, taken from the init message
  names: Record<string, string>;
}

/**
 * Opens the WebPipe, reads all sensors and keeps them updated.
 * `onUpdate` receives a fresh array at most every `throttleMs`.
 * Returns a function that closes the connection.
 */
export function subscribeSensors(
  onUpdate: (sensors: Sensor[]) => void,
  onError: (error: Error) => void,
  throttleMs = 1000,
): () => void {
  const ws = new WebSocket(getWebPipeUrl(), { maxPayload: 256 * 1024 * 1024 });
  const tracked = new Map<string, TrackedSensor>();
  let order: string[] = [];
  let dirty = false;
  let closed = false;

  const emit = () => {
    dirty = false;
    onUpdate(order.map((id) => ({ ...tracked.get(id)!.sensor })));
  };
  const timer = setInterval(() => dirty && emit(), throttleMs);

  const send = (message: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  ws.on("open", () => send({ type: INIT, id: 0 }));

  ws.on("message", (raw) => {
    let message: { type: number; id?: number; data?: unknown };
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === RESPONSE && message.id === 0) {
      const objects = message.data as Record<string, QObjectData> | undefined;
      const sensorsProp = objects?.monitor?.properties?.find((p) => p[1] === "sensors");
      if (!sensorsProp || !Array.isArray(sensorsProp[3])) {
        onError(new Error("SignalRGB did not report any sensors. Is monitoring enabled?"));
        return;
      }
      for (const ref of sensorsProp[3] as QObjectRef[]) {
        const props = ref.data?.properties ?? [];
        const names = Object.fromEntries(props.map((p) => [String(p[0]), p[1]]));
        tracked.set(ref.id, { sensor: toSensor(ref.id, Object.fromEntries(props.map((p) => [p[1], p[3]]))), names });
      }
      order = [...tracked.keys()];
      emit();
      // Tell the server we're ready for property updates.
      send({ type: IDLE });
      return;
    }

    if (message.type === PROPERTY_UPDATE && Array.isArray(message.data)) {
      for (const update of message.data as PropertyUpdate[]) {
        const entry = tracked.get(update.object);
        if (!entry || !update.properties) continue;
        const changed: Record<string, unknown> = {};
        for (const [index, value] of Object.entries(update.properties)) {
          const name = entry.names[index];
          if (name) changed[name] = value;
        }
        entry.sensor = toSensor(update.object, { ...entry.sensor, ...changed });
        dirty = true;
      }
      send({ type: IDLE });
    }
  });

  ws.on("error", (error) => {
    if (closed) return;
    const code = (error as NodeJS.ErrnoException).code;
    onError(
      code === "ECONNREFUSED"
        ? new Error("SignalRGB is not running (WebPipe not reachable).")
        : new Error(`WebPipe: ${error.message}`),
    );
  });

  ws.on("close", () => {
    clearInterval(timer);
    if (!closed && tracked.size > 0) onError(new Error("Connection to SignalRGB was closed."));
  });

  return () => {
    closed = true;
    clearInterval(timer);
    ws.close();
  };
}
