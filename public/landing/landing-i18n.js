(function () {
  'use strict';

  var SUPPORTED_LOCALES = [
    'ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW',
  ];
  var STORAGE_KEY = 'element-shot-landing-lang';

  /** Detect the best supported locale from the browser. */
  function detectLocale() {
    var raw = (navigator.language || 'en').toLowerCase();
    if (raw.indexOf('zh-tw') === 0 || raw.indexOf('zh-hk') === 0 || raw.indexOf('zh-mo') === 0) return 'zh_TW';
    if (raw.indexOf('zh') === 0) return 'zh_CN';
    if (raw.indexOf('pt') === 0) return 'pt_BR';
    var base = raw.slice(0, 2);
    return SUPPORTED_LOCALES.indexOf(base) >= 0 ? base : 'en';
  }

  /** Resolve a user "choice" (locale code or 'browser') to a concrete locale. */
  function resolveLocale(choice) {
    return !choice || choice === 'browser' ? detectLocale() : choice;
  }

  function getStoredChoice() {
    try { return window.localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
  }
  function setStoredChoice(choice) {
    try { window.localStorage.setItem(STORAGE_KEY, choice); } catch (_) { /* ignore */ }
  }

  /** Apply a messages dictionary to the DOM. */
  function applyMessages(messages) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var msg = messages[key];
      if (msg && msg.message) el.textContent = msg.message;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var msg = messages[key];
      if (msg && msg.message) el.innerHTML = msg.message;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      var msg = messages[key];
      if (msg && msg.message) el.setAttribute('title', msg.message);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      var msg = messages[key];
      if (msg && msg.message) el.setAttribute('aria-label', msg.message);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var msg = messages[key];
      if (msg && msg.message) el.setAttribute('placeholder', msg.message);
    });

    var titleMsg = messages['landingTitle'];
    if (titleMsg && titleMsg.message) document.title = titleMsg.message;

    var descEl = document.querySelector('meta[name="description"]');
    var descMsg = messages['landingDescription'];
    if (descEl && descMsg && descMsg.message) descEl.setAttribute('content', descMsg.message);
  }

  var cache = {};
  /** Fetch locale JSON with a fallback chain and cache the result. */
  async function loadMessages(locale) {
    if (cache[locale]) return cache[locale];
    var candidates = [locale];
    if (locale.indexOf('_') > 0) candidates.push(locale.split('_')[0]);
    if (locale !== 'en') candidates.push('en');
    for (var i = 0; i < candidates.length; i++) {
      try {
        var resp = await fetch('../_locales/' + candidates[i] + '/messages.json');
        if (resp.ok) {
          var messages = await resp.json();
          cache[candidates[i]] = messages;
          return messages;
        }
      } catch (_) { /* try next candidate */ }
    }
    return {};
  }

  /** Load + apply a locale, updating <html lang>. */
  async function applyLocale(locale) {
    document.documentElement.lang = locale.replace('_', '-');
    var messages = await loadMessages(locale);
    applyMessages(messages);
  }

  /** Wire the manual <select> switcher to re-apply on change. */
  function wireSwitcher() {
    var sel = document.querySelector('[data-lang-switch]');
    if (!sel) return;
    sel.value = getStoredChoice() || 'browser';
    sel.addEventListener('change', function () {
      var choice = sel.value;
      setStoredChoice(choice);
      applyLocale(resolveLocale(choice));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSwitcher);
  } else {
    wireSwitcher();
  }

  // Initial load: honor a stored manual choice, otherwise auto-detect.
  applyLocale(resolveLocale(getStoredChoice()));
})();
