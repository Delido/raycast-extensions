import { getSelectedFinderItems } from "@raycast/api";
import { execFile } from "node:child_process";

/*
 * The files selected in the file manager. Raycast's getSelectedFinderItems covers Finder; for File
 * Explorer the Shell.Application windows are asked directly: the Explorer window highest in the
 * z-order (the one used before Raycast opened) and, with tabs, the tab whose folder is in the title.
 */

const EXPLORER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Z {
  delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static List<long> Order() { var r = new List<long>(); EnumWindows((h, l) => { r.Add(h.ToInt64()); return true; }, IntPtr.Zero); return r; }
  public static string Title(long h) { var s = new StringBuilder(512); GetWindowText(new IntPtr(h), s, 512); return s.ToString(); }
}
"@
$windows = @((New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.FullName -match 'explorer\\.exe$' -and $_.Document })
$order = [Z]::Order()
$front = $windows | Sort-Object { $i = $order.IndexOf([long]$_.HWND); if ($i -lt 0) { [int]::MaxValue } else { $i } } | Select-Object -First 1
if (-not $front) { '[]'; exit }
$tabs = @($windows | Where-Object { $_.HWND -eq $front.HWND })
$title = [Z]::Title([long]$front.HWND)
$active = $tabs | Where-Object { $title -and $title.StartsWith($_.LocationName) } | Select-Object -First 1
if (-not $active) { $active = $tabs | Where-Object { $_.Document.SelectedItems().Count -gt 0 } | Select-Object -First 1 }
if (-not $active) { $active = $front }
$paths = @($active.Document.SelectedItems() | ForEach-Object { $_.Path })
ConvertTo-Json -Compress -InputObject $paths
`;

function explorerSelection(): Promise<string[]> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(EXPLORER_SCRIPT, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15_000 },
      (error, stdout) => {
        if (error) return resolve([]);
        try {
          const parsed = JSON.parse(stdout.trim() || "[]") as string[] | string;
          resolve((Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean));
        } catch {
          resolve([]);
        }
      },
    );
  });
}

/** Paths selected in File Explorer or Finder (empty if nothing is selected). */
export async function selectedPaths(): Promise<string[]> {
  try {
    const items = await getSelectedFinderItems();
    if (items.length > 0) return items.map((i) => i.path);
  } catch {
    // not available (e.g. on Windows) or nothing selected
  }
  return process.platform === "win32" ? explorerSelection() : [];
}
