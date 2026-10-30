// Erzeugt realistische Beispieldaten im Format der Defender-API (für Tests ohne Zugang).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FindingState, Snapshot, localDate } from "./builder";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Product {
  v: string;
  n: string;
  r: string;
  rv?: string;
  ver: string[];
  cves: number;
  os?: string;
  pc?: number;
  ps?: number;
  p?: string;
  up?: string;
  eos?: boolean;
}

const CATALOG: Product[] = [
  {
    v: "microsoft",
    n: "windows_11",
    r: "Update Microsoft Windows 11 (OS and built-in applications)",
    ver: ["10.0.26100.6899", "10.0.26100.6584", "10.0.26100.4946"],
    cves: 70,
    os: "Windows11",
  },
  {
    v: "microsoft",
    n: "windows_10",
    r: "Update Microsoft Windows 10 (OS and built-in applications)",
    ver: ["10.0.19045.6456", "10.0.19045.6332"],
    cves: 55,
    os: "Windows10",
  },
  {
    v: "microsoft",
    n: "windows_server_2022",
    r: "Update Microsoft Windows Server 2022 (OS and built-in applications)",
    ver: ["10.0.20348.4294", "10.0.20348.4052", "10.0.20348.3807"],
    cves: 60,
    os: "WindowsServer2022",
  },
  {
    v: "microsoft",
    n: "windows_server_2019",
    r: "Update Microsoft Windows Server 2019 (OS and built-in applications)",
    ver: ["10.0.17763.7919", "10.0.17763.7792"],
    cves: 50,
    os: "WindowsServer2019",
  },
  {
    v: "google",
    n: "chrome",
    r: "Update Google Chrome",
    rv: "142.0.7444.60",
    ver: ["141.0.7390.123", "140.0.7339.208", "138.0.7204.184", "135.0.7049.115"],
    cves: 45,
    pc: 0.85,
    ps: 0.15,
    p: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    up: "C:\\Users\\<user>\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
  },
  {
    v: "microsoft",
    n: "edge_chromium-based",
    r: "Update Microsoft Edge Chromium-based",
    rv: "142.0.3595.53",
    ver: ["141.0.3537.99", "140.0.3485.94"],
    cves: 30,
    pc: 1,
    ps: 0.6,
    p: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  },
  {
    v: "mozilla",
    n: "firefox",
    r: "Update Mozilla Firefox",
    rv: "144.0.2",
    ver: ["144.0", "143.0.4", "140.3.1"],
    cves: 25,
    pc: 0.35,
    ps: 0.05,
    p: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    up: "C:\\Users\\<user>\\AppData\\Local\\Mozilla Firefox\\firefox.exe",
  },
  {
    v: "microsoft",
    n: "office",
    r: "Update Microsoft Office",
    ver: ["16.0.19231.20156", "16.0.19127.20264"],
    cves: 20,
    pc: 0.95,
    ps: 0.05,
    p: "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
  },
  {
    v: "adobe",
    n: "acrobat_reader_dc",
    r: "Update Adobe Acrobat Reader DC",
    rv: "25.001.20844",
    ver: ["25.001.20693", "24.005.20421"],
    cves: 18,
    pc: 0.6,
    ps: 0.1,
    p: "C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe",
  },
  {
    v: "7-zip",
    n: "7-zip",
    r: "Update 7-zip 7-zip",
    rv: "25.01",
    ver: ["24.09", "23.01", "19.00"],
    cves: 6,
    pc: 0.4,
    ps: 0.35,
    p: "C:\\Program Files\\7-Zip\\7z.exe",
  },
  {
    v: "notepad-plus-plus",
    n: "notepad++",
    r: "Update Notepad-plus-plus Notepad++",
    rv: "8.8.7",
    ver: ["8.8.1", "8.6.9"],
    cves: 5,
    pc: 0.3,
    ps: 0.3,
  },
  {
    v: "oracle",
    n: "jre",
    r: "Update Oracle Jre",
    rv: "8.0.471",
    ver: ["8.0.461", "8.0.401", "8.0.351"],
    cves: 14,
    pc: 0.12,
    ps: 0.3,
    p: "C:\\Program Files\\Java\\jre1.8.0_401\\bin\\java.exe",
  },
  {
    v: "zoom",
    n: "zoom",
    r: "Update Zoom Zoom",
    rv: "6.6.6",
    ver: ["6.5.12", "6.3.5"],
    cves: 8,
    pc: 0.3,
    ps: 0,
    p: "C:\\Program Files\\Zoom\\bin\\Zoom.exe",
    up: "C:\\Users\\<user>\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe",
  },
  {
    v: "videolan",
    n: "vlc_media_player",
    r: "Update Videolan Vlc Media Player",
    rv: "3.0.21",
    ver: ["3.0.20", "3.0.18"],
    cves: 4,
    pc: 0.2,
    ps: 0,
  },
  {
    v: "rarlab",
    n: "winrar",
    r: "Update Rarlab Winrar",
    rv: "7.13",
    ver: ["7.11", "6.24"],
    cves: 4,
    pc: 0.1,
    ps: 0.05,
  },
  {
    v: "simon_tatham",
    n: "putty",
    r: "Update Simon Tatham Putty",
    rv: "0.83",
    ver: ["0.81", "0.78"],
    cves: 3,
    pc: 0.15,
    ps: 0.4,
  },
  {
    v: "openssl",
    n: "openssl",
    r: "Update Openssl Openssl",
    rv: "3.5.4",
    ver: ["3.0.15", "1.1.1w"],
    cves: 9,
    pc: 0.08,
    ps: 0.5,
    p: "C:\\Program Files\\Git\\mingw64\\bin\\libcrypto-3-x64.dll",
  },
  {
    v: "python",
    n: "python",
    r: "Update Python Python",
    rv: "3.13.9",
    ver: ["3.12.7", "3.10.11"],
    cves: 7,
    pc: 0.15,
    ps: 0.25,
    p: "C:\\Program Files\\Python312\\python.exe",
    up: "C:\\Users\\<user>\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
  },
  {
    v: "nodejs",
    n: "node.js",
    r: "Update Nodejs Node.js",
    rv: "22.21.0",
    ver: ["20.18.0", "18.20.4"],
    cves: 9,
    pc: 0.12,
    ps: 0.2,
  },
  {
    v: "microsoft",
    n: ".net",
    r: "Update Microsoft .net",
    rv: "8.0.21",
    ver: ["8.0.19", "6.0.36"],
    cves: 8,
    pc: 0.7,
    ps: 0.9,
    p: "C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App\\8.0.19\\coreclr.dll",
  },
  {
    v: "apache",
    n: "tomcat",
    r: "Update Apache Tomcat",
    rv: "10.1.48",
    ver: ["9.0.85", "8.5.100"],
    cves: 12,
    pc: 0,
    ps: 0.15,
    eos: true,
    p: "D:\\Apps\\tomcat\\lib\\catalina.jar",
  },
];

const GROUPS = [
  { g: "Clients Vertrieb", p: "PC-VT", n: 85, server: false },
  { g: "Clients Entwicklung", p: "PC-DEV", n: 60, server: false },
  { g: "Clients Verwaltung", p: "PC-VW", n: 70, server: false },
  { g: "Server Produktion", p: "SRV-PRD", n: 28, server: true },
  { g: "Server Test", p: "SRV-TST", n: 14, server: true },
];
const SEVS = ["Low", "Medium", "High", "Critical"];
const titleCase = (s: string) => s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function demoData(scale = 1) {
  const rnd = rng(4711);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min));
  const now = new Date();
  const day = 86400000;

  const used = new Set<string>();
  const cveLists = CATALOG.map((sw) =>
    Array.from({ length: sw.cves }, () => {
      let id: string;
      do {
        id = `CVE-${2024 + int(0, 3)}-${int(20000, 64000)}`;
      } while (used.has(id));
      used.add(id);
      const p = rnd();
      const sev = p < 0.1 ? "Critical" : p < 0.5 ? "High" : p < 0.9 ? "Medium" : "Low";
      const q = rnd() * (sev === "Critical" ? 0.6 : 1);
      const exp =
        q < 0.04 ? "ExploitIsInKit" : q < 0.11 ? "ExploitIsVerified" : q < 0.26 ? "ExploitIsPublic" : "NoExploit";
      const cvss =
        sev === "Critical"
          ? 9 + int(0, 9) / 10
          : sev === "High"
            ? 7 + int(0, 19) / 10
            : sev === "Medium"
              ? 4 + int(0, 29) / 10
              : 1 + int(0, 29) / 10;
      return { id, sev, exp, cvss, k: int(0, sw.ver.length) };
    }),
  );

  const machines: any[] = [],
    rows: any[] = [];
  // simulierter Vorlauf von gestern, damit "neu/behoben seit letztem Lauf" etwas zeigt
  const previous: FindingState = {
    v: 2,
    time: new Date(now.getTime() - day).toISOString(),
    devices: [],
    sw: CATALOG.map((p) => [p.v, p.n]),
    cves: [],
    items: [],
  };
  const prevCve = new Map<string, number>();
  const remember = (dev: number, si: number, cveId: string, sev: string) => {
    let ci = prevCve.get(cveId);
    if (ci === undefined) {
      ci = previous.cves.length;
      prevCve.set(cveId, ci);
      previous.cves.push(cveId);
    }
    previous.items.push(dev, si, ci, SEVS.indexOf(sev));
  };
  for (const grp of GROUPS) {
    for (let i = 1; i <= Math.max(1, Math.round(grp.n * scale)); i++) {
      const id = Array.from({ length: 40 }, () => "0123456789abcdef"[int(0, 16)]).join("");
      const os = grp.server
        ? rnd() < 0.65
          ? "WindowsServer2022"
          : "WindowsServer2019"
        : rnd() < 0.8
          ? "Windows11"
          : "Windows10";
      const pool = grp.server
        ? ["Internet-facing", "Datenbank", "Dateiserver", "Web"]
        : ["Laptop", "Desktop", "Homeoffice", "VIP"];
      const name = `${grp.p}-${String(i).padStart(3, "0")}`;
      const dns = `${name}.corp.local`.toLowerCase();
      const prevDev = previous.devices.push([id, dns, grp.g]) - 1;
      machines.push({
        id,
        computerDnsName: dns,
        osPlatform: os,
        rbacGroupName: grp.g,
        machineTags: pool.filter(() => rnd() < 0.25),
        exposureLevel: ["Low", "Medium", "High"][int(0, 3)],
        lastSeen: new Date(now.getTime() - int(1, 200) * 3600000).toISOString(),
      });

      const diligence = rnd();
      CATALOG.forEach((sw, si) => {
        const installed = sw.os ? sw.os === os : rnd() < (grp.server ? sw.ps! : sw.pc!);
        if (!installed) return;
        if (rnd() < 0.25 + 0.4 * diligence && !sw.eos) return;
        const vi = Math.min(sw.ver.length - 1, Math.floor(Math.pow(rnd(), 1 + 2 * diligence) * sw.ver.length));
        const baseAge = int(3, 120);
        let disk: string[] = [],
          reg: string[] = [],
          kb: number | null = null;
        if (sw.os) kb = 5066000 + sw.ver.length * 100 + vi;
        else {
          const label = titleCase(sw.n);
          disk = [sw.p || `C:\\Program Files\\${label}\\${sw.n.replace(/_/g, "")}.exe`];
          reg = [`HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${label}`];
          if (sw.up && !grp.server && rnd() < 0.5) {
            disk.push(sw.up.replace("<user>", "u" + int(1000, 9999)));
            reg.push(
              `HKEY_USERS\\S-1-5-21-1111111111-2222222222-3333333333-${int(1100, 9999)}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${label}`,
            );
          }
        }
        for (const cve of cveLists[si]) {
          if (cve.k > vi) {
            // gestern noch verwundbar, inzwischen aktualisiert
            if (cve.k === vi + 1 && rnd() < 0.12) remember(prevDev, si, cve.id, cve.sev);
            continue;
          }
          const age = cve.k === 0 ? int(0, 14) : Math.max(0, baseAge - int(0, 30));
          if (age >= 1) remember(prevDev, si, cve.id, cve.sev);
          rows.push({
            deviceId: id,
            deviceName: name,
            osPlatform: os,
            rbacGroupName: grp.g,
            softwareVendor: sw.v,
            softwareName: sw.n,
            softwareVersion: sw.ver[vi],
            cveId: cve.id,
            vulnerabilitySeverityLevel: cve.sev,
            cvssScore: cve.cvss,
            exploitabilityLevel: cve.exp,
            securityUpdateAvailable: !sw.eos,
            recommendationReference: `va-_-${sw.v}-_-${sw.n}`,
            firstSeenTimestamp: new Date(now.getTime() - age * day - int(0, 24) * 3600000).toISOString(),
            diskPaths: disk,
            registryPaths: reg,
            recommendedSecurityUpdateId: kb,
            recommendedSecurityUpdate: kb ? "Oktober 2026 Sicherheitsupdates" : "",
            recommendedSecurityUpdateUrl: kb ? `https://catalog.update.microsoft.com/Search.aspx?q=KB${kb}` : "",
          });
        }
      });
    }
  }

  const recommendations = CATALOG.map((sw) => ({
    id: `va-_-${sw.v}-_-${sw.n}`,
    recommendationName: sw.r,
    recommendedVersion: sw.rv || "",
  }));

  const changes: any[] = [];
  for (let back = 13; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const weekend = date.getDay() === 0 || date.getDay() === 6,
      patchDay = date.getDay() === 3;
    const counts: [string, number][] = [
      ["New", weekend ? int(5, 40) : int(80, 320)],
      ["Fixed", weekend ? int(0, 20) : patchDay ? int(400, 900) : int(60, 260)],
    ];
    for (const [status, n] of counts)
      for (let i = 0; i < n; i++) {
        const p = rnd();
        changes.push({
          status,
          eventTimestamp: new Date(date.getTime() + int(0, 1440) * 60000).toISOString(),
          vulnerabilitySeverityLevel: SEVS[p < 0.1 ? 3 : p < 0.5 ? 2 : p < 0.9 ? 1 : 0],
        });
      }
  }

  return { rows, machines, recommendations, changes, previous };
}

/** Verlauf rückwärts aus dem aktuellen Stand simulieren (nur Demo). */
export function demoHistory(snap: Snapshot): Snapshot[] {
  const rnd = rng(99);
  let cur = [...snap.s];
  const out: Snapshot[] = [];
  for (let back = 0; back < 60; back++) {
    const date = new Date();
    date.setDate(date.getDate() - back);
    const t = cur.reduce((a, b) => a + b, 0);
    out.unshift({ d: localDate(date), t, s: [...cur], e: Math.round(t * 0.18), dv: snap.dv, c: snap.c });
    const factor = date.getDay() === 3 ? 0.88 : 1.01 + rnd() * 0.015;
    cur = cur.map((x) => Math.round((x * factor) / 1.012));
  }
  return out;
}
