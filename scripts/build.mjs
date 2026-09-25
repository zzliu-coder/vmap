import { mkdir, rm, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, validate, catalogManifest } from "./validate-data.mjs";
try {
  const catalog = await validate();
  // dist is generated output only; catalog validation precedes any build write.
  const out = path.join(root, "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const name of ["index.html", "assets", "data", "vendor"])
    await cp(path.join(root, name), path.join(out, name), { recursive: true });
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(catalogManifest(catalog), null, 2) + "\n",
  );
  console.log(
    `Built v${catalog.manifest.version}: ${catalog.places.length} places, ${catalog.cities.length} cities. Static output: dist/`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
