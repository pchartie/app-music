# Installe (ou met à jour) App Music sous Windows, en une seule commande, sans droits administrateur.
# Dans PowerShell (menu Démarrer, « PowerShell ») :
#
#   irm https://raw.githubusercontent.com/pchartie/app-music/main/install.ps1 | iex
#
# - télécharge Node.js dans %LOCALAPPDATA%\AppMusic\node s'il n'est pas déjà présent (version 20 ou plus) ;
# - télécharge l'app dans %USERPROFILE%\AppMusic (une mise à jour garde le cache et le réglage du dossier de musique) ;
# - installe les dépendances, puis lance l'app : l'écran d'accueil demande le dossier de musique,
#   et « App Music » est ajoutée sur le bureau et dans le menu Démarrer.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # téléchargements bien plus rapides sans la barre de progression
  $Repo = 'pchartie/app-music'
  $Dest = if ($env:APPMUSIC_HOME) { $env:APPMUSIC_HOME } else { Join-Path $HOME 'AppMusic' }
  $NodeDir = Join-Path $env:LOCALAPPDATA 'AppMusic\node'
  function Say($m) { Write-Host '› ' -ForegroundColor Green -NoNewline; Write-Host $m }
  function NodeOk { try { [int](& node -p "process.versions.node.split('.')[0]") -ge 20 } catch { $false } }

  # 1. Node.js
  if (Test-Path (Join-Path $NodeDir 'node.exe')) { $env:Path = "$NodeDir;$env:Path" }
  if (-not (NodeOk)) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = 'https://nodejs.org/dist/latest-v24.x'
    $sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "win-$arch\.zip\s*$" } | Select-Object -First 1
    $hash, $file = $line.Trim() -split '\s+'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
    New-Item -ItemType Directory $tmp | Out-Null
    Say "Téléchargement de Node.js ($file)…"
    Invoke-WebRequest "$base/$file" -OutFile (Join-Path $tmp $file) -UseBasicParsing
    if ((Get-FileHash (Join-Path $tmp $file) -Algorithm SHA256).Hash -ne $hash.ToUpper()) { throw 'Téléchargement de Node.js corrompu.' }
    Expand-Archive (Join-Path $tmp $file) $tmp
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    New-Item -ItemType Directory (Split-Path $NodeDir) -Force | Out-Null
    Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) $NodeDir
    Remove-Item $tmp -Recurse -Force
    $env:Path = "$NodeDir;$env:Path"
  }
  Say "Node.js $(& node -v)"

  # 2. L'app (sauf si c'est un clone Git : on ne touche pas à une copie de développement)
  if (-not (Test-Path (Join-Path $Dest '.git'))) {
    Say "Téléchargement de App Music dans $Dest…"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
    New-Item -ItemType Directory $tmp | Out-Null
    Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile (Join-Path $tmp 'app.zip') -UseBasicParsing
    Expand-Archive (Join-Path $tmp 'app.zip') $tmp
    New-Item -ItemType Directory $Dest -Force | Out-Null
    $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
    Copy-Item (Join-Path $src.FullName '*') $Dest -Recurse -Force # cache\ et config.json ne sont pas dans l'archive : conservés
    Remove-Item $tmp -Recurse -Force
  }
  Set-Location $Dest

  # 3. Dépendances, puis lancement (npm.cmd : npm.ps1 peut être bloqué par la stratégie d'exécution de PowerShell)
  Say 'Installation des dépendances…'
  & npm.cmd install --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false | Out-Null
  if ($LASTEXITCODE) { throw "L'installation des dépendances a échoué." }
  Say "C'est prêt. Prochaine fois : double-clic sur « App Music » sur le bureau."
  if (-not $env:APPMUSIC_NO_LAUNCH) { & node scripts\launch.mjs }
}
