import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCatalog } from "../src/catalog/loader.js";
import { parseCatalog } from "../src/catalog/schema.js";

const packagedCatalog = new URL("../../catalog/", import.meta.url).pathname;
const digest = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
async function fixture(manifest: unknown, asset = "x") {
  const root = await mkdtemp(join(tmpdir(), "catalog-"));
  await mkdir(join(root, "skills", "safe"), { recursive: true });
  await writeFile(join(root, "skills", "safe", "SKILL.md"), asset);
  await writeFile(join(root, "catalog.json"), JSON.stringify(manifest));
  return root;
}
const valid = () => ({ schemaVersion: 1, catalogVersion: "1.0.0", skills: [{ id: "safe", stacks: ["nodejs"], path: "skills/safe/SKILL.md", digest }] });

test("catalog loads packaged skills offline in ID order independent of network", async () => {
  const loaded = await loadCatalog(packagedCatalog);
  assert.deepEqual([...loaded.assets.keys()], ["nodejs", "react", "sap-ui5", "spring-boot"]);
  assert.equal(loaded.assets.get("react")?.toString().includes("React"), true);
});

test("catalog rejects malformed metadata, unsafe fields, and duplicates", () => {
  assert.throws(() => parseCatalog({ ...valid(), extra: true }), /Invalid catalog/);
  assert.throws(() => parseCatalog({ ...valid(), schemaVersion: 2 }), /Invalid catalog/);
  assert.throws(() => parseCatalog({ ...valid(), skills: [{ ...valid().skills[0], id: "../bad" }] }), /Invalid catalog/);
  assert.throws(() => parseCatalog({ ...valid(), skills: [{ ...valid().skills[0], id: "other" }] }), /Invalid catalog/);
  assert.throws(() => parseCatalog({ ...valid(), skills: [valid().skills[0], valid().skills[0]] }), /Invalid catalog/);
  assert.throws(() => parseCatalog({ ...valid(), skills: [{ ...valid().skills[0], digest: digest.toUpperCase() }] }), /Invalid catalog/);
});

test("catalog rejects missing, changed, and symlinked assets", async (t) => {
  const roots: string[] = []; t.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  for (const setup of [
    async () => fixture(valid(), "changed"),
    async () => fixture({ ...valid(), skills: [{ ...valid().skills[0], path: "skills/safe/missing.md" }] }),
    async () => { const root = await fixture(valid()); await rm(join(root, "skills", "safe", "SKILL.md")); await symlink(join(root, "catalog.json"), join(root, "skills", "safe", "SKILL.md")); return root; }
  ]) { const root = await setup(); roots.push(root); await assert.rejects(loadCatalog(root), /Invalid catalog/); }
});
