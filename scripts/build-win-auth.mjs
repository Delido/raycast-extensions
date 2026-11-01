#!/usr/bin/env node
// Builds the Windows Hello / Microsoft sign-in helper (helpers/win-auth, C# on .NET Framework 4.8,
// which every Windows 10/11 has) into the extension's assets folder.
//
//   node ../scripts/build-win-auth.mjs <output-dir>
//
// Used as "predev"/"prebuild" by paperless, laps-connect, defender-security, teams and sharepoint.
// Without the .NET SDK an existing build is kept (e.g. one downloaded from the GitHub releases); without
// any, the extension still builds – Windows Hello and Windows sign-in are then just not offered.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [output] = process.argv.slice(2);
if (!output) {
  console.error("usage: build-win-auth.mjs <output-dir>");
  process.exit(2);
}
const out = resolve(output);
const project = join(dirname(fileURLToPath(import.meta.url)), "..", "helpers", "win-auth");
const hasDotnet = spawnSync("dotnet", ["--version"], { stdio: "ignore" }).status === 0;

if (process.platform !== "win32") {
  console.warn("win-auth is Windows-only, skipped");
  process.exit(0);
}

if (!hasDotnet) {
  if (existsSync(join(out, "win-auth.exe"))) {
    console.warn(`dotnet not found, keeping existing ${output}`);
    process.exit(0);
  }
  console.warn(
    [
      `Missing ${output} and the .NET SDK is not installed.`,
      "Either install it (winget install Microsoft.DotNet.SDK.8) and run again,",
      "or download win-auth.zip from https://github.com/Delido/raycast-extensions/releases",
      `and unpack it to ${output}.`,
      "(Only needed for Windows Hello and Windows sign-in; everything else works without it.)",
    ].join("\n"),
  );
  process.exit(0);
}

execFileSync("dotnet", ["publish", project, "-c", "Release", "-o", out, "--nologo", "-v", "quiet"], { stdio: "inherit" });
// msalruntime.dll for x64 is next to the exe; the per-architecture copies are not needed
rmSync(join(out, "runtimes"), { recursive: true, force: true });
console.log(`built ${output}`);
