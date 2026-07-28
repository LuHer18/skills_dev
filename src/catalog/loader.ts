import { lstat, readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { readVerifiedAsset } from "./integrity.js";
import { parseCatalog, type Catalog, type Skill } from "./schema.js";

const fail = (message: string): never => { throw new Error(`Invalid catalog: ${message}`); };
export class VerifiedSkillTree {
  readonly paths: readonly string[]; #files: Map<string, Buffer>;
  constructor(files: ReadonlyMap<string, Buffer>) { this.#files = new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)])); this.paths = Object.freeze([...this.#files.keys()].sort()); Object.freeze(this); }
  bytes(path: string): Buffer { const bytes = this.#files.get(path); if (!bytes) throw new Error("Verified asset not found"); return Buffer.from(bytes); }
}
class VerifiedTrees implements ReadonlyMap<string, VerifiedSkillTree> {
  #trees: Map<string, VerifiedSkillTree>; constructor(trees: readonly (readonly [string, VerifiedSkillTree])[]) { this.#trees = new Map(trees); Object.freeze(this); }
  get size() { return this.#trees.size; } get(key: string) { return this.#trees.get(key); } has(key: string) { return this.#trees.has(key); } entries() { return this.#trees.entries(); } keys() { return this.#trees.keys(); } values() { return this.#trees.values(); } forEach(callbackfn: (value: VerifiedSkillTree, key: string, map: ReadonlyMap<string, VerifiedSkillTree>) => void, thisArg?: unknown) { this.#trees.forEach((value, key) => callbackfn.call(thisArg, value, key, this)); } [Symbol.iterator]() { return this.entries(); }
}
export interface LoadedCatalog { readonly catalog: Catalog; readonly trees: ReadonlyMap<string, VerifiedSkillTree> }

async function inventory(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }); const paths: string[] = [];
  for (const entry of entries) { const path = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) fail("source node is unsafe"); if (entry.isDirectory()) paths.push(`${path}/`, ...await inventory(root, path)); else paths.push(path); }
  return paths.sort();
}
async function verifySkill(root: string, skill: Skill): Promise<VerifiedSkillTree> {
  const dir = join(root, "skills", skill.id); const stat = await lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) fail("skill source is not a directory");
  const expected = [...new Set(skill.files.flatMap((file) => file.path.split("/").slice(0, -1).map((_, index, parts) => `${parts.slice(0, index + 1).join("/")}/`).concat(file.path)))].sort(); const actual = await inventory(dir); if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) fail("skill source inventory");
  return new VerifiedSkillTree(new Map(await Promise.all(skill.files.map(async (file) => [file.path, await readVerifiedAsset(join(dir, ...file.path.split(posix.sep)), file.digest)] as const))));
}
export async function loadCatalog(catalogRoot: string): Promise<LoadedCatalog> {
  const manifest = join(catalogRoot, "catalog.json"); let stat;
  try { stat = await lstat(manifest); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("packed catalog unavailable"); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) fail("manifest is not a regular file");
  let parsed: unknown; try { parsed = JSON.parse(await readFile(manifest, "utf8")); } catch { fail("manifest JSON"); }
  const catalog = parseCatalog(parsed); const skillsDir = join(catalogRoot, "skills"); const skillEntries = await readdir(skillsDir, { withFileTypes: true });
  const expectedIds = catalog.skills.map((skill) => skill.id); const actualIds = skillEntries.map((entry) => entry.name).sort();
  if (skillEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink()) || actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) fail("catalog source inventory");
  return Object.freeze({ catalog, trees: new VerifiedTrees(await Promise.all(catalog.skills.map(async (skill) => [skill.id, await verifySkill(catalogRoot, skill)] as const))) });
}
