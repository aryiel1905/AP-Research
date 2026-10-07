(() => {
  "use strict";

  const PANEL_ID = "apr-pvcg-panel";
  const HIGHLIGHT_CLASS = "pvcg-target-highlight";
  const STORAGE_KEY = "aprPvcgCollapsed";
  const MIN_CHART_WIDTH = 430;
  const MIN_CHART_HEIGHT = 210;
  const METRICS = [
    { label: "Median Value", slug: "Median_Value", keywords: ["median value"] },
    { label: "Properties sold", slug: "Properties_Sold", keywords: ["properties sold", "property sold"] },
    { label: "Median Rent", slug: "Median_Rent", keywords: ["median rent"] },
    { label: "Median Gross Yield", slug: "Median_Gross_Yield", keywords: ["median gross yield", "gross yield"] },
    { label: "Average Days on Market", slug: "Average_Days_On_Market", keywords: ["average days on market", "days on market"] },
    { label: "Average Vendor Discount", slug: "Average_Vendor_Discount", keywords: ["average vendor discount", "vendor discount"] },
    { label: "Median Sale Price Change (1yr)", slug: "Median_Sale_Price_Change_1yr", keywords: ["median sale price change", "sale price change"] }
  ];

  let panel;
  let currentTarget = null;
  let currentMetric = null;
  let previewUrl = null;
  let currentPngBlob = null;
  let currentPngSignature = "";
  let detectTimer = null;
  let previewTimer = null;
  let scrollRefreshTimer = null;
  let toastTimer = null;
  let lastTargetSignature = "";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function tagIs(el, name) {
    if (!el) return false;
    // SVGElement.tagName/localName is commonly lowercase ("svg") while HTML
    // elements such as <canvas> usually expose uppercase tagName. Normalize both.
    const tag = String(el.localName || el.tagName || "").toLowerCase();
    return tag === String(name || "").toLowerCase();
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function titleCaseSlug(text) {
    return text
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getLocationInfo() {
    const match = location.pathname.match(/\/suburb\/([^/?#]+)/i);
    let suburb = "PropertyValue suburb";
    let postcode = "";
    let state = "";

    if (match) {
      const bits = match[1].split("-").filter(Boolean);
      if (bits.length >= 3) {
        state = bits.at(-1).toUpperCase();
        postcode = bits.at(-2);
        suburb = titleCaseSlug(bits.slice(0, -2).join("-"));
      }
    }

    const heading = findMarketHeading();
    if (heading) {
      const m = normalizeText(heading.textContent).match(/Market Trends for\s+(.+?)(?:\s+for\s+|$)/i);
      if (m?.[1]) suburb = m[1].trim();
    }

    return { suburb, postcode, state };
  }

  function getPropertyType() {
    const heading = findMarketHeading();
    if (!heading) return "Houses";
    let scope = heading.parentElement;
    for (let i = 0; i < 3 && scope; i += 1, scope = scope.parentElement) {
      const text = normalizeText(scope.textContent);
      const m = text.match(/for\s+(Houses|Units)\s+in last 12 months/i);
      if (m) return m[1];
    }
    return "Houses";
  }

  function getLatestChartPeriod(target = currentTarget) {
    if (!target) return "";
    const monthNames = {
      jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
      jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December"
    };
    const axisNodes = target.querySelectorAll(".highcharts-xaxis-labels text");
    const labels = [...(axisNodes.length ? axisNodes : target.querySelectorAll("text"))]
      .map((node) => normalizeText(node.textContent))
      .map((label) => label.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s-]+(\d{4})\b/i))
      .filter(Boolean);
    const latest = labels.at(-1);
    if (!latest) return "";
    return `${monthNames[latest[1].slice(0, 3).toLowerCase()]} ${latest[2]}`;
  }

  function findMarketHeading() {
    const selectors = "h1,h2,h3,h4,h5,[role='heading']";
    return [...document.querySelectorAll(selectors)].find((el) => {
      if (el.closest(`#${PANEL_ID}`)) return false;
      return /Market Trends for/i.test(normalizeText(el.textContent));
    }) || null;
  }

  function elementArea(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  function findChartTarget() {
    // PropertyValue has many Highcharts instances on the page (demographics, income,
    // household structure, etc.). The Market Trends chart has its own stable wrapper:
    //   #marketTrends > #containerMarketTrends > .highcharts-container > svg.highcharts-root
    // Target only that subtree so we never accidentally select another chart.
    const section = document.querySelector("#marketTrends");
    if (!section) return null;

    const container = section.querySelector("#containerMarketTrends") || document.querySelector("#containerMarketTrends");
    if (!container || !isVisible(container)) return null;

    const exactSvg = container.querySelector(".highcharts-container > svg.highcharts-root, svg.highcharts-root");
    if (exactSvg && isVisible(exactSvg)) {
      const r = exactSvg.getBoundingClientRect();
      if (r.width >= 300 && r.height >= 180) return exactSvg;
    }

    // Conservative fallback: still stay inside #containerMarketTrends.
    const svgCandidates = [...container.querySelectorAll("svg")].filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 300 && r.height >= 180;
    });
    if (svgCandidates.length) {
      svgCandidates.sort((a, b) => elementArea(b) - elementArea(a));
      return svgCandidates[0];
    }

    const highchartsContainer = container.querySelector(".highcharts-container");
    if (highchartsContainer && isVisible(highchartsContainer)) return highchartsContainer;

    return null;
  }

  function inferMetricFromChart(target) {
    if (!target) return null;
    const text = normalizeText(target.textContent).toLowerCase();
    if (text) {
      for (const metric of METRICS) {
        if (metric.keywords.some((keyword) => text.includes(keyword))) return metric;
      }
    }
    return inferMetricFromSelectedTile();
  }

  function inferMetricFromSelectedTile() {
    const heading = findMarketHeading();
    if (!heading) return null;
    const headingRect = heading.getBoundingClientRect();
    const scored = [];

    for (const metric of METRICS) {
      const nodes = [...document.querySelectorAll("body *")].filter((el) => {
        if (el.closest(`#${PANEL_ID}`)) return false;
        if (el.children.length > 4) return false;
        const text = normalizeText(el.textContent).toLowerCase();
        return metric.keywords.some((k) => text === k || text.endsWith(k) || text.includes(k));
      });

      for (const node of nodes.slice(0, 10)) {
        const nr = node.getBoundingClientRect();
        if (!isVisible(node) || nr.top < headingRect.top - 40 || nr.top > headingRect.top + 450) continue;
        let box = node;
        for (let level = 0; level < 4 && box; level += 1, box = box.parentElement) {
          if (!box || box === document.body) break;
          const style = getComputedStyle(box);
          const cls = typeof box.className === "string" ? box.className : "";
          let score = 0;
          if (box.getAttribute("aria-selected") === "true" || box.getAttribute("aria-current") === "true") score += 10;
          if (/active|selected|current/i.test(cls)) score += 8;
          const borderWidth = parseFloat(style.borderTopWidth) + parseFloat(style.borderRightWidth) + parseFloat(style.borderBottomWidth) + parseFloat(style.borderLeftWidth);
          if (borderWidth >= 3) score += 4;
          if (style.backgroundColor && !/rgba?\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor)) score += 1;
          const br = box.getBoundingClientRect();
          if (br.width >= 80 && br.width <= 220 && br.height >= 80 && br.height <= 230) score += 3;
          if (score > 0) scored.push({ metric, score, node: box });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.metric || null;
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);

    const root = document.createElement("aside");
    root.id = PANEL_ID;
    root.innerHTML = `
      <div class="pvcg-header">
        <div class="pvcg-logo">AP</div>
        <div class="pvcg-header-copy">
          <div class="pvcg-title">AP Research</div>
          <div class="pvcg-subtitle">PropertyValue / Market Trends</div>
        </div>
        <button class="pvcg-icon-btn pvcg-collapse" type="button" title="Collapse panel" aria-label="Collapse panel">
          <span class="pvcg-collapse-icon-expanded">›</span>
          <span class="pvcg-collapse-icon-collapsed">‹</span>
        </button>
        <div class="pvcg-rail-label">PropertyValue charts</div>
      </div>
      <div class="pvcg-body">
        <div class="pvcg-section-heading"><div><span class="pvcg-source-label">PropertyValue</span><h2>Current chart</h2></div></div>
        <div class="pvcg-current">
          <div class="pvcg-metric">Detecting…</div>
          <div class="pvcg-status" data-state="working">
            <span class="pvcg-status-dot"></span>
            <span class="pvcg-status-text">Looking for Market Trends chart</span>
          </div>
          <div class="pvcg-preview-shell">
            <canvas class="pvcg-preview" aria-label="Detected chart preview" hidden></canvas>
            <div class="pvcg-preview-empty">The detected Market Trends chart will appear here.</div>
          </div>
          <div class="pvcg-actions">
            <button class="pvcg-btn pvcg-btn-primary pvcg-copy" type="button" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"></path></svg><span>Copy chart</span></button>
            <button class="pvcg-btn pvcg-btn-secondary pvcg-download" type="button" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"></path><path d="m8 11 4 4 4-4"></path><path d="M5 19h14"></path></svg><span>Download PNG</span></button>
          </div>
        </div>

      </div>
      <div class="pvcg-toast" role="status" aria-live="polite"></div>
    `;

    document.documentElement.appendChild(root);

    root.querySelector(".pvcg-collapse").addEventListener("click", () => setCollapsed(!root.classList.contains("pvcg-collapsed")));
    root.querySelector(".pvcg-copy").addEventListener("click", copyCurrentChart);
    root.querySelector(".pvcg-download").addEventListener("click", downloadCurrentChart);

    for (const button of root.querySelectorAll(".pvcg-copy,.pvcg-download")) {
      button.addEventListener("mouseenter", () => currentTarget?.classList?.add(HIGHLIGHT_CLASS));
      button.addEventListener("mouseleave", () => currentTarget?.classList?.remove(HIGHLIGHT_CLASS));
    }

    chrome.storage.local.get(STORAGE_KEY).then((data) => {
      if (data?.[STORAGE_KEY]) root.classList.add("pvcg-collapsed");
    }).catch(() => {});

    return root;
  }

  function setCollapsed(collapsed) {
    if (!panel) return;
    panel.classList.toggle("pvcg-collapsed", collapsed);
    panel.querySelector(".pvcg-collapse")?.setAttribute("title", collapsed ? "Open panel" : "Collapse panel");
    chrome.storage.local.set({ [STORAGE_KEY]: collapsed }).catch(() => {});
  }

  function updateLocation() {
    if (!panel) return;
    const { suburb, postcode, state } = getLocationInfo();
    const propertyType = getPropertyType();
    panel.querySelector(".pvcg-subtitle").textContent = [suburb, state, postcode, propertyType].filter(Boolean).join(" · ") || "PropertyValue / Market Trends";
  }

  function setStatus(state, text) {
    if (!panel) return;
    const status = panel.querySelector(".pvcg-status");
    status.dataset.state = state;
    panel.querySelector(".pvcg-status-text").textContent = text;
  }

  function setButtonsEnabled(enabled) {
    panel?.querySelector(".pvcg-copy")?.toggleAttribute("disabled", !enabled);
    panel?.querySelector(".pvcg-download")?.toggleAttribute("disabled", !enabled);
  }

  function targetSignature(target, metric) {
    if (!target) return "none";
    const r = target.getBoundingClientRect();
    // Keep the signature deliberately stable. Highcharts can add/remove tooltip or
    // hover nodes inside the SVG as the pointer moves, so child counts/attributes
    // must not decide whether the cached PNG is still valid. A metric change already
    // changes metric.label and triggers an explicit refresh.
    return [
      metric?.label || "",
      String(target.localName || target.tagName || "chart").toLowerCase(),
      Math.round(r.width),
      Math.round(r.height)
    ].join("|");
  }

  async function detectAndUpdate() {
    if (!panel) return;
    updateLocation();

    const target = findChartTarget();
    const metric = inferMetricFromChart(target) || { label: "Market Trends", slug: "Market_Trends" };
    currentTarget?.classList?.remove(HIGHLIGHT_CLASS);
    currentTarget = target;
    currentMetric = metric;

    panel.querySelector(".pvcg-metric").textContent = metric.label;

    if (!target) {
      setButtonsEnabled(false);
      setStatus("warning", findMarketHeading() ? "Chart not detected yet" : "Scroll to or load Market Trends");
      clearPreview();
      return;
    }

    setButtonsEnabled(false);
    const tr = target.getBoundingClientRect();
    const nodeLabel = tagIs(target, "svg") ? "SVG" : String(target.localName || target.tagName || "chart").toUpperCase();
    setStatus("working", `Preparing ${nodeLabel} chart preview`);

    const sig = targetSignature(target, metric);
    if (sig !== lastTargetSignature) {
      lastTargetSignature = sig;
      schedulePreview();
    } else {
      // Dynamic charts often reuse the same element; refresh shortly after mutations.
      schedulePreview(550);
    }
  }

  function scheduleDetect(delay = 220) {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detectAndUpdate, delay);
  }

  function schedulePreview(delay = 180) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, delay);
  }

  function clearPreview() {
    if (!panel) return;
    const canvas = panel.querySelector(".pvcg-preview");
    const empty = panel.querySelector(".pvcg-preview-empty");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    currentPngBlob = null;
    currentPngSignature = "";
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
      canvas.hidden = true;
    }
    if (empty) empty.hidden = false;
  }

  async function refreshPreview() {
    if (!currentTarget || !panel) return clearPreview();
    try {
      const blob = await capturePreparedChart(currentTarget, { restoreScroll: true, quiet: true });
      // Cache the exact PNG used for the preview. Copy/Download reuse this blob instead
      // of taking a second screenshot. This keeps the clipboard write inside the
      // original button click and avoids losing user activation during recapture.
      currentPngBlob = blob;
      currentPngSignature = targetSignature(currentTarget, currentMetric);

      const bitmap = await createImageBitmap(blob);
      const canvas = panel.querySelector(".pvcg-preview");
      const empty = panel.querySelector(".pvcg-preview-empty");

      const maxW = 290;
      const maxH = 180;
      const ratio = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
      const cssW = Math.max(1, Math.round(bitmap.width * ratio));
      const cssH = Math.max(1, Math.round(bitmap.height * ratio));
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.drawImage(bitmap, 0, 0, cssW, cssH);
      bitmap.close?.();

      canvas.hidden = false;
      empty.hidden = true;
      setStatus("ready", "Market Trends chart ready");
      setButtonsEnabled(true);
    } catch (error) {
      console.error("[PropertyValue Chart Grabber] Screenshot preview failed:", error);
      clearPreview();
      setButtonsEnabled(true);
      setStatus("warning", `Chart detected, but preview failed: ${error?.message || error}`);
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/png", 1);
      } catch (error) {
        reject(error);
      }
    });
  }

  function copySvgComputedStyles(original, clone) {
    const originalNodes = [original, ...original.querySelectorAll("*")];
    const cloneNodes = [clone, ...clone.querySelectorAll("*")];
    const props = [
      "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "opacity",
      "font-family", "font-size", "font-style", "font-weight", "letter-spacing",
      "text-anchor", "dominant-baseline", "visibility", "display"
    ];

    for (let i = 0; i < Math.min(originalNodes.length, cloneNodes.length); i += 1) {
      const computed = getComputedStyle(originalNodes[i]);
      const style = cloneNodes[i].style;
      for (const prop of props) {
        const value = computed.getPropertyValue(prop);
        if (value) style.setProperty(prop, value);
      }
    }
  }

  async function svgToPngBlob(svg, scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))) {
    const rect = svg.getBoundingClientRect();
    const width = Number(svg.getAttribute("width")) || rect.width;
    const height = Number(svg.getAttribute("height")) || rect.height;
    if (!width || !height) throw new Error("Market Trends SVG has no size");

    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Highcharts 4.x already stores most visual styling inline. Copy the handful of
    // computed properties that may come from page CSS so the isolated SVG stays faithful.
    copySvgComputedStyles(svg, clone);
    clone.querySelectorAll('.highcharts-tooltip, .highcharts-crosshair, .highcharts-halo, .highcharts-contextmenu').forEach((node) => node.remove());

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", "#ffffff");
    const defs = clone.querySelector("defs");
    if (defs?.nextSibling) clone.insertBefore(bg, defs.nextSibling);
    else if (defs) clone.appendChild(bg);
    else clone.insertBefore(bg, clone.firstChild);

    const svgText = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });

    // createImageBitmap avoids PropertyValue's page CSP blocking blob/data URLs in an <img>.
    let bitmap;
    try {
      bitmap = await createImageBitmap(svgBlob);
    } catch (error) {
      throw new Error(`Browser could not decode the Highcharts SVG (${error?.message || "decode error"})`);
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await canvasToBlob(canvas);
    } finally {
      bitmap.close?.();
    }
  }

  async function directCanvasToBlob(canvas, scale = 1) {
    const rect = canvas.getBoundingClientRect();
    const out = document.createElement("canvas");
    const width = canvas.width || Math.round(rect.width);
    const height = canvas.height || Math.round(rect.height);
    out.width = Math.max(1, Math.round(width * scale));
    out.height = Math.max(1, Math.round(height * scale));
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return canvasToBlob(out);
  }


  function copyAllComputedStyles(original, clone) {
    if (!(original instanceof Element) || !(clone instanceof Element)) return;
    const computed = getComputedStyle(original);
    for (let i = 0; i < computed.length; i += 1) {
      const prop = computed[i];
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      try {
        clone.style.setProperty(prop, value, computed.getPropertyPriority(prop));
      } catch (_) {}
    }
  }

  function inlineClone(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toLowerCase();
    if (["script", "noscript", "style", "link", "template"].includes(tag)) return null;

    if (tag === "canvas") {
      const img = document.createElement("img");
      try {
        img.src = node.toDataURL("image/png");
      } catch (error) {
        console.debug("[PropertyValue Chart Grabber] Canvas layer could not be serialized:", error);
        return document.createElement("span");
      }
      copyAllComputedStyles(node, img);
      const rect = node.getBoundingClientRect();
      img.style.width = `${rect.width}px`;
      img.style.height = `${rect.height}px`;
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
      return img;
    }

    const clone = node.cloneNode(false);
    copyAllComputedStyles(node, clone);

    // Form controls do not serialize their live value through cloneNode reliably.
    if (tag === "input" || tag === "textarea") {
      try { clone.setAttribute("value", node.value || ""); } catch (_) {}
    }
    if (tag === "select") {
      try { clone.value = node.value; } catch (_) {}
    }

    for (const child of node.childNodes) {
      const childClone = inlineClone(child);
      if (childClone) clone.appendChild(childClone);
    }
    return clone;
  }

  async function elementToPngBlob(target, scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))) {
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("Chart wrapper has no size");

    const clone = inlineClone(target);
    if (!(clone instanceof Element)) throw new Error("Could not clone chart wrapper");

    // The target may be positioned relative to the whole page. Reset only the root position
    // so the isolated clone starts at 0,0 while keeping all child layout intact.
    clone.style.setProperty("position", "relative", "important");
    clone.style.setProperty("left", "0", "important");
    clone.style.setProperty("right", "auto", "important");
    clone.style.setProperty("top", "0", "important");
    clone.style.setProperty("bottom", "auto", "important");
    clone.style.setProperty("transform", "none", "important");
    clone.style.setProperty("margin", "0", "important");
    clone.style.setProperty("width", `${rect.width}px`, "important");
    clone.style.setProperty("height", `${rect.height}px`, "important");
    clone.style.setProperty("max-width", "none", "important");
    clone.style.setProperty("max-height", "none", "important");

    // XHTML foreignObject lets us rasterize layered canvas + HTML axes/legend as one image.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.style.cssText = `position:relative;width:${rect.width}px;height:${rect.height}px;margin:0;padding:0;background:#fff;overflow:hidden;`;
    wrapper.appendChild(clone);

    const xhtml = new XMLSerializer().serializeToString(wrapper);
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}" viewBox="0 0 ${rect.width} ${rect.height}"><rect width="100%" height="100%" fill="#fff"/><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Layered chart render failed"));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await canvasToBlob(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function chooseInnerGraphic(target) {
    if (!target) return null;
    if (tagIs(target, "svg") || tagIs(target, "canvas")) return target;

    const graphics = [...target.querySelectorAll("svg,canvas")].filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= MIN_CHART_WIDTH && r.height >= MIN_CHART_HEIGHT;
    });

    if (graphics.length === 1) return graphics[0];
    if (graphics.length > 1) {
      // A single SVG generally contains the complete chart. Multiple canvases are usually layers,
      // so let the screenshot fallback capture the whole wrapper instead.
      const svgs = graphics.filter((el) => tagIs(el, "svg"));
      if (svgs.length === 1) return svgs[0];
    }
    return null;
  }

  async function captureDirect(target, previewScale = null) {
    const scale = previewScale ?? Math.min(2, Math.max(1, window.devicePixelRatio || 1));

    // IMPORTANT: SVGElement.tagName is lowercase in Chromium ("svg").
    // v1.2 compared it with "SVG", so the exact Market Trends SVG was found
    // but then skipped by the renderer. Use normalized tag checks everywhere.
    if (tagIs(target, "svg")) {
      return await svgToPngBlob(target, scale);
    }
    if (tagIs(target, "canvas")) {
      return await directCanvasToBlob(target, 1);
    }

    // If the target is a wrapper, stay strictly inside #containerMarketTrends.
    const exactSvg = target?.matches?.("svg.highcharts-root")
      ? target
      : target?.querySelector?.("svg.highcharts-root, .highcharts-container > svg, svg");
    if (exactSvg && tagIs(exactSvg, "svg")) {
      return await svgToPngBlob(exactSvg, scale);
    }

    const graphic = chooseInnerGraphic(target);
    if (tagIs(graphic, "svg")) return await svgToPngBlob(graphic, scale);
    if (tagIs(graphic, "canvas")) return await directCanvasToBlob(graphic, 1);
    return null;
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("Could not decode PNG data");
    return await response.blob();
  }

  async function screenshotCrop(target, options = {}) {
    const oldScrollX = window.scrollX;
    const oldScrollY = window.scrollY;
    const oldVisibility = panel.style.visibility;
    const restoreScroll = options.restoreScroll !== false;

    try {
      const before = target.getBoundingClientRect();
      const fullyVisible = before.top >= 0 && before.left >= 0 && before.bottom <= window.innerHeight && before.right <= window.innerWidth;

      // Automatic preview should never yank the user's scroll position around.
      // Explicit Copy/Download may center the chart temporarily and restore the old position.
      if (options.quiet && !fullyVisible) {
        throw new Error("Scroll to Market Trends to show the preview");
      }
      if (!fullyVisible) {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        await sleep(180);
      } else {
        await sleep(options.quiet ? 40 : 80);
      }

      panel.style.visibility = "hidden";
      target.classList.remove(HIGHLIGHT_CLASS);
      await sleep(80);

      const rect = target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (
        rect.width <= 0 || rect.height <= 0 ||
        rect.bottom <= 0 || rect.top >= viewportHeight ||
        rect.right <= 0 || rect.left >= viewportWidth
      ) {
        throw new Error("Market Trends chart is not visible in the viewport");
      }

      const response = await chrome.runtime.sendMessage({
        type: "PVCG_CAPTURE_AND_CROP",
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        viewportWidth,
        viewportHeight
      });

      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error || "Browser screenshot capture failed");
      }

      return await dataUrlToBlob(response.dataUrl);
    } finally {
      panel.style.visibility = oldVisibility;
      if (restoreScroll) window.scrollTo(oldScrollX, oldScrollY);
    }
  }

  async function capturePreparedChart(target, options = {}) {
    try {
      const direct = await captureDirect(target, options.previewScale ?? null);
      if (direct) return direct;
    } catch (error) {
      console.debug('[PropertyValue Chart Grabber] Direct chart render failed; using screenshot fallback:', error);
    }
    return screenshotCrop(target, options);
  }

  async function captureCurrentChart() {
    if (!currentTarget) throw new Error("No Market Trends chart detected");
    return await capturePreparedChart(currentTarget, { restoreScroll: true });
  }

  function makeFilename() {
    const { suburb, postcode, state } = getLocationInfo();
    const safeSuburb = suburb.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
    const metric = currentMetric?.slug || "Market_Trends";
    return ["PropertyValue", safeSuburb, state, postcode, metric]
      .filter(Boolean)
      .join("_") + ".png";
  }


  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Could not encode PNG"));
      reader.readAsDataURL(blob);
    });
  }

  async function writePngToClipboard(blob) {
    if (!blob) throw new Error("PNG is not ready yet");

    // Fast path: because the PNG is already cached, this write happens directly
    // from the user's click and normally succeeds in Chrome/Brave.
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return;
      }
    } catch (error) {
      console.warn("[PropertyValue Chart Grabber] Direct clipboard write failed; trying extension fallback:", error);
    }

    // Fallback: let the extension's offscreen document perform the clipboard write.
    const dataUrl = await blobToDataUrl(blob);
    const response = await chrome.runtime.sendMessage({
      type: "PVCG_COPY_PNG",
      dataUrl
    });
    if (!response?.ok) throw new Error(response?.error || "Clipboard write failed");
  }

  async function copyCurrentChart() {
    if (!currentTarget) return;
    const button = panel.querySelector(".pvcg-copy");
    const label = button.querySelector("span");
    const oldLabel = label.textContent;
    button.disabled = true;
    label.textContent = "Copying…";
    setStatus("working", currentPngBlob ? "Copying prepared PNG" : "Capturing current chart");

    try {
      const sig = targetSignature(currentTarget, currentMetric);
      const blob = (currentPngBlob && currentPngSignature === sig)
        ? currentPngBlob
        : await captureCurrentChart();
      await writePngToClipboard(blob);
      // Keep the freshly captured blob too, so subsequent copies are instant.
      currentPngBlob = blob;
      currentPngSignature = sig;
      label.textContent = "Copied";
      setStatus("ready", "PNG copied to clipboard");
      showToast("Chart copied as PNG");
      setTimeout(() => { label.textContent = oldLabel; button.disabled = false; }, 1000);
    } catch (error) {
      console.error("[PropertyValue Chart Grabber]", error);
      setStatus("warning", error.message || "Copy failed");
      showToast("Could not copy chart");
      label.textContent = oldLabel;
      button.disabled = false;
    }
  }

  async function downloadCurrentChart() {
    if (!currentTarget) return;
    const button = panel.querySelector(".pvcg-download");
    const label = button.querySelector("span");
    const oldLabel = label.textContent;
    button.disabled = true;
    label.textContent = "Preparing…";
    setStatus("working", "Capturing current chart");

    try {
      const sig = targetSignature(currentTarget, currentMetric);
      const blob = (currentPngBlob && currentPngSignature === sig)
        ? currentPngBlob
        : await captureCurrentChart();
      currentPngBlob = blob;
      currentPngSignature = sig;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = makeFilename();
      a.style.display = "none";
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      label.textContent = "Downloaded";
      setStatus("ready", "PNG downloaded");
      showToast("Chart downloaded as PNG");
      setTimeout(() => { label.textContent = oldLabel; button.disabled = false; }, 1000);
    } catch (error) {
      console.error("[PropertyValue Chart Grabber]", error);
      setStatus("warning", error.message || "Download failed");
      showToast("Could not download chart");
      label.textContent = oldLabel;
      button.disabled = false;
    }
  }

  function showToast(message) {
    if (!panel) return;
    const toast = panel.querySelector(".pvcg-toast");
    toast.textContent = message;
    toast.classList.add("pvcg-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("pvcg-show"), 1500);
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'));
  }

  function hasUserTextSelection() {
    try {
      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
    } catch (_) {
      return false;
    }
  }

  async function copyPreparedChartFromShortcut() {
    if (!currentTarget || !currentPngBlob) return;
    const sig = targetSignature(currentTarget, currentMetric);
    if (currentPngSignature !== sig) return;

    try {
      setStatus("working", "Copying prepared PNG");
      await writePngToClipboard(currentPngBlob);
      setStatus("ready", "PNG copied to clipboard");
      showToast("Chart copied as PNG · Ctrl+C");
    } catch (error) {
      console.error("[PropertyValue Chart Grabber] Ctrl+C copy failed:", error);
      setStatus("warning", error?.message || "Copy failed");
      showToast("Could not copy chart");
    }
  }

  function installKeyboardShortcut() {
    document.addEventListener("keydown", (event) => {
      const isCopyShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === "c";
      if (!isCopyShortcut || event.repeat) return;

      // Never hijack normal browser copy while the user is typing/editing or has
      // selected text on the page. In those cases Ctrl+C behaves normally.
      if (isEditableTarget(event.target) || hasUserTextSelection()) return;

      const sig = currentTarget ? targetSignature(currentTarget, currentMetric) : "";
      const chartReady = Boolean(currentTarget && currentPngBlob && currentPngSignature === sig);
      if (!chartReady) return;

      event.preventDefault();
      event.stopPropagation();
      copyPreparedChartFromShortcut();
    }, true);
  }

  function observeMarketTrends() {
    // Do not observe SVG attributes, tooltip nodes, text, or the entire document.
    // Highcharts mutates those continuously on mouse hover, which used to make the
    // extension regenerate the screenshot whenever the cursor moved.
    const bind = () => {
      const container = document.querySelector("#containerMarketTrends");
      if (!container || container.dataset.pvcgObserved === "1") return Boolean(container);
      container.dataset.pvcgObserved = "1";

      const observer = new MutationObserver((records) => {
        // Only care if PropertyValue replaces the direct Highcharts container.
        const replaced = records.some((record) => {
          if (record.type !== "childList") return false;
          const nodes = [...record.addedNodes, ...record.removedNodes];
          return nodes.some((node) => node instanceof Element && (
            node.matches?.(".highcharts-container") ||
            node.querySelector?.(".highcharts-container")
          ));
        });
        if (replaced) {
          scheduleDetect(220);
          scheduleDetect(650);
        }
      });
      observer.observe(container, { childList: true, subtree: false });
      return true;
    };

    bind();
    // The Market Trends section may be inserted after page load. Poll briefly until
    // its stable container exists, without watching every DOM mutation.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (bind() || attempts >= 20) clearInterval(timer);
    }, 500);

    document.addEventListener("click", (event) => {
      if (panel?.contains(event.target)) return;

      const metricControl = event.target instanceof Element
        ? event.target.closest("#market-trends-metric-box-values, .market-trends-nav, .market-trends-nav-xs, [id^='metric-box-']")
        : null;
      if (!metricControl) return;

      // PropertyValue redraws Highcharts asynchronously. Capture once after the
      // metric click has settled, and once more as a conservative late redraw check.
      clearPreview();
      setButtonsEnabled(false);
      setStatus("working", "Metric changed — waiting for chart redraw");
      scheduleDetect(350);
      setTimeout(() => scheduleDetect(120), 850);
    }, true);

    window.addEventListener("scroll", () => {
      clearTimeout(scrollRefreshTimer);
      scrollRefreshTimer = setTimeout(() => {
        if (!currentPngBlob && currentTarget) schedulePreview(40);
      }, 220);
    }, { passive: true });
    window.addEventListener("resize", () => {
      clearPreview();
      scheduleDetect(180);
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PVCG_TOGGLE_PANEL") {
      setCollapsed(!panel.classList.contains("pvcg-collapsed"));
      scheduleDetect(80);
    }
  });

  function init() {
    panel = createPanel();
    updateLocation();
    observeMarketTrends();
    installKeyboardShortcut();
    scheduleDetect(100);
    setTimeout(() => scheduleDetect(100), 1000);
    setTimeout(() => scheduleDetect(100), 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
