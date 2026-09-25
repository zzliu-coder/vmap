import { encodePlusCode } from "../assets/plus-code.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as c from "../assets/core.mjs";
const read = async (p) =>
  JSON.parse(await readFile(new URL(p, import.meta.url), "utf8"));
const places = await read("../data/places.json"),
  cities = await read("../data/cities.json");
const ctx = {};
vm.runInNewContext(
  await readFile(
    new URL("../vendor/openlocationcode.js", import.meta.url),
    "utf8",
  ),
  ctx,
);
const olc = ctx.OpenLocationCode;
const base = {
  city: "dn",
  year: "2026",
  category: "all",
  award: "all",
  budget: "all",
  query: "",
  radius: "all",
  sort: "name",
  user: null,
  favorites: new Set(),
  favoritesOnly: false,
};
const sample = places.find((r) => r.name === "Gia");
test("catalog validates and preserves 203 records / 189 source coordinates", () => {
  assert.deepEqual(c.validateCatalog(cities, places), []);
  assert.equal(places.length, 203);
  assert.equal(places.filter(c.hasPoint).length, 189);
});
test("2026: Da Nang 47, Hanoi 65, HCMC 81", () => {
  for (const [city, n] of [
    ["dn", 47],
    ["hn", 65],
    ["hcm", 81],
  ])
    assert.equal(c.filterPlaces(places, { ...base, city }).length, n);
});
test("2025: Da Nang 43; two-year catalogs stay present", () => {
  assert.equal(c.filterPlaces(places, { ...base, year: "2025" }).length, 43);
  assert.equal(
    c.filterPlaces(places, { ...base, year: "all", city: "all" }).length,
    203,
  );
});
test("Da Nang Bib filter is 23", () =>
  assert.equal(
    c.filterPlaces(places, { ...base, award: "必比登" }).length,
    23,
  ));
test("budget compares upper bound, not best-case minimum", () =>
  assert(
    c
      .filterPlaces(places, { ...base, budget: "50" })
      .every((r) => r.high <= 50),
  ));
test("accent-insensitive Vietnamese names", () =>
  assert(
    c
      .filterPlaces(places, { ...base, query: "ba duong" })
      .some((r) => r.name.includes("Dưỡng")),
  ));
test("known sphere distance, inverse, missing coordinate", () => {
  assert(
    Math.abs(c.distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 2,
  );
  assert.equal(c.distance(sample, sample), 0);
  assert.equal(c.distance(null, sample), Infinity);
  assert(!c.hasPoint({ lat: 91, lon: 1 }));
  assert(!c.hasPoint({ lat: 0, lon: NaN }));
});
test("nearby radius and sorted distance", () => {
  const s = {
    ...base,
    city: "all",
    radius: "5",
    sort: "distance",
    user: { lat: 16.067, lon: 108.241 },
  };
  const rows = c.filterPlaces(places, s);
  assert(rows.length > 10);
  assert(rows.every((r) => c.distance(s.user, r) <= 5000));
  for (let i = 1; i < rows.length; i++)
    assert(c.distance(s.user, rows[i]) >= c.distance(s.user, rows[i - 1]));
});
test("distance filter without location shows no invented distances", () =>
  assert.equal(c.filterPlaces(places, { ...base, radius: "5" }).length, 0));
test("favorites retain stable IDs", () =>
  assert.deepEqual(
    c
      .filterPlaces(places, {
        ...base,
        city: "all",
        favoritesOnly: true,
        favorites: new Set([sample.id]),
      })
      .map((r) => r.id),
    [sample.id],
  ));
test("Google details query contains the name/address, not bare coordinates", () => {
  for (const r of places) {
    const u = new URL(c.googlePlaceUrl(r, cities));
    assert.equal(u.searchParams.get("api"), "1");
    assert(u.searchParams.get("query").includes(r.name));
    if (c.hasPoint(r))
      assert(!u.searchParams.get("query").includes(String(r.lat)));
  }
});
test("exact Google share links and Place IDs take precedence", () => {
  assert.equal(
    c.googlePlaceUrl(
      { ...sample, googleMapsUrl: "https://maps.app.goo.gl/testOnly" },
      cities,
    ),
    "https://maps.app.goo.gl/testOnly",
  );
  assert.equal(
    new URL(
      c.googlePlaceUrl(
        { ...sample, googlePlaceId: "ChIJ_test_fixture" },
        cities,
      ),
    ).searchParams.get("query_place_id"),
    "ChIJ_test_fixture",
  );
});
test("untrusted URLs are not activated", () => {
  for (const u of [
    "javascript:alert(1)",
    "https://google.com.evil.example/maps/x",
    "http://google.com/maps",
    "https://u:p@google.com/maps",
    "https://example.com/photo",
  ])
    assert.equal(c.safeGoogleUrl(u), "");
});
test("navigation keeps destination coordinates separate from photo search", () => {
  assert.equal(
    new URL(c.googlePinUrl(sample)).searchParams.get("query"),
    `${sample.lat},${sample.lon}`,
  );
  assert.equal(
    new URL(c.googleDirectionsUrl(sample, cities)).searchParams.get(
      "destination",
    ),
    `${sample.lat},${sample.lon}`,
  );
});
test("every mapped point produces a complete unambiguous Plus Code", () => {
  for (const r of places) {
    const code = c.plusCode(r, olc);
    if (!c.hasPoint(r)) {
      assert.equal(code, "");
      continue;
    }
    assert(olc.isFull(code));
    assert.equal(code.indexOf("+"), 8);
    const decoded = olc.decode(code);
    assert(
      r.lat >= decoded.latitudeLo - 1e-9 && r.lat <= decoded.latitudeHi + 1e-9,
    );
    assert(
      r.lon >= decoded.longitudeLo - 1e-9 &&
        r.lon <= decoded.longitudeHi + 1e-9,
    );
  }
});
test("upstream Google encoding fixtures", async () => {
  const text = await readFile(
    new URL("./olc-encoding.csv", import.meta.url),
    "utf8",
  );
  let count = 0;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [lat, lon, , , len, code] = line.trim().split(",");
    if (code)
      assert.equal(
        encodePlusCode(Number(lat), Number(lon), Number(len)),
        code,
        `OLC fixture ${line}`,
      );
    else
      assert.throws(() =>
        encodePlusCode(Number(lat), Number(lon), Number(len)),
      );
    count++;
  }
  assert(count > 200);
  console.log("Upstream Plus Code vectors verified:", count);
});
test("separate documented dropoff replaces only ride destination", () => {
  const r = {
    ...sample,
    dropoff: {
      lat: 21.0276,
      lon: 105.836,
      label: "TEST entrance",
      source: "https://example.com/entrance",
      verifiedAt: "2026-09-25",
    },
  };
  assert.equal(c.plusCode(r, olc), olc.encode(21.0276, 105.836, 10));
  assert.equal(c.googlePlaceUrl(r, cities), c.googlePlaceUrl(sample, cities));
  assert.notEqual(c.googlePinUrl(r), c.googlePinUrl(sample));
});
test("missing-price place is never represented as free", () => {
  const r = { ...sample, low: null, high: null };
  assert.equal(c.price(r), "价格待核对");
  assert(!c.hasPrice(r));
});
test("ordinary sight in a fourth city appears without Michelin awards", () => {
  const city = {
    id: "test-city",
    name: "测试城市",
    searchName: "Test City",
    country: "Vietnam",
    lat: 16,
    lon: 108,
  };
  const sight = {
    id: "TEST_SIGHT",
    name: "Test sight (fixture only)",
    city: "test-city",
    cityName: "测试城市",
    category: "sight",
    lat: 16.1,
    lon: 108.1,
    coordinateSource: "https://example.com/source",
    coordinateCheckedAt: "2026-09-25",
    positionStatus: "test fixture",
    awards: {},
    low: null,
    high: null,
    tags: [],
  };
  const next = c.mergeCatalog(cities, places, {
    cities: [city],
    places: [sight],
  });
  assert.equal(next.cities.length, 4);
  assert.equal(next.places.length, 204);
  assert.deepEqual(
    c
      .filterPlaces(next.places, { ...base, city: "test-city" })
      .map((r) => r.id),
    ["TEST_SIGHT"],
  );
  assert.equal(
    c.filterPlaces(next.places, { ...base, city: "test-city", award: "必比登" })
      .length,
    0,
  );
  assert.equal(
    c.filterPlaces(next.places, { ...base, city: "test-city", budget: "50" })
      .length,
    0,
  );
});
test("incremental update preserves coordinates and historical fields", () => {
  const next = c.mergeCatalog(cities, places, {
    places: [
      {
        id: sample.id,
        googleMapsUrl: "https://maps.app.goo.gl/testOnly",
        awards: { 2027: "一星" },
      },
    ],
  });
  const r = next.places.find((r) => r.id === sample.id);
  assert.equal(r.lat, sample.lat);
  assert.equal(r.food, sample.food);
  assert.equal(r.awards["2025"], sample.awards["2025"]);
  assert.equal(r.awards["2027"], "一星");
  assert.equal(sample.googleMapsUrl, "");
  assert.equal(next.places.length, places.length);
});
test("same patch is idempotent and never deletes other points", () => {
  const patch = { places: [{ id: sample.id, notes: "Fixture note" }] };
  const one = c.mergeCatalog(cities, places, patch),
    two = c.mergeCatalog(one.cities, one.places, patch);
  assert.deepEqual(one, two);
  assert.equal(two.places.length, 203);
});
test("duplicate IDs, bogus coordinates and unsafe links are rejected", () => {
  assert(c.validateCatalog(cities, [...places, sample]).length > 0);
  for (const patch of [
    { id: sample.id, lat: 181 },
    { id: sample.id, googleMapsUrl: "javascript:alert(1)" },
    { id: sample.id, low: 300, high: 20 },
    { id: sample.id, category: "unknown" },
    { id: sample.id, dropoff: { lat: 1, lon: 2 } },
  ])
    assert.throws(() => c.mergeCatalog(cities, places, { places: [patch] }));
  assert.throws(() =>
    c.mergeCatalog(cities, places, {
      places: [{ id: sample.id }, { id: sample.id }],
    }),
  );
});
test("escaped user-facing text cannot add elements", () => {
  assert.equal(
    c.escapeHTML('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
});
test("excluded Du Yen coordinate remains excluded", () => {
  const r = places.find((r) => r.id === "VN109");
  assert(r);
  assert(!c.hasPoint(r));
  assert.equal(c.plusCode(r, olc), "");
});
