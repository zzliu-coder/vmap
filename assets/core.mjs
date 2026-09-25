import { encodePlusCode } from "./plus-code.mjs";
/** Catalog, distance and navigation helpers. No network or account keys. */
export const CATEGORIES = {
  restaurant: { label: "餐厅", symbol: "食", className: "selected" },
  sight: { label: "景点", symbol: "景", className: "sight" },
  cafe: { label: "咖啡", symbol: "咖", className: "cafe" },
  hotel: { label: "住宿", symbol: "宿", className: "hotel" },
  shopping: { label: "购物", symbol: "购", className: "shopping" },
  transport: { label: "交通", symbol: "站", className: "transport" },
  other: { label: "其他", symbol: "◇", className: "other" },
};
export const normalized = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const hasPoint = (p) =>
  !!p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180;
export const toRadians = (n) => (n * Math.PI) / 180;
export function distance(a, b) {
  if (!hasPoint(a) || !hasPoint(b)) return Infinity;
  const p = toRadians(b.lat - a.lat),
    q = toRadians(b.lon - a.lon),
    v = Math.min(
      1,
      Math.max(
        0,
        Math.sin(p / 2) ** 2 +
          Math.cos(toRadians(a.lat)) *
            Math.cos(toRadians(b.lat)) *
            Math.sin(q / 2) ** 2,
      ),
    );
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}
export function distanceText(user, r) {
  if (!hasPoint(r)) return "坐标待补";
  if (!hasPoint(user)) return "";
  const d = distance(user, r);
  return (
    "直线 " +
    (d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km")
  );
}
export function awardOf(r, year = "all") {
  const a = r.awards || {};
  return year === "all"
    ? Object.keys(a)
        .sort()
        .reverse()
        .map((y) => a[y])
        .find(Boolean) || ""
    : a[year] || "";
}
export const isMichelin = (r) => Object.values(r.awards || {}).some(Boolean);
export const hasPrice = (r) =>
  Number.isFinite(r.low) && Number.isFinite(r.high);
export const price = (r) =>
  hasPrice(r) ? `¥${r.low}–${r.high}` : "价格待核对";
export const isOfficial = (r) => String(r.priceBasis || "").startsWith("官方");
export const awardLabel = (a) => (a === "入选" ? "入选 / 餐盘" : a);
export function markerStyle(r, year) {
  const a = awardOf(r, year);
  if (a === "一星")
    return { className: "star", symbol: "★", label: "米其林一星" };
  if (a === "必比登") return { className: "bib", symbol: "B", label: "必比登" };
  if (a === "入选")
    return { className: "selected", symbol: "•", label: "入选 / 餐盘" };
  return CATEGORIES[r.category] || CATEGORIES.other;
}
export function filterPlaces(data, s) {
  const q = normalized(s.query);
  return data
    .filter((r) => {
      const a = awardOf(r, s.year);
      return (
        (s.city === "all" || r.city === s.city) &&
        (s.category === "all" || r.category === s.category) &&
        (!isMichelin(r) || s.year === "all" || !!a) &&
        (s.award === "all" || a === s.award) &&
        (s.budget === "all" || (hasPrice(r) && r.high <= Number(s.budget))) &&
        (!s.favoritesOnly || s.favorites?.has(r.id)) &&
        (s.radius === "all" ||
          (hasPoint(s.user) &&
            distance(s.user, r) <= Number(s.radius) * 1000)) &&
        (!q ||
          normalized(
            [
              r.name,
              r.nameLocal,
              r.cityName,
              r.food,
              r.description,
              r.address,
              ...(r.tags || []),
            ].join(" "),
          ).includes(q))
      );
    })
    .sort((a, b) => {
      if (hasPoint(s.user) && s.sort === "distance") {
        const da = distance(s.user, a),
          db = distance(s.user, b);
        if (da !== db) return da - db;
      }
      return a.name.localeCompare(b.name, "vi");
    });
}
export function safeGoogleUrl(raw) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return "";
    const h = u.hostname.toLowerCase();
    if (
      h === "maps.app.goo.gl" ||
      (h === "goo.gl" && u.pathname.startsWith("/maps"))
    )
      return u.href;
    if (
      [
        "www.google.com",
        "google.com",
        "www.google.com.vn",
        "google.com.vn",
      ].includes(h) &&
      u.pathname.startsWith("/maps")
    )
      return u.href;
    if (["maps.google.com", "maps.google.com.vn"].includes(h)) return u.href;
  } catch {}
  return "";
}
export function googleQuery(r, cities = []) {
  const c = cities.find((c) => c.id === r.city);
  return [
    r.nameLocal || r.name,
    r.address || c?.searchName || r.cityName,
    c?.country || "Vietnam",
  ]
    .filter(Boolean)
    .join(", ");
}
export function googlePlaceUrl(r, cities = []) {
  const supplied = safeGoogleUrl(r.googleMapsUrl);
  if (supplied) return supplied;
  const p = new URLSearchParams({ api: "1", query: googleQuery(r, cities) });
  if (r.googlePlaceId) p.set("query_place_id", r.googlePlaceId);
  return "https://www.google.com/maps/search/?" + p;
}
export const destinationPoint = (r) =>
  hasPoint(r.dropoff) ? r.dropoff : hasPoint(r) ? r : null;
export function plusCode(r) {
  const p = destinationPoint(r);
  return p ? encodePlusCode(p.lat, p.lon, 10) : "";
}
export function googlePinUrl(r) {
  const p = destinationPoint(r);
  return p
    ? "https://www.google.com/maps/search/?" +
        new URLSearchParams({ api: "1", query: `${p.lat},${p.lon}` })
    : "";
}
export function googleDirectionsUrl(r, cities = []) {
  const p = destinationPoint(r),
    params = new URLSearchParams({
      api: "1",
      destination: p ? `${p.lat},${p.lon}` : googleQuery(r, cities),
      travelmode: "driving",
    });
  if (r.googlePlaceId && !hasPoint(r.dropoff))
    params.set("destination_place_id", r.googlePlaceId);
  return "https://www.google.com/maps/dir/?" + params;
}
export function validateCatalog(cities, places) {
  const errors = [],
    cityIds = new Set(),
    ids = new Set();
  if (!Array.isArray(cities) || !Array.isArray(places))
    return ["cities 和 places 必须是数组"];
  for (const c of cities) {
    if (!c || !/^[a-z0-9-]{1,50}$/.test(c.id || "") || cityIds.has(c.id))
      errors.push("城市 ID 无效或重复: " + c?.id);
    if (!c?.name || !c?.searchName || !hasPoint(c))
      errors.push("城市名称、搜索名或中心缺失: " + c?.id);
    cityIds.add(c?.id);
  }
  for (const r of places) {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      errors.push("地点记录必须为对象");
      continue;
    }
    const id = r.id;
    if (!r || !/^[A-Za-z0-9_-]{1,80}$/.test(id || "") || ids.has(id))
      errors.push("地点 ID 无效或重复: " + id);
    ids.add(id);
    if (
      typeof r.name !== "string" ||
      !r.name.trim() ||
      !cityIds.has(r.city) ||
      !CATEGORIES[r.category]
    )
      errors.push("地点名称、城市或类别无效: " + id);
    const empty = r?.lat == null && r?.lon == null;
    if (!empty && !hasPoint(r))
      errors.push("经纬度必须成对、为有效数字: " + id);
    if (hasPoint(r) && (!r.coordinateSource || !r.positionStatus))
      errors.push("有坐标的地点需要来源与核对状态: " + id);
    if (
      (r?.low != null || r?.high != null) &&
      (!hasPrice(r) || r.low < 0 || r.low > r.high)
    )
      errors.push("价格区间无效: " + id);
    if (r?.googleMapsUrl && !safeGoogleUrl(r.googleMapsUrl))
      errors.push("Google 门店链接无效: " + id);
    if (r?.googlePlaceId && !/^[A-Za-z0-9_-]{5,300}$/.test(r.googlePlaceId))
      errors.push("Google Place ID 无效: " + id);
    if (
      r?.dropoff &&
      (!hasPoint(r.dropoff) ||
        !r.dropoff.source ||
        !r.dropoff.label ||
        !r.dropoff.verifiedAt)
    )
      errors.push("下车点需坐标、来源、说明与核对日期: " + id);
    if (
      r?.tags != null &&
      (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== "string"))
    )
      errors.push("tags 必须是字符串数组: " + id);
    for (const key of ["source", "coordinateSource", "menuSource"])
      if (r?.[key] && !/^https:\/\//.test(r[key]))
        errors.push("来源必须为 HTTPS 链接: " + id + "." + key);
    if (
      r?.awards &&
      (typeof r.awards !== "object" ||
        Array.isArray(r.awards) ||
        Object.entries(r.awards).some(
          ([y, a]) =>
            !/^20\d{2}$/.test(y) || !["", "入选", "必比登", "一星"].includes(a),
        ))
    )
      errors.push("年度奖项无效: " + id);
  }
  for (const r of places) {
    if (r?.dropoff?.source && !/^https:\/\//.test(r.dropoff.source))
      errors.push("下车点来源必须为 HTTPS 链接: " + r.id);
  }
  return errors;
}
/** Patches upsert stable IDs; omitted fields are preserved. Never deletes records. */
export function mergeCatalog(cities, places, patch) {
  if (!patch || typeof patch !== "object" || !Array.isArray(patch.places))
    throw new Error("增量文件需要 places 数组");
  const merge = (current, changes, nested) => {
    const result = current.map((r) => structuredClone(r)),
      seen = new Set();
    for (const u of changes || []) {
      if (!u?.id || seen.has(u.id)) throw new Error("增量 ID 缺失或重复");
      seen.add(u.id);
      const i = result.findIndex((r) => r.id === u.id);
      if (i < 0) result.push(structuredClone(u));
      else {
        const old = result[i];
        result[i] = { ...old, ...structuredClone(u) };
        for (const k of nested) if (u[k]) result[i][k] = { ...old[k], ...u[k] };
      }
    }
    return result;
  };
  const next = {
    cities: merge(cities, patch.cities, []),
    places: merge(places, patch.places, ["awards", "yearSources"]),
  };
  const errors = validateCatalog(next.cities, next.places);
  if (errors.length) throw new Error(errors.join("\n"));
  return next;
}
