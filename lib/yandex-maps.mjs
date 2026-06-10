/** Ссылки на панораму и карту Яндекса по координатам объекта. */
export function buildPanoramaInfo(lat, lon) {
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return null;

    const encLl = `${lonN}%2C${latN}`;
    const point = `${lonN},${latN}`;

    return {
        lat: latN,
        lon: lonN,
        widgetUrl: `https://yandex.ru/map-widget/v1/?ll=${encLl}&z=16&panorama[point]=${point}&panorama[direction]=auto&panorama[span]=115,75`,
        mapsUrl: `https://yandex.ru/maps/?ll=${encLl}&z=16&panorama[point]=${point}&panorama[direction]=auto&panorama[span]=115,75`,
        staticMapUrl: `https://static-maps.yandex.ru/1.x/?ll=${point}&size=650,400&z=16&l=map,skl&pt=${point},pm2rdm`
    };
}
