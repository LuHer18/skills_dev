import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog/loader.js";
import { parseCatalog } from "../src/catalog/schema.js";
import { runApp } from "../src/app.js";

const packagedCatalog = fileURLToPath(new URL("../../catalog/", import.meta.url));
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const valid = (files = [{ path: "SKILL.md", digest: hash("x") }]) => ({ schemaVersion: 2, catalogVersion: "2.0.0", skills: [{ id: "safe", stacks: ["nodejs"], files }] });
async function fixture(manifest: unknown, files: Record<string, string | Buffer> = { "SKILL.md": "x" }) {
  const root = await mkdtemp(join(tmpdir(), "catalog-"));
  await Promise.all(Object.entries(files).map(async ([path, bytes]) => { const file = join(root, "skills", "safe", path); await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, bytes); }));
  await writeFile(join(root, "catalog.json"), JSON.stringify(manifest)); return root;
}

test("packaged v2 catalog loads seven ordered one-file trees with byte-exact tree bytes", async () => {
  const loaded = await loadCatalog(packagedCatalog);
  assert.deepEqual([...loaded.trees.keys()], ["nodejs", "react-architecture", "react-quality-safeguards", "react-state-data-integration", "react-testing", "sap-ui5", "spring-boot"]);
  for (const skill of loaded.catalog.skills) {
    const file = skill.files[0]; const bytes = await readFile(new URL(`../../catalog/skills/${skill.id}/${file.path}`, import.meta.url));
    assert.deepEqual(loaded.trees.get(skill.id)!.bytes(file.path), bytes); assert.equal(hash(bytes), file.digest);
  }
});

test("verified trees return private byte copies", async () => {
  const root = await fixture(valid()); try {
    const { trees } = await loadCatalog(root); const tree = trees.get("safe")!; const first = tree.bytes("SKILL.md"); first[0] = 121;
    assert.equal(tree.bytes("SKILL.md").toString(), "x");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("loader accepts a canonical tree with shared reference directories", async () => {
  const files = ["SKILL.md", "references/a.md", "references/b.md"].map((path) => ({ path, digest: hash(path === "SKILL.md" ? "x" : path[11]) })); const root = await fixture(valid(files), { "SKILL.md": "x", "references/a.md": "a", "references/b.md": "b" });
  try { assert.deepEqual((await loadCatalog(root)).trees.get("safe")!.paths, files.map((file) => file.path)); } finally { await rm(root, { recursive: true, force: true }); }
});

test("parser copies caller file records into immutable output", () => {
  const input = valid(); const parsed = parseCatalog(input); input.skills[0].files[0].digest = "changed";
  assert.equal(parsed.skills[0].files[0].digest, hash("x")); assert.equal(Object.isFrozen(input.skills[0].files[0]), false); assert.equal(Object.isFrozen(parsed.skills[0].files[0]), true);
});

test("schema v2 rejects v1, unknown fields, aliases, unsafe paths, and noncanonical file lists", () => {
  const one = valid().skills[0]; const invalid = [
    { ...valid(), schemaVersion: 1 }, { ...valid(), extra: true }, { ...valid(), skills: [{ ...one, extra: true }] },
    { ...valid(), skills: [{ ...one, files: [{ path: "SKILL.md", digest: hash("x"), extra: true }] }] },
    ...["/SKILL.md", "../SKILL.md", "references\\x.md", "references/nested/x.md", "references/Upper.md", "references/café.md", "README.sh", "references/x.mdx"].map((path) => ({ ...valid([{ path, digest: hash("x") }]) })),
    valid([{ path: "references/a.md", digest: hash("x") }]), valid([{ path: "SKILL.md", digest: hash("x") }, { path: "SKILL.md", digest: hash("x") }]),
    valid([{ path: "references/b.md", digest: hash("x") }, { path: "SKILL.md", digest: hash("x") }]),
    { ...valid(), skills: [one, one] }, { ...valid(), skills: [{ ...one, id: "zebra" }, { ...one, id: "alpha" }] },
    valid([{ path: "SKILL.md", digest: hash("x") }, { path: "references/a.md", digest: hash("x") }, { path: "references/A.md", digest: hash("x") }]),
  ];
  for (const manifest of invalid) assert.throws(() => parseCatalog(manifest), /Invalid catalog/);
});

test("loader rejects mismatches, invalid Markdown bytes, and non-exact source trees without following links", async (t) => {
  const roots: string[] = []; t.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  const cases: Array<[unknown, Record<string, string | Buffer>, (root: string) => Promise<void>]> = [
    [valid(), { "SKILL.md": "changed" }, async () => {}], [valid(), { "SKILL.md": Buffer.from([0xc3, 0x28]) }, async () => {}],
    [valid(), { "SKILL.md": "\ufeffx" }, async () => {}], [valid(), { "SKILL.md": "x\0" }, async () => {}], [valid(), { "SKILL.md": "x\r\ny" }, async () => {}],
    [valid(), { "SKILL.md": "x", "extra.md": "extra" }, async () => {}], [valid(), { "SKILL.md": "x" }, async (root) => { await rm(join(root, "skills/safe/SKILL.md")); }],
    [valid(), { "SKILL.md": "x" }, async (root) => { await mkdir(join(root, "skills/safe/extra")); }],
    [valid(), { "SKILL.md": "x" }, async (root) => { await rm(join(root, "skills/safe/SKILL.md")); await symlink(join(root, "catalog.json"), join(root, "skills/safe/SKILL.md")); }],
  ];
  for (const [manifest, files, setup] of cases) { const root = await fixture(manifest, files); roots.push(root); await setup(root); await assert.rejects(loadCatalog(root), /Invalid catalog/); }
});

test("React detection preserves existing CLI installation bytes through verified trees", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "react-install-")); t.after(() => rm(root, { recursive: true, force: true }));
  const loaded = await loadCatalog(packagedCatalog); const output: string[] = [];
  const dependencies = { cwd: () => root, resolve: (value: string) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["react" as const], warnings: [] }), write: (text: string) => output.push(text) };
  assert.equal(await runApp([], dependencies), 0);
  for (const id of ["react-architecture", "react-quality-safeguards", "react-state-data-integration", "react-testing"]) assert.deepEqual(await readFile(join(root, ".agents", "skills", id, "SKILL.md")), loaded.trees.get(id)!.bytes("SKILL.md"));
});
