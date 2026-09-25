import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../dist/", import.meta.url)),
  out = fileURLToPath(new URL("../evidence/", import.meta.url));
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (pathname === "/") pathname = "/index.html";
    const file = path.resolve(root, "." + pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const b = await readFile(file);
    const mime =
      {
        ".html": "text/html; charset=utf-8",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Permissions-Policy": "geolocation=(self)",
    });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base =
  process.env.VMAP_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
function check(name, condition, details) {
  checks.push({
    name,
    pass: !!condition,
    ...(details === undefined ? {} : { details }),
  });
  assert(condition, name + ": " + JSON.stringify(details));
}
async function newPage(width = 412, height = 915, { liveTiles = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: width < 900,
    hasTouch: width < 900,
  });
  await context.addInitScript(() => {
    window.__copied = "";
    window.__gpsCalls = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t) => {
          window.__copied = t;
        },
      },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok) => {
          window.__gpsCalls++;
          setTimeout(
            () =>
              ok({
                coords: { latitude: 16.067, longitude: 108.241, accuracy: 20 },
              }),
            0,
          );
        },
        watchPosition: (ok) => {
          window.__gpsCalls++;
          window.__watchOK = ok;
          setTimeout(
            () =>
              ok({
                coords: { latitude: 16.067, longitude: 108.241, accuracy: 20 },
              }),
            0,
          );
          return 9;
        },
        clearWatch: (id) => {
          window.__clearedWatch = id;
        },
      },
    });
  });
  if (!liveTiles)
    await context.route("https://tile.openstreetmap.org/**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e3eeea"/></svg>',
      }),
    );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__travelMap, { timeout: 15000 });
  return { page, context };
}
try {
  const { page: p, context } = await newPage();
  check(
    "default all 47 Da Nang markers before GPS",
    (await p.locator(".pin").count()) === 47,
  );
  check(
    "no automatic location request",
    (await p.evaluate(() => window.__gpsCalls)) === 0,
  );
  check(
    "default filters and list collapsed",
    (await p.locator("#filters").isHidden()) &&
      (await p.locator("#results").isHidden()),
  );
  const rect = await p.locator("#map").boundingBox();
  check(
    "mobile map occupies at least 75 percent height",
    rect.height >= 915 * 0.75,
    rect,
  );
  check(
    "no horizontal overflow",
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.click("#clean-map");
  await p.waitForTimeout(200);
  const clean = await p.locator("#map").boundingBox();
  check("clean mode nearly full viewport", clean.height >= 910, clean);
  check(
    "restore panel action visible",
    await p.locator("#restore-panels").isVisible(),
  );
  await p.click("#restore-panels");
  await p.click("#sheet-toggle");
  await p.waitForTimeout(180);
  check(
    "list opens with all original places",
    (await p.locator(".place").count()) === 47,
  );
  check("list can collapse again", await p.locator("#sheet-close").isVisible());
  await p.click("#sheet-close");
  const id = await p.evaluate(
    () =>
      window.__travelMap.DATA.find((r) => r.name.includes("Bánh Xèo Bà Dưỡng"))
        .id,
  );
  await p.evaluate((id) => window.__travelMap.showDetail(id), id);
  await p.waitForTimeout(180);
  check(
    "marker detail opens a usable sheet",
    (await p.locator("#results").isVisible()) &&
      (await p.locator("#sheet").boundingBox()).height >= 210,
  );
  check(
    "Google photos link queries real place name",
    new URL(
      await p.locator(".detail a.google").getAttribute("href"),
    ).searchParams
      .get("query")
      .includes("Bánh Xèo Bà Dưỡng"),
  );
  check(
    "detail preserves address and sources",
    (await p
      .locator(".detail .address")
      .textContent()
      .then((s) => s.includes("Hoang Dieu"))) &&
      (await p.locator(".extra summary").isVisible()),
  );
  await p.click(".detail [data-copy-code]");
  const copied = await p.evaluate(() => window.__copied);
  check(
    "Grab clipboard contains only full Plus Code",
    /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/.test(copied),
    copied,
  );
  await p.click(".detail [data-copy-name]");
  check(
    "name copied independently",
    (await p.evaluate(() => window.__copied)) === "Bánh Xèo Bà Dưỡng",
  );
  await p.click(".detail [data-copy-address]");
  check(
    "address clipboard excludes restaurant name and line breaks",
    await p.evaluate(
      () =>
        !window.__copied.includes("Bánh Xèo") &&
        !window.__copied.includes("\n"),
    ),
  );
  await p.click(".detail .favorite");
  check(
    "want-to-go persists only record IDs",
    await p.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("vmap-favorites-v4")).includes(id),
      id,
    ),
  );
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForFunction(() => !!window.__travelMap);
  check(
    "selected place restored after returning/reloading",
    await p.evaluate((id) => window.__travelMap.state.selected === id, id),
  );
  check(
    "reload does not silently request GPS",
    (await p.evaluate(() => window.__gpsCalls)) === 0,
  );
  await p.click("#back-list");
  await p.click("#locate");
  await p.waitForSelector("#user-dot");
  check(
    "GPS blue dot and accuracy displayed",
    (await p.locator("#accuracy-circle").count()) === 1 &&
      !(await p
        .locator("#user-dot")
        .getAttribute("class")
        .then((x) => x.includes("manual"))),
  );
  check(
    "GPS success replaces requesting status",
    await p
      .locator("#gps-status")
      .textContent()
      .then((t) => t.includes("已定位")),
  );
  check(
    "distance sort increases monotonically",
    await p.evaluate(() => {
      const { filtered, state, distance } = window.__travelMap,
        r = filtered();
      return r.every(
        (x, i) =>
          i === 0 || distance(state.user, x) >= distance(state.user, r[i - 1]),
      );
    }),
  );
  await p.click("#nearby");
  check(
    "nearby uses all recorded cities and 5 km radius",
    await p.evaluate(
      () =>
        window.__travelMap.state.city === "all" &&
        window.__travelMap.state.radius === "5",
    ),
  );
  check("nearby results exist", (await p.locator(".place").count()) > 5);
  await p.click("#follow");
  await p.waitForTimeout(50);
  check(
    "continuous follow starts",
    await p.evaluate(() => window.__travelMap.state.watch === 9),
  );
  await p.click("#stop");
  check(
    "stop clears browser watch",
    (await p.evaluate(() => window.__clearedWatch)) === 9,
  );
  const oldLat = await p.evaluate(() => window.__travelMap.state.user.lat);
  await p.evaluate(() =>
    window.__watchOK({
      coords: { latitude: 20, longitude: 108, accuracy: 20 },
    }),
  );
  check(
    "late GPS callbacks cannot overwrite stopped location",
    (await p.evaluate(() => window.__travelMap.state.user.lat)) === oldLat,
  );
  check(
    "GPS and coordinates are not persisted",
    await p.evaluate(
      () =>
        !JSON.stringify({ ...sessionStorage, ...localStorage }).includes(
          "16.067",
        ),
    ),
  );
  await p.click("#filter-toggle");
  await p.selectOption("#award", "必比登");
  check(
    "award filter works",
    await p.evaluate(() =>
      window.__travelMap.filtered().every((r) => r.awards["2026"] === "必比登"),
    ),
  );
  await p.selectOption("#budget", "50");
  check(
    "budget filter works",
    await p.evaluate(() =>
      window.__travelMap.filtered().every((r) => r.high <= 50),
    ),
  );
  await p.click("#reset-filters");
  await p.selectOption("#city", "hn");
  check(
    "Hanoi 64 points and 65 records",
    (await p.locator(".pin").count()) === 64 &&
      (await p.locator(".place").count()) === 65,
  );
  await p.selectOption("#city", "hcm");
  check(
    "HCMC 78 points and 81 records",
    (await p.locator(".pin").count()) === 78 &&
      (await p.locator(".place").count()) === 81,
  );
  await p.evaluate(() => window.__travelMap.showDetail("VN109"));
  check(
    "unverified coordinates cannot generate a Grab code",
    await p.locator(".detail [data-copy-code]").isDisabled(),
  );
  await p.click("#back-list");
  await p.selectOption("#city", "dn");
  await p.selectOption("#year", "2025");
  check("2025 data preserved", (await p.locator(".pin").count()) === 43);
  await p.selectOption("#year", "2026");
  await p.fill("#search", "ba duong");
  check(
    "Vietnamese accent-insensitive search works in UI",
    (await p.locator(".place").count()) === 1,
  );
  await p.click("#reset-filters");
  await p.click("#manual-location");
  await p.waitForSelector("#user-dot.manual");
  check(
    "manual origin uses explicit orange marker",
    await p
      .locator("#user-dot")
      .getAttribute("class")
      .then((x) => x.includes("manual")),
  );
  await p.click("#clear-location");
  await p.waitForSelector("#user-dot", { state: "detached" });
  check(
    "clearing origin removes location and distances",
    (await p.locator("#user-dot").count()) === 0 &&
      (await p.evaluate(() => window.__travelMap.state.user === null)),
  );
  await p.click("#filter-toggle");
  await p.evaluate((id) => window.__travelMap.showDetail(id), id);
  await p.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  await p.click(".detail [data-copy-code]");
  check(
    "clipboard failure provides selectable code, not false success",
    (await p.locator("#copy-dialog").isVisible()) &&
      /\+/.test(await p.locator("#copy-value").inputValue()),
  );
  await p.click("#copy-dialog button");
  await p.click("#sheet-close");
  const z = await p.evaluate(() => window.__travelMap.map.zoom);
  await p.click("#zoom-in");
  check(
    "map zoom remains working",
    (await p.evaluate(() => window.__travelMap.map.zoom)) === z + 1,
  );
  const center = await p.evaluate(() => window.__travelMap.map.center.lon);
  const box = await p.locator("#map").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 35, {
    steps: 5,
  });
  await p.mouse.up();
  check(
    "drag pans the actual map",
    (await p.evaluate(() => window.__travelMap.map.center.lon)) !== center,
  );
  await p.screenshot({ path: path.join(out, "mobile-functional.png") });
  await context.close();
  for (const [w, h] of [
    [360, 800],
    [768, 1024],
    [1280, 900],
    [844, 390],
  ]) {
    const { page, context } = await newPage(w, h);
    check(
      `layout ${w}x${h}: no overflow`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const b = await page.locator("#map").boundingBox();
    check(
      `layout ${w}x${h}: default map substantial`,
      b.height >= h * 0.65 && b.width >= w * 0.7,
      b,
    );
    await page.click("#sheet-toggle");
    await page.waitForTimeout(200);
    check(
      `layout ${w}x${h}: list opens`,
      await page.locator("#results").isVisible(),
    );
    await page.click("#sheet-close");
    await page.waitForTimeout(200);
    check(
      `layout ${w}x${h}: list collapses`,
      await page.locator("#results").isHidden(),
    );
    await context.close();
  }
  const { page: failed, context: fc } = await newPage();
  await failed.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 1 });
  });
  await failed.click("#locate");
  check(
    "permission denial leaves restaurant pins intact",
    (await failed.locator(".pin").count()) === 47 &&
      (await failed
        .locator("#gps-status")
        .textContent()
        .then((t) => t.includes("拒绝"))),
  );
  await failed.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 3 });
  });
  await failed.click("#locate");
  check(
    "timeout is handled",
    await failed
      .locator("#gps-status")
      .textContent()
      .then((t) => t.includes("超时")),
  );
  await fc.close();
  check("no browser JavaScript errors", errors.length === 0, errors);
  const { page: extra, context: ec } = await newPage();
  const fixtures = JSON.parse(
    await readFile(path.join(root, "data/places.json"), "utf8"),
  );
  const cityFixtures = JSON.parse(
    await readFile(path.join(root, "data/cities.json"), "utf8"),
  );
  cityFixtures.push({
    id: "test-city",
    name: "测试第四城市",
    searchName: "Test City",
    country: "Vietnam",
    lat: 16.1,
    lon: 108.3,
  });
  fixtures.push({
    id: "TEST_ONLY",
    name: "测试景点（仅测试）",
    city: "test-city",
    cityName: "测试第四城市",
    category: "sight",
    lat: 16.1,
    lon: 108.3,
    awards: {},
    coordinateSource: "https://example.com/test",
    coordinateCheckedAt: "2026-09-25",
    positionStatus: "测试用点，未写入产品数据",
    googleMapsUrl: "https://maps.app.goo.gl/testOnly",
    tags: [],
  });
  await ec.route("**/data/places.json", (r) => r.fulfill({ json: fixtures }));
  await ec.route("**/data/cities.json", (r) =>
    r.fulfill({ json: cityFixtures }),
  );
  await extra.reload({ waitUntil: "networkidle" });
  await extra.waitForFunction(() => !!window.__travelMap);
  await extra.selectOption("#city", "test-city");
  check(
    "fourth city automatically appears from independent data",
    (await extra.locator(".pin").count()) === 1,
  );
  check(
    "new sight gets its own marker category",
    (await extra.locator(".pin.sight").count()) === 1,
  );
  await extra.evaluate(() => window.__travelMap.showDetail("TEST_ONLY"));
  check(
    "non-Michelin sight shows in 2026 and retains exact Google link",
    (await extra.locator(".detail a.google").getAttribute("href")) ===
      "https://maps.app.goo.gl/testOnly",
  );
  check(
    "unknown sight fee not shown as zero",
    (await extra
      .locator(".detail .estimate")
      .textContent()
      .then((t) => t.includes("价格待核对"))) &&
      (await extra.locator(".bigprice").count()) === 0,
  );
  await ec.close();
  if (process.env.VMAP_LIVE_TILES === "1") {
    const { page: live, context: lc } = await newPage(412, 915, {
      liveTiles: true,
    });
    await live.waitForFunction(
      () =>
        [...document.querySelectorAll("#tiles img")].some(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      { timeout: 20000 },
    );
    check(
      "live OSM tiles load over actual network",
      await live.evaluate(() =>
        [...document.querySelectorAll("#tiles img")].some(
          (i) => i.naturalWidth > 0,
        ),
      ),
    );
    await live.screenshot({ path: path.join(out, "mobile-live-map.png") });
    await live.evaluate(() =>
      window.__travelMap.showDetail(
        window.__travelMap.DATA.find((r) =>
          r.name.includes("Bánh Xèo Bà Dưỡng"),
        ).id,
      ),
    );
    await live.waitForTimeout(1000);
    await live.screenshot({ path: path.join(out, "mobile-live-detail.png") });
    await lc.close();
  }
  check("all contexts free of JavaScript errors", errors.length === 0, errors);
} catch (e) {
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(out, "browser-checks.json"),
    JSON.stringify(
      {
        base,
        checkedAt: new Date().toISOString(),
        passed: checks.filter((x) => x.pass).length,
        total: checks.length,
        checks,
        errors,
        limitations: [
          "GPS and clipboard simulated. No actual Grab app search, booking, payment or ride was performed.",
          "Most tile requests stubbed; live OSM only when VMAP_LIVE_TILES=1.",
          "Fourth-city fixture exists only in intercepted browser responses. No real new location was published.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        passed: checks.filter((x) => x.pass).length,
        total: checks.length,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  server.closeAllConnections();
  server.close();
}
