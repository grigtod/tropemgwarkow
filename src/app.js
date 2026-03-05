import { createMap } from "./map.js";
import { createI18n } from "./i18n.js";

const LANDING_SEEN_KEY = "discoverTG.landingSeen.v1";

function id(name) {
  const el = document.getElementById(name);
  if (!el) throw new Error(`Missing element with id="${name}"`);
  return el;
}

function hasSeenLanding() {
  try {
    return localStorage.getItem(LANDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markLandingSeen() {
  try {
    localStorage.setItem(LANDING_SEEN_KEY, "1");
  } catch {
    // Ignore storage failures.
  }
}

function setLandingHidden(ui, hidden) {
  ui.landingOverlay.classList.toggle("landing-hidden", hidden);
  ui.landingOverlay.setAttribute("aria-hidden", hidden ? "true" : "false");
}

function applyLandingText(ui, i18n) {
  ui.landingTitle.textContent = i18n.t("app.landing.title", "Discover Tarnowskie Gory");
  ui.landingLead.textContent = i18n.t(
    "app.landing.lead",
    "Explore points of interest, historic routes, and map layers in an interactive city guide."
  );
  ui.landingHint.textContent = i18n.t(
    "app.landing.hint",
    "You can reopen information anytime using the i button."
  );
  ui.landingStartBtn.textContent = i18n.t("app.landing.start", "Start exploring");
  ui.landingCloseBtn.setAttribute("aria-label", i18n.t("app.landing.close", "Close intro"));
}

function waitForLandingDismiss(ui) {
  return new Promise((resolve) => {
    const close = () => {
      markLandingSeen();
      setLandingHidden(ui, true);
      ui.landingStartBtn.removeEventListener("click", close);
      ui.landingCloseBtn.removeEventListener("click", close);
      ui.landingOverlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeyDown);
      resolve();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };

    const onOverlayClick = (event) => {
      if (event.target === ui.landingOverlay) close();
    };

    ui.landingStartBtn.addEventListener("click", close);
    ui.landingCloseBtn.addEventListener("click", close);
    ui.landingOverlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const ui = {
    // landing
    landingOverlay: id("landingOverlay"),
    landingTitle: id("landingTitle"),
    landingLead: id("landingLead"),
    landingHint: id("landingHint"),
    landingStartBtn: id("landingStartBtn"),
    landingCloseBtn: id("landingCloseBtn"),

    // overlay
    poiOverlay: id("poiOverlay"),
    poiOverlayFrame: id("poiOverlayFrame"),
    poiOverlayClose: id("poiOverlayClose"),
    poiCompleteBtn: id("poiCompleteBtn"),
    poiCompleteLabel: id("poiCompleteLabel"),
    infoOverlay: id("infoOverlay"),
    infoOverlayFrame: id("infoOverlayFrame"),
    infoOverlayClose: id("infoOverlayClose"),
    infoCreditsBtn: id("infoCreditsBtn"),
    infoFeatureBtn: id("infoFeatureBtn"),

    // banners
    locationBanner: id("locationBanner"),
    bannerText: id("bannerText"),
    layersBanner: id("layersBanner"),
    languageMenu: id("languageMenu"),
    languageMenuTitle: id("languageMenuTitle"),
    languageOptions: id("languageOptions"),

    // buttons
    languageBtn: id("languageBtn"),
    myLocationBtn: id("myLocationBtn"),
    centerBtn: id("centerBtn"),
    grantLocationBtn: id("grantLocationBtn"),
    dismissBannerBtn: id("dismissBannerBtn"),
    layersShowBtn: id("layersShowBtn"),
    infoBtn: id("infoBtn"),
    styleToggleBtn: id("styleToggleBtn"),
    toggleImageOverlayBtn: id("toggleImageOverlayBtn")
  };

  const i18n = createI18n();
  await i18n.init();
  applyLandingText(ui, i18n);

  if (!hasSeenLanding()) {
    setLandingHidden(ui, false);
    await waitForLandingDismiss(ui);
  } else {
    setLandingHidden(ui, true);
  }

  const api = createMap({
    mapElId: "map",
    ui,
    i18n
  });

  // If you ever need access from the console while debugging:
  // window.__mapApi = api;
});
