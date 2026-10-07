# AP Research Windows installer

Keep `Install_AP_Research.bat` beside either `AP-Research-v1.0.1.zip` or the `AP-Research-v1.0.1` folder. If both are present, the folder is used. The extension is copied to `%LOCALAPPDATA%\AP-Research\Extension`; no administrator access or extra tools are needed.

## Install

1. Double-click `Install_AP_Research.bat` and select Google Chrome or Brave Browser.
2. If prompted, close all windows of that browser and press Enter.
3. The installer creates `Chrome - AP Research.lnk` or `Brave - AP Research.lnk` on your Desktop and opens the browser Extensions page.
4. **Chrome:** [Official Chrome versions 137 and later ignore](https://support.google.com/chrome/a/answer/7679408) the shortcut's `--load-extension` argument. In `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select `%LOCALAPPDATA%\AP-Research\Extension`. Chrome remembers the extension in that profile.
5. **Brave:** Check `brave://extensions/` for AP Research. If it is absent, enable **Developer mode**, click **Load unpacked**, and select the same extension folder.

Use the generated AP Research browser shortcut for later launches. If the AP Research icon is hidden, click the Extensions/puzzle icon, find **AP Research**, then click its pin icon.

## Update

Replace the supplied package with a newer AP Research package, change `PACKAGE_NAME` near the top of the BAT file to that package's name, and run the installer again. It stages the new files and restores the previous extension if replacement fails. Reload AP Research on the browser Extensions page after an update.

## Uninstall

Run `Install_AP_Research.bat` and select **Uninstall AP Research**. This removes its installed extension folder and installer-created Desktop shortcuts. Restart any open browser session. If you used **Load unpacked**, also remove AP Research from that browser's Extensions page; the installer does not edit browser profiles.
