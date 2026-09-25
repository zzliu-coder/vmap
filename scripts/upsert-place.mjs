import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { root, loadCatalog, catalogManifest } from "./validate-data.mjs";
import { mergeCatalog } from "../assets/core.mjs";
const args = process.argv.slice(2),
  file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error(
    "用法: node scripts/upsert-place.mjs change.json [--write]\n默认只预览；--write 才写入本机数据，不会自动提交或发布。",
  );
  process.exitCode = 1;
} else
  try {
    const patch = JSON.parse(await readFile(path.resolve(file), "utf8")),
      old = await loadCatalog();
    const next = mergeCatalog(old.cities, old.places, patch);
    const added = next.places.filter(
      (p) => !old.places.some((o) => o.id === p.id),
    );
    const updated = next.places.filter((p) =>
      old.places.some(
        (o) => o.id === p.id && JSON.stringify(o) !== JSON.stringify(p),
      ),
    );
    const cityChanged =
      JSON.stringify(old.cities) !== JSON.stringify(next.cities);
    console.log(
      JSON.stringify(
        {
          mode: args.includes("--write") ? "write" : "preview",
          added: added.map((p) => ({ id: p.id, name: p.name })),
          updated: updated.map((p) => ({ id: p.id, name: p.name })),
          cityChanged,
          total: next.places.length,
        },
        null,
        2,
      ),
    );
    if (
      args.includes("--write") &&
      (added.length || updated.length || cityChanged)
    ) {
      const manifest = catalogManifest({
        ...next,
        manifest: {
          ...old.manifest,
          dataVersion: (old.manifest.dataVersion || 1) + 1,
          buildDate: new Date().toISOString().slice(0, 10),
        },
      });
      const changes = [
        ["data/places.json", next.places],
        ["data/cities.json", next.cities],
        ["manifest.json", manifest],
      ];
      const originals = await Promise.all(
        changes.map(async ([name]) => [
          name,
          await readFile(path.join(root, name), "utf8"),
        ]),
      );
      try {
        for (const [name, data] of changes)
          await writeFile(
            path.join(root, name + ".next"),
            JSON.stringify(data, null, 2) + "\n",
          );
        for (const [name] of changes)
          await rename(path.join(root, name + ".next"), path.join(root, name));
      } catch (e) {
        for (const [name, text] of originals)
          await writeFile(path.join(root, name), text);
        throw e;
      }
      console.log(
        "本机数据已更新。下一步: npm test && npm run build；验收后再 git commit / git push。",
      );
    }
  } catch (e) {
    console.error("未完成写入: " + e.message);
    process.exitCode = 1;
  }
