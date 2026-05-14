/* ============================================================
   GREEN Worksheets — theme (light/dark)
   ============================================================ */

const theme = (function() {
  const STORAGE_KEY = 'green-ws-theme';

  function get() {
    try { return localStorage.getItem(STORAGE_KEY) || 'light'; }
    catch (_) { return 'light'; }
  }

  function set(value) {
    document.documentElement.setAttribute('data-theme', value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = value === 'dark' ? '☀️' : '🌙';
  }

  function init() { set(get()); }

  function toggle() { set(get() === 'dark' ? 'light' : 'dark'); }

  return { init, toggle };
})();
