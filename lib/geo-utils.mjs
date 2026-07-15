/** Web Mercator (EPSG:3857) → WGS84 */
export function mercator3857ToWgs84(x, y) {
    const lon = (x / 20037508.34) * 180;
    const latRad = Math.atan(Math.sinh((y / 20037508.34) * Math.PI));
    const lat = (latRad * 180) / Math.PI;
    return { lat, lon };
}

function ringCentroid(ring) {
    if (!ring?.length) return null;
    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of ring) {
        sumX += x;
        sumY += y;
    }
    return { x: sumX / ring.length, y: sumY / ring.length };
}

function isWebMercator(x, y) {
    return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function toWgs84(x, y, crsName) {
    if (crsName?.includes("3857") || isWebMercator(x, y)) {
        return mercator3857ToWgs84(x, y);
    }
    return { lat: y, lon: x };
}

function convertPosition(x, y, crsName) {
    return toWgs84(x, y, crsName);
}

/** GeoJSON геометрии НСПД в WGS84 (для карты и экспорта). */
export function geometryToGeoJsonWgs84(geometry) {
    if (!geometry?.coordinates) return null;
    const crsName = geometry.crs?.properties?.name || "";

    if (geometry.type === "Point") {
        const [x, y] = geometry.coordinates;
        const { lat, lon } = convertPosition(x, y, crsName);
        return { type: "Point", coordinates: [lon, lat] };
    }

    const mapRing = (ring) =>
        ring.map(([x, y]) => {
            const { lat, lon } = convertPosition(x, y, crsName);
            return [lon, lat];
        });

    if (geometry.type === "Polygon") {
        return {
            type: "Polygon",
            coordinates: geometry.coordinates.map(mapRing)
        };
    }

    if (geometry.type === "MultiPolygon") {
        return {
            type: "MultiPolygon",
            coordinates: geometry.coordinates.map((poly) => poly.map(mapRing))
        };
    }

    return null;
}

function collectLonLatPairs(geoJson) {
    const pairs = [];
    if (!geoJson) return pairs;

    if (geoJson.type === "Point") {
        pairs.push(geoJson.coordinates);
        return pairs;
    }

    const polys = geoJson.type === "Polygon" ? [geoJson.coordinates] : geoJson.coordinates || [];
    for (const poly of polys) {
        for (const ring of poly) {
            for (const [lon, lat] of ring) pairs.push([lon, lat]);
        }
    }
    return pairs;
}

/** SVG-контур границ для превью в карточке (Node или браузер). */
export function geometryToSvgPreview(geoJson, { width = 360, height = 220, padding = 16 } = {}) {
    const pairs = collectLonLatPairs(geoJson);
    if (!pairs.length) return null;

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of pairs) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    }

    const innerW = width - padding * 2;
    const innerH = height - padding * 2;
    const spanLon = maxLon - minLon || 0.0001;
    const spanLat = maxLat - minLat || 0.0001;
    const scale = Math.min(innerW / spanLon, innerH / spanLat);

    const toX = (lon) => padding + (lon - minLon) * scale;
    const toY = (lat) => height - padding - (lat - minLat) * scale;

    const rings =
        geoJson.type === "Polygon"
            ? geoJson.coordinates
            : geoJson.type === "MultiPolygon"
              ? geoJson.coordinates.map((p) => p[0])
              : [];

    const paths = rings
        .map((ring) => {
            if (!ring?.length) return "";
            const d = ring
                .map(([lon, lat], i) => `${i === 0 ? "M" : "L"}${toX(lon).toFixed(1)},${toY(lat).toFixed(1)}`)
                .join(" ");
            return `${d} Z`;
        })
        .filter(Boolean);

    if (!paths.length) return null;

    return {
        width,
        height,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Границы объекта">
            <rect width="100%" height="100%" fill="#f4f8f4"/>
            ${paths.map((d) => `<path d="${d}" fill="rgba(33,160,56,0.28)" stroke="#21A038" stroke-width="3" stroke-linejoin="round"/>`).join("")}
        </svg>`
    };
}

/** Координаты центра объекта из geometry НСПД (Point / Polygon / MultiPolygon). */
export function extractCoordinates(geometry) {
    if (!geometry?.coordinates) return null;

    const crsName = geometry.crs?.properties?.name || "";
    let x;
    let y;

    if (geometry.type === "Point") {
        [x, y] = geometry.coordinates;
    } else if (geometry.type === "Polygon") {
        const c = ringCentroid(geometry.coordinates[0]);
        if (!c) return null;
        x = c.x;
        y = c.y;
    } else if (geometry.type === "MultiPolygon") {
        const c = ringCentroid(geometry.coordinates[0]?.[0]);
        if (!c) return null;
        x = c.x;
        y = c.y;
    } else {
        return null;
    }

    const { lat, lon } = toWgs84(x, y, crsName);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}
