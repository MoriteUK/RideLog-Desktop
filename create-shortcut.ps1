# Create desktop shortcut for RideLog app
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "RideLog.lnk"

# Find the app installation - check common locations
$AppPaths = @(
    "$env:LOCALAPPDATA\Programs\RideLog\RideLog.exe",
    "$env:APPDATA\RideLog\RideLog.exe",
    "C:\Program Files\RideLog\RideLog.exe",
    "C:\Program Files (x86)\RideLog\RideLog.exe"
)

$AppPath = $null
foreach ($Path in $AppPaths) {
    if (Test-Path $Path) {
        $AppPath = $Path
        break
    }
}

if (-not $AppPath) {
    Write-Host "RideLog app not found in common installation locations."
    Write-Host "Please build and install the app first using: npm run build"
    Write-Host ""
    Write-Host "Alternatively, if running in dev mode, the shortcut will point to npm start"

    # Create shortcut to dev mode instead
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = "cmd.exe"
    $Shortcut.Arguments = "/c cd /d `"$PSScriptRoot`" && npm start"
    $Shortcut.WorkingDirectory = $PSScriptRoot
    $Shortcut.IconLocation = "$PSScriptRoot\assets\bicyclist.ico"
    $Shortcut.Description = "RideLog - Audax Training Tracker (Dev Mode)"
    $Shortcut.Save()

    Write-Host "Created desktop shortcut for development mode: $ShortcutPath"
} else {
    # Create shortcut to installed app
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $AppPath
    $Shortcut.WorkingDirectory = Split-Path $AppPath
    $Shortcut.IconLocation = $AppPath
    $Shortcut.Description = "RideLog - Audax Training Tracker"
    $Shortcut.Save()

    Write-Host "Created desktop shortcut: $ShortcutPath"
    Write-Host "Target: $AppPath"
}

Write-Host "Done!"
