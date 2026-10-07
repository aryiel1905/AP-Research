(() => {
  if (window.__APR_SQM_CHART_LOADED__) return;
  window.__APR_SQM_CHART_LOADED__ = true;

  const MIN_WIDTH = 360;
  const MIN_HEIGHT = 160;
  const PANEL_ID = 'apr-sqm-panel';
  const STORAGE_KEY = 'aprSqmPanelCollapsed';

  let panel = null;
  let panelRefreshTimer = null;
  let previewTimer = null;
  let previewGeneration = 0;
  let currentTarget = null;
  let currentMeta = null;
  let currentPngBlob = null;
  let currentPngSignature = '';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function tagIs(el, name) {
    return String(el?.localName || el?.tagName || '').toLowerCase() === String(name || '').toLowerCase();
  }

  function visibleRect(el) {
    if (!el || !(el instanceof Element)) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;

    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return null;
    return rect;
  }

  function normalizeCandidate(el) {
    if (!el) return null;

    const preferred = el.closest?.(
      '.highcharts-container, .plotly-graph-div, .js-plotly-plot, .apexcharts-canvas, [data-highcharts-chart]'
    );
    if (preferred) return preferred;

    if (tagIs(el, 'svg') || tagIs(el, 'canvas')) {
      let parent = el.parentElement;
      for (let i = 0; i < 3 && parent; i += 1, parent = parent.parentElement) {
        const token = `${parent.id || ''} ${parent.className || ''}`.toLowerCase();
        const r = parent.getBoundingClientRect();
        if ((token.includes('chart') || token.includes('graph')) && r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT) {
          return parent;
        }
      }
    }

    return el;
  }

  function nearbyText(el) {
    let text = '';
    let node = el;
    for (let i = 0; i < 3 && node; i += 1, node = node.parentElement) {
      text += ` ${(node.innerText || '').slice(0, 1200)}`;
    }
    return text.toLowerCase();
  }

  function scoreCandidate(el) {
    const rect = visibleRect(el);
    if (!rect) return -Infinity;

    const tag = el.tagName.toLowerCase();
    const token = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    const text = nearbyText(el);

    let score = Math.min((rect.width * rect.height) / 1000, 1200);

    if (token.includes('highcharts')) score += 6000;
    if (token.includes('plotly')) score += 5500;
    if (token.includes('apexcharts')) score += 5200;
    if (token.includes('chart')) score += 2200;
    if (token.includes('graph')) score += 1800;
    if (el.hasAttribute('data-highcharts-chart')) score += 6500;
    if (tag === 'iframe') score += 1200;
    if (tag === 'svg') score += 800;
    if (tag === 'canvas') score += 900;

    if (text.includes('vacancy rates')) score += 1700;
    if (text.includes('sqm research')) score += 900;
    if (text.includes('vacancies')) score += 500;
    if (text.includes('vacancy rate')) score += 500;

    const svg = tag === 'svg' ? el : el.querySelector?.('svg');
    if (svg) {
      const texts = svg.querySelectorAll?.('text').length || 0;
      const shapes = svg.querySelectorAll?.('path,rect,line,polyline,circle').length || 0;
      score += Math.min(texts * 15, 600);
      score += Math.min(shapes * 5, 700);
    }

    if (el.querySelector?.('canvas')) score += 700;

    // Down-rank giant layout sections and decorative backgrounds.
    if (rect.height > window.innerHeight * 1.5) score -= 2200;
    if (rect.width > window.innerWidth * 1.15) score -= 900;

    return score;
  }

  function findBestChart() {
    const selectors = [
      '.highcharts-container',
      '[data-highcharts-chart]',
      '.plotly-graph-div',
      '.js-plotly-plot',
      '.apexcharts-canvas',
      '[class*="chart" i]',
      '[id*="chart" i]',
      'iframe',
      'svg',
      'canvas'
    ];

    const seen = new Set();
    const candidates = [];

    for (const selector of selectors) {
      let matches = [];
      try {
        matches = document.querySelectorAll(selector);
      } catch (_) {
        continue;
      }

      for (const match of matches) {
        const candidate = normalizeCandidate(match);
        if (!candidate || seen.has(candidate)) continue;
        if (candidate.closest?.(`#${PANEL_ID}`)) continue;
        seen.add(candidate);

        const rect = visibleRect(candidate);
        if (!rect) continue;
        candidates.push({ el: candidate, score: scoreCandidate(candidate) });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.length && Number.isFinite(candidates[0].score) ? candidates[0].el : null;
  }

  function pageMeta() {
    const url = new URL(location.href);
    const postcode = url.searchParams.get('postcode') || '';
    const pathPart = url.pathname.split('/').filter(Boolean).pop() || 'chart';

    const pathLabel = pathPart
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    const heading = [...document.querySelectorAll('h1, h2')]
      .filter((node) => !node.closest(`#${PANEL_ID}`))
      .map((node) => (node.textContent || '').trim())
      .find((text) => text && text.length <= 80 && !/^postcode\s*:/i.test(text));

    return {
      postcode,
      label: heading || pathLabel || 'SQM Chart',
      url: location.href
    };
  }

  async function latestVacancyRate() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'APH_SQM_READ_RATE' });
      if (!response?.ok || !response.vacancyRate) return null;
      return {
        vacancyRate: response.vacancyRate,
        vacancyRateValue: response.vacancyRateValue,
        vacancyPeriod: response.vacancyPeriod || ''
      };
    } catch (_) {
      return null;
    }
  }

  function captureInfo(target) {
    const rect = target.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    };
  }

  async function getStatus() {
    const target = findBestChart();
    const vacancy = await latestVacancyRate();
    const meta = {
      ...pageMeta(),
      vacancyRate: vacancy?.vacancyRate || '',
      vacancyRateValue: vacancy?.vacancyRateValue ?? null,
      vacancyPeriod: vacancy?.vacancyPeriod || ''
    };

    currentTarget = target;
    currentMeta = meta;
    if (!target) {
      return {
        ok: false,
        reason: 'No chart detected. Wait for the chart to finish loading, then try again.',
        ...meta
      };
    }

    const rect = target.getBoundingClientRect();
    return {
      ok: true,
      ...meta,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  async function prepareCapture() {
    const target = findBestChart();
    const meta = pageMeta();
    if (!target) {
      return { ok: false, reason: 'No chart detected.', ...meta };
    }

    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    await sleep(180);

    let info = captureInfo(target);

    // A second adjustment helps when sticky headers or late layout shifts are present.
    if (info.height <= info.viewportHeight - 20) {
      if (info.top < 10) window.scrollBy(0, info.top - 10);
      if (info.top + info.height > info.viewportHeight - 10) {
        window.scrollBy(0, info.top + info.height - info.viewportHeight + 10);
      }
      await sleep(90);
      info = captureInfo(target);
    }

    if (info.width > info.viewportWidth + 2 || info.height > info.viewportHeight + 2) {
      return {
        ok: false,
        reason: 'The chart is larger than the visible browser area. Zoom the page out once and try again.',
        ...meta
      };
    }

    const fullyVisible =
      info.left >= -1 &&
      info.top >= -1 &&
      info.left + info.width <= info.viewportWidth + 1 &&
      info.top + info.height <= info.viewportHeight + 1;

    if (!fullyVisible) {
      return {
        ok: false,
        reason: 'Could not fit the entire chart on screen. Zoom the page out slightly and try again.',
        ...meta
      };
    }

    return { ok: true, ...meta, ...info };
  }

  function targetSignature(target, meta = currentMeta) {
    if (!target) return 'none';
    const rect = target.getBoundingClientRect();
    return [
      meta?.label || '',
      meta?.postcode || '',
      String(target.localName || target.tagName || 'chart').toLowerCase(),
      Math.round(rect.width),
      Math.round(rect.height),
      chartFingerprint(target)
    ].join('|');
  }

  function chartFingerprint(target) {
    const svg = tagIs(target, 'svg') ? target : target.querySelector?.('svg.highcharts-root, svg');
    if (!svg) return `${target.querySelectorAll?.('canvas').length || 0}:${normalizeChartText(target.textContent).slice(0, 240)}`;
    const text = [...svg.querySelectorAll('text')]
      .filter((node) => !node.closest('.highcharts-tooltip'))
      .map((node) => normalizeChartText(node.textContent))
      .filter(Boolean)
      .join('|');
    const paths = [...svg.querySelectorAll('.highcharts-series path')]
      .slice(0, 8)
      .map((node) => String(node.getAttribute('d') || '').slice(0, 240))
      .join('|');
    const input = `${text}|${paths}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeChartText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('Could not decode captured chart');
    return response.blob();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not encode chart PNG'));
      reader.readAsDataURL(blob);
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas export failed')), 'image/png', 1);
    });
  }

  function copySvgComputedStyles(original, clone) {
    const originalNodes = [original, ...original.querySelectorAll('*')];
    const cloneNodes = [clone, ...clone.querySelectorAll('*')];
    const properties = [
      'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity',
      'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing',
      'text-anchor', 'dominant-baseline', 'visibility', 'display'
    ];
    for (let index = 0; index < Math.min(originalNodes.length, cloneNodes.length); index += 1) {
      const computed = getComputedStyle(originalNodes[index]);
      for (const property of properties) {
        const value = computed.getPropertyValue(property);
        if (value) cloneNodes[index].style.setProperty(property, value);
      }
    }
  }

  async function svgToPngBlob(svg, scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))) {
    const rect = svg.getBoundingClientRect();
    const width = Number(svg.getAttribute('width')) || rect.width;
    const height = Number(svg.getAttribute('height')) || rect.height;
    if (!width || !height) throw new Error('SQM chart SVG has no size');

    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    copySvgComputedStyles(svg, clone);
    clone.querySelectorAll('.highcharts-tooltip, .highcharts-crosshair, .highcharts-halo, .highcharts-contextmenu').forEach((node) => node.remove());

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', '#ffffff');
    const defs = clone.querySelector('defs');
    if (defs?.nextSibling) clone.insertBefore(background, defs.nextSibling);
    else if (defs) clone.appendChild(background);
    else clone.insertBefore(background, clone.firstChild);

    const source = new XMLSerializer().serializeToString(clone);
    const bitmap = await createImageBitmap(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await canvasToBlob(canvas);
    } finally {
      bitmap.close?.();
    }
  }

  async function directCanvasToBlob(source) {
    const rect = source.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = source.width || Math.max(1, Math.round(rect.width));
    canvas.height = source.height || Math.max(1, Math.round(rect.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas);
  }

  async function captureDirect(target) {
    const svg = tagIs(target, 'svg') ? target : target.querySelector?.('svg.highcharts-root, svg');
    if (svg) return svgToPngBlob(svg);
    const canvases = tagIs(target, 'canvas') ? [target] : [...(target.querySelectorAll?.('canvas') || [])];
    if (canvases.length === 1) return directCanvasToBlob(canvases[0]);
    return null;
  }

  async function waitForChartToSettle(target) {
    let previous = '';
    let stablePasses = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sleep(80);
      const rect = target.getBoundingClientRect();
      const signature = `${Math.round(rect.width)}x${Math.round(rect.height)}:${chartFingerprint(target)}`;
      stablePasses = signature === previous ? stablePasses + 1 : 0;
      previous = signature;
      if (stablePasses >= 2) return;
    }
  }

  async function captureChartBlob(target, options = {}) {
    const oldScrollX = window.scrollX;
    const oldScrollY = window.scrollY;
    const quiet = options.quiet === true;

    try {
      await waitForChartToSettle(target);
      try {
        const direct = await captureDirect(target);
        if (direct) return direct;
      } catch (error) {
        console.debug('[AP Research / SQM] Direct chart render failed; using screenshot fallback:', error);
      }

      const before = target.getBoundingClientRect();
      const fullyVisible =
        before.top >= 0 &&
        before.left >= 0 &&
        before.bottom <= window.innerHeight &&
        before.right <= window.innerWidth;

      if (quiet && !fullyVisible) {
        throw new Error('Scroll until the full SQM chart is visible to load its preview');
      }

      if (!fullyVisible) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        await sleep(180);
      } else {
        await sleep(40);
      }

      panel?.classList.add('sqm-capturing');
      await sleep(80);

      const rect = target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      if (
        rect.width <= 0 || rect.height <= 0 ||
        rect.top < -1 || rect.left < -1 ||
        rect.bottom > viewportHeight + 1 || rect.right > viewportWidth + 1
      ) {
        throw new Error('Could not fit the full SQM chart on screen. Zoom out slightly and try again');
      }

      const response = await chrome.runtime.sendMessage({
        type: 'PVCG_CAPTURE_AND_CROP',
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        viewportWidth,
        viewportHeight
      });
      if (!response?.ok || !response.dataUrl) {
        throw new Error(response?.error || 'Browser screenshot capture failed');
      }
      return dataUrlToBlob(response.dataUrl);
    } finally {
      panel?.classList.remove('sqm-capturing');
      if (options.restoreScroll !== false) window.scrollTo(oldScrollX, oldScrollY);
    }
  }

  async function writePngToClipboard(blob) {
    if (!blob) throw new Error('Chart preview is not ready yet');

    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return;
      }
    } catch (error) {
      console.warn('[AP Research / SQM] Direct clipboard write failed; trying extension fallback:', error);
    }

    const response = await chrome.runtime.sendMessage({
      type: 'PVCG_COPY_PNG',
      dataUrl: await blobToDataUrl(blob)
    });
    if (!response?.ok) throw new Error(response?.error || 'Clipboard write failed');
  }

  function makeFilename(meta = currentMeta) {
    const safe = (value, fallback) => String(value || fallback)
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || fallback;
    return `SQM_${safe(meta?.label, 'Chart')}_${safe(meta?.postcode, 'Unknown')}.png`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function copyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"></path></svg>';
  }

  function downloadIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"></path><path d="m8 11 4 4 4-4"></path><path d="M5 19h14"></path></svg>';
  }

  function setButtonsEnabled(enabled) {
    panel?.querySelectorAll('.sqm-action').forEach((button) => { button.disabled = !enabled; });
  }

  function setPanelStatus(status) {
    if (!panel) return;
    const state = status?.state || (status?.ok ? 'working' : 'warning');
    panel.querySelector('.sqm-status').dataset.state = state;
    panel.querySelector('.sqm-status-text').textContent = status?.text || (status?.ok ? 'Chart detected — preparing preview' : (status?.reason || 'Waiting for chart'));
    panel.querySelector('.sqm-chart-name').textContent = status?.label || 'SQM market chart';
    panel.querySelector('.sqm-header-copy span').textContent = status?.postcode
      ? `SQM Research · Postcode ${status.postcode}`
      : 'SQM Research / Chart capture';
  }

  function clearPreview(message = 'The detected SQM chart will appear here.') {
    if (!panel) return;
    previewGeneration += 1;
    currentPngBlob = null;
    currentPngSignature = '';
    const canvas = panel.querySelector('.sqm-chart-preview');
    const empty = panel.querySelector('.sqm-preview-empty');
    if (canvas) {
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
      canvas.hidden = true;
    }
    if (empty) {
      empty.textContent = message;
      empty.hidden = false;
    }
    setButtonsEnabled(false);
  }

  function schedulePreview(delay = 160) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, delay);
  }

  async function refreshPreview() {
    if (!panel || !currentTarget || !currentMeta) return clearPreview();
    const target = currentTarget;
    const meta = currentMeta;
    const signature = targetSignature(target, meta);
    const generation = ++previewGeneration;

    try {
      const blob = await captureChartBlob(target, { quiet: true, restoreScroll: true });
      if (generation !== previewGeneration || target !== currentTarget) return;

      const bitmap = await createImageBitmap(blob);
      const shell = panel.querySelector('.sqm-chart-visual');
      const canvas = panel.querySelector('.sqm-chart-preview');
      const empty = panel.querySelector('.sqm-preview-empty');
      const maxWidth = Math.max(1, shell.clientWidth - 18);
      const maxHeight = Math.max(1, shell.clientHeight - 18);
      const ratio = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height, 1);
      const cssWidth = Math.max(1, Math.round(bitmap.width * ratio));
      const cssHeight = Math.max(1, Math.round(bitmap.height * ratio));
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const context = canvas.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, cssWidth, cssHeight);
      context.drawImage(bitmap, 0, 0, cssWidth, cssHeight);
      bitmap.close?.();

      currentPngBlob = blob;
      currentPngSignature = signature;
      canvas.hidden = false;
      empty.hidden = true;
      setPanelStatus({ ...meta, ok: true, state: 'ready', text: 'Chart preview ready', width: Math.round(target.getBoundingClientRect().width), height: Math.round(target.getBoundingClientRect().height) });
      setButtonsEnabled(true);
    } catch (error) {
      if (generation !== previewGeneration) return;
      console.error('[AP Research / SQM] Preview failed:', error);
      clearPreview(error?.message || 'Could not prepare chart preview');
      setPanelStatus({ ...meta, ok: true, state: 'warning', text: error?.message || 'Chart detected, but preview failed', width: Math.round(target.getBoundingClientRect().width), height: Math.round(target.getBoundingClientRect().height) });
    }
  }

  function showToast(text, kind = '') {
    if (!panel) return;
    const toast = panel.querySelector('.sqm-toast');
    toast.textContent = text;
    toast.dataset.kind = kind;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1700);
  }

  function setCollapsed(collapsed) {
    if (!panel) return;
    panel.classList.toggle('sqm-collapsed', collapsed);
    const button = panel.querySelector('.sqm-collapse');
    button.setAttribute('aria-label', collapsed ? 'Expand SQM panel' : 'Collapse SQM panel');
    button.setAttribute('title', collapsed ? 'Expand' : 'Collapse');
    try { sessionStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }

  async function runPanelAction(mode, button) {
    const buttons = [...panel.querySelectorAll('.sqm-action')];
    buttons.forEach(item => { item.disabled = true; });
    const label = button.querySelector('span');
    const original = label.textContent;
    label.textContent = mode === 'copy' ? 'Copying' : 'Downloading';

    try {
      const signature = targetSignature(currentTarget, currentMeta);
      if (!currentPngBlob || currentPngSignature !== signature) {
        throw new Error('Wait for the live chart preview to finish');
      }

      if (mode === 'copy') {
        await writePngToClipboard(currentPngBlob);
        showToast('Chart copied as PNG', 'success');
      } else if (mode === 'download') {
        const url = URL.createObjectURL(currentPngBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = makeFilename();
        anchor.style.display = 'none';
        document.documentElement.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        showToast(`Saved ${anchor.download}`, 'success');
      }
    } catch (error) {
      showToast(error?.message || 'Could not export the chart.', 'error');
    } finally {
      label.textContent = original;
      setButtonsEnabled(Boolean(currentPngBlob));
    }
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
    const meta = pageMeta();
    const collapsed = sessionStorage.getItem(STORAGE_KEY) === '1';
    const root = document.createElement('aside');
    root.id = PANEL_ID;
    root.classList.toggle('sqm-collapsed', collapsed);
    root.setAttribute('aria-label', 'SQM Research chart helper');
    root.innerHTML = `
      <div class="sqm-shell">
        <header class="sqm-header">
          <div class="sqm-logo">AP</div>
          <div class="sqm-header-copy"><strong>AP Research</strong><span>${escapeHtml(meta.postcode ? `SQM Research · Postcode ${meta.postcode}` : 'SQM Research / Chart capture')}</span></div>
          <button class="sqm-collapse" type="button" aria-label="${collapsed ? 'Expand' : 'Collapse'} SQM panel" title="${collapsed ? 'Expand' : 'Collapse'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
          </button>
          <div class="sqm-rail-label">SQM Research charts</div>
        </header>
        <div class="sqm-body">
          <div class="sqm-section-heading"><div><span class="sqm-source-label">SQM Research</span><h2>Current chart</h2></div></div>
          <section class="sqm-chart-card">
            <div class="sqm-chart-name">${escapeHtml(meta.label || 'SQM market chart')}</div>
            <div class="sqm-status" data-state="working"><i></i><span class="sqm-status-text">Looking for chart</span></div>
            <div class="sqm-chart-visual">
              <canvas class="sqm-chart-preview" aria-label="Detected SQM chart preview" hidden></canvas>
              <div class="sqm-preview-empty">The detected SQM chart will appear here.</div>
            </div>
            <div class="sqm-actions">
              <button class="sqm-action sqm-primary" data-mode="copy" type="button" disabled>${copyIcon()}<span>Copy chart</span></button>
              <button class="sqm-action sqm-secondary" data-mode="download" type="button" disabled>${downloadIcon()}<span>Download PNG</span></button>
            </div>
          </section>
        </div>
        <div class="sqm-toast" role="status" aria-live="polite"></div>
      </div>`;

    document.documentElement.appendChild(root);
    root.querySelector('.sqm-collapse').addEventListener('click', () => setCollapsed(!root.classList.contains('sqm-collapsed')));
    root.querySelectorAll('.sqm-action').forEach(button => {
      button.addEventListener('click', () => runPanelAction(button.dataset.mode, button));
    });
    return root;
  }

  async function refreshPanel() {
    if (!panel) return;
    try {
      const status = await getStatus();
      if (!status?.ok || !currentTarget) {
        clearPreview();
        setPanelStatus(status);
        return;
      }

      const signature = targetSignature(currentTarget, status);
      if (currentPngBlob && currentPngSignature === signature) {
        setPanelStatus({ ...status, state: 'ready', text: 'Chart preview ready' });
        setButtonsEnabled(true);
        return;
      }

      setButtonsEnabled(false);
      setPanelStatus({ ...status, state: 'working', text: 'Exact chart found — preparing preview' });
      schedulePreview();
    } catch (error) {
      clearPreview();
      setPanelStatus({ ok: false, reason: error?.message || 'Could not inspect page.' });
    }
  }

  function schedulePanelRefresh(delay = 240) {
    clearTimeout(panelRefreshTimer);
    panelRefreshTimer = setTimeout(refreshPanel, delay);
  }

  function initPanel() {
    panel = createPanel();
    schedulePanelRefresh(80);
    setTimeout(() => schedulePanelRefresh(0), 1000);
    setTimeout(() => schedulePanelRefresh(0), 2600);
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node !== panel))) {
        schedulePanelRefresh(420);
      }
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', () => schedulePanelRefresh(180), { passive: true });
    window.addEventListener('resize', () => schedulePanelRefresh(180));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'SQM_GET_STATUS') {
      getStatus().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, reason: error?.message || 'Could not inspect the page.' });
      });
      return true;
    }

    if (message.type === 'SQM_PREPARE_CAPTURE') {
      prepareCapture().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, reason: error?.message || 'Could not prepare the chart.' });
      });
      return true;
    }

    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel, { once: true });
  } else {
    initPanel();
  }
})();
