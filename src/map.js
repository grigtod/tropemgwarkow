import config from "./config.js";
import { createPoiOverlay } from "./overlay.js";
import { loadAllPois } from "./poiData.js";
import { createPoiLayer } from "./poiLayer.js";
import { addKmzPathLayer } from "./pathLayer.js";

export function createMap({ mapElId = "map", ui } = {}) {
  if (!ui) throw new Error("createMap requires { ui }");

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
    onClose: enableMapInteractions
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

  const layersTitle = ui.layersBanner.querySelector(".layers-title");
  const baseMapTitle = ui.styleToggleBtn.querySelector(".layer-tile-title");
  const styleSubtitle = ui.styleToggleBtn.querySelector(".layer-tile-subtitle");

  let layersVisible = false;

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

  const infoPages = {
    credits: "./embeds/info-credits.html",
    about: "./embeds/info-about.html",
    feature: "./embeds/info-feature.html"
  };
  let activeInfoPage = "credits";

  function setInfoTab(activeKey) {
    const tabMap = {
      credits: ui.infoCreditsBtn,
      about: ui.infoAboutBtn,
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
    ui.infoOverlayFrame.src = infoPages[nextKey];
    setInfoHidden(false);
  }

  function closeInfoOverlay() {
    ui.infoOverlayFrame.src = "about:blank";
    setInfoHidden(true);
  }

  function updateLayerSubtitles() {
    if (styleSubtitle) {
      styleSubtitle.textContent =
        currentBaseLayer === "minimalist" ? "Minimal" : "Detailed";
    }
  }

  function applyStaticTranslations() {
    layersTitle.textContent = "Map Layers";
    baseMapTitle.textContent = "Base map";
    ui.poiOverlayClose.textContent = "Cancel";
    ui.infoOverlayClose.textContent = "Close";
    ui.infoCreditsBtn.textContent = "Credits";
    ui.infoAboutBtn.textContent = "About";
    ui.infoFeatureBtn.textContent = "Contact";
    ui.dismissBannerBtn.textContent = "Dismiss";

    ui.myLocationBtn.setAttribute("aria-label", "My location");
    ui.centerBtn.setAttribute("aria-label", "Center city");
    ui.infoBtn.setAttribute("aria-label", "Information");

    updateLayerSubtitles();
    refreshLocationBanner();
    overlay.syncCompleteUi();
  }

  ui.infoBtn.addEventListener("click", () => {
    tryHideLayers();
    overlay.close();
    openInfoPage(activeInfoPage);
  });

  ui.infoOverlayClose.addEventListener("click", closeInfoOverlay);
  ui.infoCreditsBtn.addEventListener("click", () => openInfoPage("credits"));
  ui.infoAboutBtn.addEventListener("click", () => openInfoPage("about"));
  ui.infoFeatureBtn.addEventListener("click", () => openInfoPage("feature"));

  ui.styleToggleBtn.addEventListener("click", () => {
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
    tryHideLayers();
  }

  map.getContainer().addEventListener("mousedown", onMapBackgroundInteraction, { passive: true });
  map.getContainer().addEventListener("touchstart", onMapBackgroundInteraction, { passive: true });

  const poiLayer = createPoiLayer({
    map,
    overlay,
    labelZoomThreshold: 19
  });

  loadAllPois()
    .then((pois) => poiLayer.setPois(pois))
    .catch((err) => console.error("POI load failed:", err));

  addKmzPathLayer({
    map,
    url: "data/path/Test1.kmz",
    fitBounds: false
  }).catch((err) => console.error("Path load failed:", err));

  document.addEventListener("poi:complete-changed", () => poiLayer.updateIcons());

  ui.centerBtn.addEventListener("click", () => {
    map.setView(center, cityCenterZoom);
    tryHideLayers();
  });

  let isRequestInFlight = false;
  let hasLocationPermission = false;
  let userMarker = null;
  let bannerState = "hidden";
  let bannerMessage = null;

  function hideLocationBanner() {
    bannerState = "hidden";
    bannerMessage = null;
    ui.locationBanner.classList.add("banner-hidden");
    ui.locationBanner.classList.remove("banner-notice");
  }

  function refreshLocationBanner() {
    if (bannerState === "hidden") return;

    ui.dismissBannerBtn.textContent = "Dismiss";
    ui.grantLocationBtn.textContent = isRequestInFlight
      ? "Requesting..."
      : "Allow location";

    if (bannerState === "prompt") {
      ui.bannerText.textContent = "Allow location access to use My Location.";
      return;
    }

    if (bannerState === "notice") {
      ui.bannerText.textContent =
        bannerMessage || "Location access failed. You can try again from your browser settings.";
    }
  }

  function showLocationPrompt() {
    bannerState = "prompt";
    bannerMessage = null;
    ui.grantLocationBtn.classList.remove("banner-btn-hidden");
    ui.grantLocationBtn.disabled = isRequestInFlight;
    ui.dismissBannerBtn.classList.remove("banner-btn-hidden");
    ui.locationBanner.classList.remove("banner-hidden", "banner-notice");
    refreshLocationBanner();
  }

  function showLocationNotice(message) {
    bannerState = "notice";
    bannerMessage = message;
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

  function permissionErrorMessage(error) {
    if (!error || typeof error.code !== "number") {
      return "Location access failed. You can try again from your browser settings.";
    }
    if (error.code === error.PERMISSION_DENIED) {
      return "Location permission was denied. Enable it in browser settings, then reload.";
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return "Your location is unavailable right now. Try again in a moment.";
    }
    if (error.code === error.TIMEOUT) {
      return "Location request timed out. Try again.";
    }
    return "Location access failed. You can try again from your browser settings.";
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
        showLocationNotice(permissionErrorMessage(error));
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
        showLocationNotice(permissionErrorMessage(error));
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
    showLocationNotice("Location is not supported in this browser.");
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

  applyStaticTranslations();

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!ui.infoOverlay.classList.contains("poi-overlay-hidden")) closeInfoOverlay();
  });

  return {
    map,
    overlay,
    center
  };
}
