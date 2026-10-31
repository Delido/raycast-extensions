<#
.SYNOPSIS
  Installiert oder aktualisiert die Raycast-Extensions aus github.com/Delido/raycast-extensions.

.DESCRIPTION
  Lädt das Repo (ohne Git), zeigt eine Auswahl, baut die gewählten Extensions und meldet sie in
  Raycast an. Hilfsprogramme (Go, .NET) werden aus dem neuesten Release geladen, wenn die
  Werkzeuge zum Bauen fehlen. Erneut ausführen = aktualisieren.

  irm https://raw.githubusercontent.com/Delido/raycast-extensions/main/install.ps1 | iex

  Ohne Menü, z. B. für Skripte:
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Delido/raycast-extensions/main/install.ps1))) -Extensions paperless,ssh
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Delido/raycast-extensions/main/install.ps1))) -Update

.PARAMETER Extensions
  Ordnernamen der Extensions (z. B. paperless, ssh). Ohne Angabe erscheint die Auswahl.

.PARAMETER All
  Alle Extensions installieren, die unter Windows laufen.

.PARAMETER Update
  Nur die bereits installierten Extensions aktualisieren.
#>
param(
    [string[]]$Extensions,
    [switch]$All,
    [switch]$Update,
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'Delido/raycast-extensions'
$Home_ = [Environment]::GetFolderPath('UserProfile')
$Installed = Join-Path $Home_ '.config\raycast\extensions'
$Work = Join-Path $env:LOCALAPPDATA 'Delido\raycast-extensions'

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }

function Step([string]$Text) { Write-Host ''; Write-Host "> $Text" -ForegroundColor Cyan }

function Has([string]$Command) { [bool](Get-Command $Command -ErrorAction SilentlyContinue) }

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# --- Voraussetzungen -------------------------------------------------------------------------

Say ''
Say 'Raycast-Extensions von Delido' White
Say '-----------------------------' DarkGray

if (-not (Test-Path (Join-Path $Home_ '.config\raycast')) -and -not (Get-Process Raycast -ErrorAction SilentlyContinue)) {
    Say 'Raycast scheint nicht installiert zu sein: https://www.raycast.com (Windows).' Yellow
    if ((Read-Host 'Trotzdem fortfahren? [j/N]') -notmatch '^[jy]') { return }
}

if (-not (Get-Process Raycast -ErrorAction SilentlyContinue)) {
    Say 'Raycast läuft gerade nicht. Bitte starte Raycast, damit die Extensions angemeldet werden können.' Yellow
    Read-Host 'Enter, sobald Raycast läuft' | Out-Null
}

$nodeOk = $false
if (Has 'node') {
    $major = [int]((node --version) -replace '^v(\d+).*', '$1')
    $nodeOk = $major -ge 22
    if (-not $nodeOk) { Say "Node.js $(node --version) ist zu alt, gebraucht wird 22 oder neuer." Yellow }
}
if (-not $nodeOk) {
    if (-not (Has 'winget')) { throw 'Node.js 22+ fehlt. Bitte von https://nodejs.org installieren und das Skript erneut starten.' }
    if ((Read-Host 'Node.js LTS jetzt mit winget installieren? [J/n]') -match '^[nN]') { return }
    winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Has 'node')) { throw 'Node.js wurde installiert, ist aber noch nicht im PATH. Bitte ein neues PowerShell-Fenster öffnen und das Skript erneut starten.' }
}

# --- Repo laden ------------------------------------------------------------------------------

Step "Lade $Repo ($Branch)"
New-Item -ItemType Directory -Force $Work | Out-Null
$zip = Join-Path $Work 'repo.zip'
Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip -UseBasicParsing
$extract = Join-Path $Work 'extract'
Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $extract -Force
$source = Get-ChildItem $extract -Directory | Select-Object -First 1
$src = Join-Path $Work 'src'
# keep node_modules of earlier runs, that makes updates much faster
if (Test-Path $src) {
    Get-ChildItem $src -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object {
        Get-ChildItem $_.FullName -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'node_modules' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}
New-Item -ItemType Directory -Force $src | Out-Null
Copy-Item (Join-Path $source.FullName '*') $src -Recurse -Force
Remove-Item $extract, $zip -Recurse -Force -ErrorAction SilentlyContinue

# --- Extensions ermitteln --------------------------------------------------------------------

# group and German description from the README tables
$readme = Get-Content (Join-Path $src 'README.md') -Raw -Encoding UTF8
$info = @{}
$group = ''
foreach ($line in $readme -split "`n") {
    if ($line -match '^###\s+(.+)') { $group = $Matches[1].Trim(); continue }
    if ($line -match '\*\*\[(.+?)\]\(([\w-]+)/\)\*\*\s*\|\s*(.+?)\s*\|') {
        $info[$Matches[2]] = @{ Title = $Matches[1]; Text = ($Matches[3] -replace '\[([^\]]+)\]\([^)]+\)', '$1'); Group = $group }
    }
}

$catalog = @()
foreach ($dir in Get-ChildItem $src -Directory) {
    $pkgFile = Join-Path $dir.FullName 'package.json'
    if (-not (Test-Path $pkgFile)) { continue }
    $pkg = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $pkg.commands) { continue }
    if ($pkg.platforms -and ($pkg.platforms -notcontains 'Windows')) { continue }
    $meta = $info[$dir.Name]
    $catalog += [pscustomobject]@{
        Dir       = $dir.Name
        Name      = $pkg.name
        Title     = if ($meta) { $meta.Title } else { $pkg.title }
        Text      = if ($meta) { $meta.Text } else { $pkg.description }
        Group     = if ($meta) { $meta.Group } else { 'Weitere' }
        Helper    = if ($pkg.scripts) { $pkg.scripts.'build:helper' } else { $null }
        Commands  = (@($pkg.commands | ForEach-Object { '"' + $_.title + '"' }) -join ', ')
        Installed = (Test-Path (Join-Path $Installed $pkg.name)) -or (Test-Path (Join-Path $Installed $dir.Name))
    }
}
$order = @($info.Keys | ForEach-Object { $info[$_].Group } | Select-Object -Unique)
$catalog = @($catalog | Sort-Object @{ Expression = { $i = [array]::IndexOf($order, $_.Group); if ($i -lt 0) { 99 } else { $i } } }, Title)

# --- Auswahl ---------------------------------------------------------------------------------

$selected = @()
# "-Extensions a,b" arrives as one string with powershell -File
$Extensions = @($Extensions | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
if ($Extensions) {
    foreach ($name in $Extensions) {
        $hit = $catalog | Where-Object { $_.Dir -eq $name -or $_.Name -eq $name }
        if (-not $hit) { throw "Unbekannte Extension: $name (verfügbar: $(($catalog.Dir) -join ', '))" }
        $selected += $hit
    }
}
elseif ($All) { $selected = $catalog }
elseif ($Update) { $selected = @($catalog | Where-Object Installed) }
else {
    Step 'Auswahl'
    $group = ''
    for ($i = 0; $i -lt $catalog.Count; $i++) {
        $e = $catalog[$i]
        if ($e.Group -ne $group) { $group = $e.Group; Say ''; Say "  $group" White }
        $mark = if ($e.Installed) { '[x]' } else { '[ ]' }
        $text = if ($e.Text.Length -gt 70) { $e.Text.Substring(0, 67) + '...' } else { $e.Text }
        Write-Host ('  {0,2}  {1} ' -f ($i + 1), $mark) -NoNewline -ForegroundColor Green
        Write-Host ('{0,-24}' -f $e.Title) -NoNewline -ForegroundColor White
        Write-Host $text -ForegroundColor DarkGray
    }
    Say ''
    Say '  [x] = bereits installiert' DarkGray
    Say ''
    Say '  Nummern mit Komma oder Bereich (z. B. 1,3,5-7), a = alle, Enter = installierte aktualisieren, q = abbrechen'
    $answer = (Read-Host '  Auswahl').Trim()
    if ($answer -match '^[qQ]') { return }
    if ($answer -eq '') { $selected = @($catalog | Where-Object Installed) }
    elseif ($answer -match '^[aA]') { $selected = $catalog }
    else {
        foreach ($part in $answer -split '[,\s]+' | Where-Object { $_ }) {
            if ($part -match '^(\d+)-(\d+)$') { $range = [int]$Matches[1]..[int]$Matches[2] }
            elseif ($part -match '^\d+$') { $range = @([int]$part) }
            else { throw "Ungültige Eingabe: $part" }
            foreach ($n in $range) {
                if ($n -lt 1 -or $n -gt $catalog.Count) { throw "Keine Extension mit Nummer $n" }
                $selected += $catalog[$n - 1]
            }
        }
    }
}
$selected = @($selected | Sort-Object Dir -Unique)
if ($selected.Count -eq 0) { Say 'Nichts ausgewählt (es ist noch keine Extension installiert).' Yellow; return }

# --- Hilfsprogramme ----------------------------------------------------------------------------

$hasGo = Has 'go'
$hasDotnet = (Has 'dotnet') -and ((& dotnet --list-sdks 2>$null) -ne $null)
$release = $null
function Release-Asset([string]$Name) {
    if (-not $script:release) {
        $script:release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
    }
    $asset = $script:release.assets | Where-Object name -eq $Name
    if (-not $asset) { return $null }
    $file = Join-Path $Work $Name
    Invoke-WebRequest $asset.browser_download_url -OutFile $file -UseBasicParsing
    return $file
}

function Prepare-Helper($e) {
    if (-not $e.Helper) { return }
    $dir = Join-Path $src $e.Dir
    if ($e.Helper -match 'build-go-helper\.mjs\s+\S+\s+(\S+\.exe)') {
        if ($hasGo) { return }
        $target = Join-Path $dir $Matches[1]
        $file = Release-Asset (Split-Path $target -Leaf)
        if (-not $file) { throw "$($e.Title): Hilfsprogramm $(Split-Path $target -Leaf) fehlt im Release - bitte Go installieren (winget install GoLang.Go)." }
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        Move-Item $file $target -Force
    }
    elseif ($e.Helper -match 'build-win-auth\.mjs\s+(\S+)') {
        if ($hasDotnet) { return }
        $target = Join-Path $dir $Matches[1]
        $file = Release-Asset 'win-auth.zip'
        if (-not $file) {
            Say "  $($e.Title): Windows Hello / Windows-Anmeldung nicht verfügbar (win-auth fehlt im Release, .NET SDK nicht installiert). Der Rest funktioniert." Yellow
            return
        }
        Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive $file $target -Force
        Remove-Item $file -Force
    }
}

# --- Bauen und in Raycast anmelden -------------------------------------------------------------

function Install-Extension($e) {
    $dir = Join-Path $src $e.Dir
    $log = Join-Path $Work "$($e.Dir).log"
    Prepare-Helper $e

    Write-Host "  Abhängigkeiten ..." -NoNewline -ForegroundColor DarkGray
    $ci = Start-Process cmd.exe -ArgumentList '/c', 'npm ci --no-audit --no-fund --loglevel=error' -WorkingDirectory $dir -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    if ($ci.ExitCode -ne 0) { Write-Host ''; throw "npm ci fehlgeschlagen:`n$(Get-Content "$log.err" -Raw)" }

    # "npm run dev" builds the extension and registers it in Raycast; it stays installed once it is ready
    Write-Host ' bauen und anmelden ...' -NoNewline -ForegroundColor DarkGray
    $command = "npm run dev > `"$log`" 2>&1"
    # ray builds into a temporary folder and then renames it into Raycast's folder. While Raycast or a
    # virus scanner holds a file of the previous version open, Windows refuses (EPERM/EBUSY): wait and
    # try again.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        # leftovers of an interrupted build
        Get-ChildItem $Installed -Directory -Filter '.raycast-build-*' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        $dev = Start-Process cmd.exe -ArgumentList '/c', $command -WorkingDirectory $dir -PassThru -WindowStyle Hidden
        $deadline = (Get-Date).AddMinutes(4)
        $result = $null
        while ((Get-Date) -lt $deadline -and -not $result) {
            Start-Sleep -Milliseconds 700
            $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
            # ray colours its output, so "ready"/"error" are followed by an ANSI code before " - "
            if ($text -match 'ready\S*\s+-\s+built extension') { $result = 'ok' }
            elseif ($text -match 'error\S*\s+-\s|npm ERR!|npm error') { $result = 'error' }
            elseif ($dev.HasExited) { $result = 'exited' }
        }
        # After "ready" ray still tells Raycast about the build (a raycast://cli/... deeplink, debounced and
        # opened by a child process). Ending the process tree right away loses that message, and a new
        # extension then never shows up in Raycast - so give it a moment.
        if ($result -eq 'ok') { Start-Sleep -Seconds 5 }
        # ends the dev server (and its node child); it may have exited on its own already
        Start-Process taskkill.exe -ArgumentList '/T', '/F', '/PID', $dev.Id -Wait -WindowStyle Hidden
        $locked = $result -ne 'ok' -and ((Get-Content $log -Raw -ErrorAction SilentlyContinue) -match 'EPERM|EBUSY|EACCES')
        if (-not $locked -or $attempt -eq 3) { break }
        Write-Host " Datei gesperrt, neuer Versuch ($($attempt + 1)/3) ..." -NoNewline -ForegroundColor DarkYellow
        Start-Sleep -Seconds (3 * $attempt)
    }
    if ($result -ne 'ok') {
        Write-Host ''
        $tail = (Get-Content $log -Tail 15 -ErrorAction SilentlyContinue) -join "`n"
        throw "Bauen fehlgeschlagen ($(if ($result) { $result } else { 'Zeitüberschreitung' })):`n$tail"
    }
    if (-not (Test-Path (Join-Path (Join-Path $Installed $e.Name) 'package.json'))) {
        Write-Host ''
        throw "Gebaut, aber nicht im Raycast-Ordner angekommen ($Installed\$($e.Name)). Läuft Raycast?"
    }
    Write-Host ' fertig' -ForegroundColor Green
    Say "  In Raycast suchen nach: $($e.Commands)" DarkGray
}

Step "Installiere $($selected.Count) Extension(s)"
$failed = @()
foreach ($e in $selected) {
    Write-Host ''
    Write-Host "  $($e.Title)" -ForegroundColor White
    try { Install-Extension $e }
    catch { Say "  FEHLER: $($_.Exception.Message)" Red; $failed += $e.Title }
}

Write-Host ''
if ($failed.Count -eq 0) {
    Say "Fertig. Die Extensions stehen in Raycast bereit; beim ersten Öffnen fragt Raycast nach den Einstellungen." Green
}
else {
    Say "Fertig mit Fehlern bei: $($failed -join ', '). Protokolle: $Work\<extension>.log" Yellow
}
Say "Aktualisieren: dasselbe Kommando erneut ausführen und Enter drücken." DarkGray
