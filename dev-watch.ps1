$ErrorActionPreference = 'Continue'
$project = "C:\Users\NITRO ACER\Desktop\proyectos con ia\bscl-ai-studio"
$code = "C:\Users\NITRO ACER\AppData\Local\Programs\Microsoft VS Code\Code.exe"

Set-Location $project

function Publish-Latest {
  Write-Host "Empaquetando nueva version..."
  npm run package | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Host "Error al empaquetar"; return }
  $vsix = Get-ChildItem "$project\*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $vsix) { Write-Host "No se encontro .vsix"; return }
  Write-Host "Instalando $($vsix.Name)..."
  & $code --install-extension $vsix.FullName --force | Out-Host
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Instalado. En VS Code recarga la ventana con Ctrl+Shift+P > 'Developer: Reload Window'."
  } else {
    Write-Host "No se pudo instalar automaticamente."
  }
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $project
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'LastWrite, FileName, DirectoryName'
$watcher.Filter = "*.*"

$debounce = $null
Register-ObjectEvent $watcher Changed -Action {
  $path = $Event.SourceEventArgs.FullPath
  if ($path -match "\.(js|html|css|json)$" -and $path -notmatch "\\node_modules\\" -and $path -notmatch "\.git\\") {
    if ($global:debounce) { $global:debounce.Stop() }
    $global:debounce = New-Object System.Timers.Timer 2000
    $global:debounce.AutoReset = $false
    Register-ObjectEvent $global:debounce Elapsed -Action { Publish-Latest } -Once | Out-Null
    $global:debounce.Start()
  }
} | Out-Null
Register-ObjectEvent $watcher Created -Action {
  $path = $Event.SourceEventArgs.FullPath
  if ($path -match "\.(js|html|css|json)$" -and $path -notmatch "\\node_modules\\" -and $path -notmatch "\.git\\") {
    if ($global:debounce) { $global:debounce.Stop() }
    $global:debounce = New-Object System.Timers.Timer 2000
    $global:debounce.AutoReset = $false
    Register-ObjectEvent $global:debounce Elapsed -Action { Publish-Latest } -Once | Out-Null
    $global:debounce.Start()
  }
} | Out-Null

$watcher.EnableRaisingEvents = $true
Write-Host "Observando cambios en $project. Guarda un archivo para empaquetar e instalar automaticamente."
Write-Host "Pulsa Ctrl+C para detener."
while ($true) { Start-Sleep -Seconds 5 }
