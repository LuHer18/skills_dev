import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const command = (name: string) => process.platform === "win32" ? `${name}.cmd` : name;
const run = (file: string, args: string[], cwd = root) => new Promise<{ stdout: string }>((resolve, reject) => {
  execFile(file, args, { cwd, shell: process.platform === "win32", windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve({ stdout }));
});
const names = (tarball: Buffer) => {
  const bytes = gunzipSync(tarball); const result: string[] = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = bytes.subarray(offset, offset + 100).toString().replace(/\0.*$/, "");
    const size = Number.parseInt(bytes.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, "").trim(), 8) || 0;
    if (name) result.push(name); offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result.sort();
};

test("file URL roots use portable path conversion", () => {
  const url = new URL("file:///D:/skill-installer/");
  assert.equal(fileURLToPath(url, { windows: true }), "D:\\skill-installer\\");
  assert.notEqual(url.pathname, fileURLToPath(url, { windows: true }));
});

test("packed CLI contains only release artifacts and runs offline", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "skill-pack-")); t.after(() => rm(temp, { recursive: true, force: true }));
  await run(command("pnpm"), ["pack", "--pack-destination", temp]);
  const tarball = join(temp, (await readdir(temp)).find((file) => file.endsWith(".tgz"))!);
  const packed = names(await (await import("node:fs/promises")).readFile(tarball));
  assert.ok(packed.includes("package/README.md") && packed.includes("package/LICENSE"));
  assert.deepEqual(packed.filter((file) => !/^package\/(package\.json|README\.md|LICENSE|dist\/.+|catalog\/(catalog\.json|skills\/[a-z0-9-]+\/SKILL\.md))$/.test(file)), []);
  const prefix = join(temp, "prefix"); await run(command("npm"), ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--prefix", prefix, tarball]);
  const installed = join(prefix, "node_modules", "project-skill-installer");
  assert.match((await run(process.execPath, [join(installed, "dist/src/cli.js"), "--help"])).stdout, /Usage: project-skill-installer/);
  const fixture = join(temp, "fixture"); await (await import("node:fs/promises")).mkdir(fixture); await writeFile(join(fixture, "package.json"), "{}");
  assert.match((await run(process.execPath, [join(installed, "dist/src/cli.js"), "--dry-run", "--cwd", fixture])).stdout, /install nodejs/);
});
