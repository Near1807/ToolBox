# v0.45.0: the user's data survives uninstalling ToolBox (the Coffre keeps
# Thomas's files in %APPDATA%\ToolBox\coffre). Run by the Windows CI after
# `npm run dist:win`: silent install (per user), a marker file in the data
# folder, silent uninstall, then the marker must still be there.
# Usage: pwsh scripts/uninstall-keeps-data.ps1 dist/ToolBox-Setup-<version>.exe
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\ToolBox'
$dataDir = Join-Path $env:APPDATA 'ToolBox'
$marker = Join-Path $dataDir 'coffre\Cours\marqueur-desinstallation.txt'
$content = "garde-moi $(Get-Date -Format o)"

function Wait-Until([scriptblock]$Condition, [string]$What) {
  for ($i = 0; $i -lt 120; $i++) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Délai dépassé : $What"
}

Write-Host "Installation silencieuse : $Installer"
Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
Wait-Until { Test-Path (Join-Path $installDir 'ToolBox.exe') } 'ToolBox.exe installé'

New-Item -ItemType Directory -Force -Path (Split-Path $marker) | Out-Null
Set-Content -Path $marker -Value $content -Encoding utf8
Write-Host "Marqueur écrit : $marker"

$uninstaller = Join-Path $installDir 'Uninstall ToolBox.exe'
if (-not (Test-Path $uninstaller)) { throw "Désinstalleur introuvable : $uninstaller" }
Write-Host "Désinstallation silencieuse : $uninstaller"
Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
# The uninstaller copies itself and goes on in the background: wait for the app to be gone.
Wait-Until { -not (Test-Path (Join-Path $installDir 'ToolBox.exe')) } 'ToolBox.exe désinstallé'
Start-Sleep -Seconds 2

if (-not (Test-Path $marker)) { throw "ÉCHEC : la désinstallation a effacé les données ($marker)" }
$read = (Get-Content -Path $marker -Raw -Encoding utf8).Trim()
if ($read -ne $content) { throw "ÉCHEC : le marqueur a changé ($read)" }
Write-Host "OK : après désinstallation, le dossier de données et le Coffre sont intacts ($dataDir)."

Remove-Item -Recurse -Force (Join-Path $dataDir 'coffre\Cours\marqueur-desinstallation.txt')
