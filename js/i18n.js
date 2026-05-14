/* ============================================================
   GREEN Worksheets — i18n
   Loads translations from /lang/{lang}.json and swaps
   the text of every element with a data-i18n attribute.

   Usage:
     i18n.buildSwitcher(document.getElementById('lang-switcher'));
     i18n.init();                  // load saved language
     i18n.onSwitch = function() {}; // optional callback after switch
   ============================================================ */

const i18n = (function() {

  // Language metadata. Add more here when new languages are added.
  // The 'flag' field is an inline SVG so the file works offline.
  const LANGS = [
    { code: 'en', name: 'English',    flag: flagSVG('en') },
    { code: 'is', name: 'Íslenska',   flag: flagSVG('is') },
    { code: 'pt', name: 'Português',  flag: flagSVG('pt') },
    { code: 'hr', name: 'Hrvatski',   flag: flagSVG('hr') },
    { code: 'tr', name: 'Türkçe',     flag: flagSVG('tr') },
    { code: 'nl', name: 'Nederlands', flag: flagSVG('nl') }
  ];

  const DEFAULT_LANG = 'en';
  const STORAGE_KEY  = 'green-ws-lang';

  let current = DEFAULT_LANG;
  let texts   = {};

  /* Resolve dot-notation keys like "hero.title" or "worksheets.w01.title" */
  function get(key) {
    return key.split('.').reduce((obj, k) => (obj == null ? undefined : obj[k]), texts);
  }

  /* Apply current texts to all [data-i18n] elements on the page. */
  function apply() {
    document.documentElement.lang = current;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key   = el.getAttribute('data-i18n');
      const value = get(key);
      if (value !== undefined && value !== null) {
        el.textContent = value;
      }
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      // data-i18n-attr="title:hero.title" → sets title attribute
      const spec = el.getAttribute('data-i18n-attr');
      spec.split(',').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        const value = get(key);
        if (value !== undefined) el.setAttribute(attr, value);
      });
    });
    document.querySelectorAll('.lang-flag').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.lang === current ? 'true' : 'false');
    });
    if (typeof i18n.onSwitch === 'function') i18n.onSwitch(current);
  }

  /* Fetch a language file. */
  async function load(lang) {
    try {
      // Find translations folder: pages at root use 'lang/',
      // pages in /ws/wsNN/ use '../../lang/'.
      const root = document.querySelector('[data-lang-root]')?.dataset.langRoot || 'lang/';
      const res  = await fetch(root + lang + '.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      texts   = await res.json();
      current = lang;
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
      apply();
    } catch (err) {
      console.warn(`[i18n] Could not load ${lang}.json:`, err.message);
      if (lang !== DEFAULT_LANG) {
        // Fall back to the reference language
        return load(DEFAULT_LANG);
      }
    }
  }

  /* Build the flag-picker inside a host element. */
  function buildSwitcher(host) {
    if (!host) return;
    host.classList.add('lang-switcher');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Language');
    host.innerHTML = LANGS.map(l =>
      `<button class="lang-flag" data-lang="${l.code}" title="${l.name}"
               aria-pressed="${l.code === current}">${l.flag}</button>`
    ).join('');
    host.querySelectorAll('.lang-flag').forEach(btn => {
      btn.addEventListener('click', () => load(btn.dataset.lang));
    });
  }

  /* Public init — load the saved (or default) language. */
  async function init() {
    let lang = DEFAULT_LANG;
    try { lang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG; } catch (_) {}
    await load(lang);
    return current;
  }

  /* ============ FLAG SVGs ============
     Tiny inline flag library so the site works offline. */
  function flagSVG(code) {
    const flags = {
      is: '<svg viewBox="0 0 25 18" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="25" height="18" fill="#02529c"/>' +
          '<rect x="7" width="3" height="18" fill="#fff"/>' +
          '<rect y="7.5" width="25" height="3" fill="#fff"/>' +
          '<rect x="8" width="1.5" height="18" fill="#dc1e35"/>' +
          '<rect y="8.25" width="25" height="1.5" fill="#dc1e35"/></svg>',
      en: '<svg viewBox="0 0 25 18" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="25" height="18" fill="#012169"/>' +
          '<path d="M0 0 L25 18 M25 0 L0 18" stroke="#fff" stroke-width="2"/>' +
          '<path d="M0 0 L25 18 M25 0 L0 18" stroke="#c8102e" stroke-width="1"/>' +
          '<path d="M12.5 0 V18 M0 9 H25" stroke="#fff" stroke-width="3"/>' +
          '<path d="M12.5 0 V18 M0 9 H25" stroke="#c8102e" stroke-width="1.8"/></svg>',
      pt: '<svg viewBox="0 0 25 18" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="10" height="18" fill="#046a38"/>' +
          '<rect x="10" width="15" height="18" fill="#da291c"/>' +
          '<circle cx="10" cy="9" r="3.2" fill="#fee100" stroke="#fff" stroke-width=".4"/></svg>',
      hr: '<svg viewBox="0 0 25 18" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="25" height="6" fill="#171796"/>' +
          '<rect y="6" width="25" height="6" fill="#fff"/>' +
          '<rect y="12" width="25" height="6" fill="#ff0000"/></svg>',
      tr: '<svg viewBox="0 0 25 18" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="25" height="18" fill="#e30a17"/>' +
          '<circle cx="9" cy="9" r="4" fill="#fff"/>' +
          '<circle cx="10" cy="9" r="3.2" fill="#e30a17"/>' +
          '<polygon points="13,9 16.8,7.8 14.5,11.1 14.5,6.9 16.8,10.2" fill="#fff"/></svg>',
      nl: '<svg viewBox="0 0 25 18" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="25" height="6" fill="#ae1c28"/>' +
          '<rect y="6" width="25" height="6" fill="#fff"/>' +
          '<rect y="12" width="25" height="6" fill="#21468b"/></svg>'
    };
    return flags[code] || '';
  }

  /* Render country flags into any [data-flag] element on the page.
     Used on the landing for the small flag on each worksheet card. */
  function renderFlags(scope) {
    (scope || document).querySelectorAll('[data-flag]').forEach(el => {
      if (el.dataset.rendered) return;       // already done
      const code = el.getAttribute('data-flag');
      el.innerHTML  = flagSVG(code);
      el.dataset.rendered = '1';
    });
  }

  /* ============ PUBLIC API ============ */
  return {
    init,
    load,
    buildSwitcher,
    renderFlags,
    get current() { return current; },
    get texts()   { return texts; },
    onSwitch:     null
  };

})();
