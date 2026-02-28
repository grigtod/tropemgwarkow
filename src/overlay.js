export function createPoiOverlay({
  overlayEl,
  frameEl,
  closeBtnEl,
  completeBtnEl,
  completeLabelEl,
  onOpen,
  onClose,
  translate = (_key, fallback) => fallback,
  localizeUrl = (url) => url
}) {
  if (!overlayEl || !frameEl) throw new Error("overlayEl and frameEl are required");

  let activePoiId = null;
  let activeBaseUrl = null;
  let pendingFrameUrl = null;
  let pendingFrameToken = null;

  const COMPLETED_STORAGE_KEY = "discoverTG.completedPois.v1";

  function loadCompletedSet() {
    try {
      const raw = localStorage.getItem(COMPLETED_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function saveCompletedSet(set) {
    localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify([...set]));
  }

  const completedPois = loadCompletedSet();

  function setHidden(hidden) {
    const wasHidden = overlayEl.classList.contains("poi-overlay-hidden");
    overlayEl.classList.toggle("poi-overlay-hidden", hidden);
    overlayEl.setAttribute("aria-hidden", hidden ? "true" : "false");

    if (hidden && !wasHidden) onClose?.();
    if (!hidden && wasHidden) onOpen?.();
  }

  function setLoading(loading) {
    overlayEl.classList.toggle("is-loading", loading);
  }

  function normalizeUrl(url) {
    try {
      return new URL(url, window.location.href).toString();
    } catch {
      return String(url);
    }
  }

  function syncCompleteUi() {
    if (!completeBtnEl || !completeLabelEl) return;
    if (!activePoiId) return;

    const isDone = completedPois.has(activePoiId);
    completeBtnEl.classList.toggle("is-complete", isDone);
    completeBtnEl.setAttribute("aria-pressed", isDone ? "true" : "false");
    completeLabelEl.textContent = isDone
      ? translate("app.poi.completed", "Completed")
      : translate("app.poi.complete", "Complete");
  }

  function buildTargetUrl(url, poiId) {
    const localized = localizeUrl(url);
    const parsed = new URL(localized, window.location.href);
    if (poiId) parsed.searchParams.set("poiId", poiId);
    return parsed.toString();
  }

  function open({ url, poiId }) {
    activePoiId = poiId ?? null;
    activeBaseUrl = url ?? null;

    const targetUrl = buildTargetUrl(url, activePoiId);
    const token = Symbol("poi-open");
    pendingFrameUrl = targetUrl;
    pendingFrameToken = token;

    setLoading(true);
    setHidden(false);
    syncCompleteUi();

    const navigateToTarget = () => {
      if (pendingFrameToken !== token) return;
      frameEl.src = targetUrl;
    };

    if (normalizeUrl(frameEl.src) === "about:blank") {
      navigateToTarget();
      return;
    }

    frameEl.src = "about:blank";
    setTimeout(navigateToTarget, 0);
  }

  function close() {
    pendingFrameUrl = null;
    pendingFrameToken = null;
    activeBaseUrl = null;
    activePoiId = null;
    setLoading(false);
    frameEl.src = "about:blank";
    setHidden(true);
  }

  function refreshLanguage() {
    syncCompleteUi();
    if (!activeBaseUrl || !isOpen()) return;
    open({ url: activeBaseUrl, poiId: activePoiId });
  }

  function toggleComplete() {
    if (!activePoiId) return;

    if (completedPois.has(activePoiId)) completedPois.delete(activePoiId);
    else completedPois.add(activePoiId);

    saveCompletedSet(completedPois);
    syncCompleteUi();
    document.dispatchEvent(new CustomEvent("poi:complete-changed"));
  }

  function isCompleted(id) {
    return completedPois.has(id);
  }

  function getActivePoiId() {
    return activePoiId;
  }

  function isOpen() {
    return !overlayEl.classList.contains("poi-overlay-hidden");
  }

  function attachListeners() {
    if (closeBtnEl) closeBtnEl.addEventListener("click", close);
    if (completeBtnEl) completeBtnEl.addEventListener("click", toggleComplete);

    frameEl.addEventListener("load", () => {
      if (!pendingFrameUrl) return;
      if (normalizeUrl(frameEl.src) !== pendingFrameUrl) return;
      pendingFrameUrl = null;
      pendingFrameToken = null;
      setLoading(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close();
    });
  }

  attachListeners();

  return {
    open,
    close,
    refreshLanguage,
    syncCompleteUi,
    toggleComplete,
    isCompleted,
    getActivePoiId,
    isOpen
  };
}
