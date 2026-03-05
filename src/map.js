import config from "./config.js";
import { createPoiOverlay } from "./overlay.js";
import { loadAllPois } from "./poiData.js";
import { createPoiLayer } from "./poiLayer.js";
import { addKmzPathLayer } from "./pathLayer.js";

export function createMap({ mapElId = "map", ui, i18n } = {}) {
  if (!ui) throw new Error("createMap requires { ui }");
  if (!i18n) throw new Error("createMap requires { i18n }");

  const center = L.latLng(config.targetLat, config.targetLon);
  const bounds = center.toBounds(config.radiusMeters * 2);
  const platform =
    navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  const isWindows = /win/i.test(platform);
  const isMobileViewport = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
  const cityCenterZoom = 18;
  const initialZoom = isMobileViewport ? cityCenterZoom : config.startZoom;
  const zoomSnap = isWindows ? 0.5 : 0.1;
  const zoomDelta = isWindows ? 0.5 : 0.1;
  const wheelDebounceTime = isWindows ? 20 : 40;
  const wheelPxPerZoomLevel = isWindows ? 40 : 60;

  const map = L.map(mapElId, {
    center,
    zoom: initialZoom,
    maxBounds: bounds,
    maxBoundsViscosity: 0.1,
    zoomSnap,
    zoomDelta,
    wheelDebounceTime,
    wheelPxPerZoomLevel
  });

  map.zoomControl.remove();
  map.doubleClickZoom.disable();
  map.options.doubleClickZoom = false;
  map.options.tapTolerance = 15;

  function enableSingleFingerTapHoldZoom() {
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const container = map.getContainer();
    const maxTapDelayMs = 350;
    const maxTapTravelPx = 10;
    const maxTapDistancePx = 40;
    const zoomPixelsPerLevel = 120;
    const minZoomStep = 0.2;
    const gestureFrameMs = 33;

    let touchStartTime = 0;
    let touchStartPoint = null;
    let touchMoved = false;
    let lastTapTime = 0;
    let lastTapPoint = null;
    let gestureActive = false;
    let gestureTouchId = null;
    let gestureStartY = 0;
    let gestureStartZoom = 0;
    let gestureAnchor = null;
    let draggingWasEnabled = true;
    let pendingGestureZoom = null;
    let appliedGestureZoom = null;
    let gestureRafId = 0;
    let lastGestureFrameTime = 0;

    function distance(a, b) {
      if (!a || !b) return Infinity;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function findTouchById(touchList, touchId) {
      for (let i = 0; i < touchList.length; i += 1) {
        if (touchList[i].identifier === touchId) return touchList[i];
      }
      return null;
    }

    function stopGesture() {
      if (!gestureActive) return;
      gestureActive = false;
      gestureTouchId = null;
      pendingGestureZoom = null;
      appliedGestureZoom = null;
      lastGestureFrameTime = 0;
      if (gestureRafId) {
        cancelAnimationFrame(gestureRafId);
        gestureRafId = 0;
      }
      if (draggingWasEnabled) map.dragging.enable();
    }

    function applyGestureZoomIfNeeded(now) {
      if (!gestureActive || pendingGestureZoom === null || !gestureAnchor) {
        gestureRafId = 0;
        return;
      }

      if (now - lastGestureFrameTime < gestureFrameMs) {
        gestureRafId = requestAnimationFrame(applyGestureZoomIfNeeded);
        return;
      }

      const shouldApply =
        appliedGestureZoom === null || Math.abs(pendingGestureZoom - appliedGestureZoom) >= minZoomStep;

      if (shouldApply) {
        map.setZoomAround(gestureAnchor, pendingGestureZoom, { animate: false });
        appliedGestureZoom = pendingGestureZoom;
        lastGestureFrameTime = now;
      }

      gestureRafId = requestAnimationFrame(applyGestureZoomIfNeeded);
    }

    container.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 1) {
          stopGesture();
          return;
        }

        const touch = event.touches[0];
        const currentPoint = { x: touch.clientX, y: touch.clientY };
        const now = Date.now();

        touchStartTime = now;
        touchStartPoint = currentPoint;
        touchMoved = false;

        if (now - lastTapTime <= maxTapDelayMs && distance(currentPoint, lastTapPoint) <= maxTapDistancePx) {
          gestureActive = true;
          gestureTouchId = touch.identifier;
          gestureStartY = touch.clientY;
          gestureStartZoom = map.getZoom();
          gestureAnchor = map.mouseEventToLatLng(touch);
          appliedGestureZoom = gestureStartZoom;
          pendingGestureZoom = gestureStartZoom;
          lastGestureFrameTime = 0;
          draggingWasEnabled = map.dragging.enabled();
          if (draggingWasEnabled) map.dragging.disable();
          if (!gestureRafId) {
            gestureRafId = requestAnimationFrame(applyGestureZoomIfNeeded);
          }
          event.preventDefault();
        }
      },
      { passive: false }
    );

    container.addEventListener(
      "touchmove",
      (event) => {
        if (!touchStartPoint || event.touches.length !== 1) return;

        const currentTouch = gestureActive
          ? findTouchById(event.touches, gestureTouchId)
          : event.touches[0];

        if (!currentTouch) return;

        const currentPoint = { x: currentTouch.clientX, y: currentTouch.clientY };
        if (distance(currentPoint, touchStartPoint) > maxTapTravelPx) {
          touchMoved = true;
        }

        if (!gestureActive) return;

        const zoomDelta = (gestureStartY - currentTouch.clientY) / zoomPixelsPerLevel;
        const nextZoom = Math.max(config.minZoom, Math.min(config.maxZoom, gestureStartZoom + zoomDelta));
        pendingGestureZoom = nextZoom;
        event.preventDefault();
      },
      { passive: false }
    );

    container.addEventListener(
      "touchend",
      (event) => {
        const now = Date.now();
        const touchDuration = now - touchStartTime;

        if (gestureActive && findTouchById(event.changedTouches, gestureTouchId)) {
          stopGesture();
          lastTapTime = 0;
          lastTapPoint = null;
          return;
        }

        if (!gestureActive && !touchMoved && touchDuration <= maxTapDelayMs && touchStartPoint) {
          lastTapTime = now;
          lastTapPoint = touchStartPoint;
          return;
        }

        lastTapTime = 0;
        lastTapPoint = null;
      },
      { passive: true }
    );

    container.addEventListener("touchcancel", stopGesture, { passive: true });
  }

  enableSingleFingerTapHoldZoom();

  function disableMapInteractions() {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  }

  function enableMapInteractions() {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
  }

  const overlay = createPoiOverlay({
    overlayEl: ui.poiOverlay,
    frameEl: ui.poiOverlayFrame,
    closeBtnEl: ui.poiOverlayClose,
    completeBtnEl: ui.poiCompleteBtn,
    completeLabelEl: ui.poiCompleteLabel,
    onOpen: disableMapInteractions,
    onClose: enableMapInteractions,
    translate: (key, fallback, vars) => i18n.t(key, fallback, vars),
    localizeUrl: (url) => i18n.localizeUrl(url)
  });

  const minimalistLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: config.maxZoom,
      minZoom: config.minZoom,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
    }
  );

  const detailedLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: config.maxZoom,
      minZoom: config.minZoom,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  );

  let currentBaseLayer = "minimalist";
  minimalistLayer.addTo(map);

  const imageOverlay = L.imageOverlay(
    "overlays/overlayMapTunnels.png",
    [
      [50.40126, 18.78499],
      [50.46909, 18.86915]
    ],
    { opacity: 1 }
  );
  let imageOverlayVisible = false;

  const layersTitle = ui.layersBanner.querySelector(".layers-title");
  const baseMapTitle = ui.styleToggleBtn.querySelector(".layer-tile-title");
  const styleSubtitle = ui.styleToggleBtn.querySelector(".layer-tile-subtitle");
  const tunnelsTitle = ui.toggleImageOverlayBtn.querySelector(".layer-tile-title");
  const tunnelsSubtitle = ui.toggleImageOverlayBtn.querySelector(".layer-tile-subtitle");

  let layersVisible = false;
  let languageMenuVisible = false;
  const LANGUAGE_TO_COUNTRY = {
    en: "gb",
    pl: "pl",
    de: "de",
    es: "es",
    fr: "fr",
    uk: "ua"
  };

  function hideLayers() {
    ui.layersBanner.classList.add("layers-hidden");
  }

  function showLayers() {
    ui.layersBanner.classList.remove("layers-hidden");
  }

  function tryHideLayers() {
    if (!layersVisible) return;
    layersVisible = false;
    hideLayers();
  }

  function hideLanguageMenu() {
    languageMenuVisible = false;
    ui.languageMenu.classList.add("language-menu-hidden");
  }

  function showLanguageMenu() {
    languageMenuVisible = true;
    ui.languageMenu.classList.remove("language-menu-hidden");
  }

  function getLanguageFlagUrl(code) {
    const country = LANGUAGE_TO_COUNTRY[code] || "gb";
    return `https://flagcdn.com/${country}.svg`;
  }

  function createLanguageFlagElement(language, className) {
    const wrapper = document.createElement("span");
    wrapper.className = className;

    const img = document.createElement("img");
    img.className = "language-flag-img";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.src = getLanguageFlagUrl(language.code);
    img.loading = "lazy";

    img.addEventListener("error", () => {
      wrapper.textContent = language.flag || language.code.toUpperCase();
    });

    wrapper.append(img);
    return wrapper;
  }

  function setLanguageButtonAppearance() {
    const language = i18n.listLanguages().find((item) => item.code === i18n.getLanguage());
    const defaultLanguage = i18n.listLanguages().find((item) => item.code === "en");
    const selectedLanguage = language || defaultLanguage || { code: "en", flag: "\u{1F1EC}\u{1F1E7}" };
    ui.languageBtn.replaceChildren(createLanguageFlagElement(selectedLanguage, "language-btn-flag"));
    ui.languageBtn.setAttribute("title", language?.name ?? i18n.getLanguage());
    ui.languageBtn.setAttribute("aria-label", i18n.t("app.language.openMenu", "Choose language"));
  }

  async function onLanguageSelected(code) {
    await i18n.setLanguage(code);
    hideLanguageMenu();
  }

  function renderLanguageOptions() {
    ui.languageOptions.textContent = "";
    const selected = i18n.getLanguage();

    i18n.listLanguages().forEach((language) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-option";
      if (language.code === selected) button.classList.add("is-active");
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", language.code === selected ? "true" : "false");
      button.addEventListener("click", () => onLanguageSelected(language.code));

      const flag = createLanguageFlagElement(language, "language-option-flag");

      const name = document.createElement("span");
      name.className = "language-option-name";
      name.textContent = language.name;

      button.append(flag, name);
      ui.languageOptions.append(button);
    });
  }

  const infoPages = {
    credits: "./embeds/info-credits.html",
    feature: "./embeds/info-feature.html"
  };
  let activeInfoPage = "credits";

  function setInfoTab(activeKey) {
    const tabMap = {
      credits: ui.infoCreditsBtn,
      feature: ui.infoFeatureBtn
    };

    Object.entries(tabMap).forEach(([key, el]) => {
      const isActive = key === activeKey;
      el.classList.toggle("is-active", isActive);
      el.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function setInfoHidden(hidden) {
    ui.infoOverlay.classList.toggle("poi-overlay-hidden", hidden);
    ui.infoOverlay.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  function openInfoPage(pageKey = "credits") {
    const nextKey = infoPages[pageKey] ? pageKey : "credits";
    activeInfoPage = nextKey;
    setInfoTab(nextKey);
    ui.infoOverlayFrame.src = i18n.localizeUrl(infoPages[nextKey]);
    setInfoHidden(false);
  }

  function closeInfoOverlay() {
    ui.infoOverlayFrame.src = "about:blank";
    setInfoHidden(true);
  }

  function updateLayerSubtitles() {
    if (styleSubtitle) {
      styleSubtitle.textContent =
        currentBaseLayer === "minimalist"
          ? i18n.t("app.layers.styleMinimal", "Minimal")
          : i18n.t("app.layers.styleDetailed", "Detailed");
    }

    if (tunnelsSubtitle) {
      tunnelsSubtitle.textContent = imageOverlayVisible
        ? i18n.t("app.layers.on", "On")
        : i18n.t("app.layers.off", "Off");
    }
  }

  function applyStaticTranslations() {
    ui.languageMenuTitle.textContent = i18n.t("app.language.menuTitle", "Language");
    layersTitle.textContent = i18n.t("app.layers.title", "Map Layers");
    baseMapTitle.textContent = i18n.t("app.layers.baseMap", "Base map");
    tunnelsTitle.textContent = i18n.t("app.layers.tunnelsOverlay", "Tunnels Overlay");
    ui.poiOverlayClose.textContent = i18n.t("app.poi.cancel", "Cancel");
    ui.infoOverlayClose.textContent = i18n.t("app.info.close", "Close");
    ui.infoCreditsBtn.textContent = i18n.t("app.info.tabs.credits", "Credits");
    ui.infoFeatureBtn.textContent = i18n.t("app.info.tabs.feature", "Contact");
    ui.dismissBannerBtn.textContent = i18n.t("app.location.dismiss", "Dismiss");

    ui.myLocationBtn.setAttribute("aria-label", i18n.t("app.controls.myLocation", "My location"));
    ui.centerBtn.setAttribute("aria-label", i18n.t("app.controls.centerCity", "Center city"));
    ui.layersShowBtn.setAttribute("aria-label", i18n.t("app.controls.layers", "Map layers"));
    ui.infoBtn.setAttribute("aria-label", i18n.t("app.controls.info", "Information"));
    ui.languageMenu.setAttribute("aria-label", i18n.t("app.language.menuTitle", "Language"));
    ui.languageOptions.setAttribute("aria-label", i18n.t("app.language.menuTitle", "Languages"));

    setLanguageButtonAppearance();
    renderLanguageOptions();
    updateLayerSubtitles();
    refreshLocationBanner();
    overlay.syncCompleteUi();
  }

  ui.layersShowBtn.addEventListener("click", () => {
    hideLanguageMenu();
    layersVisible = !layersVisible;
    if (layersVisible) showLayers();
    else hideLayers();
  });

  ui.languageBtn.addEventListener("click", () => {
    tryHideLayers();
    languageMenuVisible ? hideLanguageMenu() : showLanguageMenu();
  });

  ui.infoBtn.addEventListener("click", () => {
    hideLanguageMenu();
    tryHideLayers();
    overlay.close();
    openInfoPage(activeInfoPage);
  });

  ui.infoOverlayClose.addEventListener("click", closeInfoOverlay);
  ui.infoCreditsBtn.addEventListener("click", () => openInfoPage("credits"));
  ui.infoFeatureBtn.addEventListener("click", () => openInfoPage("feature"));

  ui.toggleImageOverlayBtn.addEventListener("click", () => {
    hideLanguageMenu();
    if (imageOverlayVisible) {
      map.removeLayer(imageOverlay);
      imageOverlayVisible = false;
      ui.toggleImageOverlayBtn.classList.remove("is-active");
    } else {
      imageOverlay.addTo(map);
      map.setZoom(12);
      imageOverlayVisible = true;
      ui.toggleImageOverlayBtn.classList.add("is-active");
    }
    updateLayerSubtitles();
  });

  ui.styleToggleBtn.addEventListener("click", () => {
    hideLanguageMenu();
    if (currentBaseLayer === "minimalist") {
      map.removeLayer(minimalistLayer);
      detailedLayer.addTo(map);
      currentBaseLayer = "detailed";
      ui.styleToggleBtn.classList.add("is-active");
    } else {
      map.removeLayer(detailedLayer);
      minimalistLayer.addTo(map);
      currentBaseLayer = "minimalist";
      ui.styleToggleBtn.classList.remove("is-active");
    }
    updateLayerSubtitles();
  });

  function onMapBackgroundInteraction() {
    hideLanguageMenu();
    tryHideLayers();
  }

  map.getContainer().addEventListener("mousedown", onMapBackgroundInteraction, { passive: true });
  map.getContainer().addEventListener("touchstart", onMapBackgroundInteraction, { passive: true });

  document.addEventListener("click", (event) => {
    if (!languageMenuVisible) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (ui.languageBtn.contains(target) || ui.languageMenu.contains(target)) return;
    hideLanguageMenu();
  });

  const poiLayer = createPoiLayer({
    map,
    overlay,
    labelZoomThreshold: 18,
    translate: (key, fallback, vars) => i18n.t(key, fallback, vars)
  });

  loadAllPois()
    .then((pois) => poiLayer.setPois(pois))
    .catch((err) => console.error("POI load failed:", err));

  addKmzPathLayer({
    map,
    url: "data/path/Test1.kmz",
    style: {
      color: "#0f172a",
      weight: 4,
      opacity: 0.95
    },
    fitBounds: false
  }).catch((err) => console.error("Path load failed:", err));

  document.addEventListener("poi:complete-changed", () => poiLayer.updateIcons());

  ui.centerBtn.addEventListener("click", () => {
    hideLanguageMenu();
    map.setView(center, cityCenterZoom);
    tryHideLayers();
  });

  let isRequestInFlight = false;
  let hasLocationPermission = false;
  let userMarker = null;
  let bannerState = "hidden";
  let bannerMessageKey = null;

  function hideLocationBanner() {
    bannerState = "hidden";
    bannerMessageKey = null;
    ui.locationBanner.classList.add("banner-hidden");
    ui.locationBanner.classList.remove("banner-notice");
  }

  function refreshLocationBanner() {
    if (bannerState === "hidden") return;

    ui.dismissBannerBtn.textContent = i18n.t("app.location.dismiss", "Dismiss");
    ui.grantLocationBtn.textContent = isRequestInFlight
      ? i18n.t("app.location.requesting", "Requesting...")
      : i18n.t("app.location.allow", "Allow location");

    if (bannerState === "prompt") {
      ui.bannerText.textContent = i18n.t("app.location.prompt", "Allow location access to use My Location.");
      return;
    }

    if (bannerState === "notice") {
      ui.bannerText.textContent = i18n.t(
        bannerMessageKey || "app.location.failed",
        "Location access failed. You can try again from your browser settings."
      );
    }
  }

  function showLocationPrompt() {
    bannerState = "prompt";
    bannerMessageKey = null;
    ui.grantLocationBtn.classList.remove("banner-btn-hidden");
    ui.grantLocationBtn.disabled = isRequestInFlight;
    ui.dismissBannerBtn.classList.remove("banner-btn-hidden");
    ui.locationBanner.classList.remove("banner-hidden", "banner-notice");
    refreshLocationBanner();
  }

  function showLocationNotice(messageKey) {
    bannerState = "notice";
    bannerMessageKey = messageKey;
    ui.grantLocationBtn.classList.add("banner-btn-hidden");
    ui.grantLocationBtn.disabled = false;
    ui.dismissBannerBtn.classList.remove("banner-btn-hidden");
    ui.locationBanner.classList.remove("banner-hidden");
    ui.locationBanner.classList.add("banner-notice");
    refreshLocationBanner();
  }

  function enableMyLocation() {
    hasLocationPermission = true;
    ui.myLocationBtn.disabled = false;
  }

  function disableMyLocation() {
    hasLocationPermission = false;
    ui.myLocationBtn.disabled = true;
  }

  function updateUserMarker(latlng) {
    if (!userMarker) {
      userMarker = L.circleMarker(latlng, {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#0078ff",
        fillOpacity: 0.95
      }).addTo(map);
      return;
    }
    userMarker.setLatLng(latlng);
  }

  function permissionErrorKey(error) {
    if (!error || typeof error.code !== "number") return "app.location.failed";
    if (error.code === error.PERMISSION_DENIED) return "app.location.denied";
    if (error.code === error.POSITION_UNAVAILABLE) return "app.location.unavailable";
    if (error.code === error.TIMEOUT) return "app.location.timeout";
    return "app.location.failed";
  }

  function requestLocationPermission() {
    if (!navigator.geolocation || isRequestInFlight) return;
    isRequestInFlight = true;
    ui.grantLocationBtn.disabled = true;
    refreshLocationBanner();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        isRequestInFlight = false;
        enableMyLocation();
        hideLocationBanner();
        updateUserMarker(L.latLng(position.coords.latitude, position.coords.longitude));
      },
      (error) => {
        isRequestInFlight = false;
        disableMyLocation();
        showLocationNotice(permissionErrorKey(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  ui.grantLocationBtn.addEventListener("click", requestLocationPermission);
  ui.dismissBannerBtn.addEventListener("click", hideLocationBanner);

  ui.myLocationBtn.addEventListener("click", () => {
    hideLanguageMenu();
    closeInfoOverlay();
    tryHideLayers();

    if (!hasLocationPermission) {
      showLocationPrompt();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
        updateUserMarker(latlng);
        map.setView(latlng, Math.max(map.getZoom(), 17));
      },
      (error) => {
        showLocationNotice(permissionErrorKey(error));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000
      }
    );
  });

  if (!navigator.geolocation) {
    disableMyLocation();
    showLocationNotice("app.location.notSupported");
  } else if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") {
          enableMyLocation();
          hideLocationBanner();
        } else {
          disableMyLocation();
          showLocationPrompt();
        }

        status.onchange = () => {
          if (status.state === "granted") {
            enableMyLocation();
            hideLocationBanner();
          } else {
            disableMyLocation();
            showLocationPrompt();
          }
        };
      })
      .catch(() => {
        disableMyLocation();
        showLocationPrompt();
      });
  } else {
    disableMyLocation();
    showLocationPrompt();
  }

  i18n.onChange(() => {
    applyStaticTranslations();
    poiLayer.updateIcons();
    overlay.refreshLanguage();

    if (!ui.infoOverlay.classList.contains("poi-overlay-hidden")) {
      openInfoPage(activeInfoPage);
    }
  });

  applyStaticTranslations();

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!ui.infoOverlay.classList.contains("poi-overlay-hidden")) closeInfoOverlay();
    if (languageMenuVisible) hideLanguageMenu();
  });

  return {
    map,
    overlay,
    center
  };
}
