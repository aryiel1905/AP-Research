const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length) return;
  }

  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DOM_SCRAPING", "CLIPBOARD"],
    justification: "Crop detected PropertyValue and SQM charts and copy prepared PNG images to the clipboard."
  }).finally(() => {
    creatingOffscreen = null;
  });
  return creatingOffscreen;
}

function safeFilenamePart(value) {
  return String(value || "Chart")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Chart";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "APH_SQM_READ_RATE") {
    (async () => {
      if (sender.tab?.id == null) throw new Error("Could not identify the SQM tab");

      const executions = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, allFrames: true },
        world: "MAIN",
        func: () => {
          const formatRate = (value) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "";
          };

          const charts = Array.isArray(window.Highcharts?.charts)
            ? window.Highcharts.charts.filter(Boolean)
            : [];

          for (const chart of charts) {
            const series = (chart.series || []).find((item) =>
              /vacancy\s*rate/i.test(String(item?.name || item?.options?.name || ""))
            );
            if (!series) continue;

            const points = Array.isArray(series.points) ? series.points : [];
            for (let index = points.length - 1; index >= 0; index -= 1) {
              const point = points[index];
              if (!Number.isFinite(Number(point?.y))) continue;
              return {
                vacancyRate: formatRate(point.y),
                vacancyRateValue: Number(point.y),
                vacancyPeriod: String(point.category ?? point.name ?? point.x ?? "")
              };
            }
          }

          const labelledPoints = [...document.querySelectorAll('[aria-label*="Vacancy Rate" i]')];
          for (let index = labelledPoints.length - 1; index >= 0; index -= 1) {
            const label = labelledPoints[index].getAttribute('aria-label') || '';
            const match = label.match(/vacancy\s*rate[^0-9-]*(-?\d+(?:\.\d+)?)\s*%/i);
            if (!match) continue;
            return {
              vacancyRate: formatRate(match[1]),
              vacancyRateValue: Number(match[1]),
              vacancyPeriod: label.split(',')[0]?.trim() || ''
            };
          }

          return null;
        }
      });

      const result = executions.map((execution) => execution.result).find((value) => value?.vacancyRate);
      sendResponse(result ? { ok: true, ...result } : { ok: false, error: "Vacancy rate series was not ready" });
    })().catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (message?.type === "PVCG_CAPTURE_AND_CROP") {
    (async () => {
      if (!sender.tab?.windowId) throw new Error("Could not identify the browser window");

      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
      await ensureOffscreenDocument();

      const result = await chrome.runtime.sendMessage({
        type: "PVCG_OFFSCREEN_CROP",
        dataUrl,
        rect: message.rect,
        viewportWidth: message.viewportWidth,
        viewportHeight: message.viewportHeight
      });

      if (!result?.ok) throw new Error(result?.error || "Could not crop chart screenshot");
      sendResponse(result);
    })().catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (message?.type === "PVCG_COPY_PNG") {
    (async () => {
      await ensureOffscreenDocument();
      const result = await chrome.runtime.sendMessage({
        type: "PVCG_OFFSCREEN_COPY_PNG",
        dataUrl: message.dataUrl
      });
      if (!result?.ok) throw new Error(result?.error || "Clipboard write failed");
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }

  if (message?.type === "APH_SQM_CAPTURE") {
    (async () => {
      if (sender.tab?.windowId == null) throw new Error("Could not identify the browser window");
      const capture = message.capture;
      if (!capture?.width || !capture?.height || !capture?.viewportWidth || !capture?.viewportHeight) {
        throw new Error("Missing SQM chart capture details");
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
      await ensureOffscreenDocument();
      const cropped = await chrome.runtime.sendMessage({
        type: "PVCG_OFFSCREEN_CROP",
        dataUrl,
        rect: capture,
        viewportWidth: capture.viewportWidth,
        viewportHeight: capture.viewportHeight
      });
      if (!cropped?.ok) throw new Error(cropped?.error || "Could not crop SQM chart screenshot");

      if (message.mode === "copy") {
        const copied = await chrome.runtime.sendMessage({
          type: "PVCG_OFFSCREEN_COPY_PNG",
          dataUrl: cropped.dataUrl
        });
        if (!copied?.ok) throw new Error(copied?.error || "Clipboard write failed");
        sendResponse({ ok: true });
        return;
      }

      if (message.mode === "download") {
        const filename = `SQM_${safeFilenamePart(capture.label)}_${safeFilenamePart(capture.postcode || "Unknown")}.png`;
        await chrome.downloads.download({ url: cropped.dataUrl, filename, saveAs: false });
        sendResponse({ ok: true, filename });
        return;
      }

      throw new Error("Unknown SQM capture action");
    })().catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "PVCG_TOGGLE_PANEL" }).catch(() => {});
});
