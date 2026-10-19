import { Color, Icon, Image } from "@raycast/api";
import { useEffect, useState } from "react";
import { Sensor, subscribeSensors } from "./webpipe";

export type Category = "temperature" | "cooling" | "load" | "power" | "io";

export const CATEGORIES: { id: Category; title: string; icon: Image.ImageLike }[] = [
  { id: "temperature", title: "Temperatures", icon: Icon.Temperature },
  { id: "cooling", title: "Fans & Pumps", icon: Icon.Wind },
  { id: "load", title: "Load & Memory", icon: Icon.Gauge },
  { id: "power", title: "Power, Clocks & Voltage", icon: Icon.Bolt },
  { id: "io", title: "Network & Disk", icon: Icon.Network },
];

export function categoryOf(sensor: Sensor): Category {
  switch (sensor.type) {
    case "TemperatureProvider":
      return "temperature";
    case "SpeedProvider":
      return "cooling";
    case "PowerProvider":
    case "VoltageProvider":
    case "ClockProvider":
      return "power";
    case "LatencyProvider":
    case "DataRateProvider":
      return "io";
    default:
      // Fan duty cycles are reported as load
      return /fan|pump/i.test(sensor.name) ? "cooling" : "load";
  }
}

export function sensorIcon(sensor: Sensor): Image.ImageLike {
  switch (sensor.type) {
    case "TemperatureProvider":
      return Icon.Temperature;
    case "SpeedProvider":
      return Icon.Wind;
    case "PowerProvider":
      return Icon.Bolt;
    case "VoltageProvider":
      return Icon.Plug;
    case "ClockProvider":
      return Icon.Heartbeat;
    case "MemoryProvider":
      return Icon.MemoryChip;
    case "LatencyProvider":
      return Icon.Wifi;
    case "DataRateProvider":
      return /disk/i.test(sensor.group) ? Icon.HardDrive : Icon.Network;
    default:
      return /fan|pump/i.test(sensor.name) ? Icon.Wind : Icon.Gauge;
  }
}

/** Puts a space between number and unit: "68°C" -> "68 °C". */
export function formatValue(sensor: Sensor): string {
  return sensor.valueStr.replace(/^(-?[\d.,]+)\s*(?=\S)/, "$1 ");
}

/** Traffic-light colour for values where high means bad. */
export function valueColor(sensor: Sensor): Color | undefined {
  if (sensor.type === "TemperatureProvider") {
    if (sensor.value <= 0) return Color.SecondaryText;
    if (sensor.value >= 85) return Color.Red;
    if (sensor.value >= 70) return Color.Orange;
    return Color.Green;
  }
  if (sensor.unit === "%" && categoryOf(sensor) === "load") {
    if (sensor.value >= 90) return Color.Red;
    if (sensor.value >= 70) return Color.Orange;
  }
  return undefined;
}

const BARS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[], width = values.length): string {
  const points = values.slice(-width);
  if (points.length === 0) return "";
  const low = Math.min(...points);
  const high = Math.max(...points);
  if (high - low < 1e-9) return BARS[3].repeat(points.length);
  return points.map((v) => BARS[Math.round(((v - low) / (high - low)) * (BARS.length - 1))]).join("");
}

export function stats(values: number[]) {
  if (values.length === 0) return undefined;
  const sum = values.reduce((a, b) => a + b, 0);
  return { min: Math.min(...values), max: Math.max(...values), avg: sum / values.length };
}

export function round(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/** Live sensor list for the lifetime of the component. */
export function useSensors() {
  const [sensors, setSensors] = useState<Sensor[]>();
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(undefined);
    return subscribeSensors(setSensors, setError);
  }, [attempt]);

  return { sensors, error, isLoading: !sensors && !error, retry: () => setAttempt((n) => n + 1) };
}
