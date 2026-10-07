# AP Research v1.0.1

AP Research opens five Australian area research sources from one compact browser popup. Enter a postcode first, choose a suburb if the postcode has multiple saved matches, then open all five sources or select one. The popup includes suburb suggestions, an ABS locality selector when multiple official matches exist, and an option to export updated suggestions as JSON.

Each supported website has a monochrome in-page panel:

- PropertyValue: preview, copy, and download the selected Market Trends chart as a PNG.
- SQM Research: preview, copy, and download the detected chart as a PNG.
- Your Investment Property: read House growth, rental yield, and days-on-market figures in individual metric cards, copy each value, or jump to the source data.
- realestate.com.au: read House sale and weekly rent medians in one table, with its reporting month and year in a merged row; copy individual values or the detected month.
- ABS 2021 QuickStats: copy family-composition percentages, including the clearly identified calculated non-couple remainder, or jump to the source data.

PropertyValue and SQM use matching chart cards with a preview, Copy chart, and Download PNG controls. Chart previews and exported PNGs retain the source chart's original colors.

## Install

1. Open your browser's extension management page, such as `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked** and choose this `AP-Research` folder.
4. Reload any already-open supported research page.

The extension remembers its latest search and new suburb suggestions in local extension storage. Its storage is separate from the original Area Profile Helper extension when both are installed.
