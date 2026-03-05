function parseCoordinatesText(text) {
  if (!text) return [];

  return text
    .trim()
    .split(/\s+/)
    .map((entry) => entry.split(","))
    .map(([lon, lat]) => [Number(lat), Number(lon)])
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
}

function collectLineStringsFromKml(kmlText) {
  const doc = new DOMParser().parseFromString(kmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Invalid KML content");
  }

  const lineStrings = [];
  const geometryNodes = [
    ...Array.from(doc.getElementsByTagNameNS("*", "LineString")),
    ...Array.from(doc.getElementsByTagNameNS("*", "LinearRing"))
  ];

  for (const geometryNode of geometryNodes) {
    const coordinatesNode = geometryNode.getElementsByTagNameNS("*", "coordinates")[0];
    if (!coordinatesNode) continue;

    const points = parseCoordinatesText(coordinatesNode.textContent || "");
    if (points.length >= 2) lineStrings.push(points);
  }

  if (!lineStrings.length) {
    throw new Error("No LineString/LinearRing coordinates found in KML");
  }

  return lineStrings;
}

export async function addKmzPathLayer({
  map,
  url,
  style = { color: "#0f172a", weight: 4, opacity: 0.95 },
  fitBounds = true
} = {}) {
  if (!map) throw new Error("addKmzPathLayer requires { map }");
  if (!url) throw new Error("addKmzPathLayer requires { url }");
  if (!window.JSZip) throw new Error("JSZip is required to read KMZ files");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch KMZ: ${response.status}`);
  }

  const zipData = await response.arrayBuffer();
  const zip = await window.JSZip.loadAsync(zipData);
  const kmlFile = zip.file("doc.kml") || Object.values(zip.files).find((file) => file.name.endsWith(".kml"));

  if (!kmlFile) {
    throw new Error("KMZ does not contain a KML file");
  }

  const kmlText = await kmlFile.async("string");
  const lineStrings = collectLineStringsFromKml(kmlText);

  const layers = [];

  lineStrings.forEach((latlngs) => {
    const baseLine = L.polyline(latlngs, {
      color: "#ffffff",
      weight: Math.max(1, (style.weight ?? 4) + 2),
      opacity: 0.7
    }).addTo(map);
    layers.push(baseLine);

    const flowLine = L.polyline(latlngs, {
      color: style.color ?? "#0f172a",
      weight: style.weight ?? 4,
      opacity: style.opacity ?? 0.95,
      dashArray: "12 18",
      className: "route-flow-line"
    }).addTo(map);

    layers.push(flowLine);
  });

  const layer = L.featureGroup(layers).addTo(map);

  if (fitBounds) {
    map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  }

  return layer;
}
