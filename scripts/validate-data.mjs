import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCatalog, hasPoint } from "../assets/core.mjs";
export const root = fileURLToPath(new URL("../", import.meta.url));
export async function loadCatalog() {
  const read = async (p) =>
    JSON.parse(await readFile(path.join(root, p), "utf8"));
  return {
    cities: await read("data/cities.json"),
    places: await read("data/places.json"),
    manifest: await read("manifest.json"),
  };
}
export function catalogManifest(catalog) {
  const { cities, places, manifest } = catalog;
  return {
    ...manifest,
    totalCatalog: places.length,
    mapped: places.filter(hasPoint).length,
    cities: Object.fromEntries(
      cities.map((c) => {
        const rows = places.filter((p) => p.city === c.id);
        return [
          c.id,
          {
            catalog: rows.length,
            mapped: rows.filter(hasPoint).length,
            ...Object.fromEntries(
              [...new Set(rows.flatMap((p) => Object.keys(p.awards || {})))]
                .sort()
                .map((y) => [y, rows.filter((p) => p.awards?.[y]).length]),
            ),
          },
        ];
      }),
    ),
  };
}
export async function validate() {
  const c = await loadCatalog(),
    errors = validateCatalog(c.cities, c.places);
  if (errors.length) throw new Error(errors.join("\n"));
  return c;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const c = await validate();
    console.log(
      JSON.stringify(
        {
          pass: true,
          cities: c.cities.length,
          places: c.places.length,
          mapped: c.places.filter(hasPoint).length,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
