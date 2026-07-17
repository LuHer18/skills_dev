import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readVerifiedAsset } from "./integrity.js";
import { parseCatalog, type Catalog } from "./schema.js";

export interface LoadedCatalog { catalog: Catalog; assets: ReadonlyMap<string, Buffer> }

export async function loadCatalog(catalogRoot: string): Promise<LoadedCatalog> {
  const manifest = join(catalogRoot, "catalog.json");
  const stat = await lstat(manifest);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid catalog: manifest is not a regular file");
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(manifest, "utf8")); } catch { throw new Error("Invalid catalog: manifest JSON"); }
  const catalog = parseCatalog(parsed);
  const assets = new Map<string, Buffer>();
  for (const skill of catalog.skills) assets.set(skill.id, await readVerifiedAsset(catalogRoot, skill.path, skill.digest));
  return { catalog, assets };
}
