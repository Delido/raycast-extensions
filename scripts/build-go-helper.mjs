#!/usr/bin/env node
// Builds a Windows helper written in Go into the extension's assets folder.
//
//   node ../scripts/build-go-helper.mjs <go-source-dir> <output.exe> [--gui]
//
// Used as "predev"/"prebuild" by the extensions that ship a helper (mtr, power-plan,
// signalrgb). Without Go installed, an existing .exe is kept (e.g. one downloaded
// from the GitHub releases), otherwise the script explains what to do.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [source, output, ...flags] = process.argv.slice(2);
if (!source || !output) {
  console.error("usage: build-go-helper.mjs <go-source-dir> <output.exe> [--gui]");
  process.exit(2);
}
const out = resolve(output);
const hasGo = spawnSync("go", ["version"], { stdio: "ignore" }).status === 0;

if (!hasGo) {
  if (existsSync(out)) {
    console.warn(`go not found, keeping existing ${output}`);
    process.exit(0);
  }
  console.error(
    [
      `Missing ${output} and Go is not installed.`,
      "Either install Go 1.26+ (winget install GoLang.Go) and run again,",
      "or download the prebuilt helper from https://github.com/Delido/raycast-extensions/releases",
      `and save it as ${output}.`,
    ].join("\n"),
  );
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const ldflags = ["-s", "-w", ...(flags.includes("--gui") ? ["-H", "windowsgui"] : [])].join(" ");
execFileSync("go", ["build", "-trimpath", "-ldflags", ldflags, "-o", out, "."], {
  cwd: resolve(source),
  stdio: "inherit",
  env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
});
console.log(`built ${output}`);
