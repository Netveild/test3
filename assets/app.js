/* ==========================================================================
   Download hub: app logic
   You shouldn't need to edit this file. Settings and the file list live in
   config.js; colours live at the top of assets/style.css.
   ========================================================================== */
(() => {
  'use strict';

  /* ---------- Settings ---------- */

  const SITE = Object.assign({
    name: 'Nexus',
    tagline: 'Download Center',
    downloadsFolder: 'downloads',
    autoList: true,
    github: {},
    githubUrl: '',
    newBadgeDays: 14,
    links: [],
  }, window.SITE);

  const MANIFEST = Array.isArray(window.FILES) ? window.FILES : [];
  const FOLDER = String(SITE.downloadsFolder || 'downloads').replace(/^\/+|\/+$/g, '');
  const IS_HTTP = /^https?:$/.test(location.protocol);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;

  /* ---------- Helpers ---------- */

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const store = {
    get(key) { try { return localStorage.getItem(`dlhub:${key}`); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(`dlhub:${key}`, value); } catch { /* storage blocked */ } },
  };

  /* ---------- Icons ---------- */

  const ICONS = {
    download: '<path d="M12 3.5v11m0 0 4.5-4.5M12 14.5 7.5 10"/><path d="M4 15.5v2A3.5 3.5 0 0 0 7.5 21h9a3.5 3.5 0 0 0 3.5-3.5v-2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    sparkle: '<path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    // File kinds
    archive: '<rect x="3" y="3.5" width="18" height="5" rx="1.5"/><path d="M5 8.5V18a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5M10 12.5h4"/>',
    app: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7.5 13l2.5 2-2.5 2M12.5 17h4"/>',
    document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.75"/><path d="m21 15-4-4L6 21"/>',
    media: '<circle cx="12" cy="12" r="9"/><path d="M10 8.75v6.5L15.5 12z"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    schematic: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/>',
    other: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.other}</svg>`;

  /* ---------- File types ---------- */

  const KINDS = {
    archive:  ['Archive',     'zip rar 7z tar gz tgz bz2 xz iso'],
    app:      ['Application', 'exe msi dmg pkg apk ipa appimage deb rpm jar bat cmd sh'],
    document: ['Document',    'pdf doc docx txt md rtf odt xls xlsx csv ppt pptx epub'],
    image:    ['Image',       'png jpg jpeg gif svg webp bmp ico tif tiff psd ai fig'],
    media:    ['Media',       'mp3 wav flac ogg m4a mp4 mov mkv webm avi'],
    code:     ['Code',        'js ts py json html css c cpp h cs java lua rs go rb php xml yml yaml'],
    schematic: ['Schematic',  'litematic schem schematic nbt'],
    other:    ['File',        ''],
  };
  const EXT_KIND = {};
  Object.entries(KINDS).forEach(([kind, [, exts]]) => {
    exts.split(' ').filter(Boolean).forEach(ext => { EXT_KIND[ext] = kind; });
  });

  /* ---------- Formatting ---------- */

  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function formatBytes(bytes) {
    if (bytes == null || !isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let i = -1;
    do { value /= 1024; i++; } while (value >= 1024 && i < units.length - 1);
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
  }

  function parseSize(size) {
    if (typeof size === 'number') return size;
    const m = /^\s*([\d.]+)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(size || '');
    if (!m) return null;
    const power = { b: 0, kb: 1, mb: 2, gb: 3, tb: 4 }[(m[2] || 'b').toLowerCase()];
    return Math.round(parseFloat(m[1]) * 1024 ** power);
  }

  function parseDate(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    const date = m ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(value);
    return isNaN(date) ? null : date;
  }

  function timeAgo(date) {
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 864e5);
    if (days < 0) return dateFmt.format(date);
    if (days < 7) return relFmt.format(-days, 'day');
    if (days < 30) return relFmt.format(-Math.round(days / 7), 'week');
    if (days < 365) return relFmt.format(-Math.round(days / 30), 'month');
    return relFmt.format(-Math.round(days / 365), 'year');
  }

  const titleFromName = name => name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .replace(/(^|\s)(\S)/g, (_, space, ch) => space + ch.toUpperCase());

  const versionLabel = v => (/^\d/.test(v) ? `v${v}` : v);

  /* ---------- Data ---------- */

  function normalize(entry, order) {
    const path = entry.file ? String(entry.file).replace(/^\/+/, '') : '';
    const filename = path
      ? path.split('/').pop()
      : safeDecode(String(entry.url || '').split(/[?#]/)[0].split('/').pop() || '');
    const ext = String(entry.type || (/\.([a-z0-9]+)$/i.exec(filename) || [])[1] || '').toLowerCase().replace(/^\./, '');
    const kind = EXT_KIND[ext] || 'other';
    const date = parseDate(entry.date);
    const ageDays = date ? (Date.now() - date) / 864e5 : Infinity;

    return {
      key: (path || entry.url || `item-${order}`).toLowerCase(),
      order,
      path,
      filename: filename || 'download',
      href: entry.url || `${FOLDER}/${path.split('/').map(encodeURIComponent).join('/')}`,
      external: Boolean(entry.url),
      ext,
      kind,
      title: entry.title || titleFromName(filename) || 'Untitled',
      description: entry.description || '',
      category: entry.category || KINDS[kind][0],
      size: parseSize(entry.size),
      date,
      version: entry.version ? String(entry.version) : '',
      featured: Boolean(entry.featured),
      isNew: ageDays > -1 && ageDays <= SITE.newBadgeDays,
    };
  }

  /** Works out which GitHub repo this site belongs to (config first, then the github.io URL). */
  function detectRepo() {
    const gh = SITE.github || {};
    let { user, repo } = gh;
    const host = /^([\w-]+)\.github\.io$/i.exec(location.hostname);
    if (host) {
      const firstSegment = location.pathname.split('/').filter(Boolean)[0];
      user = user || host[1];
      repo = repo || (firstSegment && !firstSegment.includes('.') ? firstSegment : `${host[1]}.github.io`);
    }
    if (!user || !repo) return null;
    return { user, repo, branch: gh.branch || '', path: String(gh.path || FOLDER).replace(/^\/+|\/+$/g, '') };
  }

  /** Lists the downloads folder through the GitHub API (cached for 5 minutes). */
  async function fetchListing({ user, repo, branch, path }) {
    const api = `https://api.github.com/repos/${user}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`
      + (branch ? `?ref=${encodeURIComponent(branch)}` : '');
    const cacheKey = `dlhub:listing:${api}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.time < 3e5) return cached.items;
    } catch { /* no cache */ }

    const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('Unexpected GitHub API response');

    const items = json
      .filter(item => item.type === 'file' && !item.name.startsWith('.') && item.name !== 'PUT-YOUR-FILES-HERE.txt')
      .map(item => ({ name: item.name, size: item.size }));
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), items })); } catch { /* storage blocked */ }
    return items;
  }

  async function loadFiles() {
    const files = [];
    const seen = new Set();
    const add = entry => {
      const file = normalize(entry, files.length);
      if (seen.has(file.key)) return;
      seen.add(file.key);
      files.push(file);
    };

    MANIFEST.filter(entry => entry && (entry.file || entry.url)).forEach(add);

    const repo = SITE.autoList && IS_HTTP ? detectRepo() : null;
    if (repo) {
      try {
        const listed = await fetchListing(repo);
        const byPath = new Map(files.map(f => [f.path.toLowerCase(), f]));
        listed.forEach(item => {
          const known = byPath.get(item.name.toLowerCase());
          if (!known) add({ file: item.name, size: item.size });
          else if (known.size == null) known.size = item.size;
        });
      } catch (err) {
        console.info('[downloads] Auto-listing unavailable, showing files from config.js only:', err.message);
      }
    }

    // Fill in any sizes that are still unknown
    if (IS_HTTP) {
      await Promise.all(files.filter(f => f.size == null && !f.external).map(async f => {
        try {
          const res = await fetch(f.href, { method: 'HEAD' });
          const length = Number(res.headers.get('content-length'));
          if (res.ok && length > 0) f.size = length;
        } catch { /* size stays unknown */ }
      }));
    }

    return files;
  }

  /* ---------- State ---------- */

  const els = {
    grid: $('#grid'),
    chips: $('#chips'),
    search: $('#search'),
    searchWrap: $('#searchWrap'),
    searchClear: $('#searchClear'),
    sort: $('#sort'),
    view: $('#viewToggle'),
    meta: $('#resultsMeta'),
    modal: $('#modal'),
    toasts: $('#toasts'),
    nav: $('.nav-wrap'),
    themeToggle: $('#themeToggle'),
  };

  const state = {
    files: [],
    query: '',
    category: '',          // '' = all
    sort: 'recommended',
    view: store.get('view') === 'list' ? 'list' : 'grid',
  };
  let fileByKey = new Map();

  const SORTS = {
    recommended: (a, b) => b.featured - a.featured || a.order - b.order,
    newest: (a, b) => (b.date || 0) - (a.date || 0) || a.order - b.order,
    name: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
    size: (a, b) => (b.size ?? -1) - (a.size ?? -1),
  };

  const searchTerms = () => state.query.toLowerCase().split(/\s+/).filter(Boolean);

  function visibleFiles() {
    const terms = searchTerms();
    return state.files
      .filter(f => !state.category || f.category === state.category)
      .filter(f => {
        if (!terms.length) return true;
        const haystack = `${f.title} ${f.filename} ${f.description} ${f.category} ${f.version} ${f.ext}`.toLowerCase();
        return terms.every(term => haystack.includes(term));
      })
      .sort(SORTS[state.sort] || SORTS.recommended);
  }

  function highlight(text) {
    const terms = searchTerms();
    if (!terms.length) return esc(text);
    const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    return String(text).split(pattern).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  }

  /* ---------- Templates ---------- */

  const fileIconHTML = (f, size = '') => `
    <div class="file-icon ${size}" data-kind="${f.kind}">
      ${icon(f.kind)}
      <span class="file-ext">${esc(f.ext || 'file')}</span>
    </div>`;

  /** .litematic files get a 3D preview of the build in the details dialog. */
  const hasPreview = f => f.ext === 'litematic' && Boolean(window.LitematicPreview);

  const tagsHTML = f => [
    f.featured && `<span class="tag tag-accent">${icon('sparkle', 'i-fill')}Featured</span>`,
    f.isNew && '<span class="tag tag-new">New</span>',
    hasPreview(f) && `<span class="tag" title="Open to see the build in 3D">${icon('schematic')}3D</span>`,
    f.version && `<span class="tag">${esc(versionLabel(f.version))}</span>`,
  ].filter(Boolean).join('');

  function metaParts(f) {
    const parts = [formatBytes(f.size), f.date && dateFmt.format(f.date)].filter(Boolean);
    return parts.length ? parts : [KINDS[f.kind][0]];
  }

  function downloadLinkHTML(f, extraClass = '', extraAttrs = '') {
    const attrs = f.external ? 'target="_blank" rel="noopener"' : `download="${esc(f.filename)}"`;
    return `<a class="btn btn-primary ${extraClass}" href="${esc(f.href)}" ${attrs} ${extraAttrs} data-download>
      ${icon(f.external ? 'external' : 'download')}<span>Download</span>
    </a>`;
  }

  function cardHTML(f) {
    return `
      <article class="card${f.featured ? ' is-featured' : ''}" data-key="${esc(f.key)}">
        <div class="card-head">
          ${fileIconHTML(f)}
          <div class="card-tags">${tagsHTML(f)}</div>
        </div>
        <div class="card-body">
          <h3 class="card-title"><button type="button" data-open>${highlight(f.title)}</button></h3>
          <p class="card-meta mono">${metaParts(f).map(esc).join('<span class="dot"></span>')}</p>
          ${f.description ? `<p class="card-desc">${esc(f.description)}</p>` : ''}
        </div>
        <div class="card-foot">
          ${downloadLinkHTML(f)}
          <button class="icon-btn sm" type="button" data-copy aria-label="Copy download link" title="Copy link">${icon('link')}</button>
        </div>
      </article>`;
  }

  function modalHTML(f) {
    const rows = [
      ['Type', `${KINDS[f.kind][0]}${f.ext ? ` · .${f.ext}` : ''}`],
      ['Size', formatBytes(f.size) || '—'],
      ['Updated', f.date ? dateFmt.format(f.date) : '—'],
      ['Version', f.version ? versionLabel(f.version) : '—'],
    ];
    if (f.category !== KINDS[f.kind][0]) rows.push(['Category', f.category]);
    const tags = tagsHTML(f);

    return `
      <div class="modal-inner">
        <button class="icon-btn modal-close" type="button" data-close aria-label="Close">${icon('close')}</button>
        <div class="modal-head">
          ${fileIconHTML(f, 'lg')}
          <div class="modal-heading">
            ${tags ? `<div class="card-tags">${tags}</div>` : ''}
            <h2 class="modal-title" id="modalTitle">${esc(f.title)}</h2>
            <p class="modal-file mono">${esc(f.filename)}</p>
          </div>
        </div>
        ${f.description ? `<p class="modal-desc">${esc(f.description)}</p>` : ''}
        ${hasPreview(f) ? '<section class="preview" data-preview aria-label="Build preview"></section>' : ''}
        <dl class="modal-info">
          ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}
        </dl>
        <div class="modal-actions">
          ${downloadLinkHTML(f, 'btn-lg', 'autofocus')}
          <button class="btn btn-ghost btn-lg" type="button" data-copy>${icon('link')}<span>Copy link</span></button>
        </div>
      </div>`;
  }

  const skeletonHTML = () => `
    <div class="card skeleton" aria-hidden="true">
      <div class="card-head"><span class="sk sk-icon"></span></div>
      <div class="card-body"><span class="sk sk-title"></span><span class="sk sk-line short"></span><span class="sk sk-line"></span></div>
      <div class="card-foot"><span class="sk sk-btn"></span></div>
    </div>`;

  function emptyHTML() {
    const isLocal = !IS_HTTP || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const hint = isLocal
      ? `Put files in the <code>${esc(FOLDER)}/</code> folder and list them in <code>config.js</code>.`
      : 'Nothing has been published here yet. Check back soon.';
    return `
      <div class="empty">
        <div class="empty-icon">${icon('inbox')}</div>
        <h3>No files yet</h3>
        <p>${hint}</p>
      </div>`;
  }

  const noResultsHTML = () => `
    <div class="empty">
      <div class="empty-icon">${icon('search')}</div>
      <h3>No matches${state.query.trim() ? ` for “${esc(state.query.trim())}”` : ''}</h3>
      <p>Try a different search term or clear the filters.</p>
      <button class="btn btn-ghost" type="button" data-reset>${icon('close')}<span>Clear filters</span></button>
    </div>`;

  /* ---------- Rendering ---------- */

  function createCard(f) {
    const tpl = document.createElement('template');
    tpl.innerHTML = cardHTML(f).trim();
    const card = tpl.content.firstElementChild;
    const settle = e => {
      if (e.target !== card) return;
      card.classList.add('is-in');   // stop the entrance animation replaying when cards are re-ordered
      card.removeEventListener('animationend', settle);
    };
    card.addEventListener('animationend', settle);
    return card;
  }

  /** Keyed render: reuses existing cards and glides them to their new spot (FLIP). */
  function renderCards(list) {
    const previous = new Map();
    $$('.card[data-key]', els.grid).forEach(el => previous.set(el.dataset.key, { el, rect: el.getBoundingClientRect() }));

    let fresh = 0;
    const nodes = list.map(f => {
      const prev = previous.get(f.key);
      if (prev) {
        const title = $('[data-open]', prev.el);
        const html = highlight(f.title);
        if (title.innerHTML !== html) title.innerHTML = html;
        return prev.el;
      }
      const card = createCard(f);
      card.style.setProperty('--i', Math.min(fresh++, 10));
      return card;
    });
    els.grid.replaceChildren(...nodes);

    if (reducedMotion.matches) return;
    nodes.forEach(el => {
      const prev = previous.get(el.dataset.key);
      if (!prev) return;
      const now = el.getBoundingClientRect();
      const dx = prev.rect.left - now.left;
      const dy = prev.rect.top - now.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)' },
        );
      }
    });
  }

  function update() {
    const list = visibleFiles();
    const total = state.files.length;
    els.meta.textContent = !total ? ''
      : list.length === total ? plural(total, 'file')
      : `Showing ${list.length} of ${total}`;

    if (!total) els.grid.innerHTML = emptyHTML();
    else if (!list.length) els.grid.innerHTML = noResultsHTML();
    else renderCards(list);
  }

  function renderChips() {
    const counts = new Map();
    state.files.forEach(f => counts.set(f.category, (counts.get(f.category) || 0) + 1));
    const categories = [['', 'All', state.files.length],
      ...[...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => [name, name, count])];

    els.chips.hidden = state.files.length === 0;
    els.chips.innerHTML = '<span class="chip-indicator" aria-hidden="true"></span>' + categories.map(([value, label, count]) => {
      const active = value === state.category;
      return `<button class="chip${active ? ' is-active' : ''}" type="button" data-cat="${esc(value)}" aria-pressed="${active}">
        ${esc(label)}<span class="chip-count">${count}</span>
      </button>`;
    }).join('');
    moveIndicator(false);
  }

  function moveIndicator(animate = true) {
    const indicator = $('.chip-indicator', els.chips);
    const active = $('.chip.is-active', els.chips);
    if (!indicator || !active) return;
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.height = `${active.offsetHeight}px`;
    indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    if (!animate) {
      indicator.getBoundingClientRect();   // apply the jump before re-enabling transitions
      indicator.style.transition = '';
    }
  }

  function setCategory(category) {
    state.category = category;
    $$('.chip', els.chips).forEach(chip => {
      const active = chip.dataset.cat === category;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active);
    });
    moveIndicator();
    update();
  }

  function setView(view, animate = true) {
    state.view = view;
    store.set('view', view);
    els.view.dataset.view = view;
    $$('button[data-view]', els.view).forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view));

    const apply = () => els.grid.classList.toggle('is-list', view === 'list');
    if (!animate) return apply();
    els.grid.classList.add('is-switching');
    setTimeout(() => {
      apply();
      requestAnimationFrame(() => els.grid.classList.remove('is-switching'));
    }, 180);
  }

  function renderStats() {
    const files = state.files;
    const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const latest = files.reduce((max, f) => (f.date && (!max || f.date > max) ? f.date : max), null);
    countUp($('#statCount'), files.length);
    $('#statSize').textContent = total ? formatBytes(total) : '—';
    $('#heroBadge').textContent = files.length ? `${plural(files.length, 'file')} ready to download` : 'Coming soon';
  }

  function countUp(el, target) {
    if (reducedMotion.matches || target < 2) { el.textContent = target; return; }
    const start = performance.now();
    const duration = 900;
    const tick = now => {
      const p = Math.min(1, (now - start) / duration);
      el.textContent = Math.round(target * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function applySiteText() {
    $$('[data-site]').forEach(el => {
      const value = SITE[el.dataset.site];
      if (value) el.textContent = value;
    });
    document.title = `${SITE.name} · ${SITE.tagline}`;
    $('#year').textContent = new Date().getFullYear();

    const repo = detectRepo();
    const githubUrl = SITE.githubUrl || (repo ? `https://github.com/${repo.user}/${repo.repo}` : '');
    if (githubUrl) $$('[data-github]').forEach(a => { a.href = githubUrl; a.hidden = false; });

    const nav = $('#navLinks');
    (SITE.links || []).forEach(({ label, url }) => {
      if (!label || !url) return;
      const a = document.createElement('a');
      a.href = url;
      a.textContent = label;
      if (/^https?:/i.test(url)) { a.target = '_blank'; a.rel = 'noopener'; }
      nav.appendChild(a);
    });
  }

  /* ---------- Feedback: toasts + button states ---------- */

  function toast(message, iconName = 'check', isError = false) {
    // The open dialog sits in the top layer, so toasts move inside it to stay visible
    const host = els.modal.open ? els.modal : document.body;
    if (els.toasts.parentNode !== host) host.appendChild(els.toasts);

    const el = document.createElement('div');
    el.className = `toast${isError ? ' is-error' : ''}`;
    el.innerHTML = `<span class="toast-icon">${icon(iconName)}</span><span>${esc(message)}</span>`;
    els.toasts.appendChild(el);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();

    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  function flash(btn, iconName, label) {
    clearTimeout(btn._flashTimer);
    if (btn._original == null) btn._original = btn.innerHTML;
    const hasLabel = btn._original.includes('<span');
    btn.innerHTML = icon(iconName) + (hasLabel ? `<span>${label}</span>` : '');
    btn.classList.add('is-done');
    btn._flashTimer = setTimeout(() => {
      btn.innerHTML = btn._original;
      btn.classList.remove('is-done');
    }, 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = Object.assign(document.createElement('textarea'), { value: text });
      area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* not supported */ }
      area.remove();
      return ok;
    }
  }

  function onDownload(btn, f) {
    flash(btn, 'check', f.external ? 'Opening' : 'Started');
    toast(f.external ? `Opening ${f.title}` : `Downloading ${f.filename}`, 'download');
  }

  async function onCopy(btn, f) {
    const ok = await copyText(new URL(f.href, location.href).href);
    flash(btn, ok ? 'check' : 'close', ok ? 'Copied' : 'Failed');
    toast(ok ? 'Link copied to clipboard' : 'Couldn’t copy the link', ok ? 'check' : 'close', !ok);
  }

  /* ---------- Dialog ---------- */

  let preview = null;   // the open 3D build preview, if any

  function openModal(f) {
    if (els.toasts.parentNode === els.modal) document.body.appendChild(els.toasts);
    els.modal.dataset.key = f.key;
    els.modal.innerHTML = modalHTML(f);
    els.modal.classList.remove('is-closing');
    els.modal.classList.toggle('has-preview', hasPreview(f));
    els.modal.showModal();
    const slot = $('[data-preview]', els.modal);
    if (slot) preview = window.LitematicPreview.mount(slot, f.href);
  }

  function closeModal() {
    if (!els.modal.open || els.modal.classList.contains('is-closing')) return;
    els.modal.classList.add('is-closing');
    setTimeout(() => els.modal.close(), 190);
  }

  /* ---------- Theme ---------- */

  function syncThemeUI() {
    const dark = root.dataset.theme !== 'light';
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.title = label;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  }

  function setTheme(theme, x, y) {
    const apply = () => {
      root.dataset.theme = theme;
      store.set('theme', theme);
      syncThemeUI();
    };
    if (!document.startViewTransition || reducedMotion.matches) return apply();   // soft colour fade instead

    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(() => {
      // Swap colours instantly underneath the circular reveal: disable CSS transitions
      // and flush styles in the same step so no colour fade can start.
      root.classList.add('theme-switching');
      apply();
      void document.body.offsetHeight;
    });
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
    transition.finished.finally(() => root.classList.remove('theme-switching'));
  }

  /* ---------- Access code gate ---------- */

  const UNLOCK_KEY = 'dlhub:unlock';
  const gate = {
    hash: String((SITE.accessCode || {}).hash || '').trim().toLowerCase(),
    length: Number((SITE.accessCode || {}).length) || 0,
    el: $('#gate'),
    form: $('#gateForm'),
    code: $('#code'),
    slots: $('#codeSlots'),
    input: $('#codeInput'),
    error: $('#gateError'),
    remember: $('#gateRemember'),
    reveal: $('#gateReveal'),
    submit: $('#gateSubmit'),
    lockBtn: $('#lockBtn'),
    revealed: false,
    busy: false,
    failures: 0,
    waiting: null,          // resolves the first unlock so the files can load
  };
  const useSlots = gate.length > 0 && gate.length <= 12;
  const isLocked = () => root.classList.contains('is-locked');
  const normalizeCode = value => value.replace(/\s+/g, '').toUpperCase();

  async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function buildSlots() {
    if (!useSlots) {
      gate.code.classList.add('is-plain');
      gate.input.type = 'password';
      gate.input.placeholder = 'Access code';
      return;
    }
    const split = gate.length >= 6 && gate.length % 2 === 0 ? gate.length / 2 : -1;
    gate.slots.innerHTML = Array.from({ length: gate.length }, (_, i) =>
      `${i === split ? '<span class="slot-sep"></span>' : ''}<span class="slot" style="--n:${i}"></span>`).join('');
  }

  function renderSlots() {
    if (!useSlots) return;
    const value = gate.input.value;
    const focused = document.activeElement === gate.input;
    $$('.slot', gate.slots).forEach((slot, i) => {
      const ch = value[i] || '';
      const key = `${ch}|${gate.revealed}`;
      if (slot.dataset.v !== key) {   // only touch changed boxes so just the new character pops in
        slot.dataset.v = key;
        slot.innerHTML = !ch ? ''
          : gate.revealed ? `<span class="slot-char">${esc(ch)}</span>`
          : '<span class="slot-char slot-dot"></span>';
      }
      slot.classList.toggle('is-filled', Boolean(ch));
      slot.classList.toggle('is-active', focused && !gate.busy && i === Math.min(value.length, gate.length - 1));
    });
  }

  function showGateError(message, clear = false) {
    gate.error.textContent = message;
    gate.code.classList.remove('is-error');
    void gate.code.offsetWidth;   // restart the shake animation
    gate.code.classList.add('is-error');
    if (!clear) return;
    setTimeout(() => {
      gate.input.value = '';
      renderSlots();
      if (!gate.input.disabled) gate.input.focus();
    }, 450);
  }

  function clearGateError() {
    gate.error.textContent = '';
    gate.code.classList.remove('is-error');
  }

  function startCooldown(seconds) {
    let left = seconds;
    gate.input.disabled = true;
    gate.submit.disabled = true;
    gate.input.value = '';
    renderSlots();
    gate.code.classList.add('is-error');
    const tick = () => {
      if (left === 0) {
        gate.failures = 0;
        gate.input.disabled = false;
        gate.submit.disabled = false;
        clearGateError();
        gate.input.focus();
        return;
      }
      gate.error.textContent = `Too many tries. Try again in ${left--}s.`;
      setTimeout(tick, 1000);
    };
    tick();
  }

  async function checkCode() {
    if (gate.busy || gate.input.disabled) return;
    const value = normalizeCode(gate.input.value);
    if (!value) return showGateError('Enter your access code to continue.');
    if (useSlots && value.length < gate.length) return showGateError(`The code is ${gate.length} characters long.`);

    gate.busy = true;
    let hash;
    try {
      hash = await sha256(value);
    } catch {
      gate.busy = false;
      return showGateError('This browser can’t check the code here. Open the site over https.');
    }
    if (hash === gate.hash) return unlock();

    gate.busy = false;
    gate.failures++;
    if (gate.failures >= 5) startCooldown(30);
    else showGateError('That code isn’t right. Try again.', true);
  }

  function resetGate() {
    gate.busy = false;
    gate.input.value = '';
    gate.el.classList.remove('is-success');
    gate.code.classList.remove('is-success');
    clearGateError();
    renderSlots();
  }

  function unlock() {
    try {
      (gate.remember.checked ? localStorage : sessionStorage).setItem(UNLOCK_KEY, gate.hash);
    } catch { /* storage blocked: stays unlocked until the page is closed */ }

    gate.el.classList.add('is-success');
    gate.code.classList.add('is-success');
    gate.input.blur();
    renderSlots();

    setTimeout(() => {
      gate.el.classList.add('is-leaving');   // card fades out while the site fades in underneath
      root.classList.remove('is-locked');
      setTimeout(() => { gate.el.classList.remove('is-leaving'); resetGate(); }, 600);
      if (gate.waiting) { gate.waiting(); gate.waiting = null; }
    }, 800);
  }

  function lockSite() {
    try {
      localStorage.removeItem(UNLOCK_KEY);
      sessionStorage.removeItem(UNLOCK_KEY);
    } catch { /* storage blocked */ }
    if (els.modal.open) els.modal.close();
    resetGate();
    root.classList.add('is-locked');
    scrollTo(0, 0);
    gate.input.focus();
  }

  /** Resolves once the visitor has entered the right code (straight away if there's no lock). */
  function setupGate() {
    if (!gate.hash) {
      root.classList.remove('is-locked');
      return Promise.resolve();
    }
    gate.lockBtn.hidden = false;
    buildSlots();
    renderSlots();

    gate.input.addEventListener('input', () => {
      const clean = normalizeCode(gate.input.value).slice(0, useSlots ? gate.length : undefined);
      if (clean !== gate.input.value) gate.input.value = clean;
      clearGateError();
      renderSlots();
      if (useSlots && clean.length === gate.length) checkCode();
    });
    gate.input.addEventListener('keydown', e => {
      // Keep the cursor at the end so the boxes always fill left to right
      if (useSlots && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) e.preventDefault();
    });
    gate.input.addEventListener('focus', renderSlots);
    gate.input.addEventListener('blur', renderSlots);
    gate.form.addEventListener('submit', e => { e.preventDefault(); checkCode(); });
    gate.reveal.addEventListener('click', () => {
      gate.revealed = !gate.revealed;
      gate.reveal.setAttribute('aria-pressed', gate.revealed);
      $('span', gate.reveal).textContent = gate.revealed ? 'Hide' : 'Show';
      if (!useSlots) gate.input.type = gate.revealed ? 'text' : 'password';
      renderSlots();
      gate.input.focus();
    });
    gate.lockBtn.addEventListener('click', lockSite);

    if (!isLocked()) return Promise.resolve();
    gate.input.focus();
    return new Promise(resolve => { gate.waiting = resolve; });
  }

  /* ---------- Events ---------- */

  function clearSearch() {
    els.search.value = '';
    state.query = '';
    els.searchWrap.classList.remove('has-value');
    update();
  }

  function onGridClick(e) {
    if (e.target.closest('[data-reset]')) {
      clearSearch();
      setCategory('');
      return;
    }
    const card = e.target.closest('.card[data-key]');
    const file = card && fileByKey.get(card.dataset.key);
    if (!file) return;
    const download = e.target.closest('[data-download]');
    const copyBtn = e.target.closest('[data-copy]');
    if (download) onDownload(download, file);
    else if (copyBtn) onCopy(copyBtn, file);
    else openModal(file);
  }

  function onModalClick(e) {
    if (e.target === els.modal || e.target.closest('[data-close]')) return closeModal();
    const file = fileByKey.get(els.modal.dataset.key);
    if (!file) return;
    const download = e.target.closest('[data-download]');
    const copyBtn = e.target.closest('[data-copy]');
    if (download) onDownload(download, file);
    else if (copyBtn) onCopy(copyBtn, file);
  }

  function onPointerMove(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    card.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }

  function onShortcut(e) {
    if (els.modal.open || e.defaultPrevented || isLocked()) return;
    const key = (e.key || '').toLowerCase();
    const active = document.activeElement;
    const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    const slash = key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
    const cmdK = key === 'k' && (e.ctrlKey || e.metaKey);
    if (!slash && !cmdK) return;

    e.preventDefault();
    const rect = els.search.getBoundingClientRect();
    if (rect.top < 90 || rect.bottom > innerHeight) {
      $('#files').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
    els.search.focus({ preventScroll: true });
  }

  function bindEvents() {
    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      els.searchWrap.classList.toggle('has-value', state.query !== '');
      update();
    });
    els.search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && els.search.value) { e.preventDefault(); clearSearch(); }
    });
    els.searchClear.addEventListener('click', e => {
      e.preventDefault();
      clearSearch();
      els.search.focus();
    });
    els.sort.addEventListener('change', () => { state.sort = els.sort.value; update(); });

    els.view.addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (btn && btn.dataset.view !== state.view) setView(btn.dataset.view);
    });
    els.chips.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      setCategory(chip.dataset.cat);
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });

    els.grid.addEventListener('click', onGridClick);
    els.grid.addEventListener('pointermove', onPointerMove);

    els.modal.addEventListener('click', onModalClick);
    els.modal.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
    els.modal.addEventListener('close', () => {
      els.modal.classList.remove('is-closing');
      if (els.toasts.parentNode === els.modal) document.body.appendChild(els.toasts);
      if (preview) { preview.destroy(); preview = null; }
    });

    els.themeToggle.addEventListener('click', () => {
      const rect = els.themeToggle.getBoundingClientRect();
      setTheme(root.dataset.theme === 'light' ? 'dark' : 'light', rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    document.addEventListener('keydown', onShortcut);

    const onScroll = () => els.nav.classList.toggle('is-scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    addEventListener('resize', () => moveIndicator(false));
    if (document.fonts) document.fonts.ready.then(() => moveIndicator(false));
  }

  /* ---------- Start ---------- */

  async function init() {
    applySiteText();
    syncThemeUI();
    setView(state.view, false);
    bindEvents();
    await setupGate();   // nothing is loaded until the right access code is entered

    // Only show the skeleton if loading takes a moment, and then long enough not to flicker
    let skeletonShownAt = 0;
    const skeletonTimer = setTimeout(() => {
      els.grid.innerHTML = Array.from({ length: 6 }, skeletonHTML).join('');
      skeletonShownAt = performance.now();
    }, 120);

    const files = await loadFiles();
    clearTimeout(skeletonTimer);
    if (skeletonShownAt) await sleep(Math.max(0, 450 - (performance.now() - skeletonShownAt)));

    state.files = files;
    fileByKey = new Map(files.map(f => [f.key, f]));
    renderStats();
    renderChips();
    update();
  }

  init();
})();
