import {
  CATEGORIES,
  escapeHTML as esc,
  hasPoint,
  distance,
  distanceText,
  awardOf,
  awardLabel,
  markerStyle,
  price,
  hasPrice,
  isOfficial,
  filterPlaces,
  googlePlaceUrl,
  googleDirectionsUrl,
  googlePinUrl,
  plusCode,
  destinationPoint,
  validateCatalog,
} from "./core.mjs";
import { TravelMap } from "./map.mjs";
import {
  coordinateText,
  deleteCheckin,
  exportBackup,
  exportJournalHTML,
  importBackup,
  listCheckins,
  locationLabel,
  newCheckinId,
  preparePhotos,
  saveCheckin,
  storageInfo,
} from "./journal.mjs";
const $ = (id) => document.getElementById(id);
let DATA = [],
  CITIES = [],
  MANIFEST = {},
  map,
  checkinContext = null,
  pendingCurrentCheckin = false,
  journalObjectUrls = [];
const state = {
  city: "dn",
  year: "2026",
  category: "all",
  award: "all",
  budget: "all",
  query: "",
  radius: "all",
  sort: "name",
  user: null,
  selected: null,
  watch: null,
  following: false,
  gpsGeneration: 0,
  manualCity: false,
  pendingNearby: false,
  sheet: "collapsed",
  favoritesOnly: false,
  favorites: new Set(),
};
const cityCenter = () =>
  CITIES.find((c) => c.id === state.city) ||
  CITIES[0] || { lat: 16.065, lon: 108.231 };
const filtered = () => filterPlaces(DATA, state);
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 4200);
}
function persist() {
  try {
    const {
      city,
      year,
      category,
      award,
      budget,
      query,
      selected,
      sheet,
      sort,
      favoritesOnly,
    } = state;
    sessionStorage.setItem(
      "vmap-view-v4",
      JSON.stringify({
        city,
        year,
        category,
        award,
        budget,
        query,
        selected,
        sheet,
        sort,
        favoritesOnly,
      }),
    );
    localStorage.setItem(
      "vmap-favorites-v4",
      JSON.stringify([...state.favorites]),
    );
  } catch {
    /* Storage may be disabled; map remains usable. */
  }
}
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("vmap-view-v4") || "null");
    if (saved && typeof saved === "object") {
      for (const key of [
        "city",
        "year",
        "category",
        "award",
        "budget",
        "query",
        "selected",
        "sheet",
        "sort",
      ])
        if (typeof saved[key] === "string") state[key] = saved[key];
      state.favoritesOnly = saved.favoritesOnly === true;
    }
    const favorites = JSON.parse(
      localStorage.getItem("vmap-favorites-v4") || "[]",
    );
    if (Array.isArray(favorites))
      state.favorites = new Set(
        favorites.filter((id) => DATA.some((r) => r.id === id)),
      );
  } catch {}
  state.radius = "all";
  if (state.city !== "all" && !CITIES.some((c) => c.id === state.city))
    state.city = CITIES[0]?.id || "all";
  if (!DATA.some((r) => r.id === state.selected)) state.selected = null;
  if (!["collapsed", "open", "expanded"].includes(state.sheet))
    state.sheet = "collapsed";
}
function syncControls() {
  for (const [id, key] of [
    ["city", "city"],
    ["year", "year"],
    ["category", "category"],
    ["award", "award"],
    ["budget", "budget"],
    ["radius", "radius"],
    ["sort", "sort"],
  ]) {
    const el = $(id);
    if ([...el.options].some((o) => o.value === state[key]))
      el.value = state[key];
    else {
      state[key] = el.options[0]?.value || "all";
      el.value = state[key];
    }
  }
  $("search").value = state.query;
  $("favorites-toggle").classList.toggle("on", state.favoritesOnly);
  $("favorites-toggle").setAttribute(
    "aria-pressed",
    String(state.favoritesOnly),
  );
  $("favorites-toggle").textContent = state.favoritesOnly ? "♥ 想去" : "♡ 想去";
  const n =
    ["category", "award", "budget", "radius"].filter((k) => state[k] !== "all")
      .length + (state.query ? 1 : 0);
  $("filter-toggle").textContent = n ? `筛选 ${n}` : "筛选";
}
function setSheet(mode) {
  state.sheet = mode;
  $("sheet").dataset.mode = mode;
  const open = mode !== "collapsed";
  $("results").hidden = !open;
  $("sheet-toggle").setAttribute("aria-expanded", String(open));
  $("sheet-expand").hidden = !open;
  $("sheet-close").hidden = !open;
  $("sheet-expand").textContent = mode === "expanded" ? "半屏" : "展开";
  $("sheet-arrow").textContent = open ? "↓" : "↑";
  persist();
  map?.queue();
}
function setClean(clean) {
  document.body.classList.toggle("clean", clean);
  $("restore-panels").hidden = !clean;
  map?.queue();
}
function external(url, label, cls = "") {
  return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`;
}
function metadata(r) {
  const st = markerStyle(r, state.year);
  return `<span class="tag ${st.className}">${esc(st.label)}</span><span>${esc(r.cityName || "")}</span>${hasPrice(r) ? `<span class="price">${price(r)}${r.category === "restaurant" ? "/人" : ""}</span><span class="estimate">${isOfficial(r) ? "官方套餐 · 税费前" : "预算估算"}</span>` : '<span class="estimate">价格待核对</span>'}`;
}
function sourceFooter() {
  return `<details class="source"><summary>图例 · 数据、价格与隐私</summary><p class="legend-text">蓝点＝我的位置；橙点＝手动参考位置；★＝一星；B＝必比登；绿色圆点＝入选；景/咖/宿/购/站＝相应地点类别。</p><p>v${esc(MANIFEST.version)} · 已收录${DATA.length}处，${DATA.filter(hasPoint).length}处有公开坐标。当前覆盖来自维护的清单，尚未接入实时商家搜索。坐标待核对的记录仍保留在列表。</p><p>原203家餐厅的坐标与地址：<a href="https://github.com/ngshiheng/michelin-my-maps" target="_blank" rel="noopener">Jerry Ng / michelin-my-maps</a>，CC BY-NC 4.0；原始位置资料来自 MICHELIN Guide。后续地点逐项记录来源。会安古城新增11个非米其林本地口碑点；2026米其林官方只覆盖河内、胡志明市和岘港。个人非商业旅行使用；公开坐标未经现场测量。</p><p>原米其林餐厅沿用2026-09-24旅行预算；新增地点按各自参考日期记录。参考1人民币≈3,871.81越南盾。大部分为估算；官方套餐需另核税费、饮品及午晚餐差别。临行核对营业、地址和分店。</p><p>Google Maps 按门店资料查询照片与评价。Grab 地点码采用 Google 开源 Open Location Code 在本页生成，只编码地点坐标；请核对下车点与临街入口。<a href="https://www.grab.com/vn/macong/" target="_blank" rel="noopener">Grab 官方地点码说明</a>。</p><p>实时定位与距离在本页计算，不保存轨迹，也不发送到本项目服务器。只有主动打卡时，才把当时的坐标快照、备注和照片写入当前浏览器 IndexedDB；想去地点ID与筛选偏好也仅保存在本浏览器。清除网站数据或换设备可能丢失打卡，请定期导出备份。底图服务会收到浏览区域的瓦片请求；点击外部链接后适用相应服务的隐私政策。</p><p>增加/纠正地点：把 Google Maps 分享链接、用途和城市发给我；可补充独立的下车入口。<a href="https://github.com/zzliu-coder/vmap" target="_blank" rel="noopener">查看数据仓库</a>。</p></details>`;
}
function listHTML(rows) {
  const count = rows.filter(hasPoint).length;
  const label = state.favoritesOnly ? "想去清单" : "已收录地点";
  return (
    `<div class="listtitle"><span>${label} ${rows.length}处 · ${count}处上图${state.user ? " · " + (state.user.manual ? "临时位置" : "我的位置") : ""}</span><button id="sort-toggle">${state.sort === "distance" ? "按名称" : "按距离"}</button></div>` +
    (rows.length
      ? rows
          .map(
            (r) =>
              `<article class="place" data-row="${r.id}"><div class="r-top"><button class="r-name" data-detail="${r.id}">${esc(r.name)}</button><button class="favorite" data-favorite="${r.id}" aria-label="${state.favorites.has(r.id) ? "取消" : "加入"}想去：${esc(r.name)}" aria-pressed="${state.favorites.has(r.id)}">${state.favorites.has(r.id) ? "♥" : "♡"}</button></div><div class="r-meta">${metadata(r)}<span class="r-distance">${esc(distanceText(state.user, r))}</span></div><div class="food">${esc(r.description || r.food || "详情待补充")}</div>${r.closed ? '<div class="warning">资料标注暂时停业，请先确认。</div>' : ""}${!hasPoint(r) ? `<div class="warning">${esc(r.positionStatus || "坐标待补，暂不上图")}</div>` : ""}<div class="rowactions">${external(googlePlaceUrl(r, CITIES), "Google 看照片 ↗", "google")}<button class="grab" data-copy-code="${r.id}" ${plusCode(r) ? "" : "disabled"}>复制 Grab 地点码</button><button class="minor" data-detail="${r.id}">地址/详情</button></div></article>`,
          )
          .join("")
      : `<div class="empty">当前条件下没有已收录地点。${state.radius !== "all" ? "这不代表附近没有商家或景点。" : ""}<br><button id="relax-radius">扩大到不限范围</button><button id="reset-empty">重置所有筛选</button>${external("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("景点 " + (CITIES.find((c) => c.id === state.city)?.searchName || "Vietnam")), "去 Google Maps 查更多 ↗")}</div>`) +
    sourceFooter()
  );
}
function render(fit = false) {
  const rows = filtered();
  if (state.selected && !rows.some((r) => r.id === state.selected))
    state.selected = null;
  map.setRows(rows);
  const region = state.city === "all" ? "全部已收录" : cityCenter().name;
  $("map-count").textContent =
    `${region} · ${rows.filter(hasPoint).length}处已上图`;
  $("map-hint").textContent =
    state.radius === "all" ? "点标记看详情" : `直线 ${state.radius} km 内`;
  $("sheet-label").textContent = state.selected
    ? DATA.find((r) => r.id === state.selected).name
    : `地点列表 · ${rows.length}处${state.favoritesOnly ? " · 想去" : ""}`;
  if (!state.selected) $("results").innerHTML = listHTML(rows);
  else
    document.querySelectorAll(".current-distance").forEach(
      (el) =>
        (el.textContent = distanceText(
          state.user,
          DATA.find((r) => r.id === state.selected),
        )),
    );
  syncControls();
  updateCoordinatePanel();
  if (fit) map.fit(rows.filter(hasPoint));
  persist();
}
function showDetail(id, { pan = true } = {}) {
  const r = DATA.find((x) => x.id === id);
  if (!r) return;
  state.selected = id;
  setClean(false);
  if (state.sheet === "collapsed") setSheet("open");
  render();
  const code = plusCode(r),
    destination = destinationPoint(r),
    fav = state.favorites.has(id);
  $("results").innerHTML =
    `<div class="detail"><button class="back" id="back-list">← 返回地点列表</button><div class="r-top"><h2>${esc(r.name)}</h2><button class="favorite" data-favorite="${id}" aria-label="${fav ? "取消" : "加入"}想去" aria-pressed="${fav}">${fav ? "♥" : "♡"}</button></div><div class="r-meta">${metadata(r)}<span class="r-distance current-distance">${esc(distanceText(state.user, r))}</span></div><div class="food">${esc(r.description || r.food || "详情待补充")}</div>${r.closed ? '<div class="banner">资料标注暂时停业，先与门店确认。</div>' : ""}<div class="rowactions">${external(googlePlaceUrl(r, CITIES), "Google Maps · 照片/评价 ↗", "google")}<button class="grab" data-copy-code="${id}" ${code ? "" : "disabled"}>复制 Grab 地点码</button><button class="checkin-button" data-checkin-place="${id}">✓ 在这里打卡</button></div><p class="fine">先在 Google Maps 查看门店与照片，确认分店；然后复制地点码到 Grab 的目的地框。${r.googleMapsUrl || r.googlePlaceId ? "已保存专用门店链接。" : "当前按店名＋街道＋城市查询，结果仍需核对。"}</p>${code ? `<div class="codebox"><strong>${r.dropoff ? "单独记录的下车点" : "此地点的完整 Plus Code"}</strong><code>${esc(code)}</code><p>复制的内容只有这段代码。到 Grab 粘贴 → 核对终点图钉和入口 → 再叫车。</p><p>${esc(r.dropoff?.label || "由公开坐标生成，入口未逐家核准。点位编码不会提高原始坐标的准确性。")}</p><div class="rowactions">${external(googlePinUrl(r), "核对地点码落点 ↗", "minor")}${external(googleDirectionsUrl(r, CITIES), "Google 路线 ↗", "minor")}</div></div>` : '<div class="banner">该地点的坐标待补。Grab 地点码暂不可用，可先到 Google Maps 核对位置。</div>'}<div class="address">📍 ${esc(r.address || "街道地址待核对")}</div><div class="rowactions"><button class="minor" data-copy-name="${id}">只复制店名</button><button class="minor" data-copy-address="${id}" ${r.address ? "" : "disabled"}>只复制街道地址</button><button class="minor" data-copy-info="${id}">复制地点信息/反馈</button></div>${r.notes ? `<div class="banner">${esc(r.notes)}</div>` : ""}<details class="extra"><summary>价格、年度、来源与坐标详情</summary>${hasPrice(r) ? `<div class="bigprice">${price(r)} <span>${r.category === "restaurant" ? "/ 成人每餐" : "/ 参考花费"}</span></div><p class="fine">${esc(r.priceBasis || "待核实")} · 参考日期 ${esc(r.priceDate || "待补")}</p><p class="fine">${esc(r.priceDetail || "")} ${esc(r.charges || "")}</p>` : '<p class="fine">价格尚未核对，未按 ¥0 处理。</p>'}<div class="years">${
      Object.entries(r.awards || {})
        .sort()
        .map(([y, a]) => `${esc(y)}：${esc(a || "未在本年度名单")}`)
        .join("<br>") || "普通收录地点，不属于米其林奖项记录。"
    }</div><p class="fine">${esc(r.positionStatus || "位置待核对")}。列表显示直线距离，实际路程以导航为准。</p>${hasPoint(r) ? `<p class="fine">地点经纬度：${r.lat}, ${r.lon}</p>` : ""}${r.dropoff ? `<p class="fine">下车点：${r.dropoff.lat}, ${r.dropoff.lon}；核对日期 ${esc(r.dropoff.verifiedAt)}</p>` : ""}<div class="rowactions">${r.source ? external(r.source, "地点来源 ↗", "minor") : ""}${r.menuSource ? external(r.menuSource, "价格来源 ↗", "minor") : ""}${r.coordinateSource ? external(r.coordinateSource, "坐标来源 ↗", "minor") : ""}${r.dropoff?.source ? external(r.dropoff.source, "下车点来源 ↗", "minor") : ""}</div></details></div>`;
  $("results").scrollTop = 0;
  if (pan && hasPoint(r)) {
    pauseFollowForPan();
    map.view(r, Math.max(map.zoom, 15));
  }
  persist();
}
function backToList() {
  state.selected = null;
  render();
  $("results").scrollTop = 0;
}
function status(message, error = false) {
  $("gps-status").textContent = message;
  $("gps-status").classList.toggle("error", error);
}
function updateCoordinatePanel() {
  const panel = $("coordinate-panel");
  if (!hasPoint(state.user)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const source = state.user.manual ? "临时位置" : "GPS";
  const accuracy =
    Number.isFinite(state.user.accuracy) && state.user.accuracy > 0
      ? ` · ±${Math.round(state.user.accuracy)}m`
      : "";
  $("coordinate-value").textContent =
    `${source} · ${coordinateText(state.user)}${accuracy}`;
}

const localDateTimeValue = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

function checkinPoint(place, existing = null) {
  if (existing?.coords)
    return {
      coords: existing.coords,
      locationSource: existing.locationSource || "unknown",
    };
  if (hasPoint(state.user))
    return {
      coords: {
        lat: state.user.lat,
        lon: state.user.lon,
        accuracy: state.user.accuracy || 0,
      },
      locationSource: state.user.manual ? "manual" : "gps",
    };
  if (hasPoint(place))
    return {
      coords: { lat: place.lat, lon: place.lon, accuracy: null },
      locationSource: "place",
    };
  return { coords: null, locationSource: "unknown" };
}

let checkinPreviewUrls = [];
function clearCheckinPreviewUrls() {
  checkinPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  checkinPreviewUrls = [];
}

function renderCheckinPreview() {
  clearCheckinPreviewUrls();
  const existing = checkinContext?.existing?.photos || [];
  const files = [...($("checkin-photos").files || [])].slice(
    0,
    Math.max(0, 8 - existing.length),
  );
  const all = [
    ...existing.map((p) => ({ blob: p.blob, label: "已保存" })),
    ...files.map((file) => ({ blob: file, label: "新增" })),
  ];
  $("checkin-preview").innerHTML = all
    .map((p) => {
      const url = URL.createObjectURL(p.blob);
      checkinPreviewUrls.push(url);
      return `<figure><img src="${esc(url)}" alt=""><figcaption>${p.label}</figcaption></figure>`;
    })
    .join("");
}

async function openCheckin(
  placeId = "",
  existing = null,
  returnToJournal = false,
) {
  const place = placeId ? DATA.find((r) => r.id === placeId) : null;
  if (!existing && !place && !hasPoint(state.user)) {
    pendingCurrentCheckin = { returnToJournal };
    startLocation(false);
    toast("先获取当前位置，定位成功后会自动打开打卡。");
    return;
  }
  const location = checkinPoint(place, existing);
  checkinContext = { place, existing, returnToJournal, ...location };
  $("checkin-heading").textContent = existing ? "编辑打卡" : "地点打卡";
  $("checkin-title").value = existing?.title || place?.name || "当前位置";
  $("checkin-time").value = localDateTimeValue(
    existing?.createdAt ? new Date(existing.createdAt) : new Date(),
  );
  $("checkin-note").value = existing?.note || "";
  $("checkin-photos").value = "";
  const locText = location.coords
    ? `${locationLabel(location.locationSource)} · ${coordinateText(location.coords)}${Number.isFinite(location.coords.accuracy) && location.coords.accuracy > 0 ? ` · ±${Math.round(location.coords.accuracy)}m` : ""}`
    : "本次不记录坐标";
  $("checkin-location").textContent = locText;
  renderCheckinPreview();
  $("checkin-dialog").showModal();
}

async function copyText(text, label) {
  try {
    if (!navigator.clipboard?.writeText || !window.isSecureContext)
      throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
    toast(label);
    return true;
  } catch {
    $("copy-label").textContent = label + "；当前浏览器需要手动长按复制。";
    $("copy-value").value = text;
    $("copy-dialog").showModal();
    $("copy-value").select();
    return false;
  }
}
function copyGrab(id) {
  const r = DATA.find((x) => x.id === id),
    code = r && plusCode(r);
  if (!code) {
    toast("坐标待核对，暂时不能生成地点码。");
    return;
  }
  copyText(code, "地点码已备好：粘贴到 Grab 的目的地框，核对图钉后再叫车。");
}
function pauseFollowForPan() {
  if (state.following) {
    state.following = false;
    $("follow").classList.remove("on");
    status("已暂停地图跟随，定位仍在更新。点“跟随”重新居中。");
  }
}
function clearWatch() {
  state.gpsGeneration++;
  if (state.watch !== null) {
    navigator.geolocation?.clearWatch(state.watch);
    state.watch = null;
  }
  state.following = false;
  $("follow").classList.remove("on");
  $("stop").disabled = true;
  $("locate").disabled = false;
}
function nearestViewport() {
  if (!state.user) return;
  const rows = filtered()
    .filter((r) => hasPoint(r) && !r.closed)
    .sort((a, b) => distance(state.user, a) - distance(state.user, b))
    .slice(0, 6);
  if (rows.length && distance(state.user, rows[0]) < 50000)
    map.fit([state.user, ...rows], 15);
  else map.view(state.user, 14);
}
function fitNearby() {
  if (!hasPoint(state.user)) {
    state.pendingNearby = true;
    startLocation(false);
    return;
  }
  state.city = "all";
  state.radius = "5";
  state.sort = "distance";
  state.selected = null;
  state.manualCity = false;
  render();
  nearestViewport();
  setSheet("open");
  toast("显示5公里内已收录地点；其他筛选条件保留。");
}
function receivePosition(p, follow, first) {
  const c = p.coords;
  if (!hasPoint({ lat: c.latitude, lon: c.longitude })) {
    status("手机返回的位置无效，请重试。", true);
    $("locate").disabled = false;
    return;
  }
  state.user = {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? Math.max(0, c.accuracy) : 0,
    manual: false,
  };
  state.sort = "distance";
  if (first && !state.manualCity && !state.selected) {
    const near = [...CITIES].sort(
      (a, b) => distance(state.user, a) - distance(state.user, b),
    )[0];
    if (near && distance(state.user, near) < 80000) state.city = near.id;
    else state.city = "all";
  }
  status(
    `已定位 · 误差约${Math.round(state.user.accuracy)}米 · ${follow ? "位置持续更新" : "按直线距离排序"}`,
  );
  $("locate").disabled = false;
  if (state.pendingNearby) {
    state.pendingNearby = false;
    fitNearby();
  } else {
    render();
    if (first && !state.selected) nearestViewport();
    else if (state.following) map.pan(state.user);
  }
  map.queue();
  if (pendingCurrentCheckin) {
    const pending = pendingCurrentCheckin;
    pendingCurrentCheckin = false;
    openCheckin("", null, pending.returnToJournal);
  }
}
function startLocation(follow) {
  if (!window.isSecureContext || location.protocol === "content:") {
    status(
      "请通过 HTTPS 网址在 Chrome 打开。位置权限受当前文件打开方式限制。",
      true,
    );
    return;
  }
  if (!navigator.geolocation) {
    status("此浏览器没有网页定位功能；可在筛选里用地图中心作临时位置。", true);
    return;
  }
  clearWatch();
  const gen = state.gpsGeneration;
  let first = true;
  state.following = follow;
  $("follow").classList.toggle("on", follow);
  $("stop").disabled = false;
  $("locate").disabled = true;
  status("正在请求手机位置，请允许网页定位…");
  const ok = (p) => {
    if (gen !== state.gpsGeneration) return;
    receivePosition(p, follow, first);
    first = false;
    if (!follow) $("stop").disabled = true;
  };
  const fail = (e) => {
    if (gen !== state.gpsGeneration) return;
    $("locate").disabled = false;
    const msg = {
      1: "网页位置权限被拒绝。点击 Chrome 地址栏的网站设置，允许定位。",
      2: "暂时获取不到手机位置。请检查系统定位，也可用地图中心作临时位置。",
      3: "定位超时。已保留地点，稍后重试或用地图中心作临时位置。",
    };
    status(msg[e.code] || "定位失败，请重试。", true);
    pendingCurrentCheckin = false;
    if (!follow || e.code === 1) clearWatch();
  };
  const options = {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 20000,
  };
  try {
    if (follow)
      state.watch = navigator.geolocation.watchPosition(ok, fail, options);
    else navigator.geolocation.getCurrentPosition(ok, fail, options);
  } catch (e) {
    fail({ code: 1 });
  }
}
function resetFilters() {
  state.category = state.award = state.budget = state.radius = "all";
  state.query = "";
  state.favoritesOnly = false;
  state.selected = null;
  render(true);
}
async function submitCheckin(event) {
  event.preventDefault();
  if (!checkinContext) return;
  const saveButton = $("checkin-save");
  saveButton.disabled = true;
  try {
    const existing = checkinContext.existing;
    const existingPhotos = existing?.photos || [];
    const slots = Math.max(0, 8 - existingPhotos.length);
    const addedPhotos = await preparePhotos($("checkin-photos").files, slots);
    const date = new Date($("checkin-time").value);
    if (Number.isNaN(date.getTime())) throw new Error("打卡时间无效");
    const place = checkinContext.place;
    const entry = {
      id: existing?.id || newCheckinId(),
      createdAt: date.toISOString(),
      updatedAt: new Date().toISOString(),
      title: $("checkin-title").value.trim(),
      note: $("checkin-note").value.trim(),
      placeId: place?.id || existing?.placeId || "",
      cityName: place?.cityName || existing?.cityName || "",
      address: place?.address || existing?.address || "",
      coords: checkinContext.coords,
      locationSource: checkinContext.locationSource,
      photos: [...existingPhotos, ...addedPhotos],
    };
    if (!entry.title) throw new Error("请填写地点名称");
    await saveCheckin(entry);
    const returnToJournal = checkinContext.returnToJournal;
    $("checkin-dialog").close();
    clearCheckinPreviewUrls();
    checkinContext = null;
    toast(existing ? "打卡已更新。" : "打卡已保存到这台设备。");
    await refreshJournalCount();
    if (returnToJournal) await showJournal();
  } catch (e) {
    toast("保存失败：" + (e?.message || e));
  } finally {
    saveButton.disabled = false;
  }
}

async function refreshJournalCount() {
  try {
    const entries = await listCheckins();
    $("journal-open").textContent = entries.length
      ? `日记 ${entries.length}`
      : "日记";
  } catch {
    $("journal-open").textContent = "日记";
  }
}

function clearJournalObjectUrls() {
  journalObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  journalObjectUrls = [];
}

function journalEntryHTML(entry) {
  const photos = (entry.photos || [])
    .slice(0, 4)
    .map((p) => {
      const url = URL.createObjectURL(p.blob);
      journalObjectUrls.push(url);
      return `<img src="${esc(url)}" alt="${esc(p.name || "旅行照片")}">`;
    })
    .join("");
  const coords = entry.coords
    ? `${coordinateText(entry.coords)} · ${locationLabel(entry.locationSource)}`
    : "未记录坐标";
  return `<article class="journal-entry" data-entry-id="${esc(entry.id)}">
    <time>${esc(new Date(entry.createdAt).toLocaleString("zh-CN"))}</time>
    <h3>${esc(entry.title)}</h3>
    <p class="journal-meta">${esc([entry.cityName, coords].filter(Boolean).join(" · "))}</p>
    ${entry.note ? `<p class="journal-note">${esc(entry.note).replace(/\n/g, "<br>")}</p>` : ""}
    ${photos ? `<div class="journal-photos">${photos}</div>` : ""}
    <div class="rowactions">
      ${entry.placeId && DATA.some((r) => r.id === entry.placeId) ? `<button data-journal-place="${esc(entry.placeId)}">地图地点</button>` : ""}
      ${entry.coords ? `<button data-copy-entry-coords="${esc(entry.id)}">复制经纬度</button>` : ""}
      <button data-edit-checkin="${esc(entry.id)}">编辑</button>
      <button class="danger" data-delete-checkin="${esc(entry.id)}">删除</button>
    </div>
  </article>`;
}

async function showJournal() {
  try {
    clearJournalObjectUrls();
    const entries = await listCheckins();
    const storage = await storageInfo();
    const photoCount = entries.reduce((n, e) => n + (e.photos?.length || 0), 0);
    const used = storage ? (storage.usage / 1024 / 1024).toFixed(1) : null;
    $("journal-summary").textContent =
      `${entries.length} 次打卡 · ${photoCount} 张照片${used ? ` · 浏览器已用约 ${used} MB` : ""}`;
    $("journal-list").innerHTML = entries.length
      ? entries.map(journalEntryHTML).join("")
      : '<div class="empty">还没有打卡。定位后可以直接“当前位置打卡”，也可以在某个地点详情里打卡。</div>';
    if (!$("journal-dialog").open) $("journal-dialog").showModal();
  } catch (e) {
    toast("旅行日记无法打开：" + (e?.message || e));
  }
}

function bindEvents() {
  $("journal-open").onclick = showJournal;
  $("copy-coordinates").onclick = () => {
    if (!hasPoint(state.user)) return;
    copyText(
      coordinateText(state.user),
      "经纬度已复制；直接发给我即可按这个位置查附近地点。",
    );
  };
  $("checkin-current").onclick = () => openCheckin();
  $("checkin-form").addEventListener("submit", submitCheckin);
  $("checkin-cancel").onclick = () => {
    $("checkin-dialog").close();
    clearCheckinPreviewUrls();
    checkinContext = null;
  };
  $("checkin-photos").onchange = renderCheckinPreview;
  $("checkin-dialog").addEventListener("close", () => {
    clearCheckinPreviewUrls();
    checkinContext = null;
  });
  $("journal-dialog").addEventListener("close", clearJournalObjectUrls);
  $("filter-toggle").onclick = () => {
    const open = $("filters").hidden;
    $("filters").hidden = !open;
    $("filter-toggle").setAttribute("aria-expanded", String(open));
  };
  $("clean-map").onclick = () => setClean(true);
  $("restore-panels").onclick = () => setClean(false);
  $("sheet-toggle").onclick = () =>
    setSheet(state.sheet === "collapsed" ? "open" : "collapsed");
  $("sheet-close").onclick = () => setSheet("collapsed");
  $("sheet-expand").onclick = () =>
    setSheet(state.sheet === "expanded" ? "open" : "expanded");
  $("zoom-in").onclick = () => map.zoomBy(1);
  $("zoom-out").onclick = () => map.zoomBy(-1);
  $("retry-tiles").onclick = () => {
    map.retryTiles();
    toast("正在重试当前屏幕的底图。");
  };
  $("switch-tiles").onclick = () => {
    map.switchTiles();
    toast("已切换底图来源，正在重新加载。");
  };
  $("fit-city").onclick = () => {
    pauseFollowForPan();
    state.selected = null;
    render(true);
  };
  $("nearby").onclick = fitNearby;
  $("locate").onclick = () => {
    state.pendingNearby = false;
    startLocation(false);
  };
  $("follow").onclick = () => {
    state.pendingNearby = false;
    startLocation(true);
  };
  $("stop").onclick = () => {
    clearWatch();
    state.pendingNearby = false;
    status("已停止位置更新；蓝点保留最后一次位置。");
  };
  $("manual-location").onclick = () => {
    clearWatch();
    state.user = { ...map.center, accuracy: 0, manual: true };
    state.sort = "distance";
    status("橙点为你选择的地图中心，距离以此临时位置计算。");
    render();
    toast("已设置临时位置，不会冒充手机GPS定位。");
  };
  $("clear-location").onclick = () => {
    clearWatch();
    state.user = null;
    state.radius = "all";
    state.sort = "name";
    state.pendingNearby = false;
    render();
    status("已清除位置。地点清单与导航照常使用。");
  };
  $("journal-close").onclick = () => {
    $("journal-dialog").close();
    clearJournalObjectUrls();
  };
  $("journal-new").onclick = () => {
    $("journal-dialog").close();
    clearJournalObjectUrls();
    openCheckin("", null, true);
  };
  $("journal-export-html").onclick = async () => {
    const entries = await listCheckins();
    if (!entries.length) return toast("还没有可以导出的打卡记录。");
    await exportJournalHTML(entries);
    toast("旅行日记 HTML 已生成。");
  };
  $("journal-export-backup").onclick = async () => {
    const entries = await listCheckins();
    if (!entries.length) return toast("还没有可以备份的打卡记录。");
    await exportBackup(entries);
    toast("JSON 备份已生成。");
  };
  $("journal-import").onclick = () => $("journal-import-file").click();
  $("journal-import-file").onchange = async () => {
    const file = $("journal-import-file").files?.[0];
    if (!file) return;
    try {
      const count = await importBackup(file);
      toast(`已导入 ${count} 条打卡记录。`);
      await refreshJournalCount();
      await showJournal();
    } catch (e) {
      toast("导入失败：" + (e?.message || e));
    } finally {
      $("journal-import-file").value = "";
    }
  };
  $("favorites-toggle").onclick = () => {
    state.favoritesOnly = !state.favoritesOnly;
    state.selected = null;
    render(true);
    setSheet("open");
  };
  $("reset-filters").onclick = resetFilters;
  $("city").onchange = () => {
    state.city = $("city").value;
    state.manualCity = true;
    state.radius = "all";
    state.selected = null;
    pauseFollowForPan();
    render(true);
    $("results").scrollTop = 0;
  };
  for (const key of ["year", "category", "award", "budget", "radius", "sort"])
    $(key).onchange = () => {
      state[key] = $(key).value;
      if (
        ((key === "radius" && state.radius !== "all") ||
          (key === "sort" && state.sort === "distance")) &&
        !hasPoint(state.user)
      ) {
        state[key] = key === "sort" ? "name" : "all";
        toast("先定位，或在筛选里选择地图中心作临时位置。");
        syncControls();
        return;
      }
      state.selected = null;
      render(key !== "sort");
      $("results").scrollTop = 0;
    };
  $("search").oninput = () => {
    state.query = $("search").value;
    state.selected = null;
    render(true);
  };
  document.addEventListener("click", async (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest("[data-detail]"))) showDetail(el.dataset.detail);
    else if (t.closest("#back-list")) backToList();
    else if ((el = t.closest("[data-checkin-place]")))
      openCheckin(el.dataset.checkinPlace);
    else if ((el = t.closest("[data-journal-place]"))) {
      $("journal-dialog").close();
      clearJournalObjectUrls();
      showDetail(el.dataset.journalPlace);
    } else if ((el = t.closest("[data-copy-entry-coords]"))) {
      const entry = (await listCheckins()).find(
        (x) => x.id === el.dataset.copyEntryCoords,
      );
      if (entry?.coords)
        copyText(coordinateText(entry.coords), "这次打卡的经纬度已复制。");
    } else if ((el = t.closest("[data-edit-checkin]"))) {
      const entry = (await listCheckins()).find(
        (x) => x.id === el.dataset.editCheckin,
      );
      if (entry) {
        $("journal-dialog").close();
        clearJournalObjectUrls();
        await openCheckin(entry.placeId || "", entry, true);
      }
    } else if ((el = t.closest("[data-delete-checkin]"))) {
      const entry = (await listCheckins()).find(
        (x) => x.id === el.dataset.deleteCheckin,
      );
      if (entry && confirm(`删除“${entry.title}”这次打卡和其中照片？`)) {
        await deleteCheckin(entry.id);
        toast("打卡已删除。");
        await refreshJournalCount();
        await showJournal();
      }
    } else if ((el = t.closest("[data-copy-code]")))
      copyGrab(el.dataset.copyCode);
    else if ((el = t.closest("[data-favorite]"))) {
      const id = el.dataset.favorite;
      state.favorites.has(id)
        ? state.favorites.delete(id)
        : state.favorites.add(id);
      if (state.favoritesOnly && !state.favorites.has(id)) {
        state.selected = null;
        render();
      } else if (state.selected === id) showDetail(id, { pan: false });
      else render();
      persist();
    } else if ((el = t.closest("[data-copy-name]"))) {
      const r = DATA.find((r) => r.id === el.dataset.copyName);
      copyText(r.nameLocal || r.name, "店名已复制；Grab 优先使用地点码。");
    } else if ((el = t.closest("[data-copy-address]"))) {
      const r = DATA.find((r) => r.id === el.dataset.copyAddress);
      copyText(r.address.replace(/\s+/g, " ").trim(), "街道地址已复制。");
    } else if ((el = t.closest("[data-copy-info]"))) {
      const r = DATA.find((r) => r.id === el.dataset.copyInfo);
      copyText(
        [
          `地点ID：${r.id}`,
          `名称：${r.name}`,
          `城市：${r.cityName}`,
          `地址：${r.address || "待核对"}`,
          `Google Maps：${googlePlaceUrl(r, CITIES)}`,
          `地点码：${plusCode(r) || "待核对"}`,
          "我要补充/纠正：",
        ].join("\n"),
        "地点信息已复制，可发给我补充或纠错。",
      );
    } else if (t.closest("#sort-toggle")) {
      if (!state.user) {
        toast("先点“定位我”获取距离。");
        return;
      }
      state.sort = state.sort === "distance" ? "name" : "distance";
      render();
    } else if (t.closest("#relax-radius")) {
      state.radius = "all";
      render(true);
    } else if (t.closest("#reset-empty")) resetFilters();
  });
  document.addEventListener("visibilitychange", () => {
    persist();
    if (document.hidden && (state.watch !== null || $("locate").disabled)) {
      clearWatch();
      status("离开页面后定位已暂停。返回后可重新点“定位我”。");
    }
  });
  window.addEventListener("pagehide", () => {
    persist();
    clearWatch();
  });
}
async function boot() {
  try {
    const [places, cities, manifest] = await Promise.all(
      ["data/places.json", "data/cities.json", "manifest.json"].map(
        async (p) => {
          const r = await fetch(p, { cache: "no-cache" });
          if (!r.ok) throw new Error(p + " " + r.status);
          return r.json();
        },
      ),
    );
    const errors = validateCatalog(cities, places);
    if (errors.length) throw new Error(errors.join("; "));
    DATA = places;
    CITIES = cities;
    MANIFEST = manifest;
    $("city").innerHTML =
      '<option value="all">全部已收录</option>' +
      CITIES.map(
        (c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`,
      ).join("");
    $("category").innerHTML =
      '<option value="all">所有类别</option>' +
      Object.entries(CATEGORIES)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
        .join("");
    const years = [...new Set(DATA.flatMap((r) => Object.keys(r.awards || {})))]
      .sort()
      .reverse();
    $("year").innerHTML =
      years.map((y) => `<option value="${y}">${y} 榜单</option>`).join("") +
      '<option value="all">历年全部</option>';
    restore();
    syncControls();
    const requested = new URLSearchParams(location.search).get("place");
    if (requested) {
      const r = DATA.find((r) => r.id === requested);
      if (r) {
        state.selected = r.id;
        state.city = r.city;
        state.year = "all";
        state.category = state.award = state.budget = "all";
        state.query = "";
        state.favoritesOnly = false;
        state.sheet = "open";
      }
    }
    map = new TravelMap($("map"), {
      state,
      cityCenter,
      style: (r) => markerStyle(r, state.year),
      onSelect: showDetail,
      onPan: pauseFollowForPan,
    });
    bindEvents();
    refreshJournalCount();
    setSheet(state.sheet);
    render();
    if (state.selected) showDetail(state.selected);
    else requestAnimationFrame(() => map.fit(filtered().filter(hasPoint)));
    window.__travelMap = {
      state,
      map,
      DATA,
      CITIES,
      MANIFEST,
      filtered,
      distance,
      showDetail,
      receivePosition,
      plusCode,
      fitNearby,
      setSheet,
      render,
    };
  } catch (e) {
    $("map-count").textContent = "地点数据加载失败";
    $("map-hint").textContent = "请刷新重试";
    $("sheet").dataset.mode = "expanded";
    $("results").hidden = false;
    $("results").innerHTML =
      '<div class="empty">' +
      esc(e.message) +
      '<br>请检查网络并刷新。通过 HTTPS 网页打开，勿直接打开本地HTML。<br><button onclick="location.reload()">刷新页面</button></div>';
    status("地图数据未就绪，暂不显示错误点位。", true);
    console.error("VMAP_BOOT_FAILURE", e.message);
  }
}
boot();
