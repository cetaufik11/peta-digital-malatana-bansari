/* ==========================================================================
   WebGIS Pro Dusun Malatana — Advanced Spatial Intelligence Engine
   ========================================================================== */

(function () {
  "use strict";

  const DATA = window.MALATANA_DATA;
  if (!DATA) return;

  const STORAGE_KEY = "malatana_custom_pois_v1";

  // Load persisted custom POIs
  function loadCustomPois() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveCustomPois(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore storage quota errors
    }
  }

  let customPois = loadCustomPois();
  function getAllPois() {
    return [...DATA.pois, ...customPois];
  }

  // State
  let activeCategory = "all";
  let searchQuery = "";
  let selectedId = null;
  let activeTool = null; // null | 'distance' | 'area' | 'buffer' | 'survey'
  let showPermLabels = false;

  // Tool geometries
  let toolPoints = [];
  let toolMarkers = [];
  let toolShape = null;
  let bufferCircle = null;
  let pendingSurveyLatLng = null;

  // Route & Elevation layers
  let routeLayer = null;
  let elevHoverMarker = null;

  // DOM Elements
  const sidebar = document.getElementById("sidebar");
  const poiListEl = document.getElementById("poiList");
  const statCountEl = document.getElementById("statCount");
  const statAreaEl = document.getElementById("statArea");
  const searchInput = document.getElementById("searchInput");
  const btnClearSearch = document.getElementById("btnClearSearch");
  const filterPills = document.getElementById("filterPills");
  const detailDrawer = document.getElementById("detailDrawer");
  const dCode = document.getElementById("dCode");
  const drawerBody = document.getElementById("drawerBody");
  const telCoord = document.getElementById("telCoord");
  const telZoom = document.getElementById("telZoom");
  const toolBanner = document.getElementById("toolBanner");
  const toolBannerText = document.getElementById("toolBannerText");
  const bufferRadiusSelect = document.getElementById("bufferRadiusSelect");
  const toastEl = document.getElementById("toast");

  // Panels & Modals
  const routePanel = document.getElementById("routePanel");
  const routeFrom = document.getElementById("routeFrom");
  const routeTo = document.getElementById("routeTo");
  const routeResult = document.getElementById("routeResult");
  const elevationPanel = document.getElementById("elevationPanel");
  const epChartWrap = document.getElementById("epChartWrap");
  const analyticsModal = document.getElementById("analyticsModal");
  const analyticsBody = document.getElementById("analyticsBody");
  const surveyModal = document.getElementById("surveyModal");
  const surveyForm = document.getElementById("surveyForm");
  const surveyCoordPreview = document.getElementById("surveyCoordPreview");

  // 1. Initialize Map
  const map = L.map("map", {
    center: DATA.center,
    zoom: DATA.defaultZoom,
    zoomControl: false,
    maxZoom: 21,
    minZoom: 13
  });

  L.control.zoom({ position: "topright" }).addTo(map);

  // Basemaps (Authentic Google Maps & Satellite + Dark OSM, zero API key)
  const basemaps = {
    hybrid: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      { subdomains: ["0", "1", "2", "3"], maxNativeZoom: 20, maxZoom: 21, attribution: "Maps &copy; Google" }
    ),
    satellite: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      { subdomains: ["0", "1", "2", "3"], maxNativeZoom: 20, maxZoom: 21, attribution: "Imagery &copy; Google" }
    ),
    gmaps: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
      { subdomains: ["0", "1", "2", "3"], maxNativeZoom: 20, maxZoom: 21, attribution: "Maps &copy; Google" }
    ),
    terrain: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
      { subdomains: ["0", "1", "2", "3"], maxNativeZoom: 18, maxZoom: 21, attribution: "Terrain &copy; Google" }
    ),
    dark: L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { className: "dark-tiles", maxNativeZoom: 19, maxZoom: 21, attribution: "&copy; OpenStreetMap" }
    )
  };

  let currentBasemap = "hybrid";
  basemaps[currentBasemap].addTo(map);

  // Dual-tile SVG ClipPath for true black-and-white outside Desa Bansari & full-color inside
  map.createPane("focusTilePane");
  const focusTilePane = map.getPane("focusTilePane");
  focusTilePane.classList.add("focus-tile-pane");
  focusTilePane.style.zIndex = 205;
  focusTilePane.style.pointerEvents = "none";

  const focusBasemaps = {
    hybrid: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
      { pane: "focusTilePane", subdomains: ["0", "1", "2", "3"], maxNativeZoom: 20, maxZoom: 21 }
    ),
    satellite: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
      { pane: "focusTilePane", subdomains: ["0", "1", "2", "3"], maxNativeZoom: 20, maxZoom: 21 }
    ),
    gmaps: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
      { pane: "focusTilePane", subdomains: ["0", "1", "2", "3"], maxNativeZoom: 20, maxZoom: 21 }
    ),
    terrain: L.tileLayer(
      "https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
      { pane: "focusTilePane", subdomains: ["0", "1", "2", "3"], maxNativeZoom: 18, maxZoom: 21 }
    ),
    dark: L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { pane: "focusTilePane", className: "dark-tiles", maxNativeZoom: 19, maxZoom: 21 }
    )
  };

  let focusEnabled = true;
  if (DATA.desaBansariBoundary) {
    const svgNS = "http://www.w3.org/2000/svg";
    const clipSvg = document.createElementNS(svgNS, "svg");
    clipSvg.setAttribute("aria-hidden", "true");
    clipSvg.style.cssText = "position:fixed;width:0;height:0;pointer-events:none;";
    const defs = document.createElementNS(svgNS, "defs");
    const clipPath = document.createElementNS(svgNS, "clipPath");
    clipPath.setAttribute("id", "bansariClip");
    clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
    const clipPoly = document.createElementNS(svgNS, "polygon");
    clipPath.appendChild(clipPoly);
    defs.appendChild(clipPath);
    clipSvg.appendChild(defs);
    document.body.appendChild(clipSvg);

    focusTilePane.style.clipPath = "url(#bansariClip)";
    focusTilePane.style.webkitClipPath = "url(#bansariClip)";

    const updateBansariClip = () => {
      const pts = DATA.desaBansariBoundary
        .map((c) => {
          const pt = map.latLngToLayerPoint(c);
          return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
        })
        .join(" ");
      clipPoly.setAttribute("points", pts);
    };
    map.on("move zoom viewreset zoomend", updateBansariClip);
    updateBansariClip();
  }

  function syncDesaFocus() {
    const tilePane = map.getPane("tilePane");
    if (focusEnabled) {
      tilePane.classList.add("bw-outside");
      if (!map.hasLayer(focusBasemaps[currentBasemap])) {
        focusBasemaps[currentBasemap].addTo(map);
      }
    } else {
      tilePane.classList.remove("bw-outside");
      Object.values(focusBasemaps).forEach((layer) => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });
    }
  }
  syncDesaFocus();

  // 2. Geodesic Math Helpers
  function calcPolygonAreaSqM(latlngs) {
    if (!latlngs || latlngs.length < 3) return 0;
    const R = 6378137;
    let area = 0;
    const len = latlngs.length;
    for (let i = 0; i < len; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % len];
      const lat1 = (p1[0] ?? p1.lat) * (Math.PI / 180);
      const lng1 = (p1[1] ?? p1.lng) * (Math.PI / 180);
      const lat2 = (p2[0] ?? p2.lat) * (Math.PI / 180);
      const lng2 = (p2[1] ?? p2.lng) * (Math.PI / 180);
      area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs((area * R * R) / 2);
  }

  function calcPolylineLength(coordsList) {
    let total = 0;
    coordsList.forEach((line) => {
      for (let i = 1; i < line.length; i++) {
        total += L.latLng(line[i - 1]).distanceTo(L.latLng(line[i]));
      }
    });
    return total;
  }

  const dusunAreaHa = (calcPolygonAreaSqM(DATA.boundary) / 10000).toFixed(2);
  statAreaEl.textContent = `${dusunAreaHa} ha`;

  // 3. Spatial Vector Layers (Hierarchical: neighbor dusuns subdued -> Dusun Malatan highlighted as CORE)
  const boundaryLayer = L.featureGroup().addTo(map);

  (DATA.neighborBoundaries || []).forEach((dusun) => {
    const areaHa = (calcPolygonAreaSqM(dusun.coords) / 10000).toFixed(2);
    const poly = L.polygon(dusun.coords, {
      color: dusun.color,
      weight: 1.6,
      opacity: 0.55,
      dashArray: "4 5",
      fillColor: dusun.color,
      fillOpacity: 0.22
    }).addTo(boundaryLayer);
    poly.bindTooltip(`${escapeHtml(dusun.name)} (~${areaHa} ha)`, {
      permanent: true,
      direction: "center",
      className: "neighbor-dusun-label"
    });
  });

  // CORE Highlight: Dusun Malatan with glowing double-halo border & crisp interior
  L.polygon(DATA.boundary, {
    color: "#34d399",
    weight: 11,
    opacity: 0.32,
    fill: false,
    interactive: false
  }).addTo(boundaryLayer);

  L.polygon(DATA.boundary, {
    color: "#ffffff",
    weight: 5,
    opacity: 0.85,
    fill: false,
    interactive: false
  }).addTo(boundaryLayer);

  const malatanBoundary = L.polygon(DATA.boundary, {
    color: "#10b981",
    weight: 3,
    opacity: 1,
    fillColor: "#10b981",
    fillOpacity: 0.04
  }).addTo(boundaryLayer);
  malatanBoundary.bindTooltip(`★ DUSUN MALATAN · PUSAT (${dusunAreaHa} ha)`, {
    permanent: true,
    direction: "center",
    className: "core-dusun-label"
  });

  // Outer Village Administrative Boundary (Desa Bansari) with distinct dot-dash-halo motif
  const desaBansariLayer = L.featureGroup().addTo(map);
  if (DATA.desaBansariBoundary) {
    const desaAreaHa = (calcPolygonAreaSqM(DATA.desaBansariBoundary) / 10000).toFixed(2);
    L.polygon(DATA.desaBansariBoundary, {
      color: "#ffffff",
      weight: 6.5,
      opacity: 0.9,
      fill: false,
      interactive: false
    }).addTo(desaBansariLayer);

    const desaPoly = L.polygon(DATA.desaBansariBoundary, {
      color: "#dc2626",
      weight: 3.5,
      dashArray: "16 6 3 6",
      opacity: 0.98,
      fillColor: "#ffffff",
      fillOpacity: 0.02
    }).addTo(desaBansariLayer);
    desaPoly.bindTooltip(`<strong>Batas Wilayah Desa Bansari</strong> (~${desaAreaHa} ha)`, {
      sticky: true,
      direction: "top"
    });
  }

  // (Outside B&W spotlight is handled by tilePane.bw-outside + clipped focusTilePane)

  const roadLayer = L.layerGroup();
  DATA.roads.forEach((coords) => {
    L.polyline(coords, { color: "#f59e0b", weight: 3.2, opacity: 0.85 }).addTo(roadLayer);
  });

  const riverLayer = L.layerGroup();
  DATA.rivers.forEach((coords) => {
    L.polyline(coords, { color: "#38bdf8", weight: 3, opacity: 0.85, dashArray: "4 4" }).addTo(riverLayer);
  });

  const harmonyLayer = L.layerGroup();
  const harmonyLine = L.polyline(DATA.harmonyLine, { color: "#ec4899", weight: 2.8, dashArray: "5 5" }).addTo(harmonyLayer);
  harmonyLine.bindTooltip("Simpul Harmoni Lintas Iman (±82,4 m)", { sticky: true });

  // Activity Density Zone Layer (Heatmap-like radial zones)
  const heatmapLayer = L.layerGroup();
  const activityZones = [
    { coords: [-7.28058, 110.05173], radius: 110, color: "#10b981", label: "Zona Inti Bina Damai (Masjid - TPQ - GKJ)" },
    { coords: [-7.27990, 110.05286], radius: 60, color: "#f59e0b", label: "Zona Sosial & Gedung Kesenian Malatan" },
    { coords: [-7.28145, 110.05200], radius: 85, color: "#ef4444", label: "Zona Ekonomi Agraris & Niaga Warga" }
  ];
  activityZones.forEach((z) => {
    L.circle(z.coords, {
      radius: z.radius,
      color: z.color,
      weight: 1,
      fillColor: z.color,
      fillOpacity: 0.22
    })
      .bindTooltip(z.label, { sticky: true })
      .addTo(heatmapLayer);
  });

  // 4. POI Markers
  const markersLayer = L.layerGroup().addTo(map);

  function createCustomIcon(poi, isSelected) {
    return L.divIcon({
      className: "custom-marker-wrapper",
      html: `<div class="custom-pin ${isSelected ? "selected" : ""}" style="background:${poi.color}"><span>${poi.num}</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }

  function renderMarkers(filteredPois) {
    markersLayer.clearLayers();
    filteredPois.forEach((poi) => {
      const marker = L.marker([poi.lat, poi.lng], {
        icon: createCustomIcon(poi, poi.id === selectedId)
      });

      if (showPermLabels) {
        marker.bindTooltip(poi.name, {
          permanent: true,
          direction: "right",
          offset: [14, -18],
          className: "perm-label"
        });
      } else {
        marker.bindTooltip(`<strong>${poi.code}</strong> · ${poi.name}`, {
          direction: "top",
          offset: [0, -28]
        });
      }

      marker.on("click", () => {
        if (activeTool === "buffer") {
          runBufferAnalysis(L.latLng(poi.lat, poi.lng), poi.name);
        } else if (!activeTool) {
          selectPoi(poi.id);
        }
      });

      marker.addTo(markersLayer);
    });
  }

  // 5. Filter & Render List
  function getFilteredPois() {
    return getAllPois().filter((poi) => {
      const matchCat = activeCategory === "all" || poi.cat === activeCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        poi.name.toLowerCase().includes(q) ||
        poi.subtitle.toLowerCase().includes(q) ||
        poi.code.toLowerCase().includes(q) ||
        poi.desc.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }

  function renderList() {
    const filtered = getFilteredPois();
    statCountEl.textContent = filtered.length;
    renderMarkers(filtered);

    if (filtered.length === 0) {
      poiListEl.innerHTML = `<div class="empty-state">Tidak ditemukan lokasi yang cocok dengan "${escapeHtml(searchQuery)}".</div>`;
      return;
    }

    poiListEl.innerHTML = filtered
      .map(
        (poi) => `
      <button class="poi-card ${poi.id === selectedId ? "active" : ""}" data-id="${poi.id}">
        <div class="poi-num" style="background:${poi.color}">${poi.num}</div>
        <div class="poi-info">
          <div class="poi-title">${escapeHtml(poi.name)}</div>
          <div class="poi-meta">
            <span class="poi-badge">${escapeHtml(poi.catLabel)}</span>
            <span>·</span>
            <span>${poi.elev} mdpl</span>
            ${poi.gpsVerified ? '<span class="gps-dot" title="GPS Terverifikasi"></span>' : ""}
          </div>
        </div>
      </button>
    `
      )
      .join("");

    poiListEl.querySelectorAll(".poi-card").forEach((card) => {
      card.addEventListener("click", () => selectPoi(card.dataset.id));
    });
  }

  // 6. Select POI & Detail Drawer
  function selectPoi(id) {
    const poi = getAllPois().find((p) => p.id === id);
    if (!poi) return;

    selectedId = id;
    renderList();

    map.flyTo([poi.lat, poi.lng], 19, { animate: true, duration: 0.75 });

    dCode.textContent = poi.code;
    const coordStr = `${poi.lat.toFixed(6)}, ${poi.lng.toFixed(6)}`;
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`;
    const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${poi.lat},${poi.lng}`;

    const specsRows = Object.entries(poi.specs || {})
      .map(
        ([k, v]) => `
        <div class="d-spec-row">
          <span class="d-spec-key">${escapeHtml(k)}</span>
          <span class="d-spec-val">${escapeHtml(v)}</span>
        </div>
      `
      )
      .join("");

    drawerBody.innerHTML = `
      <span class="d-cat" style="color:${poi.color}">${escapeHtml(poi.catLabel)}</span>
      <h2 class="d-title">${escapeHtml(poi.name)}</h2>
      <p class="d-sub">${escapeHtml(poi.subtitle)}</p>

      <div class="d-quick-stats">
        <div class="d-stat-box">
          <span class="lbl">Elevasi</span>
          <span class="val">± ${poi.elev} mdpl</span>
        </div>
        <div class="d-stat-box">
          <span class="lbl">Koordinat WGS84</span>
          <span class="val">${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)}</span>
        </div>
      </div>

      <p class="d-desc">${escapeHtml(poi.desc)}</p>

      ${
        poi.quote
          ? `<blockquote class="d-quote"><p>“${escapeHtml(poi.quote)}”</p><cite>— ${escapeHtml(poi.quoteCite)}</cite></blockquote>`
          : ""
      }

      ${specsRows ? `<div class="d-specs">${specsRows}</div>` : ""}

      <div class="d-actions">
        <a class="btn-primary" href="${gmapsUrl}" target="_blank" rel="noopener noreferrer">Google Maps</a>
        <a class="btn-secondary" href="${streetViewUrl}" target="_blank" rel="noopener noreferrer">👁️ Street View</a>
      </div>
      <div class="d-actions-full">
        <button class="btn-secondary" id="btnCopyCoord" data-coord="${coordStr}">📋 Salin Koordinat</button>
        <button class="btn-secondary" id="btnRouteToHere">🧭 Hitung Rute Jalan Kaki ke Sini</button>
        ${poi.isCustom ? `<button class="btn-danger" id="btnDeleteCustom">🗑️ Hapus Titik Survei Ini</button>` : ""}
      </div>
    `;

    document.getElementById("btnCopyCoord").addEventListener("click", (e) => {
      const val = e.currentTarget.dataset.coord;
      navigator.clipboard?.writeText(val).then(() => showToast(`Koordinat disalin: ${val}`));
    });

    document.getElementById("btnRouteToHere").addEventListener("click", () => {
      openRoutePanel(null, poi.id);
    });

    const btnDel = document.getElementById("btnDeleteCustom");
    if (btnDel) {
      btnDel.addEventListener("click", () => {
        customPois = customPois.filter((p) => p.id !== poi.id);
        saveCustomPois(customPois);
        closeDrawer();
        populateRouteSelects();
        renderList();
        showToast("Titik survei dihapus");
      });
    }

    detailDrawer.classList.add("open");
    detailDrawer.setAttribute("aria-hidden", "false");
    if (window.innerWidth <= 768) sidebar.classList.add("collapsed");
  }

  function closeDrawer() {
    selectedId = null;
    detailDrawer.classList.remove("open");
    detailDrawer.setAttribute("aria-hidden", "true");
    renderList();
  }

  // 7. Basemap & Layer Controls
  document.getElementById("basemapSwitcher").addEventListener("click", (e) => {
    const btn = e.target.closest(".bm-btn");
    if (!btn) return;
    const bm = btn.dataset.bm;
    if (bm === currentBasemap || !basemaps[bm]) return;

    const tilePane = map.getPane("tilePane");
    tilePane.classList.add("basemap-blur-fade");
    focusTilePane.classList.add("basemap-blur-fade");

    document.querySelectorAll(".bm-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    setTimeout(() => {
      map.removeLayer(basemaps[currentBasemap]);
      if (map.hasLayer(focusBasemaps[currentBasemap])) {
        map.removeLayer(focusBasemaps[currentBasemap]);
      }
      basemaps[bm].addTo(map);
      currentBasemap = bm;
      syncDesaFocus();

      const clearBlur = () => {
        tilePane.classList.remove("basemap-blur-fade");
        focusTilePane.classList.remove("basemap-blur-fade");
      };
      basemaps[bm].once("load", clearBlur);
      setTimeout(clearBlur, 350);
    }, 180);
  });

  function bindLayerToggle(checkboxId, layer) {
    document.getElementById(checkboxId).addEventListener("change", (e) => {
      if (e.target.checked) layer.addTo(map);
      else map.removeLayer(layer);
    });
  }

  bindLayerToggle("lyrBoundary", boundaryLayer);
  bindLayerToggle("lyrDesaBansari", desaBansariLayer);
  document.getElementById("lyrDesaFocus").addEventListener("change", (e) => {
    focusEnabled = e.target.checked;
    syncDesaFocus();
  });
  bindLayerToggle("lyrRoads", roadLayer);
  bindLayerToggle("lyrRivers", riverLayer);
  bindLayerToggle("lyrHarmony", harmonyLayer);
  bindLayerToggle("lyrHeatmap", heatmapLayer);

  document.getElementById("lyrLabels").addEventListener("change", (e) => {
    showPermLabels = e.target.checked;
    renderList();
  });

  // 8. Spatial Tools (Distance, Area, Buffer, Survey)
  const dockButtons = {
    distance: document.getElementById("btnMeasureDist"),
    area: document.getElementById("btnMeasureArea"),
    buffer: document.getElementById("btnBufferTool"),
    survey: document.getElementById("btnAddPoi")
  };

  function clearToolGeometries() {
    toolPoints = [];
    toolMarkers.forEach((m) => map.removeLayer(m));
    toolMarkers = [];
    if (toolShape) {
      map.removeLayer(toolShape);
      toolShape = null;
    }
    if (bufferCircle) {
      map.removeLayer(bufferCircle);
      bufferCircle = null;
    }
  }

  function setTool(mode) {
    clearToolGeometries();
    Object.values(dockButtons).forEach((b) => b?.classList.remove("active"));

    if (activeTool === mode || !mode) {
      activeTool = null;
      toolBanner.style.display = "none";
      bufferRadiusSelect.style.display = "none";
      document.getElementById("map").style.cursor = "";
      return;
    }

    activeTool = mode;
    dockButtons[mode]?.classList.add("active");
    toolBanner.style.display = "flex";
    bufferRadiusSelect.style.display = mode === "buffer" ? "inline-block" : "none";
    document.getElementById("map").style.cursor = "crosshair";

    if (mode === "distance") {
      toolBannerText.innerHTML = `Ukur Jarak: Klik titik di peta (<strong>0 m</strong>)`;
    } else if (mode === "area") {
      toolBannerText.innerHTML = `Ukur Luas Poligon: Klik min. 3 titik (<strong>0 m²</strong>)`;
    } else if (mode === "buffer") {
      toolBannerText.innerHTML = `Analisis Radius: Klik di peta atau lokasi untuk cek jangkauan`;
    } else if (mode === "survey") {
      toolBannerText.innerHTML = `Mode Survei: Klik lokasi di peta untuk menambah titik baru`;
    }
  }

  dockButtons.distance.addEventListener("click", () => setTool("distance"));
  dockButtons.area.addEventListener("click", () => setTool("area"));
  dockButtons.buffer.addEventListener("click", () => setTool("buffer"));
  dockButtons.survey.addEventListener("click", () => setTool("survey"));
  document.getElementById("btnToolClear").addEventListener("click", () => {
    clearToolGeometries();
    if (activeTool === "distance") toolBannerText.innerHTML = `Ukur Jarak: Klik titik di peta (<strong>0 m</strong>)`;
    if (activeTool === "area") toolBannerText.innerHTML = `Ukur Luas Poligon: Klik min. 3 titik (<strong>0 m²</strong>)`;
    if (activeTool === "buffer") toolBannerText.innerHTML = `Analisis Radius: Klik di peta atau lokasi`;
  });
  document.getElementById("btnToolExit").addEventListener("click", () => setTool(null));

  function runBufferAnalysis(latlng, originLabel) {
    clearToolGeometries();
    const radius = parseInt(bufferRadiusSelect.value, 10) || 100;
    bufferCircle = L.circle(latlng, {
      radius,
      color: "#a855f7",
      weight: 2,
      fillColor: "#a855f7",
      fillOpacity: 0.16
    }).addTo(map);

    const inside = getAllPois()
      .map((p) => ({
        poi: p,
        dist: latlng.distanceTo(L.latLng(p.lat, p.lng))
      }))
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist);

    const names = inside.map((x) => `${x.poi.name} (${Math.round(x.dist)}m)`).join(", ");
    toolBannerText.innerHTML = `Radius ${radius}m${originLabel ? " dr " + escapeHtml(originLabel) : ""}: <strong>${inside.length} lokasi</strong> ditemukan`;
    if (inside.length > 0) {
      bufferCircle.bindPopup(`<strong>${inside.length} Lokasi dalam ${radius}m:</strong><br/>${escapeHtml(names)}`).openPopup();
    } else {
      showToast(`Tidak ada lokasi dalam radius ${radius} meter`);
    }
  }

  bufferRadiusSelect.addEventListener("change", () => {
    if (bufferCircle) {
      runBufferAnalysis(bufferCircle.getLatLng());
    }
  });

  map.on("click", (e) => {
    if (!activeTool) return;
    const latlng = e.latlng;

    if (activeTool === "survey") {
      pendingSurveyLatLng = latlng;
      surveyCoordPreview.textContent = `Koordinat: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
      surveyModal.style.display = "flex";
      return;
    }

    if (activeTool === "buffer") {
      runBufferAnalysis(latlng);
      return;
    }

    toolPoints.push(latlng);
    const pt = L.circleMarker(latlng, {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: "#f59e0b",
      fillOpacity: 1
    }).addTo(map);
    toolMarkers.push(pt);

    if (activeTool === "distance" && toolPoints.length >= 2) {
      if (toolShape) map.removeLayer(toolShape);
      toolShape = L.polyline(toolPoints, { color: "#f59e0b", weight: 3, dashArray: "6 4" }).addTo(map);
      let meters = 0;
      for (let i = 1; i < toolPoints.length; i++) meters += toolPoints[i - 1].distanceTo(toolPoints[i]);
      const formatted = meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
      toolBannerText.innerHTML = `Ukur Jarak (${toolPoints.length} titik): <strong>${formatted}</strong>`;
    }

    if (activeTool === "area" && toolPoints.length >= 3) {
      if (toolShape) map.removeLayer(toolShape);
      toolShape = L.polygon(toolPoints, {
        color: "#10b981",
        weight: 2.5,
        fillColor: "#10b981",
        fillOpacity: 0.25
      }).addTo(map);
      const sqm = calcPolygonAreaSqM(toolPoints);
      const ha = sqm / 10000;
      const formatted = sqm >= 10000 ? `${ha.toFixed(2)} ha (${Math.round(sqm).toLocaleString("id-ID")} m²)` : `${Math.round(sqm).toLocaleString("id-ID")} m²`;
      toolBannerText.innerHTML = `Luas Area Poligon: <strong>${formatted}</strong>`;
    }
  });

  // 9. Point-to-Point Route Simulator
  function populateRouteSelects() {
    const pois = getAllPois();
    const opts = pois.map((p) => `<option value="${p.id}">${p.code} — ${escapeHtml(p.name)}</option>`).join("");
    routeFrom.innerHTML = opts;
    routeTo.innerHTML = opts;
    if (pois.length > 1) routeTo.selectedIndex = 1;
  }

  function calculateRoute() {
    const fromId = routeFrom.value;
    const toId = routeTo.value;
    const p1 = getAllPois().find((p) => p.id === fromId);
    const p2 = getAllPois().find((p) => p.id === toId);
    if (!p1 || !p2) return;

    if (routeLayer) map.removeLayer(routeLayer);
    if (p1.id === p2.id) {
      routeResult.textContent = "Pilih dua lokasi yang berbeda.";
      return;
    }

    const ll1 = L.latLng(p1.lat, p1.lng);
    const ll2 = L.latLng(p2.lat, p2.lng);
    const straightDist = ll1.distanceTo(ll2);
    // Realistic rural path factor (~1.18x)
    const walkDist = Math.round(straightDist * 1.18);
    const walkMins = Math.max(1, Math.round(walkDist / 72)); // ~4.3 km/h rural walking pace
    const elevDiff = p2.elev - p1.elev;
    const elevText = elevDiff > 0 ? `+${elevDiff} m (Naik)` : elevDiff < 0 ? `${elevDiff} m (Turun)` : "Datar";

    // Create intermediate curved waypoint to represent rural road corridor
    const midLat = (p1.lat + p2.lat) / 2 + 0.00012;
    const midLng = (p1.lng + p2.lng) / 2;

    routeLayer = L.polyline([[p1.lat, p1.lng], [midLat, midLng], [p2.lat, p2.lng]], {
      color: "#38bdf8",
      weight: 4.5,
      opacity: 0.95,
      className: "animated-route"
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [80, 80], animate: true });

    routeResult.innerHTML = `
      <div><strong>${escapeHtml(p1.name)}</strong> → <strong>${escapeHtml(p2.name)}</strong></div>
      <div class="route-metrics">
        <div class="rm-box"><span class="rm-val">${walkDist} m</span><span class="rm-lbl">Estimasi Jarak</span></div>
        <div class="rm-box"><span class="rm-val">~${walkMins} mnt</span><span class="rm-lbl">Jalan Kaki</span></div>
        <div class="rm-box"><span class="rm-val">${elevText}</span><span class="rm-lbl">Elevasi</span></div>
      </div>
    `;
  }

  function openRoutePanel(fromId, toId) {
    populateRouteSelects();
    if (fromId) routeFrom.value = fromId;
    if (toId) routeTo.value = toId;
    routePanel.style.display = "block";
    document.getElementById("btnRouteMode").classList.add("active");
    calculateRoute();
  }

  document.getElementById("btnRouteMode").addEventListener("click", () => {
    const visible = routePanel.style.display === "block";
    if (visible) {
      routePanel.style.display = "none";
      document.getElementById("btnRouteMode").classList.remove("active");
      if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
      }
    } else {
      openRoutePanel();
    }
  });

  document.getElementById("btnCloseRoute").addEventListener("click", () => {
    routePanel.style.display = "none";
    document.getElementById("btnRouteMode").classList.remove("active");
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
  });

  routeFrom.addEventListener("change", calculateRoute);
  routeTo.addEventListener("change", calculateRoute);

  // 10. Interactive Elevation Profile (SVG Chart + Map Sync)
  function renderElevationChart() {
    // Sort key points West-to-East / High-to-Low transect across Dusun Malatana
    const transect = [...DATA.pois].sort((a, b) => a.lng - b.lng);
    const width = epChartWrap.clientWidth || 720;
    const height = 140;
    const padX = 36;
    const padY = 20;

    const minElev = 1230;
    const maxElev = 1270;

    const points = transect.map((p, idx) => {
      const x = padX + (idx / (transect.length - 1)) * (width - padX * 2);
      const y = height - padY - ((p.elev - minElev) / (maxElev - minElev)) * (height - padY * 2);
      return { x, y, poi: p };
    });

    const linePath = points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - padY} L${points[0].x.toFixed(1)},${height - padY} Z`;

    epChartWrap.innerHTML = `
      <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3 3"/>
        <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="rgba(255,255,255,0.12)"/>
        <text x="4" y="${padY + 4}" fill="#94a3b8" font-size="10" font-family="JetBrains Mono">1270m</text>
        <text x="4" y="${height - padY}" fill="#94a3b8" font-size="10" font-family="JetBrains Mono">1230m</text>
        <path d="${areaPath}" fill="url(#elevGrad)" />
        <path d="${linePath}" fill="none" stroke="#10b981" stroke-width="2.5" />
        ${points
          .map(
            (pt, idx) => `
          <circle class="ep-node" data-idx="${idx}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" fill="${pt.poi.color}" stroke="#fff" stroke-width="1.5" style="cursor:pointer"/>
        `
          )
          .join("")}
      </svg>
    `;

    epChartWrap.querySelectorAll(".ep-node").forEach((node) => {
      node.addEventListener("mouseenter", () => {
        const pt = points[node.dataset.idx];
        document.getElementById("epSubtitle").textContent = `${pt.poi.name} — Elevasi ± ${pt.poi.elev} mdpl`;
        if (elevHoverMarker) map.removeLayer(elevHoverMarker);
        elevHoverMarker = L.circleMarker([pt.poi.lat, pt.poi.lng], {
          radius: 11,
          color: "#fff",
          weight: 2.5,
          fillColor: "#10b981",
          fillOpacity: 0.55
        }).addTo(map);
      });
      node.addEventListener("click", () => {
        const pt = points[node.dataset.idx];
        selectPoi(pt.poi.id);
      });
    });
  }

  document.getElementById("btnElevation").addEventListener("click", () => {
    const isOpen = elevationPanel.style.display === "flex";
    elevationPanel.style.display = isOpen ? "none" : "flex";
    document.getElementById("btnElevation").classList.toggle("active", !isOpen);
    if (!isOpen) renderElevationChart();
  });

  document.getElementById("btnCloseElevation").addEventListener("click", () => {
    elevationPanel.style.display = "none";
    document.getElementById("btnElevation").classList.remove("active");
    if (elevHoverMarker) {
      map.removeLayer(elevHoverMarker);
      elevHoverMarker = null;
    }
  });

  // 11. Custom Field Survey Modal
  function closeSurveyModal() {
    surveyModal.style.display = "none";
    surveyForm.reset();
    pendingSurveyLatLng = null;
  }

  document.getElementById("btnCloseSurveyModal").addEventListener("click", closeSurveyModal);
  document.getElementById("btnCancelSurvey").addEventListener("click", closeSurveyModal);

  surveyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!pendingSurveyLatLng) return;

    const cat = document.getElementById("svCat").value;
    const catMeta = {
      survei: { label: "Survei Lapangan", color: "#a855f7" },
      ibadah: { label: "Ibadah & Bina Damai", color: "#10b981" },
      sejarah: { label: "Sejarah & Adat", color: "#e07a5f" },
      budaya: { label: "Budaya & Warga", color: "#f59e0b" },
      agraris: { label: "Agraris & Akses", color: "#38bdf8" }
    }[cat] || { label: "Survei Lapangan", color: "#a855f7" };

    const newNum = String(getAllPois().length + 1).padStart(2, "0");
    const newPoi = {
      id: `custom-${Date.now()}`,
      code: `SRV-${newNum}`,
      num: newNum,
      name: document.getElementById("svName").value.trim(),
      subtitle: document.getElementById("svSub").value.trim() || "Titik Survei Lapangan Warga",
      cat,
      catLabel: catMeta.label,
      color: catMeta.color,
      lat: pendingSurveyLatLng.lat,
      lng: pendingSurveyLatLng.lng,
      elev: parseInt(document.getElementById("svElev").value, 10) || 1248,
      gpsVerified: true,
      isCustom: true,
      desc: document.getElementById("svDesc").value.trim() || "Data ditambahkan melalui alat survei WebGIS Dusun Malatana.",
      specs: {
        "Sumber Data": "Survei Lapangan Pengguna",
        "Waktu Input": new Date().toLocaleDateString("id-ID")
      }
    };

    customPois.push(newPoi);
    saveCustomPois(customPois);
    closeSurveyModal();
    setTool(null);
    populateRouteSelects();
    renderList();
    selectPoi(newPoi.id);
    showToast("Titik survei berhasil disimpan ke peta!");
  });

  // 12. Analytics & GeoJSON/CSV Export
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGeoJSON() {
    const features = [
      {
        type: "Feature",
        properties: { name: "Batas Wilayah Dusun Malatana", type: "boundary", area_ha: parseFloat(dusunAreaHa) },
        geometry: { type: "Polygon", coordinates: [DATA.boundary.map(([lat, lng]) => [lng, lat])] }
      },
      ...DATA.roads.map((r, i) => ({
        type: "Feature",
        properties: { name: `Jaringan Jalan ${i + 1}`, type: "road" },
        geometry: { type: "LineString", coordinates: r.map(([lat, lng]) => [lng, lat]) }
      })),
      ...DATA.rivers.map((r, i) => ({
        type: "Feature",
        properties: { name: `Alur Sungai ${i + 1}`, type: "river" },
        geometry: { type: "LineString", coordinates: r.map(([lat, lng]) => [lng, lat]) }
      })),
      ...getAllPois().map((p) => ({
        type: "Feature",
        properties: { code: p.code, name: p.name, category: p.catLabel, elevation_mdpl: p.elev, description: p.desc },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] }
      }))
    ];

    const fc = { type: "FeatureCollection", features };
    downloadFile("peta-dusun-malatana-bansari.geojson", JSON.stringify(fc, null, 2), "application/geo+json");
    showToast("File GeoJSON berhasil diunduh!");
  }

  function exportCSV() {
    const header = "Kode,Nama,Kategori,Latitude,Longitude,Elevasi_mdpl,Deskripsi\n";
    const rows = getAllPois()
      .map((p) => `"${p.code}","${p.name.replace(/"/g, '""')}","${p.catLabel}",${p.lat},${p.lng},${p.elev},"${p.desc.replace(/"/g, '""')}"`)
      .join("\n");
    downloadFile("data-lokasi-dusun-malatana.csv", header + rows, "text/csv;charset=utf-8;");
    showToast("File CSV berhasil diunduh!");
  }

  document.getElementById("btnExportGeoJSON").addEventListener("click", exportGeoJSON);

  document.getElementById("btnAnalytics").addEventListener("click", () => {
    const pois = getAllPois();
    const roadLen = Math.round(calcPolylineLength(DATA.roads));
    const riverLen = Math.round(calcPolylineLength(DATA.rivers));

    const counts = {
      ibadah: pois.filter((p) => p.cat === "ibadah").length,
      sejarah: pois.filter((p) => p.cat === "sejarah").length,
      budaya: pois.filter((p) => p.cat === "budaya").length,
      agraris: pois.filter((p) => p.cat === "agraris").length,
      survei: pois.filter((p) => p.cat === "survei").length
    };

    const maxCount = Math.max(1, ...Object.values(counts));
    const bars = [
      { label: "Ibadah & Damai", count: counts.ibadah, color: "#10b981" },
      { label: "Sejarah & Adat", count: counts.sejarah, color: "#e07a5f" },
      { label: "Budaya & Warga", count: counts.budaya, color: "#f59e0b" },
      { label: "Agraris & Akses", count: counts.agraris, color: "#38bdf8" },
      { label: "Survei Lapangan", count: counts.survei, color: "#a855f7" }
    ];

    analyticsBody.innerHTML = `
      <div class="analytics-grid">
        <div class="an-card"><span class="an-val">${pois.length}</span><span class="an-lbl">Total Titik Lokasi</span></div>
        <div class="an-card"><span class="an-val">${dusunAreaHa} ha</span><span class="an-lbl">Luas Poligon Dusun</span></div>
        <div class="an-card"><span class="an-val">${roadLen} m</span><span class="an-lbl">Panjang Jaringan Jalan</span></div>
        <div class="an-card"><span class="an-val">${riverLen} m</span><span class="an-lbl">Alur Sungai Terpetakan</span></div>
      </div>

      <h4 style="font-size:13px; margin-bottom:10px; color:var(--text-secondary)">Distribusi Titik Spasial per Kategori</h4>
      <div class="an-bars">
        ${bars
          .map(
            (b) => `
          <div class="an-bar-row">
            <span class="an-bar-label">${b.label}</span>
            <div class="an-bar-track"><div class="an-bar-fill" style="width:${(b.count / maxCount) * 100}%; background:${b.color}"></div></div>
            <span class="an-bar-count">${b.count}</span>
          </div>
        `
          )
          .join("")}
      </div>

      <div class="export-bar">
        <button class="btn-primary" id="btnAnExportGeo">⬇️ Unduh GeoJSON (QGIS / ArcGIS)</button>
        <button class="btn-secondary" id="btnAnExportCsv">⬇️ Unduh CSV (Excel)</button>
      </div>
    `;

    document.getElementById("btnAnExportGeo").addEventListener("click", exportGeoJSON);
    document.getElementById("btnAnExportCsv").addEventListener("click", exportCSV);
    analyticsModal.style.display = "flex";
  });

  document.getElementById("btnCloseAnalytics").addEventListener("click", () => {
    analyticsModal.style.display = "none";
  });

  // 13. Search, Filter & Topbar Actions
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    btnClearSearch.style.display = searchQuery ? "block" : "none";
    renderList();
  });

  btnClearSearch.addEventListener("click", () => {
    searchQuery = "";
    searchInput.value = "";
    btnClearSearch.style.display = "none";
    renderList();
  });

  filterPills.addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    activeCategory = pill.dataset.cat;
    filterPills.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    renderList();
  });

  document.getElementById("btnToggleSidebar").addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });

  document.getElementById("btnCloseDrawer").addEventListener("click", closeDrawer);

  document.getElementById("btnResetView").addEventListener("click", () => {
    map.fitBounds(malatanBoundary.getBounds(), { padding: [40, 40], animate: true });
    showToast("Tampilan dipusatkan ke Dusun Malatan");
  });

  const btnTheme = document.getElementById("btnTheme");
  const iconSun = document.getElementById("iconSun");
  const iconMoon = document.getElementById("iconMoon");

  btnTheme.addEventListener("click", () => {
    const html = document.documentElement;
    const isDark = html.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    html.setAttribute("data-theme", next);
    iconSun.style.display = next === "dark" ? "block" : "none";
    iconMoon.style.display = next === "light" ? "block" : "none";
  });

  // Live Telemetry & Real-Time Terrarium DEM Elevation Sampler (mdpl)
  const telElev = document.getElementById("telElev");
  const demTileCache = new Map();

  function getTerrariumElevation(lat, lng) {
    const z = 14;
    const n = 2 ** z;
    const xFloat = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const tx = Math.floor(xFloat);
    const ty = Math.floor(yFloat);
    const key = `${z}/${tx}/${ty}`;
    const entry = demTileCache.get(key);
    if (!entry) {
      demTileCache.set(key, { status: "loading" });
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        demTileCache.set(key, { status: "ready", ctx });
      };
      img.onerror = () => demTileCache.set(key, { status: "error" });
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      return null;
    }
    if (entry.status !== "ready") return null;
    const px = Math.min(255, Math.max(0, Math.floor((xFloat - tx) * 256)));
    const py = Math.min(255, Math.max(0, Math.floor((yFloat - ty) * 256)));
    const d = entry.ctx.getImageData(px, py, 1, 1).data;
    return Math.round(d[0] * 256 + d[1] + d[2] / 256 - 32768);
  }

  // Preload center DEM tile on startup
  getTerrariumElevation(DATA.center[0], DATA.center[1]);

  map.on("mousemove", (e) => {
    telCoord.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    if (telElev) {
      const elev = getTerrariumElevation(e.latlng.lat, e.latlng.lng);
      if (elev !== null) telElev.textContent = `${elev.toLocaleString("id-ID")} mdpl`;
    }
  });

  map.on("zoomend", () => {
    telZoom.textContent = map.getZoom();
  });

  // Helpers
  function escapeHtml(str) {
    if (typeof str !== "string") return str;
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  // =========================================================
  // 10. Live Weather (Open-Meteo), Time Machine & 3D Terrain
  // =========================================================
  async function loadLiveWeather() {
    const weatherIcon = document.getElementById("weatherIcon");
    const weatherText = document.getElementById("weatherText");
    if (!weatherText) return;
    try {
      const url = "https://api.open-meteo.com/v1/forecast?latitude=-7.28035&longitude=110.05220&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia%2FJakarta";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Weather HTTP " + res.status);
      const json = await res.json();
      const c = json.current || {};
      const code = c.weather_code ?? 2;
      let icon = "⛅";
      let desc = "Berawan";
      if (code === 0) { icon = "☀️"; desc = "Cerah"; }
      else if (code <= 3) { icon = "⛅"; desc = "Cerah Berawan"; }
      else if (code >= 45 && code <= 48) { icon = "🌫️"; desc = "Berkabut"; }
      else if (code >= 51 && code <= 67) { icon = "🌧️"; desc = "Hujan"; }
      else if (code >= 80) { icon = "⛈️"; desc = "Hujan Lebat"; }
      weatherIcon.textContent = icon;
      weatherText.textContent = `${c.temperature_2m}°C · ${desc} · ${c.relative_humidity_2m}% RH`;
    } catch {
      weatherText.textContent = "Lereng Sindoro · ±1.320 mdpl";
    }
  }
  loadLiveWeather();

  // Esri Wayback Time Machine (2014 - 2026)
  const tmBar = document.getElementById("timeMachineBar");
  const btnToggleTM = document.getElementById("btnToggleTM");
  const btnCloseTM = document.getElementById("btnCloseTM");
  let waybackBaseLayer = null;
  let waybackFocusLayer = null;

  function clearWaybackLayers() {
    if (waybackBaseLayer && map.hasLayer(waybackBaseLayer)) map.removeLayer(waybackBaseLayer);
    if (waybackFocusLayer && map.hasLayer(waybackFocusLayer)) map.removeLayer(waybackFocusLayer);
    waybackBaseLayer = null;
    waybackFocusLayer = null;
  }

  function applyWaybackYear(rel, year) {
    clearWaybackLayers();
    if (map.hasLayer(basemaps[currentBasemap])) map.removeLayer(basemaps[currentBasemap]);
    if (map.hasLayer(focusBasemaps[currentBasemap])) map.removeLayer(focusBasemaps[currentBasemap]);

    const tmUrl = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rel}/{z}/{y}/{x}`;
    waybackBaseLayer = L.tileLayer(tmUrl, { maxNativeZoom: 17, maxZoom: 21, attribution: `Esri Wayback ${year}` }).addTo(map);
    if (focusEnabled) {
      waybackFocusLayer = L.tileLayer(tmUrl, { pane: "focusTilePane", maxNativeZoom: 17, maxZoom: 21 }).addTo(map);
    }
    showToast(`Citra Satelit Tahun ${year} dimuat`);
  }

  btnToggleTM.addEventListener("click", () => {
    const isOpen = tmBar.style.display !== "none";
    if (isOpen) {
      btnCloseTM.click();
    } else {
      tmBar.style.display = "flex";
      btnToggleTM.classList.add("active");
      const activeYearBtn = document.querySelector(".tm-btn.active");
      if (activeYearBtn) applyWaybackYear(activeYearBtn.dataset.rel, activeYearBtn.dataset.year);
    }
  });

  document.getElementById("tmYears").addEventListener("click", (e) => {
    const btn = e.target.closest(".tm-btn");
    if (!btn) return;
    document.querySelectorAll(".tm-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    applyWaybackYear(btn.dataset.rel, btn.dataset.year);
  });

  btnCloseTM.addEventListener("click", () => {
    tmBar.style.display = "none";
    btnToggleTM.classList.remove("active");
    clearWaybackLayers();
    basemaps[currentBasemap].addTo(map);
    syncDesaFocus();
    showToast("Kembali ke peta utama");
  });

  // 3D Terrain Mode (MapLibre GL JS + AWS Terrarium DEM)
  const map3dEl = document.getElementById("map3d");
  const controls3d = document.getElementById("controls3d");
  const btnToggle3D = document.getElementById("btnToggle3D");
  const btnExit3D = document.getElementById("btnExit3D");
  const rangePitch = document.getElementById("rangePitch");
  const rangeBearing = document.getElementById("rangeBearing");
  const valPitch = document.getElementById("valPitch");
  const valBearing = document.getElementById("valBearing");
  let map3d = null;
  let orbitTimer = null;

  function toGeoJsonRing(coords) {
    const ring = coords.map(([lat, lng]) => [lng, lat]);
    if (ring.length > 0) ring.push(ring[0]);
    return [ring];
  }

  function init3DMap() {
    if (typeof maplibregl === "undefined") {
      showToast("MapLibre 3D belum termuat");
      return;
    }
    const center = map.getCenter();
    const zoom = Math.max(14, Math.min(18, map.getZoom() - 1));

    map3d = new maplibregl.Map({
      container: "map3d",
      center: [center.lng, center.lat],
      zoom: zoom,
      pitch: 55,
      bearing: 310,
      maxPitch: 80,
      style: {
        version: 8,
        sources: {
          "google-hybrid": {
            type: "raster",
            tiles: ["https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"],
            tileSize: 256,
            maxzoom: 20
          },
          "terrain-dem": {
            type: "raster-dem",
            tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15
          },
          "hillshade-dem": {
            type: "raster-dem",
            tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15
          }
        },
        layers: [
          { id: "google-hybrid-layer", type: "raster", source: "google-hybrid" },
          {
            id: "hillshade-layer",
            type: "hillshade",
            source: "hillshade-dem",
            paint: {
              "hillshade-exaggeration": 0.45,
              "hillshade-shadow-color": "#090d16",
              "hillshade-highlight-color": "#ffffff"
            }
          }
        ],
        terrain: { source: "terrain-dem", exaggeration: 1.45 }
      }
    });

    map3d.on("mousemove", (e) => {
      const elevRaw = map3d.queryTerrainElevation(e.lngLat);
      if (elevRaw !== null && elevRaw !== undefined && !Number.isNaN(elevRaw)) {
        const elevM = Math.round(elevRaw);
        const elev3dEl = document.getElementById("elev3dVal");
        if (elev3dEl) elev3dEl.textContent = `${elevM.toLocaleString("id-ID")} mdpl`;
        if (telElev) telElev.textContent = `${elevM.toLocaleString("id-ID")} mdpl`;
      }
      telCoord.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
    });

    map3d.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map3d.on("load", () => {
      // Neighbor dusuns
      const neighborFeatures = (DATA.neighborBoundaries || []).map((d) => ({
        type: "Feature",
        properties: { name: d.name, color: d.color },
        geometry: { type: "Polygon", coordinates: toGeoJsonRing(d.coords) }
      }));
      map3d.addSource("neighbors-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: neighborFeatures }
      });
      map3d.addLayer({
        id: "neighbors-fill",
        type: "fill",
        source: "neighbors-src",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 }
      });
      map3d.addLayer({
        id: "neighbors-line",
        type: "line",
        source: "neighbors-src",
        paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [3, 3], "line-opacity": 0.7 }
      });

      // Dusun Malatan CORE
      map3d.addSource("malatan-src", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "Polygon", coordinates: toGeoJsonRing(DATA.boundary) } }
      });
      map3d.addLayer({
        id: "malatan-fill",
        type: "fill",
        source: "malatan-src",
        paint: { "fill-color": "#10b981", "fill-opacity": 0.08 }
      });
      map3d.addLayer({
        id: "malatan-glow",
        type: "line",
        source: "malatan-src",
        paint: { "line-color": "#34d399", "line-width": 8, "line-opacity": 0.4 }
      });
      map3d.addLayer({
        id: "malatan-line",
        type: "line",
        source: "malatan-src",
        paint: { "line-color": "#10b981", "line-width": 3 }
      });

      // Outer Desa Bansari border
      if (DATA.desaBansariBoundary) {
        map3d.addSource("desa-src", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "Polygon", coordinates: toGeoJsonRing(DATA.desaBansariBoundary) } }
        });
        map3d.addLayer({
          id: "desa-halo",
          type: "line",
          source: "desa-src",
          paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.85 }
        });
        map3d.addLayer({
          id: "desa-line",
          type: "line",
          source: "desa-src",
          paint: { "line-color": "#dc2626", "line-width": 2.8, "line-dasharray": [5, 2, 1, 2] }
        });
      }

      // Calibrated POIs
      getAllPois().forEach((poi) => {
        const el = document.createElement("div");
        el.className = "custom-pin";
        el.style.background = poi.color;
        el.style.cursor = "pointer";
        el.innerHTML = `<span>${poi.num}</span>`;
        new maplibregl.Marker({ element: el })
          .setLngLat([poi.lng, poi.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 22 }).setHTML(
              `<strong>${escapeHtml(poi.name)}</strong><br/><small>${escapeHtml(poi.catLabel)} · ±${poi.elev} mdpl</small>`
            )
          )
          .addTo(map3d);
      });
    });

    map3d.on("moveend", () => {
      const c = map3d.getCenter();
      const z = map3d.getZoom().toFixed(2);
      const p = Math.round(map3d.getPitch());
      const b = Math.round(((map3d.getBearing() % 360) + 360) % 360);
      rangePitch.value = p;
      rangeBearing.value = b;
      valPitch.textContent = `${p}°`;
      valBearing.textContent = `${b}°`;
      history.replaceState(null, "", `#@${c.lat.toFixed(6)},${c.lng.toFixed(6)},${z}z,${p}p,${b}b`);
    });
  }

  function enter3DMode() {
    map3dEl.style.display = "block";
    controls3d.style.display = "flex";
    btnToggle3D.classList.add("active");
    if (!map3d) {
      init3DMap();
    } else {
      const c = map.getCenter();
      map3d.resize();
      map3d.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(14, Math.min(18, map.getZoom() - 1)) });
    }
    showToast("Mode 3D Terrain aktif (drag kanan/Ctrl untuk putar)");
  }

  function exit3DMode() {
    if (orbitTimer) {
      cancelAnimationFrame(orbitTimer);
      orbitTimer = null;
    }
    if (map3d) {
      const c = map3d.getCenter();
      map.setView([c.lat, c.lng], Math.min(20, Math.round(map3d.getZoom()) + 1));
    }
    map3dEl.style.display = "none";
    controls3d.style.display = "none";
    btnToggle3D.classList.remove("active");
  }

  btnToggle3D.addEventListener("click", () => {
    if (map3dEl.style.display === "none") enter3DMode();
    else exit3DMode();
  });
  btnExit3D.addEventListener("click", exit3DMode);

  rangePitch.addEventListener("input", (e) => {
    const p = Number(e.target.value);
    valPitch.textContent = `${p}°`;
    if (map3d) map3d.setPitch(p);
  });
  rangeBearing.addEventListener("input", (e) => {
    const b = Number(e.target.value);
    valBearing.textContent = `${b}°`;
    if (map3d) map3d.setBearing(b);
  });

  const rangeExag = document.getElementById("rangeExag");
  const valExag = document.getElementById("valExag");
  rangeExag.addEventListener("input", (e) => {
    const ex = Number(e.target.value);
    valExag.textContent = `${ex.toFixed(2)}×`;
    if (map3d) map3d.setTerrain({ source: "terrain-dem", exaggeration: ex });
  });

  document.getElementById("chk3dHillshade").addEventListener("change", (e) => {
    if (map3d && map3d.getLayer("hillshade-layer")) {
      map3d.setLayoutProperty("hillshade-layer", "visibility", e.target.checked ? "visible" : "none");
    }
  });

  document.getElementById("btn3DSindoro").addEventListener("click", () => {
    if (orbitTimer) { cancelAnimationFrame(orbitTimer); orbitTimer = null; }
    if (map3d) map3d.easeTo({ center: [110.0522, -7.28035], zoom: 16.2, pitch: 62, bearing: 285, duration: 900 });
  });
  document.getElementById("btn3DTop").addEventListener("click", () => {
    if (orbitTimer) { cancelAnimationFrame(orbitTimer); orbitTimer = null; }
    if (map3d) map3d.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  });
  document.getElementById("btn3DOrbit").addEventListener("click", () => {
    if (!map3d) return;
    if (orbitTimer) {
      cancelAnimationFrame(orbitTimer);
      orbitTimer = null;
      showToast("Putar otomatis dihentikan");
      return;
    }
    showToast("Putar otomatis aktif (klik lagi untuk berhenti)");
    const spin = () => {
      if (!map3d || map3dEl.style.display === "none") { orbitTimer = null; return; }
      map3d.setBearing((map3d.getBearing() + 0.25) % 360);
      orbitTimer = requestAnimationFrame(spin);
    };
    orbitTimer = requestAnimationFrame(spin);
  });

  // =========================================================
  // 11. Button Click Blur Pulse & Archive/Storytelling Modal
  // =========================================================
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".bm-btn, .dock-btn, .icon-btn, .tm-btn");
    if (!btn) return;
    btn.classList.remove("btn-blur-pulse");
    void btn.offsetWidth;
    btn.classList.add("btn-blur-pulse");
  });

  const archiveModal = document.getElementById("archiveModal");
  const archiveContent = document.getElementById("archiveContent");
  const btnArchiveGuide = document.getElementById("btnArchiveGuide");
  const btnCloseArchive = document.getElementById("btnCloseArchive");
  const BOT_VOICE_KEY = "malatan_datanusantarabot_voice_url";
  let activeAudio = null;

  const STORY_CHAPTERS = [
    {
      id: "asal-usul",
      title: "1. Asal-Usul, Posisi & Lanskap Lereng Sindoro",
      text: "Dusun Malatan merupakan salah satu dukuh bersejarah di Desa Bansari, Kecamatan Bansari, Kabupaten Temanggung. Terletak di ketinggian sekitar 1.310 hingga 1.338 meter di atas permukaan laut pada punggungan lereng timur Gunung Sindoro, permukiman warga RT dan RW 09 tumbuh mengikuti kontur alami perbukitan yang dikelilingi terasering pertanian."
    },
    {
      id: "tradisi",
      title: "2. Jejak Leluhur, Sedekah Bumi & Budaya Agraris",
      text: "Sejak era pembentukan wilayah dukuh, masyarakat Malatan menjaga tradisi leluhur seperti Sedekah Bumi dan gotong royong bersih dusun sebagai wujud syukur atas kesuburan tanah dan kelestarian mata air sendang. Nilai kebersamaan ini terus diwariskan melalui kegiatan warga di Balai Dusun maupun Gedung Kesenian Malatan."
    },
    {
      id: "harmoni",
      title: "3. Sejarah Kerukunan & Koridor Bina Damai Lintas Iman",
      text: "Salah satu warisan sosial terpenting Dusun Malatan adalah harmoni kehidupan beragama yang telah teruji lintas generasi. Masjid Jami' Al-Muqorobbin dan GKJ Sindoro Pepanthan Malatan berdiri berdekatan sekitar 194 meter di poros dusun. Praktik bina damai ini bahkan terdokumentasi dalam penelitian akademik UIN Sunan Kalijaga Yogyakarta tahun 2022."
    },
    {
      id: "pembangunan",
      title: "4. Dinamika Pembangunan & Ruang Publik Dusun (2019–2026)",
      text: "Dalam perkembangan modernnya, Dusun Malatan aktif menjadi pusat musyawarah warga, termasuk menjadi tuan rumah Musrenbang Kecamatan Bansari pada 2019, pelaksanaan peningkatan jalan lingkungan seperti pavingisasi RT 01 RW 09 pada 2023, hingga digitalisasi arsip dan peta geospasial 2D dan 3D."
    },
    {
      id: "ekonomi",
      title: "5. Tembakau Lereng Sindoro, Seni Rakyat & Wisata",
      text: "Dari sisi ekonomi dan budaya, Dusun Malatan bertumpu pada budidaya serta pengolahan tembakau rajangan khas Temanggung, sayuran dataran tinggi, usaha perlengkapan pendakian Gunung Sindoro, serta pelestarian kesenian tradisional Jaran Kepang dan Topeng Ireng."
    }
  ];

  const HISTORY_TIMELINE = [
    {
      year: "Era Pembentukan Dukuh (±1965)",
      title: "Penetapan Permukiman & Batas Dukuh Malatan",
      desc: "Penataan awal blok permukiman warga di punggungan lereng Sindoro beserta pemanfaatan sendang mata air dan lahan terasering utara-selatan."
    },
    {
      year: "Warisan Lintas Generasi",
      title: "Tradisi Sedekah Bumi & Seni Kesenian Rakyat",
      desc: "Pelestarian ritual syukur panen, gotong royong pembangunan dusun, serta latihan seni Jaran Kepang dan Topeng Ireng di Gedung Kesenian Malatan."
    },
    {
      year: "2019",
      title: "Balai Dusun Malatan Tuan Rumah Musrenbang Kecamatan",
      desc: "Tercatat dalam dokumentasi resmi Pemerintah Provinsi Jawa Tengah sebagai lokasi penyelenggaraan Musrenbang Kecamatan Bansari."
    },
    {
      year: "2022",
      title: "Riset Akademik Kerukunan Umat Beragama Dusun Malatan",
      desc: "Tesis UIN Sunan Kalijaga Yogyakarta mendokumentasikan praktik nyata bina damai warga Muslim dan Kristiani di sekitar Masjid Al-Muqorobbin dan GKJ Sindoro."
    },
    {
      year: "2023 – 2026",
      title: "Pavingisasi RT 01/RW 09 & Digitalisasi Peta 3D/WebGIS",
      desc: "Peningkatan akses jalan lingkungan (Renja DPUPR Kab. Temanggung 2023) hingga pemetaan geospasial modern 2D/3D dan arsip digital Dusun Malatan."
    }
  ];

  const HISTORY_SOURCES = [
    {
      title: "Kerukunan Antar Umat Beragama di Dusun Malatan (2022)",
      inst: "Tesis UIN Sunan Kalijaga Yogyakarta",
      url: "https://digilib.uin-suka.ac.id/id/eprint/56593/"
    },
    {
      title: "Musrenbang Kecamatan Bansari di Balai Dusun Malatan (2019)",
      inst: "Pemerintah Provinsi Jawa Tengah",
      url: "https://jatengprov.go.id/beritadaerah/musrenbang-2019-demi-terwujudnya-temanggung-tentrem-marem-gandem/"
    },
    {
      title: "Rencana Kerja DPUPR Kab. Temanggung — Pavingisasi RT 01/RW 09 Malatan (2023)",
      inst: "PPID Kabupaten Temanggung",
      url: "https://ppid.temanggungkab.go.id/assets/dok_file/RENJA_DPUPR_Tahun_2023.pdf"
    },
    {
      title: "Kecamatan Bansari Dalam Angka 2025",
      inst: "BPS Kabupaten Temanggung",
      url: "https://temanggungkab.bps.go.id/id/publication/2025/09/26/2561385b26246d8a079b4338/bansari-district-in-figures-2025.html"
    }
  ];

  function stopStoryVoice() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function playStoryVoice(text) {
    stopStoryVoice();
    const customUrl = (localStorage.getItem(BOT_VOICE_KEY) || "").trim();
    if (customUrl) {
      const targetUrl = customUrl.includes("{text}")
        ? customUrl.replace("{text}", encodeURIComponent(text))
        : customUrl;
      activeAudio = new Audio(targetUrl);
      activeAudio.play().catch(() => {
        showToast("Gagal memutar URL datanusantarabot, beralih ke suara browser");
        speakBrowserId(text);
      });
      showToast("Memutar suara datanusantarabot...");
      return;
    }
    speakBrowserId(text);
  }

  function speakBrowserId(text) {
    if (!("speechSynthesis" in window)) {
      showToast("Browser tidak mendukung sintesis suara");
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "id-ID";
    utter.rate = 0.98;
    const voices = window.speechSynthesis.getVoices();
    const idVoice = voices.find((v) => v.lang.toLowerCase().includes("id"));
    if (idVoice) utter.voice = idVoice;
    window.speechSynthesis.speak(utter);
    showToast("Memutar narasi suara Indonesia (isi URL datanusantarabot untuk suara bot)");
  }

  function renderArchiveTab(tabName) {
    if (tabName === "story") {
      const savedUrl = escapeHtml(localStorage.getItem(BOT_VOICE_KEY) || "");
      archiveContent.innerHTML = `
        <div class="story-voice-bar">
          <div style="font-size:12px;font-weight:700;color:#6ee7b7;">🎙️ Konfigurasi Suara Bot (datanusantarabot)</div>
          <div class="story-voice-row">
            <input type="text" id="botVoiceInput" value="${savedUrl}" placeholder="URL Audio / Endpoint datanusantarabot (opsional, dukung {text})" />
            <button class="m-btn" id="btnSaveBotVoice">Simpan Suara</button>
            <button class="m-btn m-btn-close" id="btnStopVoice">⏹ Stop</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);">Jika dikosongkan, pemutar otomatis memakai suara Bahasa Indonesia bawaan browser sebagai cadangan.</div>
        </div>
        ${STORY_CHAPTERS.map((ch) => `
          <div class="story-card">
            <h4>${escapeHtml(ch.title)}</h4>
            <p>${escapeHtml(ch.text)}</p>
            <button class="btn-secondary btn-play-story" data-story-id="${ch.id}">🔊 Putar Narasi</button>
          </div>
        `).join("")}
      `;

      document.getElementById("btnSaveBotVoice").addEventListener("click", () => {
        const val = document.getElementById("botVoiceInput").value.trim();
        localStorage.setItem(BOT_VOICE_KEY, val);
        showToast(val ? "Sumber suara datanusantarabot disimpan" : "Kembali ke suara bawaan browser");
      });
      document.getElementById("btnStopVoice").addEventListener("click", () => {
        stopStoryVoice();
        showToast("Narasi suara dihentikan");
      });
      archiveContent.querySelectorAll(".btn-play-story").forEach((b) => {
        b.addEventListener("click", () => {
          const ch = STORY_CHAPTERS.find((c) => c.id === b.dataset.storyId);
          if (ch) playStoryVoice(ch.text);
        });
      });
    } else if (tabName === "timeline") {
      archiveContent.innerHTML = `
        <div class="timeline-list">
          ${HISTORY_TIMELINE.map((t) => `
            <div class="timeline-item">
              <div class="timeline-year">${escapeHtml(t.year)}</div>
              <h5>${escapeHtml(t.title)}</h5>
              <p>${escapeHtml(t.desc)}</p>
            </div>
          `).join("")}
        </div>
        <div style="font-size:12px;font-weight:700;color:#6ee7b7;margin-bottom:8px;">📚 Sumber Rujukan Resmi</div>
        <div class="source-link-list">
          ${HISTORY_SOURCES.map((s) => `
            <a class="source-link-card" href="${s.url}" target="_blank" rel="noopener noreferrer">
              <div>
                <strong>${escapeHtml(s.title)}</strong>
                <small>${escapeHtml(s.inst)}</small>
              </div>
              <span>↗</span>
            </a>
          `).join("")}
        </div>
      `;
    } else if (tabName === "legend") {
      const neighbors = (DATA.neighborBoundaries || []).map(
        (d) => `<div class="legend-item"><span class="legend-box" style="background:${d.color};opacity:0.75"></span><span>${escapeHtml(d.name)}</span></div>`
      ).join("");
      archiveContent.innerHTML = `
        <div class="legend-grid">
          <div class="legend-item"><span class="legend-box" style="background:#10b981;box-shadow:0 0 8px #34d399"></span><span><strong>Dusun Malatan (CORE / Pusat)</strong></span></div>
          ${neighbors}
          <div class="legend-item"><span class="legend-box" style="background:repeating-linear-gradient(90deg,#dc2626 0 5px,#fff 5px 8px);border:1px solid #dc2626"></span><span>Batas Luar Desa Bansari</span></div>
          <div class="legend-item"><span class="legend-box" style="background:linear-gradient(135deg,#10b981 50%,#475569 50%)"></span><span>Luar Desa Bansari Hitam-Putih</span></div>
        </div>
      `;
    } else {
      archiveContent.innerHTML = `
        <div class="story-card">
          <h4>🧭 Navigasi 2D &amp; 3D Terrain</h4>
          <p>Gunakan panel bawah untuk berpindah antara <strong>Satelit Asli</strong>, <strong>Satelit Polos</strong>, <strong>Google Maps</strong>, <strong>Mesin Waktu 2014–2026</strong>, dan <strong>Mode 3D Terrain</strong>. Di mode 3D, geser slider Pitch, Bearing, dan Skala Ketinggian (Relief) serta aktifkan Hillshade.</p>
        </div>
        <div class="story-card">
          <h4>📏 Alat Ukur Spasial &amp; Elevasi</h4>
          <p>Arahkan kursor ke mana saja untuk membaca koordinat WGS84 dan ketinggian permukaan tanah (<code>mdpl</code>) secara langsung. Gunakan dok kiri untuk mengukur jarak, luas area, radius kedekatan, profil elevasi, serta mengekspor GeoJSON/CSV.</p>
        </div>
      `;
    }
  }

  btnArchiveGuide.addEventListener("click", () => {
    archiveModal.style.display = "flex";
    renderArchiveTab("story");
  });
  btnCloseArchive.addEventListener("click", () => {
    stopStoryVoice();
    archiveModal.style.display = "none";
  });
  archiveModal.addEventListener("click", (e) => {
    if (e.target === archiveModal) {
      stopStoryVoice();
      archiveModal.style.display = "none";
    }
  });
  document.getElementById("archiveTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    document.querySelectorAll("#archiveTabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderArchiveTab(btn.dataset.tab);
  });

  // Init
  populateRouteSelects();
  renderList();
})();
