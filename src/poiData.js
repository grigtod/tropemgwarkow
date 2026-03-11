async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function loadOptionalJson(url) {
  try {
    return await fetchJson(url);
  } catch (error) {
    console.warn(`Skipping POI dataset ${url}:`, error);
    return null;
  }
}

function parseFrontMatter(rawText) {
  const normalized = rawText.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return {};

  const closingIndex = normalized.indexOf("\n---\n", 4);
  const header = closingIndex === -1
    ? normalized.slice(4).trim()
    : normalized.slice(4, closingIndex);
  const attributes = {};

  for (const line of header.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    attributes[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }

  return attributes;
}

async function loadHistoricalBuildingAudioMap(items) {
  const entries = await Promise.all(items.map(async (item) => {
    if (!item?.id) return [null, ""];

    try {
      const markdown = await fetchText(`./content/historical-buildings/${encodeURIComponent(item.id)}.md`);
      const attributes = parseFrontMatter(markdown);
      const audioPath = typeof attributes.audio === "string" ? attributes.audio.trim() : "";
      const audioUrl = audioPath ? new URL(audioPath, window.location.href).toString() : "";
      return [item.id, audioUrl];
    } catch {
      return [item.id, ""];
    }
  }));

  return new Map(entries.filter(([id]) => typeof id === "string"));
}

export async function loadAllPois() {
  const pois = [];

  function addToPois(id, lat, lon, label, emoji, embedUrl, initialAudioUrl = "") {
    pois.push({ id, lat, lon, label, emoji, embedUrl, initialAudioUrl });
  }

  function buildGwarekEmbedUrl(dialogueJson) {
    const baseUrl = new URL("./embeds/pomnik-gwarka.html", window.location.href);
    if (typeof dialogueJson === "string" && dialogueJson.trim()) {
      baseUrl.searchParams.set("dialogue", dialogueJson.trim());
    }
    return baseUrl.toString();
  }

  /*const loadedPOI = await loadOptionalJson("./data/poi.json");
  loadedPOI?.data?.forEach((el) =>
    // Temporarily hide the generic "info" POI and museum marker.
    el.id !== "info" &&
    el.id !== "museum-tg" &&
    addToPois(el.id, el.lat, el.lon, el.label, el.emoji, el.embedUrl)
  );*/

  const loadedGwarek = await loadOptionalJson("./data/gwarek.json");
  const gwarekItems = Array.isArray(loadedGwarek?.data) ? loadedGwarek.data : [];

  gwarekItems.forEach((el) =>
    el.enabled !== false &&
    addToPois(
      el.id,
      el.lat,
      el.lon,
      el.label,
      "miner",
      buildGwarekEmbedUrl(el.json)
    )
  );

  // Temporarily hide photo POIs from photo.json.
  // const loadedPhotos = await loadOptionalJson("./data/photo.json");
  // loadedPhotos?.data?.forEach((el) =>
  //   addToPois(el.id, el.lat, el.lon, el.label, "📷", "./embeds/photo.html")
  // );

  const loadedHistoricalBuildings = await loadOptionalJson("./data/historical-buildings.json");
  const historicalBuildingItems = Array.isArray(loadedHistoricalBuildings?.data)
    ? loadedHistoricalBuildings.data
    : [];
  const historicalAudioById = await loadHistoricalBuildingAudioMap(historicalBuildingItems);

  historicalBuildingItems.forEach((el) =>
    addToPois(
      el.id,
      el.lat,
      el.lon,
      el.label,
      "house",
      "./embeds/historical-building.html",
      historicalAudioById.get(el.id) ?? ""
    )
  );

  return pois;
}
