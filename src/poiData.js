async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

export async function loadAllPois() {
  const pois = [];

  function addToPois(id, lat, lon, label, emoji, embedUrl, labelKey = null) {
    pois.push({ id, lat, lon, label, emoji, embedUrl, labelKey });
  }

  const loadedPOI = await fetchJson("./data/poi.json");
  loadedPOI.data.forEach((el) =>
    addToPois(el.id, el.lat, el.lon, el.label, el.emoji, el.embedUrl, `poi.${el.id}`)
  );

  const loadedGwarek = await fetchJson("./data/gwarek.json");
  loadedGwarek.data.forEach((el) =>
    addToPois(
      el.id,
      el.lat,
      el.lon,
      el.label,
      "🗿",
      "./embeds/pomnik-gwarka.html",
      `poi.${el.id}`
    )
  );

  const loadedPhotos = await fetchJson("./data/photo.json");
  loadedPhotos.data.forEach((el) =>
    addToPois(el.id, el.lat, el.lon, el.label, "📷", "./embeds/photo.html", `poi.${el.id}`)
  );

  return pois;
}
