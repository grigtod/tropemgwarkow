export function createPoiOverlay({
  overlayEl,
  frameEl,
  closeBtnEl,
  completeBtnEl,
  completeLabelEl,
  onOpen,
  onClose
}) {
  if (!overlayEl || !frameEl) throw new Error("overlayEl and frameEl are required");
  let activePoiId = null;
  let activeBaseUrl = null;
  let pendingFrameUrl = null;
  let pendingFrameToken = null;
  let activeFrameEl = frameEl;

  const COMPLETED_STORAGE_KEY = "tropemgwarkow.completedPois.v1";

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

  function attachFrameLoadListener(targetFrameEl) {
    targetFrameEl.addEventListener("load", () => {
      if (!pendingFrameUrl) return;
      if (normalizeUrl(targetFrameEl.src) !== pendingFrameUrl) return;
      pendingFrameUrl = null;
      pendingFrameToken = null;
      setLoading(false);
      postStateToFrame();
    });
  }

  function postMessageToFrame(message) {
    try {
      activeFrameEl.contentWindow?.postMessage(message, window.location.origin);
    } catch {
      // Ignore frames that are not ready yet.
    }
  }

  function postStateToFrame() {
    postMessageToFrame({
      type: "poi-overlay-state",
      poiId: activePoiId,
      isComplete: activePoiId ? completedPois.has(activePoiId) : false
    });
  }

  function stopEmbeddedMedia() {
    postMessageToFrame({ type: "poi-overlay-stop-media" });
  }

  function replaceFrame(nextUrl) {
    stopEmbeddedMedia();
    const nextFrameEl = activeFrameEl.cloneNode(false);
    nextFrameEl.src = nextUrl;
    activeFrameEl.replaceWith(nextFrameEl);
    activeFrameEl = nextFrameEl;
    attachFrameLoadListener(activeFrameEl);
  }

  function syncCompleteUi() {
    if (!completeBtnEl || !completeLabelEl) return;
    if (!activePoiId) return;

    const isDone = completedPois.has(activePoiId);
    completeBtnEl.classList.toggle("is-complete", isDone);
    completeBtnEl.setAttribute("aria-pressed", isDone ? "true" : "false");
    completeLabelEl.textContent = isDone ? "Ukończono" : "Zakończ";
    postStateToFrame();
  }

  function buildTargetUrl(url, poiId) {
    const parsed = new URL(url, window.location.href);
    if (poiId) parsed.searchParams.set("poiId", poiId);
    return parsed.toString();
  }

  function applyOpenState({ url, poiId }) {
    activePoiId = poiId ?? null;
    activeBaseUrl = url ?? null;

    const targetUrl = buildTargetUrl(url, activePoiId);
    const token = Symbol("poi-open");
    pendingFrameUrl = targetUrl;
    pendingFrameToken = token;

    setLoading(true);
    setHidden(false);
    syncCompleteUi();
    if (pendingFrameToken !== token) return;

    if (normalizeUrl(activeFrameEl.src) === targetUrl) {
      pendingFrameUrl = null;
      pendingFrameToken = null;
      setLoading(false);
      return;
    }

    replaceFrame(targetUrl);
  }

  function open({ url, poiId }) {
    applyOpenState({ url, poiId });
  }

  function applyCloseState() {
    stopEmbeddedMedia();
    pendingFrameUrl = null;
    pendingFrameToken = null;
    activeBaseUrl = null;
    activePoiId = null;
    setLoading(false);
    setHidden(true);
  }

  function close() {
    applyCloseState();
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
    if (completeBtnEl) completeBtnEl.addEventListener("click", toggleComplete);
    attachFrameLoadListener(activeFrameEl);
    window.addEventListener("message", (event) => {
      if (event.source !== activeFrameEl.contentWindow) return;
      if (event.origin !== window.location.origin) return;

      const { data } = event;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "poi-overlay-close") {
        if (closeBtnEl) closeBtnEl.click();
        else close();
        return;
      }

      if (data.type === "poi-overlay-toggle-complete") {
        toggleComplete();
        return;
      }

      if (data.type === "poi-overlay-request-state") {
        postStateToFrame();
      }
    });
  }

  attachListeners();

  return {
    open,
    close,
    syncCompleteUi,
    toggleComplete,
    isCompleted,
    getActivePoiId,
    isOpen
  };
}
