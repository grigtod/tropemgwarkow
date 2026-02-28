import { createMap } from "./map.js";
import { createI18n } from "./i18n.js";

function id(name) {
  const el = document.getElementById(name);
  if (!el) throw new Error(`Missing element with id="${name}"`);
  return el;
}

document.addEventListener("DOMContentLoaded", async () => {
  const ui = {
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
    infoCoffeeBtn: id("infoCoffeeBtn"),
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

  const api = createMap({
    mapElId: "map",
    ui,
    i18n
  });

  // If you ever need access from the console while debugging:
  // window.__mapApi = api;
});
