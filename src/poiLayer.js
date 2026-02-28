export function createPoiLayer({
  map,
  overlay,
  labelZoomThreshold = 18,
  dotZoomThreshold = 16,
  translate = (_key, fallback) => fallback
}) {
  if (!map) throw new Error("createPoiLayer requires map");
  if (!overlay) throw new Error("createPoiLayer requires overlay");

  let poiMarkers = [];

  function getDotColor(emoji) {
    const colorsByEmoji = {
      "📷": "#d9480f",
      "🗿": "#495057",
      "ℹ️": "#1971c2",
      "🏛️": "#5f3dc4",
      "⛏️": "#2b8a3e"
    };

    return colorsByEmoji[emoji] ?? "#0078ff";
  }

  function escapeHtml(input) {
    return String(input)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function translatedLabel(poi) {
    if (!poi?.labelKey) return poi?.label ?? "";
    return translate(poi.labelKey, poi.label ?? "");
  }

  function makePoiIcon(poi, zoomLevel) {
    const label = translatedLabel(poi);
    const safeLabel = escapeHtml(label);

    const isCompleted = overlay.isCompleted(poi.id);
    const showLabel = zoomLevel >= labelZoomThreshold;
    const showDotOnly = zoomLevel < dotZoomThreshold;

    const classNameParts = ["poi-marker"];
    if (showLabel) classNameParts.push("show-label");
    if (isCompleted) classNameParts.push("is-completed");

    const markerVisual = showDotOnly
      ? `<span class="poi-dot" style="--poi-dot-color: ${getDotColor(poi.emoji)}" aria-hidden="true"></span>`
      : `<span class="poi-emoji">${poi.emoji}</span>`;

    const html = `
      <div class="${classNameParts.join(" ")}" role="button" aria-label="${safeLabel}">
        ${markerVisual}
        <span class="poi-label">${safeLabel}</span>
      </div>
    `;

    return L.divIcon({
      className: "poi-icon",
      html,
      iconSize: [1, 1]
    });
  }

  function updateIcons() {
    const zoomLevel = map.getZoom();
    for (const { poi, marker } of poiMarkers) {
      marker.setIcon(makePoiIcon(poi, zoomLevel));
    }
  }

  function setPois(pois) {
    for (const { marker } of poiMarkers) map.removeLayer(marker);
    poiMarkers = [];

    poiMarkers = pois.map((poi) => {
      const marker = L.marker([poi.lat, poi.lon], {
        icon: makePoiIcon(poi, map.getZoom()),
        keyboard: true,
        riseOnHover: true
      }).addTo(map);

      marker.on("click", () => {
        overlay.open({ url: poi.embedUrl, poiId: poi.id });
      });

      marker.on("keypress", (e) => {
        const key = e.originalEvent?.key;
        if (key === "Enter" || key === " ") {
          overlay.open({ url: poi.embedUrl, poiId: poi.id });
        }
      });

      return { poi, marker };
    });

    updateIcons();
  }

  map.on("zoomend", updateIcons);

  return {
    setPois,
    updateIcons
  };
}
