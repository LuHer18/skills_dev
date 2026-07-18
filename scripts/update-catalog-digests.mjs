import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const catalogPath = resolve(root, "catalog/catalog.json");
const arguments_ = process.argv.slice(2);
const check = arguments_.length === 1 && arguments_[0] === "--check";
if (arguments_.length > 0 && !check) throw new Error("Usage: node scripts/update-catalog-digests.mjs [--check]");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const skills = await Promise.all(catalog.skills.map(async (skill) => ({
  ...skill,
  digest: createHash("sha256").update(await readFile(resolve(root, "catalog", skill.path))).digest("hex"),
})));
const next = `${JSON.stringify({ ...catalog, skills: [...skills].sort((left, right) => left.id.localeCompare(right.id)) }, null, 2)}\n`;
if (check) {
  if (await readFile(catalogPath, "utf8") !== next) throw new Error("Catalog digests or ID order are stale; run update-catalog-digests.mjs");
} else await writeFile(catalogPath, next, "utf8");
