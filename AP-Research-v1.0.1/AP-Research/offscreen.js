chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PVCG_OFFSCREEN_CROP") return;

  (async () => {
    const { dataUrl, rect, viewportWidth, viewportHeight } = message;
    if (!dataUrl || !rect || !viewportWidth || !viewportHeight) {
      throw new Error("Missing screenshot crop data");
    }

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Screenshot could not be decoded"));
      img.src = dataUrl;
    });

    const scaleX = img.naturalWidth / viewportWidth;
    const scaleY = img.naturalHeight / viewportHeight;

    const sx = Math.max(0, Math.round(rect.left * scaleX));
    const sy = Math.max(0, Math.round(rect.top * scaleY));
    const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(rect.width * scaleX)));
    const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(rect.height * scaleY)));

    if (sw <= 0 || sh <= 0) throw new Error("Chart is outside the visible viewport");

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const pngDataUrl = canvas.toDataURL("image/png", 1);
    sendResponse({ ok: true, dataUrl: pngDataUrl, width: sw, height: sh });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PVCG_OFFSCREEN_COPY_PNG") return;

  (async () => {
    if (!message.dataUrl) throw new Error("Missing PNG data");
    const response = await fetch(message.dataUrl);
    if (!response.ok) throw new Error("Could not decode prepared PNG");
    const sourceBlob = await response.blob();
    const pngBlob = sourceBlob.type === "image/png"
      ? sourceBlob
      : new Blob([await sourceBlob.arrayBuffer()], { type: "image/png" });

    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard API is unavailable in this browser");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    sendResponse({ ok: true });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});
