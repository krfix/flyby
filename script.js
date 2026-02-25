// ===== Config =====
const kmlPolylinesUrl = "kml_polylines.json";
const kmlBaseUrl = "kml"; // expects kml/<name>.kml

// ===== State =====
let map;
let allFlightsLayer;
let selectedFullKmlLayer;
let selectedMarkerLayer;

let polylinesIndex = [];      // [{name, coords:[{lat,lng}], polyline}]
let currentFlight = null;     // {name, points:[{lat,lng,altM,timeMs,hdgDeg}], speedKts[], altFt[], timeMs[], hdgDeg[]}
let kmlFetchAbort = null;

let resizeChartCanvas = null;

// ===== Utilities =====
function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function bearingDeg(a, b) {
  // initial bearing from a->b
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLon = toRad(b.lng - a.lng);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = toDeg(Math.atan2(y, x));
  brng = (brng + 360) % 360;
  return brng;
}

function metersToNm(m) { return m / 1852; }
function msToKnots(mps) { return mps * 1.9438444924406; }
function metersToFeet(m) { return m * 3.280839895; }

function safeParseTimeMs(whenText) {
  const t = Date.parse(whenText);
  return Number.isFinite(t) ? t : null;
}

function fmtUtc(ms) {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtAltFt(ft) {
  if (!Number.isFinite(ft)) return "—";
  return `${Math.round(ft)} ft`;
}

function fmtKts(kts) {
  if (!Number.isFinite(kts)) return "—";
  return `${Math.round(kts)} kt`;
}

function fmtHdg(deg) {
  if (!Number.isFinite(deg)) return "—";
  return `${Math.round(deg)}°`;
}

function computePolylineDistanceNm(coords) {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) meters += haversineMeters(coords[i - 1], coords[i]);
  return metersToNm(meters);
}

// ===== DOM helpers =====
function el(id) { return document.getElementById(id); }
function showPanel() { el("flight-panel").style.display = "block"; }
function hidePanel() { el("flight-panel").style.display = "none"; }

function setPanelHeader(title, subtitle) {
  el("flight-title").textContent = title || "";
  el("flight-sub").textContent = subtitle || "";
}

function setStats({ timeMs, hdgDeg, altFt, speedKts }) {
  el("stat-time").textContent = fmtUtc(timeMs);
  el("stat-hdg").textContent = fmtHdg(hdgDeg);
  el("stat-alt").textContent = fmtAltFt(altFt);
  el("stat-gs").textContent = fmtKts(speedKts);
}

// ===== Map init =====
function initMap() {
  map = L.map("map").setView([48.0, 16.0], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  allFlightsLayer = L.featureGroup().addTo(map);
  selectedFullKmlLayer = L.featureGroup().addTo(map);
  selectedMarkerLayer = L.featureGroup().addTo(map);

  // Dropdown control
  const DropdownControl = L.Control.extend({
    onAdd: function () {
      const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      div.style.background = "rgba(255,255,255,0.95)";
      div.style.padding = "8px";
      div.style.borderRadius = "8px";
      div.style.fontFamily = "Arial, sans-serif";
      div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";

      const label = L.DomUtil.create("div", "", div);
      label.textContent = "Select flight";
      label.style.fontWeight = "700";
      label.style.fontSize = "12px";
      label.style.marginBottom = "6px";

      const select = L.DomUtil.create("select", "", div);
      select.id = "flight-select";
      select.style.width = "220px";

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      return div;
    }
  });
  map.addControl(new DropdownControl({ position: "topright" }));

  // Distance box
  const DistanceControl = L.Control.extend({
    onAdd: function () {
      const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      div.id = "distance-box";
      div.style.background = "rgba(255,255,255,0.95)";
      div.style.padding = "8px";
      div.style.borderRadius = "8px";
      div.style.fontFamily = "Arial, sans-serif";
      div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
      div.style.marginTop = "10px";
      div.style.display = "none";
      return div;
    }
  });
  map.addControl(new DistanceControl({ position: "topright" }));
}

function setDistanceBox(text) {
  const box = el("distance-box");
  if (!box) return;
  if (!text) {
    box.style.display = "none";
    box.textContent = "";
    return;
  }
  box.textContent = text;
  box.style.display = "block";
}

// ===== Load lightweight polylines =====
async function loadPolylines() {
  const res = await fetch(kmlPolylinesUrl);
  if (!res.ok) throw new Error(`Failed to load ${kmlPolylinesUrl}: ${res.status}`);
  // your file format: [{ name, path: [[lat,lng], ...] }, ...]
  return await res.json();
}

function buildDropdown(items) {
  const select = el("flight-select");
  select.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "All flights";
  select.appendChild(optAll);

  // alphabetical
  const sorted = [...items].sort((a, b) => String(b.name).localeCompare(String(a.name)));

  for (const it of sorted) {
    const opt = document.createElement("option");
    opt.value = it.name;
    opt.textContent = it.name;
    select.appendChild(opt);
  }
}

function addOverviewPolylines(items) {
  allFlightsLayer.clearLayers();
  polylinesIndex = [];

  for (const it of items) {
    const path = it.path || it.coords || [];
    const coords = path.map(([lat, lng]) => ({ lat, lng }));
    if (coords.length < 2) continue;

    const pl = L.polyline(coords, { color: "#0000FF", weight: 2, opacity: 0.6 });
    pl.addTo(allFlightsLayer);

    polylinesIndex.push({ name: it.name, coords, polyline: pl });
  }

  if (polylinesIndex.length > 0) {
    map.fitBounds(allFlightsLayer.getBounds(), { padding: [40, 40] });
  }
}

function setSelectedOverview(name) {
  if (!name || name === "all") {
    for (const p of polylinesIndex) {
      p.polyline.setStyle({ color: "#0000FF", weight: 2, opacity: 0.6 });
      if (!map.hasLayer(p.polyline)) p.polyline.addTo(allFlightsLayer);
    }
    setDistanceBox(null);
    return;
  }

  let selected = null;
  for (const p of polylinesIndex) {
    if (p.name === name) {
      selected = p;
      p.polyline.setStyle({ color: "#FF0000", weight: 3, opacity: 1.0 });
      if (!map.hasLayer(p.polyline)) p.polyline.addTo(allFlightsLayer);
    } else {
      if (map.hasLayer(p.polyline)) allFlightsLayer.removeLayer(p.polyline);
    }
  }

  if (selected) {
    const distNm = computePolylineDistanceNm(selected.coords);
    setDistanceBox(`Distance: ${distNm.toFixed(1)} nm`);
    map.fitBounds(selected.polyline.getBounds(), { padding: [40, 40] });
  } else {
    setDistanceBox(null);
  }
}

// ===== KML parsing =====
function parseKmlToPoints(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "text/xml");

  // ---- FR24 format: many Point Placemarks with TimeStamp/when and IconStyle/heading
  const placemarks = xml.getElementsByTagName("Placemark");
  const fr24Points = [];

  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];

    const pointNode = pm.getElementsByTagName("Point")[0];
    const whenNode = pm.getElementsByTagName("when")[0]; // inside TimeStamp
    if (!pointNode || !whenNode) continue;

    const coordNode = pointNode.getElementsByTagName("coordinates")[0];
    if (!coordNode) continue;

    const whenText = (whenNode.textContent || "").trim();
    const timeMs = safeParseTimeMs(whenText);

    const coordText = (coordNode.textContent || "").trim();
    const parts = coordText.split(",");
    if (parts.length < 2) continue;

    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    const altM = parts.length >= 3 ? Number(parts[2]) : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // heading in FR24 is usually IconStyle/heading
    let hdgDeg = null;
    const iconStyle = pm.getElementsByTagName("IconStyle")[0];
    if (iconStyle) {
      const hdgNode = iconStyle.getElementsByTagName("heading")[0];
      if (hdgNode) {
        const h = Number((hdgNode.textContent || "").trim());
        if (Number.isFinite(h)) hdgDeg = h;
      }
    }

    fr24Points.push({
      lat,
      lng: lon,
      altM: Number.isFinite(altM) ? altM : null,
      timeMs: Number.isFinite(timeMs) ? timeMs : null,
      hdgDeg: Number.isFinite(hdgDeg) ? hdgDeg : null
    });
  }

  if (fr24Points.length >= 2) {
    // FR24 is already in time order, but sort defensively if timestamps exist
    const hasAnyTime = fr24Points.some(p => Number.isFinite(p.timeMs));
    if (hasAnyTime) {
      fr24Points.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
    }
    return fr24Points;
  }

  // ---- ADSBexchange / simple KML: LineString coordinates "lon,lat,alt lon,lat,alt ..."
  const lineNodes = xml.getElementsByTagName("LineString");
  const pts = [];
  for (let l = 0; l < lineNodes.length; l++) {
    const coordNodes = lineNodes[l].getElementsByTagName("coordinates");
    if (!coordNodes || coordNodes.length === 0) continue;

    const text = (coordNodes[0].textContent || "").trim();
    const tuples = text.split(/\s+/);

    for (const tup of tuples) {
      const p = tup.split(",");
      if (p.length < 2) continue;

      const lon = Number(p[0]);
      const lat = Number(p[1]);
      const altM = p.length >= 3 ? Number(p[2]) : null;

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      pts.push({
        lat,
        lng: lon,
        altM: Number.isFinite(altM) ? altM : null,
        timeMs: null,
        hdgDeg: null
      });
    }
  }

  return pts;
}

function ema(values, alpha = 0.2) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { out[i] = null; continue; }
    prev = (prev === null) ? v : (alpha * v + (1 - alpha) * prev);
    out[i] = prev;
  }
  return out;
}

function windowedSpeedKts(points, halfWindow = 3) {
  // speed at i computed from i-halfWindow to i+halfWindow
  const out = new Array(points.length).fill(null);

  for (let i = 0; i < points.length; i++) {
    const a = Math.max(0, i - halfWindow);
    const b = Math.min(points.length - 1, i + halfWindow);
    if (b <= a) continue;

    const t1 = points[a].timeMs;
    const t2 = points[b].timeMs;
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) continue;

    // sum distance across the window for robustness
    let distM = 0;
    for (let j = a + 1; j <= b; j++) distM += haversineMeters(points[j - 1], points[j]);

    const dt = (t2 - t1) / 1000;
    out[i] = msToKnots(distM / dt);
  }
  return out;
}

function computeSeries(points) {
  const timeMs = points.map(p => p.timeMs);
  let altFt = points.map(p => (Number.isFinite(p.altM) ? metersToFeet(p.altM) : null));
  let hdgDeg = points.map(p => (Number.isFinite(p.hdgDeg) ? p.hdgDeg : null));

  // SPEED: use windowed computation if time exists
  let speedKts = windowedSpeedKts(points, 4);   // try 3–6 depending on sampling

  // Optional: apply EMA to further smooth speed
  speedKts = ema(speedKts, 0.25);

  // Altitude smoothing (gentle)
  altFt = ema(altFt, 0.15);

  // Heading: if missing, derive from geometry
  for (let i = 1; i < points.length; i++) {
    if (!Number.isFinite(hdgDeg[i])) hdgDeg[i] = bearingDeg(points[i - 1], points[i]);
  }
  if (!Number.isFinite(hdgDeg[0]) && points.length > 1) hdgDeg[0] = bearingDeg(points[0], points[1]);

  return { timeMs, altFt, speedKts, hdgDeg };
}

// ===== Selected KML loading/rendering =====
async function loadSelectedKml(name) {
  if (kmlFetchAbort) kmlFetchAbort.abort();
  kmlFetchAbort = new AbortController();

  const url = `${kmlBaseUrl}/${name}.kml`;
  const res = await fetch(url, { signal: kmlFetchAbort.signal });
  if (!res.ok) throw new Error(`Failed to fetch KML: ${res.status} ${res.statusText}`);
  return await res.text();
}

function renderFullKmlOverlay(points) {
  selectedFullKmlLayer.clearLayers();
  selectedMarkerLayer.clearLayers();

  const latlngs = points.map(p => [p.lat, p.lng]);
  const pl = L.polyline(latlngs, { color: "#FF0000", weight: 4, opacity: 1.0 });
  pl.addTo(selectedFullKmlLayer);

  map.fitBounds(pl.getBounds(), { padding: [40, 40] });
}

function ensureMarkerAt(index) {
  selectedMarkerLayer.clearLayers();
  if (!currentFlight || !currentFlight.points || currentFlight.points.length === 0) return;

  const p = currentFlight.points[index];
  const marker = L.circleMarker([p.lat, p.lng], {
    radius: 7,
    weight: 2,
    opacity: 1,
    fillOpacity: 0.8
  });
  marker.addTo(selectedMarkerLayer);
}

// ===== Chart =====
function niceStep(range, targetTicks) {
  // pick a "nice" step size: 1,2,5 * 10^n
  const rough = range / Math.max(1, targetTicks);
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const mult = rough / pow10;
  let niceMult = 1;
  if (mult >= 5) niceMult = 5;
  else if (mult >= 2) niceMult = 2;
  else niceMult = 1;
  return niceMult * pow10;
}

function makeTicks(min, max, targetTicks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const step = niceStep(max - min, targetTicks);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

function drawChart() {
  const canvas = el("chart");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  if (!currentFlight) return;

  const n = currentFlight.points.length;
  if (n < 2) return;

  const altFt = currentFlight.altFt;       // altitude in feet (may contain null)
  const spdKts = currentFlight.speedKts;   // speed in knots (may contain null)

  const altVals = altFt.filter(v => Number.isFinite(v));
  const spdVals = spdKts.filter(v => Number.isFinite(v));

  const hasAlt = altVals.length > 0;
  const hasSpd = spdVals.length > 0;

  // plot padding (extra right padding for right axis labels)
  const padL = 56, padR = 56, padT = 12, padB = 28;
  const pw = w - padL - padR;
  const ph = h - padT - padB;

  const xFor = (i) => padL + (pw * (i / (n - 1)));

  // Axis ranges
  const spdMin = hasSpd ? Math.min(...spdVals) : 0;
  const spdMax = hasSpd ? Math.max(...spdVals) : 1;

  const altMinFt = hasAlt ? Math.min(...altVals) : 0;
  const altMaxFt = hasAlt ? Math.max(...altVals) : 1;

  // Convert alt axis to FL for labeling (FL = ft/100)
  const altMinFL = altMinFt / 100;
  const altMaxFL = altMaxFt / 100;

  // Ticks
  const spdTicks = hasSpd ? makeTicks(spdMin, spdMax, 8) : [];
  const altTicksFL = hasAlt ? makeTicks(altMinFL, altMaxFL, 8) : [];

  let spdMinA = spdMin, spdMaxA = spdMax;
if (spdTicks.length >= 2) {
  spdMinA = spdTicks[0];
  spdMaxA = spdTicks[spdTicks.length - 1];
}

let altMinFtA = altMinFt, altMaxFtA = altMaxFt;
if (altTicksFL.length >= 2) {
  altMinFtA = altTicksFL[0] * 100;
  altMaxFtA = altTicksFL[altTicksFL.length - 1] * 100;
}

  // Use one set of grid lines for readability: prefer speed ticks if present, else altitude ticks
  const gridTicks = (spdTicks.length ? spdTicks : altTicksFL);

  // Scaling functions
const ySpd = (kts) =>
  padT + ph - (ph * ((kts - spdMinA) / (spdMaxA - spdMinA || 1)));

const yAlt = (ft) =>
  padT + ph - (ph * ((ft - altMinFtA) / (altMaxFtA - altMinFtA || 1)));

  // Background grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.font = "12px Arial";

  // Draw grid lines + labels
  for (let i = 0; i < gridTicks.length; i++) {
    const t = gridTicks[i];

    // decide y based on which axis gridTicks represent
    const y = (spdTicks.length ? ySpd(t) : yAlt(t * 100));

    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + pw, y);
    ctx.stroke();

    // Left label (KT)
    if (hasSpd && spdTicks.length) {
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.round(t)), padL - 8, y);
    }

    // Right label (FL)
    if (hasAlt && altTicksFL.length) {
      // pick corresponding FL tick nearest to this gridline if grid is based on speed;
      // otherwise t is already FL
      let fl = t;
if (spdTicks.length) {
  const frac = (padT + ph - y) / ph;
  const ft = altMinFtA + frac * (altMaxFtA - altMinFtA);
  fl = ft / 100;
}      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.round(fl)), padL + pw + 8, y);
    }
  }

  // Axes lines
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + ph);
  ctx.lineTo(padL + pw, padT + ph);
  ctx.stroke();

  // Axis titles
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("KT", 8, 8);

  ctx.textAlign = "right";
  ctx.fillText("FL", w - 8, 8);

  // Plot altitude (green)
  if (hasAlt) {
    ctx.strokeStyle = "#2E7D32";
    ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = altFt[i];
      if (!Number.isFinite(v)) continue;
      const x = xFor(i);
      const y = yAlt(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Plot speed (blue)
  if (hasSpd) {
    ctx.strokeStyle = "#1565C0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = spdKts[i];
      if (!Number.isFinite(v)) continue;
      const x = xFor(i);
      const y = ySpd(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ===== Scrubber/UI update =====
function setScrubberMax(maxIdx) {
  const s = el("scrubber");
  s.min = "0";
  s.max = String(Math.max(0, maxIdx));
  s.value = "0";
}

function updateUiForIndex(idx) {
  if (!currentFlight) return;

  const p = currentFlight.points[idx];
  const altFt = currentFlight.altFt[idx];
  const speedKts = currentFlight.speedKts[idx];
  const hdgDeg = currentFlight.hdgDeg[idx];

  setStats({
    timeMs: p.timeMs,
    hdgDeg: Number.isFinite(hdgDeg) ? hdgDeg : null,
    altFt: Number.isFinite(altFt) ? altFt : null,
    speedKts: Number.isFinite(speedKts) ? speedKts : null
  });

  ensureMarkerAt(idx);
  drawChart();
}

async function selectFlight(name) {
  selectedFullKmlLayer.clearLayers();
  selectedMarkerLayer.clearLayers();
  currentFlight = null;

  if (!name || name === "all") {
    hidePanel();
    setSelectedOverview("all");
    return;
  }

  setSelectedOverview(name);
  showPanel();

  requestAnimationFrame(() => {
  map.invalidateSize();
  if (typeof resizeChartCanvas === "function") resizeChartCanvas();
});

  setPanelHeader(name, "Loading KML…");
  setStats({ timeMs: null, hdgDeg: null, altFt: null, speedKts: null });

  try {
    const kmlText = await loadSelectedKml(name);
    const points = parseKmlToPoints(kmlText);

    if (!points || points.length < 2) {
      setPanelHeader(name, "No track points found in KML");
      setScrubberMax(0);
      return;
    }

    const { timeMs, altFt, speedKts, hdgDeg } = computeSeries(points);
    currentFlight = { name, points, timeMs, altFt, speedKts, hdgDeg };

    renderFullKmlOverlay(points);

    const hasTime = points.some(p => Number.isFinite(p.timeMs));
    setPanelHeader(
      name,
      hasTime ? `Loaded ${points.length} points (time OK)` : `Loaded ${points.length} points (no time data)`
    );

    setScrubberMax(points.length - 1);
    updateUiForIndex(0);

  } catch (e) {
    if (e && e.name === "AbortError") return;
    console.error(e);
    setPanelHeader(name, "Failed to load KML");
  }
}

// ===== Controls =====
function wirePanelControls() {
  el("panel-close").addEventListener("click", () => {
    hidePanel();
    selectedFullKmlLayer.clearLayers();
    selectedMarkerLayer.clearLayers();

    const sel = el("flight-select");
    if (sel) sel.value = "all";
    setSelectedOverview("all");
  });

  el("scrubber").addEventListener("input", (e) => {
    const idx = Number(e.target.value);
    if (!Number.isFinite(idx)) return;
    updateUiForIndex(idx);
  });

  // HiDPI canvas
  const canvas = el("chart");
  function resizeCanvas() {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    drawChart();
  }

    resizeChartCanvas = resizeCanvas;

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
}

// ===== Main =====
(async function main() {
  initMap();
  wirePanelControls();

  try {
    const items = await loadPolylines();

    // build list A->Z but still draw all
    buildDropdown(items);
    addOverviewPolylines(items);

    el("flight-select").addEventListener("change", (e) => {
      selectFlight(e.target.value);
    });

    setSelectedOverview("all");
    hidePanel();

  } catch (e) {
    console.error(e);
    alert("Failed to initialize map. Check console for details.");
  }
})();