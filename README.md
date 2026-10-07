# AP Research

AP Research is an unpacked Manifest V3 browser extension for Australian area research. Version 1.0.1 opens ABS QuickStats, SQM Research, PropertyValue, realestate.com.au, and Your Investment Property from one popup. Its page panels help read, copy, and export selected data and charts.

## Download and install on Windows

1. On GitHub, select **Code → Download ZIP**, then extract the downloaded repository ZIP.
2. In the extracted folder, double-click `Install_AP_Research.bat`. Keep it beside the `AP-Research-v1.0.1` folder.
3. The menu lists profiles found in each browser's standard Windows user-data folder. These names are for reference; choose Google Chrome or Brave Browser, and close all windows of that browser if prompted.
4. Confirm the intended profile from the browser's profile icon after launch, then follow the browser-specific instructions. The unpacked extension directory is `AP-Research-v1.0.1/AP-Research` in this repository and `%LOCALAPPDATA%\AP-Research\Extension` after installation.

Official Chrome 137 and later [ignore the `--load-extension` launch argument](https://support.google.com/chrome/a/answer/7679408). In the intended Chrome profile, open `chrome://extensions/`, enable **Developer mode**, select **Load unpacked**, and choose `%LOCALAPPDATA%\AP-Research\Extension`. For Brave, verify that AP Research appears at `brave://extensions/` in the intended profile; use **Load unpacked** there if needed. Use the generated Desktop shortcut on later launches. The shortcut does not select a profile; the browser decides which profile opens.

If its toolbar icon is hidden, open the Extensions/puzzle menu and pin **AP Research**.

For updates and removal, see [the installer guide](README_AP_Research_Installer.md). The extension's feature description is in [its own README](AP-Research-v1.0.1/AP-Research/README.md).

## Permissions and data

The manifest requests `activeTab`, `scripting`, `downloads`, `clipboardWrite`, `storage`, `offscreen`, and host access that includes `<all_urls>`. Review these permissions before loading the extension. Its bundled suburb and ABS locality JSON files are stored in the extension folder; learned suburb suggestions and the latest search are stored in browser extension storage.

This repository includes third-party GSAP and ScrollTrigger distribution files in `vendor/`, with their original license notices retained.
