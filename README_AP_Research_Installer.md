# AP Research Windows installer

`Install_AP_Research.bat` downloads AP Research v1.0.1 from the [public GitHub release](https://github.com/aryiel1905/AP-Research/releases/tag/v1.0.1). It does not use a local extension folder or ZIP. The downloaded ZIP is checked against its expected SHA-256 fingerprint, then the extension is installed at `%LOCALAPPDATA%\AP-Research\Extension`. An internet connection is required for installation; no administrator access or extra tools are needed.

## Install

1. Download the BAT from the GitHub release and double-click it. The menu shows profiles found in Chrome and Brave's standard user-data folders. Choose the browser you want.
2. If prompted, close all windows of that browser and press Enter.
3. The installer creates `Chrome - AP Research.lnk` or `Brave - AP Research.lnk` on your Desktop and opens the browser Extensions page.
4. Check the browser's profile icon to confirm the intended profile is open. The list in the installer is informational; the shortcut does not select a profile.
5. **Chrome:** [Official Chrome versions 137 and later ignore](https://support.google.com/chrome/a/answer/7679408) the shortcut's `--load-extension` argument. In the intended profile's `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select `%LOCALAPPDATA%\AP-Research\Extension`. Chrome remembers the extension in that profile.
6. **Brave:** Check `brave://extensions/` in the intended profile for AP Research. If it is absent, enable **Developer mode**, click **Load unpacked**, and select the same extension folder.

Use the generated AP Research browser shortcut for later launches. If the AP Research icon is hidden, click the Extensions/puzzle icon, find **AP Research**, then click its pin icon.

## Update

Running the same BAT again downloads v1.0.1 and replaces the existing AP Research files. For a future version, download the BAT from that version's release; its package name, release URL, and expected SHA-256 fingerprint must match. The installer stages new files and restores the previous extension if replacement fails. Reload AP Research on the browser Extensions page after an update.

## Uninstall

Run `Install_AP_Research.bat` and select **Uninstall AP Research**. This removes its installed extension folder and installer-created Desktop shortcuts. Restart any open browser session. If you used **Load unpacked**, also remove AP Research from that browser's Extensions page; the installer does not edit browser profiles.
