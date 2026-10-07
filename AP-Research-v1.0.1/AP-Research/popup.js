const areaSearchForm = document.getElementById('areaSearchForm');
const suburbInput = document.getElementById('suburbInput');
const stateInput = document.getElementById('stateInput');
const postcodeInput = document.getElementById('postcodeInput');
const absSalField = document.getElementById('absSalField');
const absSalInput = document.getElementById('absSalInput');
const openAllBtn = document.getElementById('openAllBtn');
const searchMessage = document.getElementById('searchMessage');
const stateChip = document.getElementById('stateChip');
const suburbSuggestions = document.getElementById('suburbSuggestions');
const exportSuggestionsBtn = document.getElementById('exportSuggestionsBtn');
const sourceLaunchers = [...document.querySelectorAll('[data-search-source]')];

const AREA_SEARCH_STORAGE_KEY = 'aprLastAreaSearch';
const LEARNED_SUGGESTIONS_STORAGE_KEY = 'aprLearnedAreaSuggestions';
const SUGGESTIONS_DATA_PATH = 'data/suburb_search_suggestions.json';
const ABS_SAL_DATA_PATH = 'data/abs_sal_2021.json';
const VALID_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const SEARCH_SOURCE_ORDER = ['propertyvalue', 'yip', 'rea', 'sqm', 'abs'];
const SEARCH_SOURCE_NAMES = {
  propertyvalue: 'PropertyValue', yip: 'YIP', rea: 'realestate.com.au',
  sqm: 'SQM Research', abs: 'ABS Census'
};
let areaSuggestions = [];
let learnedSuggestions = [];
let absSalLocalities = [];
let selectedSalCode = '';
let activeSuggestionIndex = -1;
let suburbManuallyEdited = false;
let stateManuallyEdited = false;

function normalizeSuburb(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function hyphenateSuburb(value) {
  return normalizeSuburb(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function encodePropertyValueSuburb(value) {
  return encodeURIComponent(normalizeSuburb(value).toLowerCase());
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSuggestion(record) {
  const suburb = normalizeSuburb(record?.suburb);
  const state = String(record?.state || '').toUpperCase();
  const postcode = String(record?.postcode || '').replace(/\D/g, '').slice(0, 4);
  if (suburb.length < 2 || !VALID_STATES.includes(state) || !/^\d{4}$/.test(postcode)) return null;
  const salCode = /^\d{5}$/.test(String(record?.salCode || '')) ? String(record.salCode) : '';
  const salName = normalizeSuburb(record?.salName);
  return {
    suburb,
    state,
    postcode,
    label: `${suburb}, ${state} ${postcode}`,
    searchText: normalizeSearchText(`${suburb} ${state} ${postcode}`),
    ...(salCode ? { salCode } : {}),
    ...(salCode && salName ? { salName } : {})
  };
}

function suggestionKey(record) {
  return `${normalizeSearchText(record?.suburb)}|${String(record?.state || '').toUpperCase()}|${String(record?.postcode || '')}`;
}

function mergeSuggestions(...groups) {
  const merged = new Map();
  groups.flat().forEach(record => {
    const normalized = normalizeSuggestion(record);
    if (normalized) merged.set(suggestionKey(normalized), normalized);
  });
  return [...merged.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function buildAreaUrls(suburb, state, postcode, salCode = '') {
  const hyphenated = hyphenateSuburb(suburb);
  const propertyValueSuburb = encodePropertyValueSuburb(suburb);
  const stateSlug = state.toLowerCase();
  return {
    propertyvalue: `https://www.propertyvalue.com.au/suburb/${propertyValueSuburb}-${postcode}-${stateSlug}`,
    yip: `https://www.yourinvestmentpropertymag.com.au/top-suburbs/${stateSlug}/${postcode}-${hyphenated}`,
    rea: `https://www.realestate.com.au/${stateSlug}/${hyphenated}-${postcode}/`,
    sqm: `https://sqmresearch.com.au/property/vacancy-rates?postcode=${postcode}`,
    ...(salCode ? { abs: `https://www.abs.gov.au/census/find-census-data/quickstats/2021/SAL${salCode}` } : {})
  };
}

function salBaseName(value) {
  return normalizeSearchText(normalizeSuburb(value).replace(/\s*\([^)]*\)\s*$/, ''));
}

function findSalCandidates(suburb, state) {
  const target = normalizeSearchText(suburb);
  const inState = absSalLocalities.filter(record => record.state === state);
  const exact = inState.filter(record => normalizeSearchText(record.suburb) === target);
  return exact.length ? exact : inState.filter(record => salBaseName(record.suburb) === target);
}

function hideAbsSalSelector() {
  absSalField.classList.add('hidden');
  absSalInput.replaceChildren();
}

function showAbsSalSelector(candidates) {
  const existing = selectedSalCode || absSalInput.value;
  absSalInput.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose the official locality';
  absSalInput.append(placeholder);
  candidates.forEach(record => {
    const option = document.createElement('option');
    option.value = record.salCode;
    option.textContent = `${record.suburb} — SAL${record.salCode}`;
    absSalInput.append(option);
  });
  if (candidates.some(record => record.salCode === existing)) absSalInput.value = existing;
  absSalField.classList.remove('hidden');
}

function resolveAbsLocality(suburb, state) {
  const candidates = findSalCandidates(suburb, state);
  if (!candidates.length) {
    hideAbsSalSelector();
    throw new Error(`No official 2021 ABS locality match was found for ${suburb}, ${state}. Try the official locality name.`);
  }
  if (candidates.length === 1) {
    selectedSalCode = candidates[0].salCode;
    hideAbsSalSelector();
    return candidates[0];
  }
  showAbsSalSelector(candidates);
  const selected = candidates.find(record => record.salCode === absSalInput.value || record.salCode === selectedSalCode);
  if (!selected) {
    absSalInput.focus();
    throw new Error(`Choose the official ABS locality for ${suburb}, ${state}.`);
  }
  selectedSalCode = selected.salCode;
  return selected;
}

function findMatchingState(suburb, postcode) {
  const matches = areaSuggestions.filter(record =>
    normalizeSearchText(record.suburb) === normalizeSearchText(suburb) && record.postcode === postcode
  );
  const states = [...new Set(matches.map(record => record.state))];
  return states.length === 1 ? states[0] : '';
}

function validateAreaSearch() {
  const suburb = normalizeSuburb(suburbInput.value);
  let state = String(stateInput.value || '').toUpperCase();
  const postcode = postcodeInput.value.replace(/\D/g, '').slice(0, 4);
  suburbInput.value = suburb;
  postcodeInput.value = postcode;
  if (!state) {
    state = findMatchingState(suburb, postcode);
    if (state) stateInput.value = state;
  }

  const suburbValid = suburb.length >= 2;
  const stateValid = VALID_STATES.includes(state);
  const postcodeValid = /^\d{4}$/.test(postcode);
  suburbInput.setAttribute('aria-invalid', String(!suburbValid));
  stateInput.setAttribute('aria-invalid', String(!stateValid));
  postcodeInput.setAttribute('aria-invalid', String(!postcodeValid));

  if (!suburbValid) throw new Error('Enter an Australian suburb name.');
  if (!stateValid) throw new Error('Select the state or territory.');
  if (!postcodeValid) throw new Error('Enter a four-digit Australian postcode.');
  stateChip.textContent = state;
  return { suburb, state, postcode };
}

function hideSuggestions() {
  suburbSuggestions.hidden = true;
  suburbSuggestions.replaceChildren();
  suburbInput.setAttribute('aria-expanded', 'false');
  suburbInput.removeAttribute('aria-activedescendant');
  activeSuggestionIndex = -1;
}

function selectSuggestion(record) {
  suburbInput.value = record.suburb;
  suburbManuallyEdited = false;
  stateInput.value = record.state;
  stateManuallyEdited = false;
  postcodeInput.value = record.postcode;
  stateChip.textContent = record.state;
  selectedSalCode = record.salCode || '';
  hideAbsSalSelector();
  suburbInput.removeAttribute('aria-invalid');
  stateInput.removeAttribute('aria-invalid');
  postcodeInput.removeAttribute('aria-invalid');
  hideSuggestions();
  setSearchMessage(`${record.label} selected. Choose one source or open all five.`);
}

function renderSuggestions(showAllPostcodeMatches = false) {
  const query = normalizeSearchText(suburbInput.value);
  const postcode = postcodeInput.value;
  const postcodeMatches = /^\d{4}$/.test(postcode)
    ? areaSuggestions.filter(record => record.postcode === postcode)
    : [];
  if (!postcodeMatches.length && query.length < 2) {
    hideSuggestions();
    return;
  }

  const tokens = showAllPostcodeMatches ? [] : (query ? query.split(' ') : []);
  const selectedState = stateInput.value;
  const candidates = postcodeMatches.length ? postcodeMatches : areaSuggestions;
  const matches = candidates
    .filter(record => tokens.every(token => record.searchText.includes(token)))
    .sort((left, right) => {
      const leftState = selectedState && left.state === selectedState ? 0 : 1;
      const rightState = selectedState && right.state === selectedState ? 0 : 1;
      const leftStarts = normalizeSearchText(left.suburb).startsWith(query) ? 0 : 1;
      const rightStarts = normalizeSearchText(right.suburb).startsWith(query) ? 0 : 1;
      return leftState - rightState || leftStarts - rightStarts || left.label.localeCompare(right.label);
    })
    .slice(0, postcodeMatches.length ? 12 : 5);

  suburbSuggestions.replaceChildren();
  matches.forEach((record, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'suburb-option';
    option.id = `suburb-option-${index}`;
    option.setAttribute('role', 'option');
    option.innerHTML = '<span></span><small></small>';
    option.querySelector('span').textContent = record.suburb;
    option.querySelector('small').textContent = `${record.state} ${record.postcode}`;
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => selectSuggestion(record));
    suburbSuggestions.append(option);
  });

  if (!matches.length) {
    hideSuggestions();
    return;
  }
  suburbSuggestions.hidden = false;
  suburbInput.setAttribute('aria-expanded', 'true');
  activeSuggestionIndex = -1;
}

function moveSuggestionSelection(direction) {
  const options = [...suburbSuggestions.querySelectorAll('.suburb-option')];
  if (!options.length) return;
  activeSuggestionIndex = (activeSuggestionIndex + direction + options.length) % options.length;
  options.forEach((option, index) => {
    option.classList.toggle('active', index === activeSuggestionIndex);
    option.setAttribute('aria-selected', String(index === activeSuggestionIndex));
  });
  const activeOption = options[activeSuggestionIndex];
  suburbInput.setAttribute('aria-activedescendant', activeOption.id);
  activeOption.scrollIntoView({ block: 'nearest' });
}

async function loadAreaSuggestions() {
  let seedSuggestions = [];
  try {
    const response = await fetch(chrome.runtime.getURL(SUGGESTIONS_DATA_PATH));
    if (!response.ok) throw new Error(`Suggestion file returned ${response.status}.`);
    seedSuggestions = (await response.json())?.suggestions || [];
  } catch (_) {}

  try {
    const stored = await chrome.storage.local.get(LEARNED_SUGGESTIONS_STORAGE_KEY);
    learnedSuggestions = Array.isArray(stored?.[LEARNED_SUGGESTIONS_STORAGE_KEY])
      ? stored[LEARNED_SUGGESTIONS_STORAGE_KEY]
      : [];
  } catch (_) {
    learnedSuggestions = [];
  }
  areaSuggestions = mergeSuggestions(seedSuggestions, learnedSuggestions);

  try {
    const response = await fetch(chrome.runtime.getURL(ABS_SAL_DATA_PATH));
    if (!response.ok) throw new Error(`ABS SAL file returned ${response.status}.`);
    const records = (await response.json())?.localities || [];
    absSalLocalities = records.filter(record =>
      normalizeSuburb(record?.suburb) && VALID_STATES.includes(record?.state) && /^\d{5}$/.test(String(record?.salCode || ''))
    );
  } catch (_) {
    absSalLocalities = [];
  }
}

async function learnAreaSearch(area) {
  const record = normalizeSuggestion(area);
  if (!record) return false;
  const existing = areaSuggestions.find(item => suggestionKey(item) === suggestionKey(record));
  if (existing && (!record.salCode || existing.salCode === record.salCode)) return false;
  learnedSuggestions = mergeSuggestions(learnedSuggestions, [record]).slice(0, 1000);
  areaSuggestions = mergeSuggestions(areaSuggestions, [record]);
  await chrome.storage.local.set({ [LEARNED_SUGGESTIONS_STORAGE_KEY]: learnedSuggestions });
  return true;
}

function setSearchMessage(text, kind = '') {
  searchMessage.textContent = text;
  searchMessage.className = `search-message${kind ? ` ${kind}` : ''}`;
}

function setSearchBusy(busy) {
  openAllBtn.disabled = busy;
  openAllBtn.classList.toggle('busy', busy);
  openAllBtn.querySelector('span').textContent = busy ? 'Opening sources' : 'Open all five sources';
  sourceLaunchers.forEach(button => { button.disabled = busy; });
}

async function openAreaSources(sourceKeys = SEARCH_SOURCE_ORDER) {
  try {
    const { suburb, state, postcode } = validateAreaSearch();
    const wantsAbs = sourceKeys.includes('abs');
    const absLocality = wantsAbs ? resolveAbsLocality(suburb, state) : null;
    const salCode = absLocality?.salCode || '';
    const urls = buildAreaUrls(suburb, state, postcode, salCode);
    const requested = sourceKeys.filter(source => urls[source]);
    if (!requested.length) throw new Error('Choose at least one research source.');

    setSearchBusy(true);
    setSearchMessage(`Opening ${requested.length === 1 ? SEARCH_SOURCE_NAMES[requested[0]] : 'all five research sources'}…`);
    const storedArea = { suburb, state, postcode, ...(salCode ? { salCode, salName: absLocality.suburb } : {}) };
    await chrome.storage.local.set({ [AREA_SEARCH_STORAGE_KEY]: storedArea });
    const learned = await learnAreaSearch(storedArea);

    await Promise.all(requested.map(source => {
      const options = { url: urls[source], active: false };
      return chrome.tabs.create(options);
    }));

    setSearchMessage(`${suburb}, ${state} ${postcode} opened in ${requested.length} background ${requested.length === 1 ? 'tab' : 'tabs'}.${learned ? ' Added to suggestions.' : ''}`, 'success');
  } catch (error) {
    setSearchMessage(error?.message || 'Could not open the research websites.', 'error');
  } finally {
    setSearchBusy(false);
  }
}

async function restoreAreaSearch() {
  try {
    const stored = await chrome.storage.local.get(AREA_SEARCH_STORAGE_KEY);
    const area = stored?.[AREA_SEARCH_STORAGE_KEY];
    if (area?.suburb) suburbInput.value = normalizeSuburb(area.suburb);
    if (area?.postcode) postcodeInput.value = String(area.postcode).replace(/\D/g, '').slice(0, 4);
    if (/^\d{5}$/.test(String(area?.salCode || ''))) selectedSalCode = String(area.salCode);
    const restoredState = VALID_STATES.includes(String(area?.state || '').toUpperCase())
      ? String(area.state).toUpperCase()
      : findMatchingState(area?.suburb, String(area?.postcode || ''));
    if (restoredState) {
      stateInput.value = restoredState;
      stateChip.textContent = restoredState;
    }
  } catch (_) {}
}

async function exportAreaSuggestions() {
  try {
    const exportData = {
      version: 1,
      last_updated: new Date().toISOString().slice(0, 10),
      purpose: 'Autocomplete/search suggestions based on suburbs and postcodes previously searched.',
      unique_key: 'suburb|state|postcode',
      suggestions: mergeSuggestions(areaSuggestions)
    };
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(`${JSON.stringify(exportData, null, 2)}\n`)}`;
    await chrome.downloads.download({ url, filename: 'suburb_search_suggestions.json', saveAs: true });
    setSearchMessage(`Exported ${exportData.suggestions.length} Australian suburb suggestions.`, 'success');
  } catch (error) {
    setSearchMessage(error?.message || 'Could not export the updated suggestion list.', 'error');
  }
}

function initMotion() {
  if (!window.gsap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  window.gsap.from('.search-heading', { y: -12, opacity: 0, duration: .5, ease: 'power3.out' });
  window.gsap.from('.search-field, .search-primary, .source-launchers button', {
    y: 12, opacity: 0, duration: .52, stagger: .045, ease: 'power3.out', delay: .08
  });
}

async function init() {
  initMotion();
  await loadAreaSuggestions();
  await restoreAreaSearch();
}

exportSuggestionsBtn.addEventListener('click', exportAreaSuggestions);
areaSearchForm.addEventListener('submit', event => {
  event.preventDefault();
  hideSuggestions();
  openAreaSources();
});
sourceLaunchers.forEach(button => {
  button.addEventListener('click', () => openAreaSources([button.dataset.searchSource]));
});
postcodeInput.addEventListener('input', () => {
  postcodeInput.value = postcodeInput.value.replace(/\D/g, '').slice(0, 4);
  postcodeInput.removeAttribute('aria-invalid');
  selectedSalCode = '';
  hideAbsSalSelector();
  hideSuggestions();
  const postcode = postcodeInput.value;
  if (!/^\d{4}$/.test(postcode)) {
    setSearchMessage('');
    return;
  }

  const matches = areaSuggestions.filter(record => record.postcode === postcode);
  const states = [...new Set(matches.map(record => record.state))];
  if (states.length === 1) {
    stateInput.value = states[0];
    stateManuallyEdited = false;
    stateInput.removeAttribute('aria-invalid');
    stateChip.textContent = states[0];
  } else if (!stateManuallyEdited) {
    stateInput.value = '';
    stateChip.textContent = 'AU';
  }

  const currentSuburb = normalizeSearchText(suburbInput.value);
  const matchingSuburb = matches.find(record =>
    normalizeSearchText(record.suburb) === currentSuburb && (!stateInput.value || record.state === stateInput.value)
  );
  if (matchingSuburb) {
    selectSuggestion(matchingSuburb);
    return;
  }
  if (matches.length === 1 && !suburbManuallyEdited) {
    selectSuggestion(matches[0]);
    return;
  }
  if (matches.length > 1) {
    if (!suburbManuallyEdited) suburbInput.value = '';
    renderSuggestions(true);
    setSearchMessage(currentSuburb && suburbManuallyEdited
      ? `Check the suburb for ${postcode}; choose a matching suggestion or correct the postcode.`
      : `Choose a suburb for ${postcode}.`);
    return;
  }
  if (!matches.length && !suburbManuallyEdited) suburbInput.value = '';
  if (matches.length) renderSuggestions(true);
  setSearchMessage(matches.length
    ? `Check the suburb for ${postcode}; choose the saved match or correct the postcode.`
    : `No saved suburb for ${postcode}. Enter the suburb and state manually.`);
});
absSalInput.addEventListener('change', () => {
  selectedSalCode = absSalInput.value;
  if (selectedSalCode) setSearchMessage(`Official ABS locality SAL${selectedSalCode} selected.`, 'success');
});
stateInput.addEventListener('change', () => {
  stateManuallyEdited = true;
  selectedSalCode = '';
  hideAbsSalSelector();
  stateInput.removeAttribute('aria-invalid');
  stateChip.textContent = stateInput.value || 'AU';
  if (document.activeElement === suburbInput) renderSuggestions();
});
suburbInput.addEventListener('focus', () => renderSuggestions());
suburbInput.addEventListener('input', () => {
  suburbManuallyEdited = true;
  selectedSalCode = '';
  hideAbsSalSelector();
  suburbInput.removeAttribute('aria-invalid');
  renderSuggestions();
});
suburbInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (suburbSuggestions.hidden) renderSuggestions();
    moveSuggestionSelection(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
    event.preventDefault();
    suburbSuggestions.querySelectorAll('.suburb-option')[activeSuggestionIndex]?.click();
    return;
  }
  if (event.key === 'Escape') hideSuggestions();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.suburb-field')) hideSuggestions();
});

init().catch(error => setSearchMessage(error?.message || 'Could not start AP Research.', 'error'));
