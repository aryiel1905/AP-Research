(() => {
  'use strict';

  const PANEL_ID = 'apr-yip-market-data-panel-host';
  const LABELS = [
    '12-month growth',
    'Gross rental yield',
    'Avg. Days on Market (12m)'
  ];
  const SHORT_LABELS = {
    '12-month growth': 'Annual growth',
    'Gross rental yield': 'Rental yield',
    'Avg. Days on Market (12m)': 'Days on market'
  };

  let lastSignature = '';
  let retryTimer = null;
  let refreshTimer = null;

  function cleanText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  }

  function norm(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function exactTextElement(text, root = document) {
    const wanted = norm(text);
    const candidates = root.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,th,td,strong,b');
    for (const element of candidates) {
      if (element.id === PANEL_ID || element.closest?.(`#${PANEL_ID}`)) continue;
      if (norm(element.textContent) === wanted) return element;
    }
    return null;
  }

  function findDataTable() {
    for (const table of document.querySelectorAll('table')) {
      if (table.closest(`#${PANEL_ID}`)) continue;
      const text = norm(table.innerText);
      const score = LABELS.reduce((total, label) => total + (text.includes(norm(label)) ? 1 : 0), 0);
      if (score >= 2 && text.includes('house')) return table;
    }
    return null;
  }

  function parseTable(table) {
    const rows = [];
    let houseIndex = 1;
    let unitIndex = 2;

    for (const tableRow of table.querySelectorAll('tr')) {
      const cells = [...tableRow.querySelectorAll(':scope > th, :scope > td')]
        .map(cell => cleanText(cell.innerText));
      const foundHouseIndex = cells.findIndex(cell => norm(cell) === 'house');
      const foundUnitIndex = cells.findIndex(cell => norm(cell) === 'unit');
      if (foundHouseIndex >= 0) houseIndex = foundHouseIndex;
      if (foundUnitIndex >= 0) unitIndex = foundUnitIndex;
    }

    for (const label of LABELS) {
      const target = norm(label);
      for (const tableRow of table.querySelectorAll('tr')) {
        const cells = [...tableRow.querySelectorAll(':scope > th, :scope > td')]
          .map(cell => cleanText(cell.innerText));
        if (!cells.length) continue;
        if (norm(cells[0]) === target || norm(cells[0]).includes(target)) {
          rows.push({
            label,
            house: cells[houseIndex] || '–',
            unit: cells[unitIndex] || '–'
          });
          break;
        }
      }
    }
    return rows;
  }

  function candidateContainerFromHeading() {
    const heading = exactTextElement('Key Market Data');
    if (!heading) return null;

    let node = heading;
    for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
      const text = cleanText(node.innerText || '');
      const score = LABELS.reduce((total, label) => total + (norm(text).includes(norm(label)) ? 1 : 0), 0);
      if (score >= 2 && text.length < 5000) return node;
    }
    return heading.parentElement;
  }

  function leafTexts(root) {
    const result = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.children.length === 0) {
          const text = cleanText(node.textContent);
          if (text) return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      result.push({ element: node, text: cleanText(node.textContent) });
    }
    return result;
  }

  function parseGrid(container) {
    const leaves = leafTexts(container);
    const rows = [];

    for (const label of LABELS) {
      const labelNode = leaves.find(item => norm(item.text) === norm(label));
      if (!labelNode) continue;

      let row = labelNode.element;
      let values = [];
      for (let depth = 0; depth < 5 && row && row !== container; depth++, row = row.parentElement) {
        const rowLeaves = leafTexts(row).map(item => item.text);
        const labelIndex = rowLeaves.findIndex(text => norm(text) === norm(label));
        if (labelIndex >= 0 && rowLeaves.length >= 2 && rowLeaves.length <= 6) {
          values = rowLeaves.slice(labelIndex + 1)
            .filter(text => norm(text) !== 'house' && norm(text) !== 'unit');
          if (values.length >= 1) break;
        }
      }

      if (!values.length) {
        const labelIndex = leaves.indexOf(labelNode);
        values = leaves.slice(labelIndex + 1, labelIndex + 4)
          .map(item => item.text)
          .filter(text => !LABELS.some(item => norm(item) === norm(text)))
          .filter(text => norm(text) !== 'house' && norm(text) !== 'unit');
      }

      rows.push({
        label,
        house: values[0] || '–',
        unit: values[1] || '–'
      });
    }
    return rows;
  }

  function getMarketData() {
    const table = findDataTable();
    let rows = table ? parseTable(table) : [];

    if (rows.length < LABELS.length) {
      const container = candidateContainerFromHeading();
      if (container) rows = parseGrid(container);
    }

    const byLabel = new Map(rows.map(row => [norm(row.label), row]));
    return LABELS.map(label => byLabel.get(norm(label))).filter(Boolean);
  }

  function titleCaseSlug(slug) {
    return slug.split('-').filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function getLocationInfo() {
    const parts = location.pathname.split('/').filter(Boolean);
    const stateRaw = parts[1] || '';
    const slug = parts[2] || '';
    const match = slug.match(/^(\d{4})-(.+)$/);
    const postcode = match?.[1] || '';
    let suburb = match ? titleCaseSlug(match[2]) : '';

    const headings = [...document.querySelectorAll('h1,h2')]
      .filter(element => !element.closest(`#${PANEL_ID}`))
      .map(element => cleanText(element.textContent))
      .filter(Boolean);
    const visibleSuburb = headings.find(text => suburb && norm(text).includes(norm(suburb))) || '';

    if (visibleSuburb && visibleSuburb.length < 80) {
      const stripped = visibleSuburb
        .replace(new RegExp(`\\b${postcode}\\b`, 'g'), '')
        .replace(/\bQLD\b|\bNSW\b|\bVIC\b|\bSA\b|\bWA\b|\bTAS\b|\bNT\b|\bACT\b/gi, '')
        .replace(/[:|,-]+$/g, '')
        .trim();
      if (stripped) suburb = stripped;
    }

    return {
      suburb: suburb || 'Suburb',
      state: stateRaw.toUpperCase(),
      postcode
    };
  }

  function copyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"></path></svg>';
  }

  function checkIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  }

  function chevronIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
  }

  function valueCell(value, label) {
    const displayValue = cleanText(value) || '–';
    const disabled = displayValue === '–' || displayValue === '-';
    return `
      <div class="value-wrap">
        <span class="value ${disabled ? 'muted' : ''}">${escapeHtml(displayValue)}</span>
        <button class="icon-button copy" type="button" data-copy="${escapeHtml(displayValue)}" aria-label="Copy ${escapeHtml(label)} value" ${disabled ? 'disabled' : ''}>
          ${copyIcon()}
        </button>
      </div>`;
  }

  async function writeClipboard(value) {
    if (!value || value === '–' || value === '-') return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  }

  function buildPanel(rows) {
    const info = getLocationInfo();
    const oldHost = document.getElementById(PANEL_ID);
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;width:min(402px,94vw);height:100dvh;z-index:2147483647;font-family:Geist,"Segoe UI",system-ui,-apple-system,sans-serif;transition:width 520ms cubic-bezier(.22,1,.36,1);';
    const shadow = host.attachShadow({ mode: 'open' });

    const bodyRows = rows.map((row, index) => `
      <article class="metric-card" style="--index:${index}">
        <span class="metric">${escapeHtml(SHORT_LABELS[row.label] || row.label)}</span>
        ${valueCell(row.house, row.label)}
      </article>
    `).join('');

    const locationLine = [info.state, info.postcode].filter(Boolean).join(' · ');

    shadow.innerHTML = `
      <style>
        :host{color-scheme:dark}
        *{box-sizing:border-box}
        button,a{font:inherit}
        button:focus-visible,a:focus-visible{outline:2px solid #d8d8d8;outline-offset:3px}
        .shell{position:relative;width:100%;height:100%;overflow:hidden;background:#101010;color:#f5f5f5;border-left:1px solid rgba(245,245,245,.11);box-shadow:-24px 0 72px rgba(16,16,16,.28);isolation:isolate}
        .shell::before{content:"";position:absolute;z-index:-2;inset:-12%;background:radial-gradient(circle at 88% 5%,rgba(168,168,168,.28),transparent 35%),radial-gradient(circle at 8% 60%,rgba(75,75,75,.25),transparent 42%),#101010}
        .shell::after{content:"";position:absolute;z-index:-1;inset:0;opacity:.12;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.92' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.34'/%3E%3C/svg%3E")}
        .main-view{height:100%;display:flex;flex-direction:column;opacity:1;transform:translateX(0);transition:opacity 180ms ease,transform 420ms cubic-bezier(.22,1,.36,1)}
        .topbar{display:flex;align-items:center;justify-content:space-between;min-height:72px;padding:15px 18px;border-bottom:1px solid rgba(245,245,245,.1);background:rgba(16,16,16,.83);backdrop-filter:blur(18px)}
        .brand{display:flex;align-items:center;gap:11px;min-width:0}
        .brand-mark{width:39px;height:39px;display:grid;place-items:center;border:1px solid rgba(245,245,245,.18);background:#f5f5f5;color:#101010;border-radius:50%;font-size:9px;font-weight:850;letter-spacing:-.04em}
        .brand-name{font-size:13px;font-weight:780;letter-spacing:-.015em}.brand-context{margin-top:3px;overflow:hidden;color:#a8a8a8;font-size:9px;letter-spacing:.05em;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}
        .icon-button{width:35px;height:35px;border:1px solid transparent;border-radius:50%;background:transparent;color:inherit;display:grid;place-items:center;cursor:pointer;transition:transform 240ms ease,background 240ms ease,border-color 240ms ease,color 240ms ease}
        .icon-button:hover{background:rgba(245,245,245,.08);border-color:rgba(245,245,245,.15);transform:scale(1.05)}
        .icon-button:active{transform:scale(.94)}.icon-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .collapse svg{transform:rotate(0);transition:transform 320ms ease}
        .ticker{overflow:hidden;border-bottom:1px solid rgba(245,245,245,.08);background:rgba(16,16,16,.22);white-space:nowrap}
        .ticker-track{width:max-content;display:flex;gap:16px;padding:8px 0;animation:ticker 22s linear infinite;color:#a8a8a8;font-size:9px;font-weight:650;letter-spacing:.05em;text-transform:uppercase}
        .ticker-track span{display:inline-flex;align-items:center;gap:7px}.ticker-track i{width:4px;height:4px;border-radius:50%;background:#a8a8a8}.ticker-track strong{color:#f5f5f5;font-weight:700}
        .ticker:hover .ticker-track{animation-play-state:paused}
        @keyframes ticker{to{transform:translateX(-50%)}}
        .scroll{min-height:0;overflow-y:auto;overflow-x:hidden;padding:20px 20px 24px;scrollbar-width:thin;scrollbar-color:rgba(245,245,245,.2) transparent}
        .section-heading{margin:0 2px 14px}.section-heading .source-label{display:block;margin:0 0 5px;color:#d8d8d8!important;font:800 9px/1.2 Outfit,"Segoe UI",system-ui,sans-serif!important;letter-spacing:.1em;text-transform:uppercase;white-space:normal}.section-heading h2{margin:0;color:#f5f5f5!important;font:760 20px/1.1 Outfit,"Segoe UI",system-ui,sans-serif!important;letter-spacing:-.035em;text-transform:none}
        .metric-grid{display:grid;grid-template-columns:1fr;grid-auto-flow:dense;gap:0;border:1px solid rgba(245,245,245,.12);border-radius:21px;overflow:hidden;background:rgba(245,245,245,.035)}
        .metric-card{position:relative;display:flex;flex-direction:column;align-items:stretch;justify-content:center;min-height:96px;padding:15px 17px;border-bottom:1px solid rgba(245,245,245,.09);transition:background 260ms ease;animation:card-in 620ms both;animation-delay:calc(var(--index) * 85ms)}
        .metric-card:last-child{border-bottom:0}.metric-card:hover{background:rgba(245,245,245,.07)}
        @keyframes card-in{from{opacity:0;transform:translateY(22px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        .metric{color:#a8a8a8;font-size:10px;font-weight:720;letter-spacing:.01em}
        .value-wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;margin-top:4px}.value{color:#f5f5f5;font-size:27px;font-weight:780;line-height:1;letter-spacing:-.045em;white-space:nowrap}.value.muted{color:#a8a8a8}
        .copy{width:34px;height:34px;flex:0 0 34px;color:#a8a8a8}.copy:hover{color:#f5f5f5}.copy.copied{background:#d8d8d8;color:#1b1b1b}.copy:disabled{opacity:.25;cursor:default}.copy:disabled:hover{transform:none;background:transparent;border-color:transparent}
        .source-link{width:max-content;min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;padding:0 13px;border:1px solid rgba(245,245,245,.16);border-radius:12px;background:transparent;color:#d8d8d8;font:700 10px/1.4 Outfit,"Segoe UI",system-ui,sans-serif;text-decoration:none;opacity:1;transition:background 240ms ease,transform 240ms ease}.source-link:hover{background:rgba(245,245,245,.08);transform:translateY(-2px)}.source-link svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        .note{margin:14px 3px 0;color:#a8a8a8;font-size:10px;line-height:1.55}
        .rail{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:16px 10px 20px;opacity:0;pointer-events:none;transform:translateX(20px);transition:opacity 220ms ease,transform 420ms cubic-bezier(.22,1,.36,1)}
        .rail-open{width:40px;height:40px;border-color:rgba(245,245,245,.15);transform:rotate(180deg)}.rail-title{margin:auto 0;writing-mode:vertical-rl;transform:rotate(180deg);color:#d8d8d8;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.rail-dot{width:7px;height:7px;border-radius:50%;background:#a8a8a8;box-shadow:0 0 0 7px rgba(168,168,168,.12)}
        .shell.collapsed .main-view{opacity:0;pointer-events:none;transform:translateX(32px)}.shell.collapsed .rail{opacity:1;pointer-events:auto;transform:translateX(0)}
        .toast{position:absolute;left:50%;bottom:22px;z-index:10;max-width:calc(100% - 40px);padding:10px 14px;border:1px solid rgba(245,245,245,.13);border-radius:999px;background:#f5f5f5;color:#101010;box-shadow:0 12px 36px rgba(16,16,16,.3);font-size:11px;font-weight:720;opacity:0;pointer-events:none;transform:translate(-50%,14px);transition:opacity 220ms ease,transform 320ms cubic-bezier(.22,1,.36,1);white-space:nowrap}.toast.visible{opacity:1;transform:translate(-50%,0)}
        @media(max-width:560px){.scroll{padding:18px 14px}.topbar{padding:14px}}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}.ticker-track{animation:none}}
      </style>
      <aside class="shell" aria-label="YIP house market data panel">
        <div class="main-view">
          <header class="topbar">
            <div class="brand">
              <div class="brand-mark">AP</div>
              <div><div class="brand-name">AP Research</div><div class="brand-context">${escapeHtml([info.suburb, locationLine].filter(Boolean).join(' · '))}</div></div>
            </div>
            <button class="icon-button collapse" type="button" aria-label="Collapse market data panel">${chevronIcon()}</button>
          </header>
          <div class="scroll">
            <div class="section-heading"><div><span class="source-label">YIP</span><h2>House market signals</h2></div></div>
            <section class="metric-grid" aria-label="House market metrics">${bodyRows}</section>
            <a class="source-link" href="#" aria-label="Jump to source market data" title="Jump to source data">
              <span>View source data</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>
            </a>
          </div>
        </div>
        <div class="rail" aria-hidden="true">
          <button class="icon-button rail-open" type="button" aria-label="Expand market data panel">${chevronIcon()}</button>
          <div class="rail-title">${escapeHtml(info.suburb)} market data</div>
          <div class="rail-dot"></div>
        </div>
        <div class="toast" role="status" aria-live="polite"></div>
      </aside>
    `;

    const shell = shadow.querySelector('.shell');
    const toast = shadow.querySelector('.toast');
    let toastTimer;

    function showToast(message) {
      clearTimeout(toastTimer);
      toast.textContent = message;
      toast.classList.add('visible');
      toastTimer = setTimeout(() => toast.classList.remove('visible'), 1400);
    }

    function setCollapsed(collapsed) {
      shell.classList.toggle('collapsed', collapsed);
      host.style.width = collapsed ? '62px' : 'min(402px,94vw)';
      const mainView = shadow.querySelector('.main-view');
      const rail = shadow.querySelector('.rail');
      mainView.inert = collapsed;
      rail.inert = !collapsed;
      rail.setAttribute('aria-hidden', String(!collapsed));
    }

    shadow.querySelector('.rail').inert = true;
    shadow.querySelector('.collapse').addEventListener('click', () => setCollapsed(true));
    shadow.querySelector('.rail-open').addEventListener('click', () => setCollapsed(false));

    shadow.querySelectorAll('button.copy:not(:disabled)').forEach(button => {
      button.addEventListener('click', async () => {
        const copied = await writeClipboard(button.dataset.copy);
        if (!copied) return;
        const original = button.innerHTML;
        button.innerHTML = checkIcon();
        button.classList.add('copied');
        showToast('Value copied');
        setTimeout(() => {
          button.innerHTML = original;
          button.classList.remove('copied');
        }, 1000);
      });
    });

    shadow.querySelector('.source-link').addEventListener('click', event => {
      event.preventDefault();
      const target = findDataTable() || exactTextElement('Key Market Data') || candidateContainerFromHeading();
      if (target) {
        target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        showToast('Source data located');
      } else {
        showToast('Source section unavailable');
      }
    });

    document.documentElement.appendChild(host);
  }

  function refresh() {
    const rows = getMarketData();
    if (rows.length < LABELS.length) return false;
    const locationInfo = getLocationInfo();

    const signature = JSON.stringify({ path: location.pathname, rows });
    if (signature !== lastSignature || !document.getElementById(PANEL_ID)) {
      lastSignature = signature;
      buildPanel(rows);
    }
    return true;
  }

  function scheduleRefresh(delay = 220) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }

  let attempts = 0;
  function boot() {
    attempts += 1;
    if (refresh() || attempts >= 20) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(boot, 500);
  }

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node => node.id !== PANEL_ID))) {
      scheduleRefresh();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('popstate', () => scheduleRefresh(50));
  window.addEventListener('pageshow', () => scheduleRefresh(50));
  boot();
})();
