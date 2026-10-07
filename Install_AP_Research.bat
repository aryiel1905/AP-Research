@echo off
setlocal DisableDelayedExpansion
set "PACKAGE_NAME=AP-Research-v1.0.1"
set "AP_INSTALLER_FILE=%~f0"
set "AP_INSTALLER_DIR=%~dp0"
set "AP_PACKAGE_NAME=%PACKAGE_NAME%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $lines=[IO.File]::ReadAllLines($env:AP_INSTALLER_FILE); $code=($lines | Where-Object { $_.StartsWith('::PS ') } | ForEach-Object { $_.Substring(5) }) -join [Environment]::NewLine; & ([ScriptBlock]::Create($code)) } catch { Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
set "AP_EXIT_CODE=%ERRORLEVEL%"
if not "%AP_EXIT_CODE%"=="0" pause
exit /b %AP_EXIT_CODE%

::PS $ErrorActionPreference = 'Stop'
::PS $packageName = $env:AP_PACKAGE_NAME
::PS $installerDir = [IO.Path]::GetFullPath($env:AP_INSTALLER_DIR)
::PS if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is unavailable.' }
::PS $installBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AP-Research'))
::PS $extensionDir = [IO.Path]::GetFullPath((Join-Path $installBase 'Extension'))
::PS $desktop = [Environment]::GetFolderPath('DesktopDirectory')
::PS if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'The current user Desktop could not be found.' }
::PS function Fail([string]$message) { throw $message }
::PS function Full([string]$path) { return [IO.Path]::GetFullPath($path).TrimEnd('\') }
::PS function SamePath([string]$a, [string]$b) { return [string]::Equals((Full $a), (Full $b), [StringComparison]::OrdinalIgnoreCase) }
::PS function ShowError([string]$message) { Write-Host ('[ERROR] ' + $message) -ForegroundColor Red }
::PS function ReadManifest([string]$manifestPath) {
::PS   try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { Fail ('Malformed manifest.json: ' + $manifestPath) }
::PS   if ($null -eq $manifest -or $manifest.manifest_version -ne 3 -or $manifest.name -ne 'AP Research' -or [string]::IsNullOrWhiteSpace([string]$manifest.version)) { Fail ('Not the AP Research Manifest V3 extension: ' + $manifestPath) }
::PS   if ([string]$manifest.version -notmatch '^\d+(\.\d+){0,3}$') { Fail ('Invalid extension version in ' + $manifestPath) }
::PS   if (-not $manifest.action -or -not $manifest.background -or -not $manifest.background.service_worker) { Fail ('Required browser extension fields are missing: ' + $manifestPath) }
::PS   return $manifest
::PS }
::PS function CheckManifestFiles([string]$root, $manifest) {
::PS   $refs = New-Object System.Collections.Generic.List[string]
::PS   $refs.Add([string]$manifest.background.service_worker)
::PS   if ($manifest.action.default_popup) { $refs.Add([string]$manifest.action.default_popup) }
::PS   if ($manifest.action.default_icon) { $manifest.action.default_icon.PSObject.Properties | ForEach-Object { $refs.Add([string]$_.Value) } }
::PS   if ($manifest.icons) { $manifest.icons.PSObject.Properties | ForEach-Object { $refs.Add([string]$_.Value) } }
::PS   foreach ($script in @($manifest.content_scripts)) { if ($null -ne $script) { foreach ($file in @($script.js) + @($script.css)) { if ($file) { $refs.Add([string]$file) } } } }
::PS   $rootWithSlash = (Full $root) + '\'
::PS   foreach ($reference in ($refs | Select-Object -Unique)) {
::PS     if ([IO.Path]::IsPathRooted($reference)) { Fail ('Manifest contains an absolute file path: ' + $reference) }
::PS     $target = Full (Join-Path $root $reference)
::PS     if (-not $target.StartsWith($rootWithSlash, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $target -PathType Leaf)) { Fail ('Required extension file is missing or outside the extension: ' + $reference) }
::PS   }
::PS }
::PS function FindSource {
::PS   $folder = Join-Path $installerDir $packageName
::PS   $zip = Join-Path $installerDir ($packageName + '.zip')
::PS   if (Test-Path -LiteralPath $folder -PathType Container) { Write-Host ('[OK] ' + $packageName + ' folder found'); return @{ Path = $folder; Temporary = $null } }
::PS   if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { Fail ($packageName + ' folder or ZIP was not found beside this BAT file.') }
::PS   Write-Host ('[OK] ' + $packageName + ' ZIP found')
::PS   $tempParent = Join-Path $env:TEMP 'AP-Research-Installer'
::PS   $temp = Join-Path $tempParent ([guid]::NewGuid().ToString('N'))
::PS   try { New-Item -ItemType Directory -Path $temp -Force -ErrorAction Stop | Out-Null; Expand-Archive -LiteralPath $zip -DestinationPath $temp -ErrorAction Stop } catch { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }; Fail ('ZIP extraction failed: ' + $_.Exception.Message) }
::PS   return @{ Path = $temp; Temporary = $temp }
::PS }
::PS function FindExtension([string]$source) {
::PS   try { $manifests = @(Get-ChildItem -LiteralPath $source -Filter 'manifest.json' -File -Recurse -Force -ErrorAction Stop) } catch { Fail ('Source folder is inaccessible: ' + $_.Exception.Message) }
::PS   if ($manifests.Count -eq 0) { Fail 'No manifest.json was found in the package.' }
::PS   $matches = New-Object System.Collections.ArrayList
::PS   $invalid = New-Object System.Collections.ArrayList
::PS   foreach ($file in $manifests) {
::PS     try { $manifest = ReadManifest $file.FullName; [void]$matches.Add(@{ Root = $file.DirectoryName; Manifest = $manifest }) } catch { [void]$invalid.Add($_.Exception.Message) }
::PS   }
::PS   if ($matches.Count -eq 0) { Fail ('No valid AP Research extension manifest was found. ' + ($invalid -join ' | ')) }
::PS   if ($matches.Count -gt 1) { Fail ('Multiple AP Research extension manifests were found: ' + (($matches | ForEach-Object { $_.Root }) -join ', ')) }
::PS   $selected = $matches[0]
::PS   if (SamePath $selected.Root $extensionDir) { Fail 'Source and destination resolve to the same directory.' }
::PS   $links = @(Get-ChildItem -LiteralPath $selected.Root -Recurse -Force -ErrorAction Stop | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
::PS   if ($links.Count -gt 0) { Fail 'The extension source contains a junction or symbolic link, so copying was stopped.' }
::PS   Write-Host ('[OK] Extension manifest located: ' + $selected.Root)
::PS   CheckManifestFiles $selected.Root $selected.Manifest
::PS   Write-Host ('[OK] manifest.json validated: ' + $selected.Manifest.name + ' v' + $selected.Manifest.version)
::PS   return $selected
::PS }
::PS function BrowserPath([string]$kind) {
::PS   $roots = @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'), $env:LOCALAPPDATA) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
::PS   if ($kind -eq 'Chrome') { $relative = 'Google\Chrome\Application\chrome.exe' } else { $relative = 'BraveSoftware\Brave-Browser\Application\brave.exe' }
::PS   foreach ($root in $roots) { $candidate = Join-Path $root $relative; if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Full $candidate) } }
::PS   return $null
::PS }
::PS function GetProfiles([string]$kind) {
::PS   $relative = if ($kind -eq 'Chrome') { 'Google\Chrome\User Data' } else { 'BraveSoftware\Brave-Browser\User Data' }
::PS   $userData = Join-Path $env:LOCALAPPDATA $relative
::PS   if (-not (Test-Path -LiteralPath $userData -PathType Container)) { return }
::PS   $names = @{}
::PS   $localState = Join-Path $userData 'Local State'
::PS   if (Test-Path -LiteralPath $localState -PathType Leaf) {
::PS     try { $cache = (Get-Content -LiteralPath $localState -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop).profile.info_cache; if ($cache) { foreach ($entry in $cache.PSObject.Properties) { $names[$entry.Name] = [string]$entry.Value.name } } } catch { }
::PS   }
::PS   try { $directories = @(Get-ChildItem -LiteralPath $userData -Directory -Force -ErrorAction Stop | Where-Object { $_.Name -match '^(Default|Profile [0-9]+)$' } | Sort-Object @{ Expression = { if ($_.Name -eq 'Default') { -1 } else { [int]($_.Name -replace '^Profile ', '') } } }) } catch { return }
::PS   foreach ($directory in $directories) {
::PS     if (-not (Test-Path -LiteralPath (Join-Path $directory.FullName 'Preferences') -PathType Leaf)) { continue }
::PS     $display = $names[$directory.Name]
::PS     if ([string]::IsNullOrWhiteSpace($display)) { $display = $directory.Name }
::PS     $display = [regex]::Replace($display, '[\x00-\x1f\x7f]', ' ').Trim()
::PS     if ($display.Length -gt 60) { $display = $display.Substring(0, 57) + '...' }
::PS     [pscustomobject]@{ Directory = $directory.Name; Display = $display }
::PS   }
::PS }
::PS function ShowProfiles([string]$kind) {
::PS   $profiles = @(GetProfiles $kind)
::PS   if ($profiles.Count -eq 0) { Write-Host '  Profiles: none found in the standard user-data folder'; return }
::PS   Write-Host '  Profiles:'
::PS   foreach ($profile in $profiles) { Write-Host ('    ' + $profile.Display + ' [' + $profile.Directory + ']') }
::PS }
::PS function ShortcutPath([string]$kind) { if ($kind -eq 'Chrome') { return (Join-Path $desktop 'Chrome - AP Research.lnk') } else { return (Join-Path $desktop 'Brave - AP Research.lnk') } }
::PS function ShortcutArgument { return ('--load-extension="' + $extensionDir + '"') }
::PS function OwnsShortcut([string]$path, [string]$kind) {
::PS   if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
::PS   try { $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($path); $expectedExe = if ($kind -eq 'Chrome') { 'chrome.exe' } else { 'brave.exe' }; return (([IO.Path]::GetFileName($shortcut.TargetPath) -ieq $expectedExe) -and ($shortcut.Arguments -eq (ShortcutArgument))) } catch { return $false }
::PS }
::PS function CreateShortcut([string]$kind, [string]$exe) {
::PS   $path = ShortcutPath $kind
::PS   if ((Test-Path -LiteralPath $path) -and -not (OwnsShortcut $path $kind)) { Fail ('Desktop shortcut exists but was not created by this installer: ' + $path) }
::PS   try { $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($path); $shortcut.TargetPath = $exe; $shortcut.Arguments = ShortcutArgument; $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($exe); $shortcut.IconLocation = $exe + ',0'; $shortcut.Description = 'Launch ' + $kind + ' with AP Research'; $shortcut.Save() } catch { Fail ('Shortcut creation failed: ' + $_.Exception.Message) }
::PS   Write-Host ('[OK] ' + $kind + ' AP Research shortcut created')
::PS   return $path
::PS }
::PS function CopyExtension([string]$sourceRoot, $manifest) {
::PS   if (-not (SamePath $installBase (Join-Path $env:LOCALAPPDATA 'AP-Research')) -or -not (SamePath $extensionDir (Join-Path $installBase 'Extension'))) { Fail 'Unsafe destination path.' }
::PS   if ((Test-Path -LiteralPath $installBase) -and ((Get-Item -LiteralPath $installBase -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Fail 'The AP-Research destination is a junction or symbolic link.' }
::PS   if ((Test-Path -LiteralPath $extensionDir) -and ((Get-Item -LiteralPath $extensionDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Fail 'The Extension destination is a junction or symbolic link.' }
::PS   if (Test-Path -LiteralPath $extensionDir) { if (-not (Test-Path -LiteralPath $extensionDir -PathType Container)) { Fail 'The extension destination is not a folder.' }; try { $old = ReadManifest (Join-Path $extensionDir 'manifest.json') } catch { Fail 'The existing Extension folder was not recognized as AP Research; it was left untouched.' } }
::PS   try { New-Item -ItemType Directory -Path $installBase -Force -ErrorAction Stop | Out-Null } catch { Fail ('Destination creation failed: ' + $_.Exception.Message) }
::PS   $stage = Join-Path $installBase ('Extension.stage.' + [guid]::NewGuid().ToString('N'))
::PS   $backup = Join-Path $installBase ('Extension.backup.' + [guid]::NewGuid().ToString('N'))
::PS   $movedOld = $false
::PS   try {
::PS     New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null
::PS     Get-ChildItem -LiteralPath $sourceRoot -Force -ErrorAction Stop | Copy-Item -Destination $stage -Recurse -Force -ErrorAction Stop
::PS     $stagedManifest = ReadManifest (Join-Path $stage 'manifest.json')
::PS     CheckManifestFiles $stage $stagedManifest
::PS     if (Test-Path -LiteralPath $extensionDir) { Move-Item -LiteralPath $extensionDir -Destination $backup -ErrorAction Stop; $movedOld = $true }
::PS     Move-Item -LiteralPath $stage -Destination $extensionDir -ErrorAction Stop
::PS   } catch {
::PS     $reason = $_.Exception.Message
::PS     if ($movedOld -and -not (Test-Path -LiteralPath $extensionDir)) { try { Move-Item -LiteralPath $backup -Destination $extensionDir -ErrorAction Stop } catch { Fail ('Update failed and rollback also failed. Previous files remain at ' + $backup + '. Cause: ' + $reason) } }
::PS     Fail ('File copy or update failed: ' + $reason)
::PS   } finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue } }
::PS   if ($movedOld) { try { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Stop } catch { Write-Host ('[WARNING] Old version remains at ' + $backup) -ForegroundColor Yellow } }
::PS   Write-Host '[OK] Extension copied to the persistent location'
::PS }
::PS function WaitForBrowser([string]$kind) {
::PS   $processName = if ($kind -eq 'Chrome') { 'chrome' } else { 'brave' }
::PS   while (@(Get-Process -Name $processName -ErrorAction SilentlyContinue).Count -gt 0) {
::PS     Write-Host ('-' * 40)
::PS     Write-Host ($kind + ' is currently running.')
::PS     Write-Host ('Close all ' + $kind + ' windows first so the launch argument can be applied.')
::PS     $answer = Read-Host 'After closing it, press Enter to continue, or M for the menu'
::PS     if ($answer -match '^[Mm]$') { return $false }
::PS   }
::PS   return $true
::PS }
::PS function Install([string]$kind) {
::PS   $exe = BrowserPath $kind
::PS   if (-not $exe) { ShowError ($kind + ' was not found in the common installation locations.'); return }
::PS   Write-Host ('[OK] ' + $kind + ' detected: ' + $exe)
::PS   $source = $null
::PS   try {
::PS     $source = FindSource
::PS     $selected = FindExtension $source.Path
::PS     if (-not (WaitForBrowser $kind)) { return }
::PS     CopyExtension $selected.Root $selected.Manifest
::PS     $shortcut = CreateShortcut $kind $exe
::PS     $url = if ($kind -eq 'Chrome') { 'chrome://extensions/' } else { 'brave://extensions/' }
::PS     try { Start-Process -FilePath $exe -ArgumentList @((ShortcutArgument), $url) -ErrorAction Stop } catch { Fail ('Browser launch failed: ' + $_.Exception.Message) }
::PS     Write-Host ('[OK] ' + $kind + ' launched')
::PS     ShowSuccess $kind $shortcut
::PS   } catch { ShowError $_.Exception.Message; Write-Host 'The package and any previous installed version were left available where possible.' } finally { if ($source -and $source.Temporary -and (Test-Path -LiteralPath $source.Temporary)) { Remove-Item -LiteralPath $source.Temporary -Recurse -Force -ErrorAction SilentlyContinue } }
::PS }
::PS function ShowSuccess([string]$kind, [string]$shortcut) {
::PS   Write-Host ''
::PS   Write-Host '========================================'
::PS   Write-Host '       AP RESEARCH FILES INSTALLED'
::PS   Write-Host '========================================'
::PS   Write-Host ('Extension folder: ' + $extensionDir)
::PS   Write-Host ('Desktop shortcut: ' + $shortcut)
::PS   Write-Host 'Confirm the intended profile from the browser profile icon.'
::PS   if ($kind -eq 'Chrome') {
::PS     Write-Host 'Current official Chrome versions ignore --load-extension.' -ForegroundColor Yellow
::PS     Write-Host 'On chrome://extensions, enable Developer mode, click Load unpacked,'
::PS     Write-Host ('and select: ' + $extensionDir)
::PS     Write-Host 'Do this in the intended Chrome profile; Chrome remembers it there.'
::PS   } else {
::PS     Write-Host 'Brave was launched with the AP Research load argument.'
::PS     Write-Host 'Check brave://extensions to verify that AP Research appears.'
::PS     Write-Host 'Check within the intended Brave profile.'
::PS     Write-Host 'If it does not, enable Developer mode, click Load unpacked,'
::PS     Write-Host ('and select: ' + $extensionDir)
::PS   }
::PS   Write-Host 'If the icon is hidden: Extensions (puzzle icon) > AP Research > Pin.'
::PS   Write-Host 'Use the generated AP Research shortcut for later launches.'
::PS   Write-Host '========================================'
::PS }
::PS function Uninstall {
::PS   if (-not (SamePath $installBase (Join-Path $env:LOCALAPPDATA 'AP-Research')) -or -not (SamePath $extensionDir (Join-Path $installBase 'Extension'))) { ShowError 'Unsafe uninstall path; nothing was removed.'; return }
::PS   if ((Test-Path -LiteralPath $installBase) -and ((Get-Item -LiteralPath $installBase -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { ShowError 'The AP-Research destination is a junction or symbolic link; nothing was removed.'; return }
::PS   if ((Test-Path -LiteralPath $extensionDir) -and ((Get-Item -LiteralPath $extensionDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { ShowError 'The Extension destination is a junction or symbolic link; nothing was removed.'; return }
::PS   if (Test-Path -LiteralPath $extensionDir) {
::PS     if (-not (Test-Path -LiteralPath $extensionDir -PathType Container)) { ShowError 'The extension path is not a folder; nothing was removed.'; return }
::PS     try { $installedManifest = ReadManifest (Join-Path $extensionDir 'manifest.json') } catch { ShowError 'The installed folder was not recognized as AP Research; nothing was removed.'; return }
::PS   }
::PS   $shortcutError = $false
::PS   foreach ($kind in @('Chrome', 'Brave')) { $path = ShortcutPath $kind; if (Test-Path -LiteralPath $path) { if (OwnsShortcut $path $kind) { try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop } catch { ShowError ('Could not remove shortcut: ' + $path); $shortcutError = $true } } else { Write-Host ('[SKIP] Unrecognized shortcut left untouched: ' + $path) } } }
::PS   if (Test-Path -LiteralPath $extensionDir) { try { Remove-Item -LiteralPath $extensionDir -Recurse -Force -ErrorAction Stop } catch { ShowError ('Could not remove extension files: ' + $_.Exception.Message); return } }
::PS   if ($shortcutError) { Write-Host 'AP Research files were removed, but one or more installer shortcuts could not be removed.' } else { Write-Host 'AP Research files and installer-created shortcuts have been removed.' }
::PS   Write-Host 'Already-running browser sessions may need to be restarted.'
::PS   Write-Host 'If you used Load unpacked, remove its entry from the browser Extensions page.'
::PS }
::PS function Menu {
::PS   while ($true) {
::PS     $chrome = BrowserPath 'Chrome'; $brave = BrowserPath 'Brave'
::PS     $chromeStatus = if ($chrome) { 'INSTALLED' } else { 'NOT FOUND' }
::PS     $braveStatus = if ($brave) { 'INSTALLED' } else { 'NOT FOUND' }
::PS     Clear-Host
::PS     Write-Host '========================================'
::PS     Write-Host '          AP RESEARCH INSTALLER'
::PS     Write-Host '========================================'
::PS     Write-Host ('Source: ' + $packageName)
::PS     Write-Host ''
::PS     Write-Host 'Detected browsers:'
::PS     Write-Host ('Google Chrome : ' + $chromeStatus)
::PS     if ($chrome) { ShowProfiles 'Chrome' }
::PS     Write-Host ('Brave Browser : ' + $braveStatus)
::PS     if ($brave) { ShowProfiles 'Brave' }
::PS     Write-Host 'Profile list is informational; check the profile opened in the browser.'
::PS     Write-Host ('-' * 40)
::PS     Write-Host '[1] Install / Launch with Google Chrome'
::PS     Write-Host '[2] Install / Launch with Brave Browser'
::PS     Write-Host '[3] Uninstall AP Research'
::PS     Write-Host '[4] Exit'
::PS     $choice = Read-Host 'Selection'
::PS     switch ($choice) { '1' { Install 'Chrome' } '2' { Install 'Brave' } '3' { Uninstall } '4' { return } default { ShowError 'Choose 1, 2, 3, or 4.' } }
::PS     if ($choice -ne '4') { [void](Read-Host 'Press Enter to return to the menu') }
::PS   }
::PS }
::PS try { Menu } catch { ShowError $_.Exception.Message; exit 1 }
