(() => {
  'use strict';

  const PANEL_ID = 'apr-rea-panel';
  const COPY_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
    </svg>`;
  const CHECK_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 12 4 4 8-8"></path>
    </svg>`;

  let lastSignature = '';
  let renderTimer = null;

  function isSuburbPage() {
    if (location.hostname !== 'www.realestate.com.au') return false;
    return /^\/(?:[a-z]{2,3})\/[a-z0-9-]+-\d{4}\/?$/i.test(location.pathname);
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r/g, '')
      .trim();
  }

  function pageText() {
    // textContent includes content rendered in inactive/hidden tabs, which is useful
    // because REA currently keeps bedroom snapshots in the page DOM.
    return normalizeText(document.body?.textContent || '');
  }

  function getLocationInfo() {
    const h1 = document.querySelector('h1');
    const suburb = normalizeText(h1?.textContent) || 'Property market';

    const postcodeFromUrl = location.pathname.match(/-(\d{4})\/?$/)?.[1] || '';
    const stateFromUrl = location.pathname.match(/^\/([a-z]{2,3})\//i)?.[1]?.toUpperCase() || '';

    let regionLine = '';
    if (h1) {
      let el = h1.nextElementSibling;
      for (let i = 0; el && i < 4; i++, el = el.nextElementSibling) {
        const t = normalizeText(el.textContent);
        if (postcodeFromUrl && t.includes(postcodeFromUrl)) {
          regionLine = t;
          break;
        }
      }
    }

    return {
      suburb,
      state: stateFromUrl,
      postcode: postcodeFromUrl,
      regionLine
    };
  }

  function extractPriceFromHeading(heading) {
    const headingText = normalizeText(heading.textContent);
    const isRental = /^Median rental price snapshot for/i.test(headingText);
    const labelPattern = isRental ? /Median rental price/i : /Median price/i;

    // Prefer a compact ancestor that contains the heading and the corresponding
    // median label/value, but not multiple snapshot headings.
    let node = heading.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const text = normalizeText(node.textContent);
      const snapshotCount = (text.match(/Median (?:rental )?price snapshot for/gi) || []).length;
      if (snapshotCount === 1 && labelPattern.test(text)) {
        const afterHeading = text.slice(text.toLowerCase().indexOf(headingText.toLowerCase()) + headingText.length);
        const value = findMedianValue(afterHeading, isRental);
        if (value) return value;
      }
    }

    // Fallback: scan forward through nearby DOM elements until the next snapshot heading.
    const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div'));
    const start = all.indexOf(heading);
    if (start >= 0) {
      let buffer = '';
      for (let i = start + 1; i < Math.min(all.length, start + 80); i++) {
        const t = normalizeText(all[i].textContent);
        if (/^Median (?:rental )?price snapshot for/i.test(t)) break;
        if (t.length <= 160) buffer += ' ' + t;
        const value = findMedianValue(buffer, isRental);
        if (value) return value;
      }
    }

    return null;
  }

  function findMedianValue(text, isRental) {
    const normalized = normalizeText(text);
    const label = isRental ? 'Median rental price' : 'Median price';
    const idx = normalized.toLowerCase().indexOf(label.toLowerCase());
    const searchArea = idx >= 0 ? normalized.slice(idx + label.length, idx + label.length + 180) : normalized.slice(0, 180);
    const price = searchArea.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/);
    if (price) return price[0].replace(/\$\s+/, '$');
    if (/[–—]/.test(searchArea)) return '—';
    return null;
  }

  function parseHouseMedians() {
    const result = new Map();
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));

    for (const heading of headings) {
      const text = normalizeText(heading.textContent);
      const match = text.match(/^Median (rental )?price snapshot for (?:(\d+) bed )?houses$/i);
      if (!match) continue;

      const type = match[1] ? 'rent' : 'buy';
      const bedrooms = match[2] ? `${match[2]} Bed` : 'All';
      const price = extractPriceFromHeading(heading);
      if (!price) continue;

      if (!result.has(bedrooms)) result.set(bedrooms, { bedrooms, buy: null, rent: null });
      result.get(bedrooms)[type] = price;
    }

    // Robust text fallback. This helps if REA changes heading tags but keeps the wording.
    if (result.size === 0) {
      const text = pageText();
      const re = /Median (rental )?price snapshot for (?:(\d+) bed )?houses\s+Median (?:rental )?price\s+(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[–—])/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        const type = m[1] ? 'rent' : 'buy';
        const bedrooms = m[2] ? `${m[2]} Bed` : 'All';
        const price = m[3].replace(/\$\s+/, '$').replace(/[–—]/, '—');
        if (!result.has(bedrooms)) result.set(bedrooms, { bedrooms, buy: null, rent: null });
        result.get(bedrooms)[type] = price;
      }
    }

    const rows = Array.from(result.values());
    rows.sort((a, b) => {
      if (a.bedrooms === 'All') return -1;
      if (b.bedrooms === 'All') return 1;
      return parseInt(a.bedrooms, 10) - parseInt(b.bedrooms, 10);
    });
    return rows;
  }

  function parsePeriodText(text) {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthPattern = monthNames.join('|');
    const normalized = normalizeText(text);
    const range = normalized.match(new RegExp(`(${monthPattern})\\s+(\\d{4})\\s*(?:-|–|—|to)\\s*(${monthPattern})\\s+(\\d{4})(?!\\d)`, 'i'));

    if (range) {
      const startMonth = monthNames.find(month => month.toLowerCase() === range[1].toLowerCase());
      const endMonth = monthNames.find(month => month.toLowerCase() === range[3].toLowerCase());
      return {
        range: `${startMonth} ${range[2]} – ${endMonth} ${range[4]}`,
        updatedMonthYear: `${endMonth} ${range[4]}`,
        month: endMonth
      };
    }

    const single = normalized.match(new RegExp(`(?:updated|as at|current to)\\s+(${monthPattern})\\s+(\\d{4})(?!\\d)`, 'i'));
    if (!single) return null;
    const month = monthNames.find(name => name.toLowerCase() === single[1].toLowerCase());
    return { range: '', updatedMonthYear: `${month} ${single[2]}`, month };
  }

  function extractPeriod() {
    const text = pageText();
    const snapshotIndex = text.search(/Median price snapshot for houses/i);
    if (snapshotIndex >= 0) {
      const nearby = parsePeriodText(text.slice(snapshotIndex, snapshotIndex + 1200));
      if (nearby) return nearby;
    }
    return parsePeriodText(text) || { range: '', updatedMonthYear: '', month: '' };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function copyText(text, button, successText = '') {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      ok = document.execCommand('copy');
      textarea.remove();
    }

    if (button && ok) {
      const old = button.innerHTML;
      button.innerHTML = successText ? `${CHECK_ICON}<span>${escapeHtml(successText)}</span>` : CHECK_ICON;
      button.classList.add('rea-copy-success');
      button.setAttribute('aria-label', `Copied ${text}`);
      setTimeout(() => {
        if (!button.isConnected) return;
        button.innerHTML = old;
        button.classList.remove('rea-copy-success');
        button.setAttribute('aria-label', `Copy ${text}`);
      }, 900);
    }
  }

  function numericCopyValue(value) {
    return String(value || '').replace(/\$/g, '').replace(/\s+/g, '').trim();
  }

  function renderPanel() {
    clearTimeout(renderTimer);
    renderTimer = null;

    if (!isSuburbPage()) {
      document.getElementById(PANEL_ID)?.remove();
      lastSignature = '';
      return;
    }

    const rows = parseHouseMedians();
    if (!rows.length) return;

    const info = getLocationInfo();
    const period = extractPeriod();

    const signature = JSON.stringify({ info, rows, period, url: location.href });
    if (signature === lastSignature && document.getElementById(PANEL_ID)) return;
    lastSignature = signature;

    document.getElementById(PANEL_ID)?.remove();

    const root = document.createElement('aside');
    root.id = PANEL_ID;
    root.setAttribute('aria-label', 'House median prices');

    const savedCollapsed = sessionStorage.getItem('aprReaPanelCollapsed') === '1';
    if (savedCollapsed) root.classList.add('rea-collapsed');

    const rowsHtml = rows.map(row => {
      const buy = row.buy || '—';
      const rent = row.rent || '—';
      const buyCopy = buy !== '—'
        ? `<button class="rea-copy-btn" type="button" data-copy="${escapeHtml(numericCopyValue(buy))}" aria-label="Copy number ${escapeHtml(numericCopyValue(buy))}" title="Copy number ${escapeHtml(numericCopyValue(buy))}">${COPY_ICON}</button>`
        : '<span class="rea-copy-spacer" aria-hidden="true"></span>';
      const rentCopy = rent !== '—'
        ? `<button class="rea-copy-btn" type="button" data-copy="${escapeHtml(numericCopyValue(rent))}" aria-label="Copy number ${escapeHtml(numericCopyValue(rent))}" title="Copy number ${escapeHtml(numericCopyValue(rent))}">${COPY_ICON}</button>`
        : '<span class="rea-copy-spacer" aria-hidden="true"></span>';

      return `
        <tr class="rea-row">
          <th scope="row" class="rea-bed">${escapeHtml(row.bedrooms)}</th>
          <td><div class="rea-value-cell"><span>${escapeHtml(buy)}</span>${buyCopy}</div></td>
          <td><div class="rea-value-cell"><span>${escapeHtml(rent)}</span>${rentCopy}</div></td>
        </tr>`;
    }).join('');

    root.innerHTML = `
      <div class="rea-panel-card">
        <header class="rea-header">
          <div class="rea-brand-mark">AP</div>
          <div class="rea-title-wrap">
            <div class="rea-title">AP Research</div>
            <div class="rea-subtitle">${escapeHtml([info.suburb, info.state, info.postcode].filter(Boolean).join(' · '))}</div>
          </div>
          <button class="rea-collapse-btn" type="button" aria-label="${savedCollapsed ? 'Expand' : 'Collapse'} median panel" title="${savedCollapsed ? 'Expand' : 'Collapse'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
          </button>
          <div class="rea-rail-label">${escapeHtml(info.suburb)} medians</div>
        </header>

        <div class="rea-body">
          <div class="rea-section-heading">
            <div><span class="rea-source-label">realestate.com.au</span><h2>House medians</h2></div>
          </div>
          <table class="rea-table" aria-label="House median sale and rental prices">
            <colgroup><col class="rea-col-bed"><col class="rea-col-buy"><col class="rea-col-rent"></colgroup>
            <thead><tr class="rea-table-head"><th scope="col">Bedrooms</th><th scope="col">Buy</th><th scope="col">Rent/wk</th></tr></thead>
            <tbody>
              <tr class="rea-period-row"><td colspan="3"><div class="rea-period-content">
                <span>${escapeHtml(period.updatedMonthYear ? `Updated ${period.updatedMonthYear}` : 'Reporting period unavailable')}</span>
                ${period.month ? `<button class="rea-copy-month" type="button" data-copy-month="${escapeHtml(period.month)}" aria-label="Copy update month ${escapeHtml(period.month)}" title="Copy ${escapeHtml(period.month)}">${COPY_ICON}<span>Copy month</span></button>` : ''}
              </div></td></tr>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>`;

    document.body.appendChild(root);

    root.addEventListener('click', event => {
      const monthCopyButton = event.target.closest('.rea-copy-month');
      if (monthCopyButton) {
        copyText(monthCopyButton.dataset.copyMonth, monthCopyButton, 'Month copied');
        return;
      }

      const copyButton = event.target.closest('.rea-copy-btn');
      if (copyButton) {
        copyText(copyButton.dataset.copy, copyButton);
        return;
      }

      const collapseButton = event.target.closest('.rea-collapse-btn');
      if (collapseButton) {
        const collapsed = root.classList.toggle('rea-collapsed');
        sessionStorage.setItem('aprReaPanelCollapsed', collapsed ? '1' : '0');
        collapseButton.setAttribute('aria-label', collapsed ? 'Expand median panel' : 'Collapse median panel');
        collapseButton.setAttribute('title', collapsed ? 'Expand' : 'Collapse');
      }
    });
  }

  function scheduleRender(delay = 250) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPanel, delay);
  }

  // Initial render. REA is client-rendered, so retry briefly while the data arrives.
  scheduleRender(100);
  setTimeout(() => scheduleRender(0), 1000);
  setTimeout(() => scheduleRender(0), 3000);

  const observer = new MutationObserver(() => scheduleRender(300));
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  // Handle client-side navigation without monkey-patching the site's history methods.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSignature = '';
      scheduleRender(250);
    }
  }, 750);
})();
