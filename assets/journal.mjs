const DB_NAME = "vmap-travel-journal";
const STORE = "checkins";
const VERSION = 1;

export const coordinateText = (point, digits = 6) =>
  point && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    ? `${point.lat.toFixed(digits)},${point.lon.toFixed(digits)}`
    : "";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withStore(mode, work) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let value;
      try {
        value = work(store);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB aborted"));
    });
  } finally {
    db.close();
  }
}

export async function listCheckins() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () =>
        resolve(
          req.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
export async function saveCheckin(entry) {
  if (!entry?.id || !entry?.createdAt || !entry?.title)
    throw new Error("打卡记录缺少必要字段");
  return withStore("readwrite", (store) => store.put(entry));
}

export async function deleteCheckin(id) {
  return withStore("readwrite", (store) => store.delete(id));
}

export async function clearCheckins() {
  return withStore("readwrite", (store) => store.clear());
}

export function newCheckinId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `checkin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function locationLabel(source) {
  if (source === "gps") return "手机 GPS";
  if (source === "manual") return "地图临时位置";
  if (source === "place") return "地点公开坐标";
  return "未记录坐标";
}
export async function preparePhotos(fileList, maxPhotos = 8) {
  const files = [...(fileList || [])].slice(0, maxPhotos);
  const photos = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 25 * 1024 * 1024)
      throw new Error(`${file.name} 超过 25MB，请先缩小图片`);
    photos.push(await compressPhoto(file));
  }
  return photos;
}

async function compressPhoto(file) {
  if (!globalThis.createImageBitmap) {
    return { name: file.name, type: file.type, blob: file };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.84),
    );
    if (!blob) throw new Error("图片压缩失败");
    return {
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      type: "image/jpeg",
      blob,
    };
  } catch {
    return { name: file.name, type: file.type, blob: file };
  } finally {
    bitmap?.close?.();
  }
}

export async function storageInfo() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function serializableEntry(entry) {
  return {
    ...entry,
    photos: await Promise.all(
      (entry.photos || []).map(async (p) => ({
        name: p.name,
        type: p.type,
        data: await blobToDataURL(p.blob),
      })),
    ),
  };
}

export async function exportBackup(entries) {
  const payload = {
    format: "vmap-travel-journal",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: await Promise.all(entries.map(serializableEntry)),
  };
  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `越南旅行打卡备份-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export async function importBackup(file) {
  const payload = JSON.parse(await file.text());
  if (
    payload?.format !== "vmap-travel-journal" ||
    !Array.isArray(payload.entries)
  )
    throw new Error("这不是 VMap 旅行打卡备份");
  let count = 0;
  for (const raw of payload.entries) {
    if (!raw?.id || !raw?.title || !raw?.createdAt) continue;
    const photos = [];
    for (const p of raw.photos || []) {
      if (!p?.data?.startsWith("data:image/")) continue;
      const response = await fetch(p.data);
      photos.push({
        name: p.name || "photo.jpg",
        type: p.type,
        blob: await response.blob(),
      });
    }
    await saveCheckin({ ...raw, photos });
    count++;
  }
  return count;
}
export async function exportJournalHTML(entries) {
  const rows = await Promise.all(entries.map(serializableEntry));
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const cards = rows
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((e) => {
      const photos = (e.photos || [])
        .map((p) => `<img src="${p.data}" alt="${esc(p.name)}">`)
        .join("");
      return `<article><time>${esc(new Date(e.createdAt).toLocaleString("zh-CN"))}</time>
<h2>${esc(e.title)}</h2>
<p class="meta">${esc(e.cityName || "")}${e.coords ? " · " + esc(coordinateText(e.coords)) : ""}</p>
<p>${esc(e.note || "").replace(/\n/g, "<br>")}</p>
<div class="photos">${photos}</div></article>`;
    })
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>我的越南旅行日记</title><style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:860px;margin:auto;padding:24px;color:#173438;background:#f4f7f5}
h1{font-size:32px}article{background:white;border-radius:16px;padding:20px;margin:18px 0;box-shadow:0 2px 12px #1231}
time,.meta{color:#667b78;font-size:13px}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:12px}
img{width:100%;height:auto;border-radius:10px}p{line-height:1.7;white-space:normal}</style>
<h1>我的越南旅行日记</h1><p>由 VMap 本机打卡记录导出 · ${esc(new Date().toLocaleString("zh-CN"))}</p>${cards}`;
  download(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `我的越南旅行日记-${new Date().toISOString().slice(0, 10)}.html`,
  );
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
