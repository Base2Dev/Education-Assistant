$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Scholo Education Assistant.lnk'
$electronPath = Join-Path $projectPath 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronPath)) { throw 'Install the Electron runtime before creating the shortcut.' }
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronPath
$shortcut.Arguments = '"' + $projectPath + '"'
$shortcut.WorkingDirectory = $projectPath
$shortcut.IconLocation = (Join-Path $projectPath 'electron\icon.ico') + ',0'
$shortcut.Description = 'Scholo study workspace - Ctrl+Shift+Space to capture'
$shortcut.Save()
Write-Output $shortcutPath
