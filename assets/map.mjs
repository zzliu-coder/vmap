import { hasPoint, toRadians, price } from "./core.mjs";
const $ = (id) => document.getElementById(id);
export class TravelMap {
  constructor(el, options) {
    this.options = options;
    this.el = el;
    this.center = { lat: 16.065, lon: 108.231 };
    this.zoom = 12;
    this.rows = [];
    this.nodes = new Map();
    this.tiles = new Map();
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.raf = 0;
    this.tileProviders = [
      {
        name: "OpenStreetMap",
        template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      },
      {
        name: "OpenStreetMap DE",
        template: "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
      },
    ];
    this.tileProviderIndex = 0;
    this.tileCacheLimit = 120;
    this.currentNeed = new Set();
    this.tileStatusTimer = 0;
    this.setup();
    this.updateProviderLabel();
    new ResizeObserver(() => this.queue()).observe(el);
  }
  project(p, z = this.zoom) {
    const s = 256 * 2 ** z,
      lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
    return {
      x: ((p.lon + 180) / 360) * s,
      y: ((1 - Math.asinh(Math.tan(toRadians(lat))) / Math.PI) / 2) * s,
    };
  }
  unproject(p, z = this.zoom) {
    const s = 256 * 2 ** z;
    return {
      lon: (p.x / s) * 360 - 180,
      lat:
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * p.y) / s))) * 180) / Math.PI,
    };
  }
  size() {
    return { w: this.el.clientWidth, h: this.el.clientHeight };
  }
  queue() {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.draw();
      });
  }
  pan(p) {
    this.center = { lat: p.lat, lon: p.lon };
    this.queue();
  }
  view(p, z) {
    this.center = { lat: p.lat, lon: p.lon };
    this.zoom = Math.min(19, Math.max(3, z));
    this.queue();
  }
  zoomBy(delta, anchor) {
    const old = this.zoom,
      z = Math.min(19, Math.max(3, old + delta));
    if (z === old) return;
    const { w, h } = this.size();
    anchor = anchor || { x: w / 2, y: h / 2 };
    const c = this.project(this.center),
      at = this.unproject({
        x: c.x + anchor.x - w / 2,
        y: c.y + anchor.y - h / 2,
      });
    this.zoom = z;
    const p = this.project(at);
    this.center = this.unproject({
      x: p.x - anchor.x + w / 2,
      y: p.y - anchor.y + h / 2,
    });
    this.queue();
  }
  fit(points, maxZoom = 16) {
    if (!points.length) {
      this.view(this.options.cityCenter(), 12);
      return;
    }
    if (points.length === 1) {
      this.view(points[0], maxZoom);
      return;
    }
    const { w, h } = this.size();
    if (w < 20 || h < 20) return;
    const ps = points.map((p) => this.project(p, 0)),
      xs = ps.map((p) => p.x),
      ys = ps.map((p) => p.y),
      minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys),
      ratio = Math.min(
        Math.max(60, w - 88) / Math.max(maxX - minX, 0.00001),
        Math.max(50, h - 100) / Math.max(maxY - minY, 0.00001),
      );
    this.zoom = Math.max(3, Math.min(maxZoom, Math.floor(Math.log2(ratio))));
    this.center = this.unproject(
      { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      0,
    );
    this.queue();
  }
  setRows(rows) {
    this.rows = rows.filter(hasPoint);
    const keep = new Set(this.rows.map((r) => r.id));
    for (const [id, node] of this.nodes)
      if (!keep.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    for (const r of this.rows) {
      let node = this.nodes.get(r.id);
      if (!node) {
        node = document.createElement("button");
        node.dataset.id = r.id;
        node.setAttribute("aria-label", r.name + "，查看地点");
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          this.options.onSelect(r.id);
        });
        $("pins").append(node);
        this.nodes.set(r.id, node);
      }
      const st = this.options.style(r);
      node.dataset.name = r.name;
      node.className =
        "pin " +
        st.className +
        (r.closed ? " closed" : "") +
        (this.options.state.selected === r.id ? " active" : "");
      node.textContent = st.symbol;
      node.title = r.name + " · " + price(r);
    }
    this.queue();
  }
  screen(p) {
    const c = this.project(this.center),
      n = this.project(p),
      { w, h } = this.size();
    return { x: n.x - c.x + w / 2, y: n.y - c.y + h / 2 };
  }
  provider(step = 0) {
    return this.tileProviders[
      (this.tileProviderIndex + step) % this.tileProviders.length
    ];
  }
  tileUrl(z, x, y, step = 0) {
    return this.provider(step)
      .template.replace("{z}", z)
      .replace("{x}", x)
      .replace("{y}", y);
  }
  loadTile(im, z, x, y, step = 0, retry = 0) {
    im.dataset.providerStep = String(step);
    im.dataset.retry = String(retry);
    im.dataset.state = "loading";
    im.src = this.tileUrl(z, x, y, step);
  }
  scheduleTileStatus() {
    clearTimeout(this.tileStatusTimer);
    this.updateTileStatus();
    const incomplete = [...this.currentNeed].some((key) => {
      const im = this.tiles.get(key);
      return !im || im.dataset.state !== "loaded";
    });
    if (incomplete)
      this.tileStatusTimer = setTimeout(
        () => this.updateTileStatus(true),
        1200,
      );
  }
  updateTileStatus() {
    const fallbackLoaded = [...this.currentNeed].some((key) => {
      const im = this.tiles.get(key);
      return (
        im?.dataset.state === "loaded" &&
        Number(im.dataset.providerStep || 0) > 0
      );
    });
    const providerLabel = $("map-provider");
    if (providerLabel)
      providerLabel.textContent = fallbackLoaded
        ? `${this.provider().name} + 备用`
        : this.provider().name;
  }
  pruneTileCache() {
    if (this.tiles.size <= this.tileCacheLimit) return;
    const stale = [...this.tiles.entries()]
      .filter(([key]) => !this.currentNeed.has(key))
      .sort(
        (a, b) =>
          Number(a[1].dataset.lastUsed || 0) -
          Number(b[1].dataset.lastUsed || 0),
      );
    while (this.tiles.size > this.tileCacheLimit && stale.length) {
      const [key, im] = stale.shift();
      im.remove();
      this.tiles.delete(key);
    }
  }
  retryTiles() {
    for (const key of this.currentNeed) {
      const im = this.tiles.get(key);
      if (!im || im.dataset.state === "loaded") continue;
      const [z, x, y] = key.split("/").map(Number);
      this.loadTile(im, z, ((x % 2 ** z) + 2 ** z) % 2 ** z, y, 0, 0);
    }
    this.scheduleTileStatus();
  }
  switchTiles() {
    this.tileProviderIndex =
      (this.tileProviderIndex + 1) % this.tileProviders.length;
    for (const im of this.tiles.values()) im.remove();
    this.tiles.clear();
    this.updateProviderLabel();
    this.queue();
  }
  updateProviderLabel() {
    const el = $("map-provider");
    if (el) el.textContent = this.provider().name;
  }
  draw() {
    const { w, h } = this.size();
    if (!w || !h) return;
    const center = this.project(this.center),
      left = center.x - w / 2,
      top = center.y - h / 2,
      n = 2 ** this.zoom;
    const need = new Set();
    this.currentNeed = need;
    for (let x = Math.floor(left / 256); x <= Math.floor((left + w) / 256); x++)
      for (
        let y = Math.floor(top / 256);
        y <= Math.floor((top + h) / 256);
        y++
      ) {
        if (y < 0 || y >= n) continue;
        const wrap = ((x % n) + n) % n,
          z = this.zoom,
          key = `${z}/${x}/${y}`;
        need.add(key);
        let im = this.tiles.get(key);
        if (!im) {
          im = new Image();
          im.alt = "";
          im.draggable = false;
          im.decoding = "async";
          im.dataset.state = "loading";
          im.onload = () => {
            im.dataset.state = "loaded";
            im.style.opacity = "1";
            this.updateTileStatus();
          };
          im.onerror = () => {
            const retry = Number(im.dataset.retry || 0),
              step = Number(im.dataset.providerStep || 0);
            if (!this.currentNeed.has(key)) {
              im.dataset.state = "failed";
              return;
            }
            if (retry < 2) {
              im.dataset.state = "loading";
              setTimeout(
                () =>
                  this.tiles.get(key) === im &&
                  this.currentNeed.has(key) &&
                  this.loadTile(im, z, wrap, y, step, retry + 1),
                retry === 0 ? 500 : 1500,
              );
              this.updateTileStatus();
              return;
            }
            if (step + 1 < this.tileProviders.length) {
              im.dataset.state = "loading";
              setTimeout(
                () =>
                  this.tiles.get(key) === im &&
                  this.currentNeed.has(key) &&
                  this.loadTile(im, z, wrap, y, step + 1, 0),
                250,
              );
              this.updateTileStatus(true);
              return;
            }
            im.dataset.state = "failed";
            im.style.opacity = "0";
            this.updateTileStatus(true);
          };
          $("tiles").append(im);
          this.tiles.set(key, im);
          this.loadTile(im, z, wrap, y, 0, 0);
        }
        if (im.dataset.state === "failed") this.loadTile(im, z, wrap, y, 0, 0);
        im.dataset.lastUsed = String(Date.now());
        im.style.display = "";
        im.style.transform = `translate(${Math.round(x * 256 - left)}px,${Math.round(y * 256 - top)}px)`;
      }
    this.currentNeed = need;
    for (const [key, im] of this.tiles)
      if (!need.has(key)) im.style.display = "none";
    this.pruneTileCache();
    this.scheduleTileStatus();
    for (const r of this.rows) {
      const p = this.screen(r),
        node = this.nodes.get(r.id);
      node.style.left = p.x + "px";
      node.style.top = p.y + "px";
      node.style.display =
        p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30 ? "none" : "";
    }
    const old = $("user-dot"),
      circle = $("accuracy-circle");
    if (this.options.state.user) {
      const pos = this.screen(this.options.state.user);
      let dot = old;
      if (!dot) {
        dot = document.createElement("div");
        dot.id = "user-dot";
        dot.className = "userdot";
        dot.setAttribute("aria-label", "我的位置");
        $("pins").append(dot);
      }
      dot.classList.toggle("manual", !!this.options.state.user.manual);
      dot.style.left = pos.x + "px";
      dot.style.top = pos.y + "px";
      let ac = circle;
      if (!ac) {
        ac = document.createElement("div");
        ac.id = "accuracy-circle";
        ac.className = "accuracy";
        $("accuracy-layer").append(ac);
      }
      const mpp =
          (40075016.686 * Math.cos(toRadians(this.options.state.user.lat))) /
          (256 * 2 ** this.zoom),
        rad = Math.max(0, this.options.state.user.accuracy || 0) / mpp;
      ac.style.width = ac.style.height = rad * 2 + "px";
      ac.style.left = pos.x + "px";
      ac.style.top = pos.y + "px";
    } else {
      old?.remove();
      circle?.remove();
    }
    const mpp =
        (40075016.686 * Math.cos(toRadians(this.center.lat))) /
        (256 * 2 ** this.zoom),
      max = 80 * mpp,
      pow = 10 ** Math.floor(Math.log10(max)),
      units = [1, 2, 5, 10].filter((k) => k * pow <= max),
      m = units[units.length - 1] * pow;
    $("scale").style.width = m / mpp + "px";
    $("scale").textContent = m >= 1000 ? m / 1000 + " km" : m + " m";
  }
  setup() {
    this.el.addEventListener("keydown", (e) => {
      if (e.target !== this.el) return;
      const delta = {
        ArrowLeft: [-80, 0],
        ArrowRight: [80, 0],
        ArrowUp: [0, -80],
        ArrowDown: [0, 80],
      }[e.key];
      if (delta) {
        e.preventDefault();
        this.options.onPan?.();
        const p = this.project(this.center);
        this.pan(this.unproject({ x: p.x + delta[0], y: p.y + delta[1] }));
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        this.zoomBy(1);
      }
      if (e.key === "-") {
        e.preventDefault();
        this.zoomBy(-1);
      }
    });
    this.el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button,a")) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.drag = {
          x: e.clientX,
          y: e.clientY,
          center: this.project(this.center),
        };
        this.el.classList.add("dragging");
      } else if (this.pointers.size === 2) {
        this.drag = null;
        const p = [...this.pointers.values()];
        this.pinch = {
          distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
          zoom: this.zoom,
        };
      }
      this.options.onPan?.();
    });
    this.el.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const p = [...this.pointers.values()],
          d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
          delta = Math.round(Math.log2(d / Math.max(1, this.pinch.distance))),
          z = Math.min(19, Math.max(3, this.pinch.zoom + delta));
        if (z !== this.zoom) {
          const box = this.el.getBoundingClientRect();
          this.zoomBy(z - this.zoom, {
            x: (p[0].x + p[1].x) / 2 - box.left,
            y: (p[0].y + p[1].y) / 2 - box.top,
          });
        }
      } else if (this.drag && this.pointers.size === 1) {
        this.center = this.unproject({
          x: this.drag.center.x - (e.clientX - this.drag.x),
          y: this.drag.center.y - (e.clientY - this.drag.y),
        });
        this.center.lat = Math.max(-85, Math.min(85, this.center.lat));
        this.queue();
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      this.drag = null;
      this.pinch = null;
      if (this.pointers.size === 1) {
        const p = [...this.pointers.values()][0];
        this.drag = { x: p.x, y: p.y, center: this.project(this.center) };
      }
      if (!this.pointers.size) this.el.classList.remove("dragging");
    };
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
      this.el.addEventListener(ev, up);
    this.el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const t = Date.now();
        if (t - (this.wheelTime || 0) < 140) return;
        this.wheelTime = t;
        const b = this.el.getBoundingClientRect();
        this.zoomBy(e.deltaY < 0 ? 1 : -1, {
          x: e.clientX - b.left,
          y: e.clientY - b.top,
        });
      },
      { passive: false },
    );
    this.el.addEventListener("dblclick", (e) => {
      if (e.target.closest("button,a")) return;
      const b = this.el.getBoundingClientRect();
      this.zoomBy(1, { x: e.clientX - b.left, y: e.clientY - b.top });
    });
  }
}
