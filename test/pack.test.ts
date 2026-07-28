import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { loadCatalog } from "../src/catalog/loader.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const command = (name: string) => process.platform === "win32" ? `${name}.cmd` : name;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const run = (file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, shell: boolean) => new Promise<{ stdout: string }>((resolveRun, reject) => {
  execFile(file, args, { cwd, env, shell, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`phase=command argv=${JSON.stringify([file, ...args])} exit=${error.code}\nstdout=${stdout}\nstderr=${stderr}`)) : resolveRun({ stdout }));
});
const runCommand = (name: string, args: string[], cwd = root, env = process.env) => run(command(name), args, cwd, env, process.platform === "win32");
const runJavaScript = (args: string[], cwd = root, env = process.env) => run(process.execPath, args, cwd, env, false);
interface TarEntry { readonly path: string; readonly bytes: Buffer }
const entries = (tarball: Buffer): TarEntry[] => {
  const tar = gunzipSync(tarball); const result: TarEntry[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); const path = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, "").trim(), 8) || 0;
    if (path) result.push({ path, bytes: Buffer.from(tar.subarray(offset + 512, offset + 512 + size)) }); offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
};
const sorted = (values: readonly string[]) => [...values].sort();
const packed = (entry: readonly TarEntry[], path: string) => entry.filter((value) => value.path === path);
const expectedSkills = (manifest: { skills: Array<{ id: string; files: Array<{ path: string; digest: string }> }> }) => manifest.skills.flatMap((skill) => skill.files.map((file) => ({ path: `package/catalog/skills/${skill.id}/${file.path}`, digest: file.digest })));
interface ContentRow { readonly path: string; readonly digest: string }
const compareCodePoints = (left: string, right: string) => {
  let leftOffset = 0; let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    const leftPoint = left.codePointAt(leftOffset)!; const rightPoint = right.codePointAt(rightOffset)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftOffset += leftPoint > 0xffff ? 2 : 1; rightOffset += rightPoint > 0xffff ? 2 : 1;
  }
  return leftOffset < left.length ? 1 : rightOffset < right.length ? -1 : 0;
};
const rows = (values: readonly ContentRow[]) => [...values].sort((left, right) => compareCodePoints(left.path, right.path) || compareCodePoints(left.digest, right.digest));
const renderRows = (values: readonly ContentRow[]) => rows(values).map((value) => `${value.path} ${value.digest}`).join("\n") || "(none)";
function assertContent(label: string, expected: readonly ContentRow[], actual: readonly ContentRow[]) {
  const remaining = new Map<string, ContentRow[]>(); for (const value of rows(actual)) remaining.set(value.path, [...(remaining.get(value.path) ?? []), value]);
  const missing: ContentRow[] = []; const mismatch: Array<{ expected: ContentRow; actual: ContentRow }> = [];
  for (const value of rows(expected)) { const values = remaining.get(value.path) ?? []; const match = values.findIndex((actualValue) => actualValue.digest === value.digest); if (match >= 0) values.splice(match, 1); else if (values.length) mismatch.push({ expected: value, actual: values.shift()! }); else missing.push(value); }
  const extra = [...remaining.values()].flat(); if (missing.length || extra.length || mismatch.length) throw new Error(`${label}\nmissing:\n${renderRows(missing)}\nextra:\n${renderRows(extra)}\nmismatch:\n${mismatch.map((value) => `expected ${value.expected.path} ${value.expected.digest}\nactual ${value.actual.path} ${value.actual.digest}`).join("\n") || "(none)"}\nexpected rows:\n${renderRows(expected)}\nactual rows:\n${renderRows(actual)}`);
}
function assertCatalog(entry: readonly TarEntry[]) {
  const manifests = packed(entry, "package/catalog/catalog.json"); assert.equal(manifests.length, 1, "packed manifest must be a singleton");
  const manifest = JSON.parse(manifests[0].bytes.toString()) as Parameters<typeof expectedSkills>[0]; const expected = expectedSkills(manifest);
  const actual = entry.filter((value) => value.path.startsWith("package/catalog/skills/"));
  assertContent("packed skill entries must equal the manifest-derived multiset", expected, actual.map((value) => ({ path: value.path, digest: digest(value.bytes) })));
  return new Set(expected.map((file) => file.path));
}
async function assertPackageContract(tarball: string, cwd: string) {
  const entry = entries(await readFile(tarball)); const skills = assertCatalog(entry);
  const npm = JSON.parse((await runCommand("npm", ["pack", "--dry-run", "--json"], cwd)).stdout) as Array<{ files: Array<{ path: string }> }>;
  const expected = new Set(npm[0].files.map((file) => `package/${file.path}`).filter((path) => !path.startsWith("package/catalog/skills/")));
  const actual = new Set(entry.map((value) => value.path).filter((path) => !skills.has(path)));
  assert.deepEqual(sorted([...actual]), sorted([...expected]), "non-skill package entries must follow npm's authoritative pack contract");
  return entry;
}
const isolatedEnv = (root: string) => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NPM_CONFIG_")).concat([
  ["HOME", join(root, "home")], ["npm_config_cache", join(root, "cache")], ["npm_config_userconfig", join(root, "npmrc")], ["npm_config_globalconfig", join(root, "global-npmrc")],
]));

test("file URL roots use portable path conversion", () => {
  const url = new URL("file:///D:/skill-installer/");
  assert.equal(fileURLToPath(url, { windows: true }), "D:\\skill-installer\\"); assert.notEqual(url.pathname, fileURLToPath(url, { windows: true }));
});

test("missing packed catalog reports an actionable unavailable-catalog error", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "missing-catalog-")); t.after(() => rm(temp, { recursive: true, force: true }));
  await assert.rejects(loadCatalog(temp), /packed catalog unavailable/);
});

test("content diagnostics sort Unicode paths by code point with prefixes first", () => {
  const expected = [{ path: "package/\u{1f600}", digest: "expected-supplementary" }, { path: "package/\u{10000}", digest: "expected-plane-one" }, { path: "package/\ue000/child", digest: "expected-child" }, { path: "package/\ue000", digest: "expected-private" }];
  const actual = [{ path: "package/\u{1f600}", digest: "actual-supplementary" }, { path: "package/\u{10000}", digest: "actual-plane-one" }, { path: "package/\ue000/child", digest: "actual-child" }, { path: "package/\ue000", digest: "actual-private" }];
  assert.throws(() => assertContent("Unicode diagnostic order", expected, actual), { message: "Unicode diagnostic order\nmissing:\n(none)\nextra:\n(none)\nmismatch:\nexpected package/\ue000 expected-private\nactual package/\ue000 actual-private\nexpected package/\ue000/child expected-child\nactual package/\ue000/child actual-child\nexpected package/\u{10000} expected-plane-one\nactual package/\u{10000} actual-plane-one\nexpected package/\u{1f600} expected-supplementary\nactual package/\u{1f600} actual-supplementary\nexpected rows:\npackage/\ue000 expected-private\npackage/\ue000/child expected-child\npackage/\u{10000} expected-plane-one\npackage/\u{1f600} expected-supplementary\nactual rows:\npackage/\ue000 actual-private\npackage/\ue000/child actual-child\npackage/\u{10000} actual-plane-one\npackage/\u{1f600} actual-supplementary" });
});

test("packed manifest exactly defines catalog skills and the remaining package contract", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "skill-pack-")); t.after(() => rm(temp, { recursive: true, force: true }));
  await runCommand("pnpm", ["pack", "--pack-destination", temp]); const tarball = join(temp, (await readdir(temp)).find((file) => file.endsWith(".tgz"))!);
  const entry = await assertPackageContract(tarball, root); const skill = entry.find((value) => value.path.startsWith("package/catalog/skills/"))!;
  assert.throws(() => assertCatalog([...entry, skill]), /multiset|duplicate/); assert.throws(() => assertCatalog(entry.map((value) => value === skill ? { ...value, path: "package/catalog/skills/nodejs/references\\bad.md" } : value)), /multiset/);
  const other = entry.find((value) => value !== skill && value.path.startsWith("package/catalog/skills/"))!; const broken = entry.filter((value) => value !== other).map((value) => value === skill ? { ...value, bytes: Buffer.from("changed\n") } : value); broken.push({ ...skill, path: "package/catalog/skills/nodejs/references/extra.md" });
  let failure: Error; try { assertCatalog(broken); throw new Error("expected package comparison failure"); } catch (error) { failure = error as Error; }
  assert.match(failure.message, /missing:.*extra:.*mismatch:.*expected rows:.*actual rows:/s); assert.match(failure.message, /package\/catalog\/skills\/.* [a-f0-9]{64}/); assert.match(failure.message, /expected rows:\npackage\/catalog\/skills\/nodejs\/SKILL\.md [a-f0-9]{64}\npackage\/catalog\/skills\/react-architecture\/SKILL\.md [a-f0-9]{64}/s);
});

test("synthetic nested references install from a deleted producer through the packaged JavaScript bin", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "offline-skill-pack-")); t.after(() => rm(temp, { recursive: true, force: true })); const producer = join(temp, "producer");
  const files = new Map([["SKILL.md", Buffer.from("# Synthetic\n")], ["references/first.md", Buffer.from("first\n")], ["references/second.md", Buffer.from("second\n")]]);
  await cp(join(root, "dist"), join(producer, "dist"), { recursive: true }); await mkdir(join(producer, "catalog", "skills", "nodejs", "references"), { recursive: true });
  await Promise.all([...files].map(([path, bytes]) => writeFile(join(producer, "catalog", "skills", "nodejs", ...path.split("/")), bytes)));
  const manifest = { schemaVersion: 2, catalogVersion: "2.0.0", skills: [{ id: "nodejs", stacks: ["nodejs"], files: [...files].map(([path, bytes]) => ({ path, digest: digest(bytes) })) }] };
  await writeFile(join(producer, "catalog/catalog.json"), `${JSON.stringify(manifest)}\n`); await writeFile(join(producer, "package.json"), JSON.stringify({ name: "synthetic-skill-installer", version: "1.0.0", private: true, type: "module", bin: { "project-skill-installer": "dist/src/cli.js" }, files: ["dist/**", "catalog/**"] }));
  const packages = join(temp, "packages"); await mkdir(packages); await runCommand("pnpm", ["pack", "--pack-destination", packages], producer); const tarball = join(packages, (await readdir(packages)).find((file) => file.endsWith(".tgz"))!);
  const entry = await assertPackageContract(tarball, producer); assert.doesNotMatch(Buffer.concat(entry.filter((value) => value.path.startsWith("package/dist/src/")).map((value) => value.bytes)).toString(), /projectSingleFileAssets|toSingleFileTransactionActions/);
  await rm(producer, { recursive: true, force: true }); const prefix = join(temp, "prefix"); const env = isolatedEnv(temp); await runCommand("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--prefix", prefix, tarball], temp, env);
  const installed = join(prefix, "node_modules", "synthetic-skill-installer"); const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as { bin: Record<string, string> }; const target = pkg.bin["project-skill-installer"];
  assert.ok(typeof target === "string" && target.endsWith(".js") && !isAbsolute(target) && !target.includes("\\") && target.split("/").every((part) => part && part !== "." && part !== "..")); const cli = resolve(installed, target); assert.ok(!relative(installed, cli).startsWith(".."));
  const consumer = join(temp, "consumer"); await mkdir(consumer); await writeFile(join(consumer, "package.json"), "{}"); await runJavaScript([cli, "--cwd", consumer], temp, env);
  const expected = [...files].map(([path, bytes]) => ({ path, digest: digest(bytes) })); const actual = (await Promise.all(expected.map(async (file) => { try { return { path: file.path, digest: digest(await readFile(join(consumer, ".agents", "skills", "nodejs", ...file.path.split("/")))) }; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }))).filter((file): file is ContentRow => file !== undefined);
  assertContent("installed skill files must equal synthetic fixture", expected, actual);
  await rm(join(installed, "catalog", "catalog.json")); await assert.rejects(runJavaScript([cli, "--cwd", consumer], temp, env), /packed catalog unavailable/);
});
