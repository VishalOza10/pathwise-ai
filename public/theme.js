// Load before styles so a saved theme is applied before the first paint.
(() => {
  const key = 'pathwise-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Storage may be disabled. */ }
  const valid = value => value === 'dark' || value === 'light';
  if (!valid(preference)) preference = null;
  function sync() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = dark ? '☀ Light mode' : '☾ Dark mode';
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }
  function apply() {
    document.documentElement.dataset.theme = preference || (media.matches ? 'dark' : 'light');
    sync();
  }
  apply();
  document.addEventListener('DOMContentLoaded', sync);
  document.addEventListener('pathwise:render', sync);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, preference); } catch { /* Keep it for this page. */ }
    apply();
  });
  media.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    apply();
  });
})();
