export const LANGUAGE_STORAGE_KEY = "discoverTG.language";
export const DEFAULT_LANGUAGE = "en";

export const SUPPORTED_LANGUAGES = [
  { code: "pl", flag: "🇵🇱", name: "Polski" },
  { code: "en", flag: "\u{1F1EC}\u{1F1E7}", name: "English" },
  { code: "de", flag: "\u{1F1E9}\u{1F1EA}", name: "Deutsch" },
  { code: "es", flag: "\u{1F1EA}\u{1F1F8}", name: "Espa\u00F1ol" },
  { code: "fr", flag: "\u{1F1EB}\u{1F1F7}", name: "Fran\u00E7ais" },
  { code: "uk", flag: "\u{1F1FA}\u{1F1E6}", name: "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430" }
];

const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES.map((lang) => lang.code));

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function interpolate(template, vars = {}) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function normalizeLanguageCode(input) {
  if (!input) return null;

  const normalized = String(input)
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");

  if (SUPPORTED_LANGUAGE_SET.has(normalized)) return normalized;

  const shortCode = normalized.split("-")[0];
  if (shortCode === "ua") return "uk";
  if (SUPPORTED_LANGUAGE_SET.has(shortCode)) return shortCode;

  return null;
}

function readStoredLanguage() {
  try {
    return normalizeLanguageCode(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStoredLanguage(language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
}

export function resolveLanguage(explicitLanguage = null) {
  const explicit = normalizeLanguageCode(explicitLanguage);
  if (explicit) return explicit;

  const stored = readStoredLanguage();
  if (stored) return stored;

  const browserCandidates = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];

  for (const candidate of browserCandidates) {
    const normalized = normalizeLanguageCode(candidate);
    if (normalized) return normalized;
  }

  return DEFAULT_LANGUAGE;
}

async function loadLocaleFile(language) {
  const localeUrl = new URL(`../locales/${language}.json`, import.meta.url);
  const response = await fetch(localeUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load locale ${language}: HTTP ${response.status}`);
  }
  return await response.json();
}

function buildUrlWithLanguage(url, language) {
  try {
    const parsed = new URL(url, window.location.href);
    const isLocalHtml =
      parsed.origin === window.location.origin && /\.html?$/i.test(parsed.pathname);
    if (isLocalHtml) parsed.searchParams.set("lang", language);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function createI18n() {
  let language = resolveLanguage();
  let activeDictionary = {};
  let fallbackDictionary = {};
  const listeners = new Set();

  async function ensureDictionaries(nextLanguage) {
    if (!Object.keys(fallbackDictionary).length) {
      fallbackDictionary = await loadLocaleFile(DEFAULT_LANGUAGE);
    }

    if (nextLanguage === DEFAULT_LANGUAGE) {
      activeDictionary = fallbackDictionary;
      return;
    }

    activeDictionary = await loadLocaleFile(nextLanguage);
  }

  async function init() {
    await ensureDictionaries(language);
    writeStoredLanguage(language);
    return language;
  }

  async function setLanguage(nextLanguage) {
    const resolved = normalizeLanguageCode(nextLanguage) || DEFAULT_LANGUAGE;
    if (resolved === language && Object.keys(activeDictionary).length) return language;

    language = resolved;
    await ensureDictionaries(language);
    writeStoredLanguage(language);

    listeners.forEach((listener) => listener(language));
    return language;
  }

  function getLanguage() {
    return language;
  }

  function t(key, fallback = key, vars = {}) {
    const fromActive = getPath(activeDictionary, key);
    const fromFallback = getPath(fallbackDictionary, key);
    const value = fromActive ?? fromFallback ?? fallback;
    return interpolate(value, vars);
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function localizeUrl(url) {
    return buildUrlWithLanguage(url, language);
  }

  function listLanguages() {
    return SUPPORTED_LANGUAGES.slice();
  }

  return {
    init,
    setLanguage,
    getLanguage,
    t,
    onChange,
    localizeUrl,
    listLanguages
  };
}
