import config from "./config.js";
import { createPoiOverlay } from "./overlay.js";
import { loadAllPois } from "./poiData.js";
import { createPoiLayer } from "./poiLayer.js";
import { addKmzPathLayer } from "./pathLayer.js";
import { isMobileExperience } from "./device.js";

export function createMap({ mapElId = "map", ui } = {}) {
  if (!ui) throw new Error("createMap requires { ui }");
  const APP_HISTORY_STATE_KEY = "tropemgwarkow.route";

  const center = L.latLng(config.targetLat, config.targetLon);
  const bounds = center.toBounds(config.radiusMeters * 2);
  const platform =
    navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  const isWindows = /win/i.test(platform);
  const isMobileViewport = isMobileExperience();
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
  let poiById = new Map();
  let poisLoaded = false;

  function readRouteFromHistory(state = window.history.state) {
    const route = state?.[APP_HISTORY_STATE_KEY];
    if (!route || typeof route.kind !== "string") {
      return { kind: "map" };
    }

    if (route.kind === "poi" && typeof route.poiId === "string") {
      return { kind: "poi", poiId: route.poiId };
    }

    if (route.kind === "info" && typeof route.pageKey === "string" && infoPages[route.pageKey]) {
      return { kind: "info", pageKey: route.pageKey };
    }

    return { kind: "map" };
  }

  function writeRouteToHistory(route, { replace = false } = {}) {
    const nextState = {
      ...(window.history.state ?? {}),
      [APP_HISTORY_STATE_KEY]: route
    };
    const method = replace ? "replaceState" : "pushState";
    window.history[method](nextState, "", window.location.href);
  }

  function ensureBaseHistoryState() {
    if (window.history.state?.[APP_HISTORY_STATE_KEY]) return;
    writeRouteToHistory({ kind: "map" }, { replace: true });
  }

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
    setInfoHidden(true);
  }

  function showPoiRoute(targetPoi) {
    const poi = typeof targetPoi === "string" ? poiById.get(targetPoi) : targetPoi;
    if (!poi) return false;

    closeInfoOverlay();
    overlay.open({
      url: poi.embedUrl,
      poiId: poi.id,
      initialAudioUrl: poi.initialAudioUrl || ""
    });
    return true;
  }

  function showInfoRoute(pageKey) {
    overlay.close();
    openInfoPage(pageKey);
  }

  function showMapRoute() {
    overlay.close();
    closeInfoOverlay();
  }

  function syncUiToRoute() {
    const route = readRouteFromHistory();

    if (route.kind === "poi") {
      if (!poisLoaded) {
        showMapRoute();
        return;
      }
      if (showPoiRoute(route.poiId)) return;
      writeRouteToHistory({ kind: "map" }, { replace: true });
    }

    if (route.kind === "info") {
      showInfoRoute(route.pageKey);
      return;
    }

    showMapRoute();
  }

  function navigateToPoi(targetPoi) {
    const poiId = typeof targetPoi === "string" ? targetPoi : targetPoi?.id;
    if (!poiId || !showPoiRoute(targetPoi)) {
      writeRouteToHistory({ kind: "map" }, { replace: true });
      showMapRoute();
      return;
    }

    writeRouteToHistory(
      { kind: "poi", poiId },
      { replace: readRouteFromHistory().kind !== "map" }
    );
  }

  function navigateToInfo(pageKey = activeInfoPage) {
    const nextKey = infoPages[pageKey] ? pageKey : "credits";
    showInfoRoute(nextKey);
    writeRouteToHistory(
      { kind: "info", pageKey: nextKey },
      { replace: readRouteFromHistory().kind !== "map" }
    );
  }

  function navigateToMap() {
    const route = readRouteFromHistory();
    if (route.kind === "map") {
      showMapRoute();
      return;
    }

    window.history.back();
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
    ui.infoBtn?.setAttribute("aria-label", "Information");

    updateLayerSubtitles();
    refreshLocationBanner();
    overlay.syncCompleteUi();
  }

  ui.infoBtn?.addEventListener("click", () => {
    tryHideLayers();
    navigateToInfo(activeInfoPage);
  });

  ui.poiOverlayClose.addEventListener("click", navigateToMap);
  ui.infoOverlayClose.addEventListener("click", navigateToMap);
  ui.infoCreditsBtn.addEventListener("click", () => navigateToInfo("credits"));
  ui.infoAboutBtn.addEventListener("click", () => navigateToInfo("about"));
  ui.infoFeatureBtn.addEventListener("click", () => navigateToInfo("feature"));

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
    onPoiSelect: (poi) => navigateToPoi(poi),
    labelZoomThreshold: 19
  });

  loadAllPois()
    .then((pois) => {
      poiById = new Map(pois.map((poi) => [poi.id, poi]));
      poisLoaded = true;
      poiLayer.setPois(pois);
      syncUiToRoute();
    })
    .catch((err) => console.error("POI load failed:", err));

  addKmzPathLayer({
    map,
    url: "data/path/Test1.kmz",
    fitBounds: false
  }).catch((err) => console.error("Path load failed:", err));

  document.addEventListener("poi:complete-changed", () => poiLayer.updateIcons());

  ui.centerBtn.addEventListener("click", () => {
    setUserTrackingEnabled(false);
    map.setView(center, cityCenterZoom);
    tryHideLayers();
  });

  let isRequestInFlight = false;
  let hasLocationPermission = false;
  let userMarker = null;
  let userHeading = null;
  let locationWatchId = null;
  let orientationTrackingStarted = false;
  let isFollowingUser = false;
  const prefersWebkitCompassHeading = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const minGpsHeadingSpeedMps = 1.5;
  let bannerState = "hidden";
  let bannerMessage = null;

  function normalizeHeading(heading) {
    if (!Number.isFinite(heading)) return null;
    return ((heading % 360) + 360) % 360;
  }

  function getScreenAngle() {
    const angle =
      window.screen?.orientation?.angle ??
      (typeof window.orientation === "number" ? window.orientation : 0);

    return Number.isFinite(angle) ? angle : 0;
  }

  function getHeadingFromDeviceOrientation(event) {
    if (Number.isFinite(event.webkitCompassHeading)) {
      return normalizeHeading(event.webkitCompassHeading);
    }

    if (!Number.isFinite(event.alpha)) return null;
    if (event.absolute !== true) return null;

    const screenAngle = getScreenAngle();
    const heading = normalizeHeading(360 - event.alpha + screenAngle);
    if (heading === null) return null;

    // On Apple devices, `webkitCompassHeading` is the preferred sensor source.
    // Falling back to alpha there can be noisier than simply keeping the last stable heading.
    if (prefersWebkitCompassHeading) return null;

    return heading;
  }

  function getHeadingFromGeolocation(position) {
    const heading = normalizeHeading(position?.coords?.heading);
    if (heading === null) return null;

    const speed = position?.coords?.speed;
    if (Number.isFinite(speed) && speed < minGpsHeadingSpeedMps) {
      return null;
    }

    return heading;
  }

  function makeUserMarkerIcon(heading) {
    const normalizedHeading = normalizeHeading(heading);
    const hasHeading = normalizedHeading !== null;
    const headingStyle = hasHeading ? ` style="--heading: ${normalizedHeading}"` : "";
    const headingClass = hasHeading ? " user-heading has-heading" : " user-heading";

    return L.divIcon({
      className: "user-heading-icon",
      html: `<div class="${headingClass.trim()}"${headingStyle} aria-hidden="true"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function renderUserMarkerHeading() {
    if (!userMarker) return;
    userMarker.setIcon(makeUserMarkerIcon(userHeading));
  }

  function setUserHeading(nextHeading) {
    const normalizedHeading = normalizeHeading(nextHeading);
    if (normalizedHeading === userHeading) return;
    userHeading = normalizedHeading;
    renderUserMarkerHeading();
  }

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

  function syncMyLocationButtonState() {
    ui.myLocationBtn.classList.toggle("is-tracking", isFollowingUser);
    ui.myLocationBtn.setAttribute("aria-pressed", isFollowingUser ? "true" : "false");
  }

  function setUserTrackingEnabled(enabled) {
    if (isFollowingUser === enabled) return;
    isFollowingUser = enabled;
    syncMyLocationButtonState();
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
    syncMyLocationButtonState();
  }

  function disableMyLocation() {
    hasLocationPermission = false;
    ui.myLocationBtn.disabled = true;
    setUserTrackingEnabled(false);
  }

  function updateUserMarker(latlng, heading = userHeading) {
    const normalizedHeading = normalizeHeading(heading);
    if (!userMarker) {
      userMarker = L.marker(latlng, {
        icon: makeUserMarkerIcon(normalizedHeading),
        keyboard: false,
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map);
      userHeading = normalizedHeading;
      poiLayer.setUserLocation(latlng);
      return;
    }
    userMarker.setLatLng(latlng);
    if (normalizedHeading !== userHeading) {
      userHeading = normalizedHeading;
      renderUserMarkerHeading();
    }
    poiLayer.setUserLocation(latlng);
  }

  function onOrientationChange(event) {
    if (!userMarker) return;
    setUserHeading(getHeadingFromDeviceOrientation(event));
  }

  async function ensureOrientationTrackingFromGesture() {
    if (orientationTrackingStarted) return;

    const orientationEvent = window.DeviceOrientationEvent;
    if (typeof orientationEvent === "undefined") return;

    if (typeof orientationEvent.requestPermission === "function") {
      try {
        const permission = await orientationEvent.requestPermission();
        if (permission !== "granted") return;
      } catch {
        return;
      }
    }

    window.addEventListener("deviceorientation", onOrientationChange, true);
    orientationTrackingStarted = true;
  }

  function handlePositionUpdate(position, { recenter = false } = {}) {
    const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
    const heading = getHeadingFromGeolocation(position);
    updateUserMarker(latlng, heading ?? userHeading);

    if (recenter) {
      map.setView(latlng, Math.max(map.getZoom(), 17));
      return;
    }

    if (isFollowingUser) {
      map.panTo(latlng, { animate: false });
    }
  }

  function startLocationWatch() {
    if (!navigator.geolocation || locationWatchId !== null) return;

    locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        handlePositionUpdate(position);
      },
      () => {
        if (locationWatchId !== null) {
          navigator.geolocation.clearWatch(locationWatchId);
          locationWatchId = null;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 1000
      }
    );
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
    ensureOrientationTrackingFromGesture();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        isRequestInFlight = false;
        enableMyLocation();
        hideLocationBanner();
        handlePositionUpdate(position);
        startLocationWatch();
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
    ensureOrientationTrackingFromGesture();

    if (!hasLocationPermission) {
      showLocationPrompt();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserTrackingEnabled(true);
        handlePositionUpdate(position, { recenter: true });
        startLocationWatch();
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

  map.on("dragstart", () => {
    if (!isFollowingUser) return;
    setUserTrackingEnabled(false);
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
    if (!ui.poiOverlay.classList.contains("poi-overlay-hidden")) navigateToMap();
    if (!ui.infoOverlay.classList.contains("poi-overlay-hidden")) navigateToMap();
  });

  window.addEventListener("popstate", () => {
    syncUiToRoute();
  });

  ensureBaseHistoryState();
  syncUiToRoute();

  return {
    map,
    overlay,
    center
  };
}
