import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog/loader.js";
import { parseCatalog } from "../src/catalog/schema.js";
import { runApp } from "../src/app.js";

const packagedCatalog = fileURLToPath(new URL("../../catalog/", import.meta.url));
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
  assert.deepEqual([...loaded.assets.keys()], ["nodejs-architecture", "nodejs-quality-safeguards", "nodejs-runtime-integration", "nodejs-testing", "react-architecture", "react-quality-safeguards", "react-state-data-integration", "react-testing", "sap-ui5", "spring-boot"]);
  const nodejs = loaded.catalog.skills.filter((skill) => skill.stacks.includes("nodejs"));
  assert.deepEqual(nodejs.map((skill) => skill.id), ["nodejs-architecture", "nodejs-quality-safeguards", "nodejs-runtime-integration", "nodejs-testing"]);
  const react = loaded.catalog.skills.filter((skill) => skill.stacks.includes("react"));
  assert.deepEqual(react.map((skill) => skill.id), ["react-architecture", "react-quality-safeguards", "react-state-data-integration", "react-testing"]);
  for (const skill of react) {
    const bytes = await readFile(new URL(`../../catalog/${skill.path}`, import.meta.url));
    assert.deepEqual(loaded.assets.get(skill.id), bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), skill.digest);
  }
});

test("Node.js detection installs all and only sorted Node.js IDs with verified bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nodejs-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loaded = await loadCatalog(packagedCatalog);
  const ids = ["nodejs-architecture", "nodejs-quality-safeguards", "nodejs-runtime-integration", "nodejs-testing"];
  const output: string[] = [];
  const dependencies = { cwd: () => root, resolve: (value: string) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["nodejs" as const], warnings: [] }), write: (text: string) => output.push(text) };
  assert.equal(await runApp(["--dry-run"], dependencies), 0);
  assert.deepEqual(output[0].match(/- install [\w-]+/g), ids.map((id) => `- install ${id}`));
  await assert.rejects(readFile(join(root, ".agents", "skills", ids[0], "SKILL.md")));
  assert.equal(await runApp([], dependencies), 0);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(join(root, ".agents", "skills")), ids);
  for (const id of ids) assert.deepEqual(await readFile(join(root, ".agents", "skills", id, "SKILL.md")), loaded.assets.get(id));
});

test("Node.js and React detection produces a deduplicated ID-sorted union", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nodejs-react-plan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loaded = await loadCatalog(packagedCatalog);
  const ids = ["nodejs-architecture", "nodejs-quality-safeguards", "nodejs-runtime-integration", "nodejs-testing", "react-architecture", "react-quality-safeguards", "react-state-data-integration", "react-testing"];
  const output: string[] = [];
  const dependencies = { cwd: () => root, resolve: (value: string) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["react", "nodejs", "react"] as const, warnings: [] }), write: (text: string) => output.push(text) };
  assert.equal(await runApp(["--dry-run"], dependencies), 0);
  assert.deepEqual(output[0].match(/- install [\w-]+/g), ids.map((id) => `- install ${id}`));
});

test("catalog canonicalizes skills and assets independently of manifest entry order", async () => {
  const root = await fixture({ schemaVersion: 1, catalogVersion: "1.0.0", skills: [
    { id: "zebra", stacks: ["nodejs"], path: "skills/zebra/SKILL.md", digest },
    { id: "alpha", stacks: ["react"], path: "skills/alpha/SKILL.md", digest }
  ] });
  try {
    await mkdir(join(root, "skills", "zebra"), { recursive: true }); await writeFile(join(root, "skills", "zebra", "SKILL.md"), "x");
    await mkdir(join(root, "skills", "alpha"), { recursive: true }); await writeFile(join(root, "skills", "alpha", "SKILL.md"), "x");
    const loaded = await loadCatalog(root);
    assert.deepEqual(loaded.catalog.skills.map((skill) => skill.id), ["alpha", "zebra"]);
    assert.deepEqual([...loaded.assets.keys()], ["alpha", "zebra"]);
  } finally { await rm(root, { recursive: true, force: true }); }
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
