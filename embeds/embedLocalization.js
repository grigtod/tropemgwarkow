import { createI18n } from "../src/i18n.js";

function applyTranslations(root, i18n) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = i18n.t(key, el.textContent || "");
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    const fallback = el.getAttribute("placeholder") || "";
    el.setAttribute("placeholder", i18n.t(key, fallback));
  });

  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    if (!key) return;
    const fallback = el.getAttribute("aria-label") || "";
    el.setAttribute("aria-label", i18n.t(key, fallback));
  });
}

export async function initEmbedLocalization({ titleKey = null, titleFallback = null } = {}) {
  const i18n = createI18n();
  await i18n.init();

  const queryLang = new URLSearchParams(window.location.search).get("lang");
  if (queryLang) await i18n.setLanguage(queryLang);

  applyTranslations(document, i18n);

  if (titleKey) {
    document.title = i18n.t(titleKey, titleFallback || document.title);
  }

  return {
    i18n,
    t: (key, fallback, vars) => i18n.t(key, fallback, vars),
    apply: () => applyTranslations(document, i18n)
  };
}
