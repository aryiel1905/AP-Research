(() => {
  'use strict';

  if (window.__APR_ABS_PANEL_LOADED__) return;
  window.__APR_ABS_PANEL_LOADED__ = true;

  const PANEL_ID = 'apr-abs-panel';
  const STORAGE_KEY = 'aprAbsPanelCollapsed';
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8"></path></svg>';
  const SOURCE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>';

  let collapsed = false;
  let collapsedReady = false;
  let renderTimer = null;
  let lastSignature = '';

  function normalizeText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isQuickStatsPage() {
    return /(^|\.)abs\.gov\.au$/i.test(location.hostname) &&
      /^\/census\/find-census-data\/quickstats\/2021\/SAL\d{5}/i.test(location.pathname);
  }

  function parsePercentage(value) {
    const match = normalizeText(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }

  function percentageFromRow(row) {
    const cells = Array.from(row.cells || row.querySelectorAll('th,td'));
    if (cells.length >= 3) {
      const direct = parsePercentage(cells[2].textContent);
      if (direct !== null) return direct;
    }

    // ABS tables place the local count first and the local percentage second.
    const numericCells = cells.slice(1).map(cell => parsePercentage(cell.textContent));
    return numericCells.length >= 2 ? numericCells[1] : null;
  }

  function findFamilyValue(label) {
    const target = label.toLowerCase();
    const rows = Array.from(document.querySelectorAll('tr'));
    for (const row of rows) {
      const firstCell = row.cells?.[0] || row.querySelector('th,td');
      if (normalizeText(firstCell?.textContent).toLowerCase() !== target) continue;
      const value = percentageFromRow(row);
      if (value !== null) return value;
    }
    return null;
  }

  function findFamilySourceTarget() {
    const rows = Array.from(document.querySelectorAll('tr'));
    return rows.find(row => {
      const firstCell = row.cells?.[0] || row.querySelector('th,td');
      return normalizeText(firstCell?.textContent).toLowerCase() === 'couple family without children';
    }) || Array.from(document.querySelectorAll('h1,h2,h3,h4')).find(heading =>
      /^families$/i.test(normalizeText(heading.textContent))
    ) || null;
  }

  function getLocalityName() {
    const titleMatch = document.title.match(/2021\s+(.+?),\s*Census/i);
    if (titleMatch) return normalizeText(titleMatch[1]);
    const h1 = normalizeText(document.querySelector('h1')?.textContent);
    const headingMatch = h1.match(/(?:2021\s+)?(.+?)(?:,\s*Census|\s+QuickStats|$)/i);
    return normalizeText(headingMatch?.[1]) || 'ABS locality';
  }

  function getFamilyData() {
    const withoutChildren = findFamilyValue('Couple family without children');
    const withChildren = findFamilyValue('Couple family with children');
    const available = withoutChildren !== null && withChildren !== null;
    const nonCouple = available
      ? Math.round(Math.max(0, Math.min(100, 100 - withoutChildren - withChildren)) * 10) / 10
      : null;
    return {
      locality: getLocalityName(),
      salCode: location.pathname.match(/SAL(\d{5})/i)?.[1] || '',
      withoutChildren,
      withChildren,
      nonCouple,
      available
    };
  }

  function formatValue(value) {
    if (value === null || !Number.isFinite(value)) return '—';
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
  }

  async function copyText(text, button) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      document.body.append(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      textarea.remove();
    }

    if (!copied || !button) return;
    const original = button.innerHTML;
    button.innerHTML = `${CHECK_ICON}<span>Copied</span>`;
    button.classList.add('abs-copy-success');
    setTimeout(() => {
      if (!button.isConnected) return;
      button.innerHTML = original;
      button.classList.remove('abs-copy-success');
    }, 1000);
  }

  function statCard(label, value, kind = '') {
    const clean = formatValue(value);
    const display = value === null ? clean : `${clean}%`;
    const disabled = value === null ? ' disabled' : '';
    return `
      <article class="abs-stat-card ${kind}">
        <span class="abs-stat-label">${escapeHtml(label)}</span>
        <div class="abs-value-wrap">
          <strong>${escapeHtml(display)}</strong>
          <button class="abs-copy-value" type="button" data-copy="${escapeHtml(clean)}" aria-label="Copy ${escapeHtml(label)} percentage"${disabled}>
            ${COPY_ICON}
          </button>
        </div>
      </article>`;
  }

  function renderPanel() {
    clearTimeout(renderTimer);
    renderTimer = null;
    if (!collapsedReady || !isQuickStatsPage()) return;

    const data = getFamilyData();

    const signature = JSON.stringify(data);
    if (signature === lastSignature && document.getElementById(PANEL_ID)) return;
    lastSignature = signature;
    document.getElementById(PANEL_ID)?.remove();

    const root = document.createElement('aside');
    root.id = PANEL_ID;
    if (collapsed) root.classList.add('abs-collapsed');
    root.setAttribute('aria-label', 'AP Research ABS Census panel');
    root.innerHTML = `
      <div class="abs-panel-card">
        <header class="abs-header">
          <div class="abs-brand-mark">AP</div>
          <div class="abs-title-wrap">
            <div class="abs-title">AP Research</div>
            <div class="abs-subtitle">${escapeHtml([data.locality, data.salCode ? `SAL${data.salCode}` : 'ABS Census'].join(' · '))}</div>
          </div>
          <button class="abs-collapse-btn" type="button" aria-label="${collapsed ? 'Expand' : 'Collapse'} Census panel" title="${collapsed ? 'Expand' : 'Collapse'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>
          </button>
          <span class="abs-rail-label">ABS Census</span>
        </header>
        <div class="abs-body">
          <div class="abs-section-heading">
            <div><span>ABS Census / 2021 QuickStats</span><h2>Household profile</h2></div>
            ${data.available ? '' : '<em>Data unavailable</em>'}
          </div>
          ${data.available ? `
            <div class="abs-stats">
              ${statCard('Couple without children', data.withoutChildren)}
              ${statCard('Couple with children', data.withChildren)}
              ${statCard('Single / non-couple', data.nonCouple, 'abs-derived')}
            </div>
            <a class="abs-source-link" href="#" aria-label="Jump to source family data" title="Jump to source data">
              <span>View source data</span>${SOURCE_ICON}
            </a>
            <p class="abs-method"><strong>Calculated figure.</strong> Single / non-couple is 100% minus both couple-family shares. It includes one-parent and other family types.</p>
          ` : `
            <div class="abs-empty">
              <strong>Family composition is not available yet.</strong>
              <span>Expand the Families section or wait for the ABS QuickStats table to finish loading.</span>
            </div>
          `}
          <div class="abs-source-toast" role="status" aria-live="polite"></div>
        </div>
      </div>`;

    root.addEventListener('click', event => {
      const sourceLink = event.target.closest('.abs-source-link');
      if (sourceLink) {
        event.preventDefault();
        const target = findFamilySourceTarget();
        if (target) {
          target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        }
        const toast = root.querySelector('.abs-source-toast');
        toast.textContent = target ? 'Source data located' : 'Source section unavailable';
        toast.classList.add('visible');
        clearTimeout(toast.hideTimer);
        toast.hideTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
        return;
      }
      const collapseButton = event.target.closest('.abs-collapse-btn');
      if (collapseButton) {
        collapsed = root.classList.toggle('abs-collapsed');
        collapseButton.setAttribute('aria-label', collapsed ? 'Expand Census panel' : 'Collapse Census panel');
        collapseButton.setAttribute('title', collapsed ? 'Expand' : 'Collapse');
        chrome.storage.local.set({ [STORAGE_KEY]: collapsed }).catch(() => {});
        return;
      }
      const copyButton = event.target.closest('[data-copy]');
      if (copyButton && !copyButton.disabled) copyText(copyButton.dataset.copy, copyButton);
    });

    document.documentElement.append(root);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPanel, 180);
  }

  chrome.storage.local.get(STORAGE_KEY).then(result => {
    collapsed = Boolean(result?.[STORAGE_KEY]);
  }).catch(() => {}).finally(() => {
    collapsedReady = true;
    scheduleRender();
  });

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', scheduleRender);
  setTimeout(scheduleRender, 900);
  setTimeout(scheduleRender, 2400);
})();
