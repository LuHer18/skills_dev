import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { VerifiedSkillTree } from "../src/catalog/loader.js";
import { inventoryTree } from "../src/install/paths.js";
import { install, type InstallAction, type InstallFs } from "../src/install/transaction.js";
import { acquireLock } from "../src/install/lock.js";

async function root() { return mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "skill-installer-")); }
const tree = (files: Record<string, string>) => new VerifiedSkillTree(new Map(Object.entries(files).map(([path, value]) => [path, Buffer.from(value)])));
async function writeTree(base: string, id: string, files: Record<string, string>) { for (const [path, value] of Object.entries(files)) { const file = join(base, ".agents", "skills", id, path); await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, value); } }
async function action(base: string, id: string, files: Record<string, string>, decision: "install" | "replace" | "skip" = "install"): Promise<InstallAction> { const target = join(base, ".agents", "skills", id); const inventory = decision === "replace" ? await inventoryTree(target) : []; return { id, digest: id[0].repeat(64), tree: tree(files), decision, discovery: { id, target, state: decision === "replace" ? "directory" : "absent", inventory } }; }
async function files(base: string, id: string) { const result: Record<string, string> = {}; const walk = async (dir: string, prefix = "") => { for (const entry of await (await import("node:fs/promises")).readdir(dir, { withFileTypes: true })) { const path = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) await walk(join(dir, entry.name), path); else result[path] = await readFile(join(dir, entry.name), "utf8"); } }; await walk(join(base, ".agents", "skills", id)); return result; }
const journal = async (base: string, transaction: string, events: readonly Record<string, string>[]) => { const path = join(base, ".agents", "skills", ".project-skill-installer.journal"); await mkdir(join(path, ".."), { recursive: true }); for (const event of events) await appendFile(path, `${JSON.stringify({ version: 1, transaction, ...event })}\n`); };

test("stages and atomically installs, replaces, and skips complete nested trees", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  await writeTree(base, "replace", { "SKILL.md": "old", "references/stale.md": "stale", "user.md": "user" }); await writeTree(base, "skip", { "SKILL.md": "keep", "user.md": "keep" });
  const result = await install(base, [await action(base, "install", { "SKILL.md": "new", "references/java.md": "17", "references/spring.md": "boot" }), await action(base, "replace", { "SKILL.md": "new", "references/java.md": "21" }, "replace"), await action(base, "skip", { "SKILL.md": "ignored" }, "skip")]);
  assert.deepEqual(result.actions, [{ id: "install", status: "install" }, { id: "replace", status: "replace" }, { id: "skip", status: "skip" }]);
  assert.deepEqual(await files(base, "install"), { "SKILL.md": "new", "references/java.md": "17", "references/spring.md": "boot" }); assert.deepEqual(await files(base, "replace"), { "SKILL.md": "new", "references/java.md": "21" }); assert.deepEqual(await files(base, "skip"), { "SKILL.md": "keep", "user.md": "keep" });
});

test("rejects nested symlinks and non-directory targets before replacement", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await writeTree(base, "alpha", { "SKILL.md": "old", "references/a.md": "old" });
  await rm(join(base, ".agents/skills/alpha/references/a.md")); await symlink(tmpdir(), join(base, ".agents/skills/alpha/references/a.md"));
  await assert.rejects(action(base, "alpha", { "SKILL.md": "new" }, "replace"), /symlink/);
  await mkdir(join(base, ".agents", "skills", "file-target"), { recursive: true }); await rm(join(base, ".agents", "skills", "file-target"), { recursive: true }); await writeFile(join(base, ".agents", "skills", "file-target"), "file");
  await assert.rejects(install(base, [await action(base, "file-target", { "SKILL.md": "new" })]), /Expected directory/);
  if (process.platform !== "win32") {
    await writeTree(base, "special", { "SKILL.md": "old", "references/a.md": "old" }); const socket = createServer(); const socketPath = join(base, ".agents/skills/special/references/node.sock"); await new Promise<void>((done) => socket.listen(socketPath, done));
    await assert.rejects(action(base, "special", { "SKILL.md": "new" }, "replace"), /Unsafe destination node/); await new Promise<void>((done) => socket.close(() => done()));
  }
});

test("re-inventory rejects static appearance, disappearance, type, path, and byte races", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  const appeared = await action(base, "appeared", { "SKILL.md": "new" }); await writeTree(base, "appeared", { "SKILL.md": "other" }); await assert.rejects(install(base, [appeared]), /appeared/);
  for (const [id, mutate] of [["gone", async () => rm(join(base, ".agents/skills/gone/SKILL.md"))], ["type", async () => { await rm(join(base, ".agents/skills/type/SKILL.md")); await mkdir(join(base, ".agents/skills/type/SKILL.md")); }], ["path", async () => writeFile(join(base, ".agents/skills/path/extra.md"), "extra")], ["bytes", async () => writeFile(join(base, ".agents/skills/bytes/SKILL.md"), "changed")]] as const) { await writeTree(base, id, { "SKILL.md": "old" }); const planned = await action(base, id, { "SKILL.md": "new" }, "replace"); await mutate(); await assert.rejects(install(base, [planned]), /changed after discovery/); }
});

test("injected post-stage appearance, disappearance, type, path, and byte races fail before swap", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await writeTree(base, "alpha", { "SKILL.md": "old", "references/a.md": "old" });
  const race = await action(base, "alpha", { "SKILL.md": "new", "references/a.md": "new" }, "replace"); let changed = false;
  await assert.rejects(install(base, [race], { journalUpdate: async (_path, line) => { if (line.includes('"staged"') && !changed) { changed = true; await writeFile(join(base, ".agents/skills/alpha/SKILL.md"), "race"); } } }), /changed after discovery/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "race", "references/a.md": "old" });
  for (const [id, decision, mutate] of [["injected-appear", "install", async () => writeTree(base, "injected-appear", { "SKILL.md": "race" })], ["injected-gone", "replace", async () => rm(join(base, ".agents/skills/injected-gone"), { recursive: true })], ["injected-type", "replace", async () => { await rm(join(base, ".agents/skills/injected-type/SKILL.md")); await mkdir(join(base, ".agents/skills/injected-type/SKILL.md")); }], ["injected-path", "replace", async () => writeFile(join(base, ".agents/skills/injected-path/extra.md"), "race")], ["injected-bytes", "replace", async () => writeFile(join(base, ".agents/skills/injected-bytes/SKILL.md"), "race")]] as const) { if (decision === "replace") await writeTree(base, id, { "SKILL.md": "old" }); const planned = await action(base, id, { "SKILL.md": "new" }, decision); let once = false; await assert.rejects(install(base, [planned], { journalUpdate: async (_path, line) => { if (line.includes('"staged"') && !once) { once = true; await mutate(); } } }), /appeared|ENOENT|changed/); }
});

test("rollback restores whole old trees after a later atomic swap fault", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await writeTree(base, "alpha", { "SKILL.md": "old", "references/a.md": "old" });
  await writeTree(base, "beta", { "SKILL.md": "old", "references/b.md": "old" }); const alpha = await action(base, "alpha", { "SKILL.md": "new" }, "replace"); const beta = await action(base, "beta", { "SKILL.md": "new" }, "replace"); let renames = 0;
  await assert.rejects(install(base, [alpha, beta], { rename: async (from, to) => { if (++renames === 4) throw new Error("fault"); await rename(from, to); } }), /fault/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old", "references/a.md": "old" }); assert.deepEqual(await files(base, "beta"), { "SKILL.md": "old", "references/b.md": "old" });
});

test("post-revalidation rename races restore the complete captured old tree", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await writeTree(base, "alpha", { "SKILL.md": "old", "references/a.md": "old" }); const input = await action(base, "alpha", { "SKILL.md": "new" }, "replace"); let raced = false;
  await assert.rejects(install(base, [input], { rename: async (from, to) => { if (!raced) { raced = true; await writeFile(join(base, ".agents/skills/alpha/user.md"), "user"); } await rename(from, to); } }), /changed after discovery/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old", "references/a.md": "old", "user.md": "user" });
});

test("stage write failure leaves no partial final tree", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); const input = await action(base, "alpha", { "SKILL.md": "new", "references/a.md": "new" });
  const fs: InstallFs = { writeFile: async (path, value) => { if (path.includes("references")) throw new Error("write fault"); await writeFile(path, value); } }; await assert.rejects(install(base, [input], fs), /write fault/); await assert.rejects(readFile(join(base, ".agents/skills/alpha/SKILL.md")));
});

test("existing lock and journal recovery boundaries remain fail-closed", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await mkdir(join(base, ".agents", "skills"), { recursive: true }); const input = await action(base, "alpha", { "SKILL.md": "new" });
  const release = await acquireLock(base); await assert.rejects(install(base, [input]), /lock/); await release(); await writeFile(join(base, ".agents/skills/.project-skill-installer.journal"), "orphan"); await assert.rejects(install(base, [input]), /Recovery required/);
});

test("fault injection at durable transaction boundaries reverses multiple trees", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await writeTree(base, "alpha", { "SKILL.md": "old" }); await writeTree(base, "beta", { "SKILL.md": "old" });
  for (const boundary of ["started", "staged", "backed-up", "committed"] as const) {
    const alpha = await action(base, "alpha", { "SKILL.md": "new" }, "replace"); const beta = await action(base, "beta", { "SKILL.md": "new" }, "replace"); let tripped = false;
    await assert.rejects(install(base, [alpha, beta], { journalUpdate: async (path, line) => { await appendFile(path, line); if (!tripped && line.includes(`\"state\":\"${boundary}\"`)) { tripped = true; throw new Error(`${boundary} fault`); } } }), /fault/);
    assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" }); assert.deepEqual(await files(base, "beta"), { "SKILL.md": "old" });
  }
});

test("restart rolls back a validated incomplete journal across multiple trees", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); const tx = "123e4567-e89b-12d3-a456-426614174000";
  for (const id of ["alpha", "beta"]) { await writeTree(base, id, { "SKILL.md": "new" }); await writeTree(base, `.${id}.backup-${tx}`, { "SKILL.md": "old" }); }
  await journal(base, tx, [{ state: "started" }, ...["alpha", "beta"].flatMap((id) => [{ state: "staged", id, nonce: tx }, { state: "backed-up", id, nonce: tx }, { state: "committed", id, nonce: tx }])]);
  let cleanup = true; await assert.rejects(install(base, [], { rm: async (path, options) => { if (cleanup && path.endsWith(".journal")) { cleanup = false; throw new Error("cleanup fault"); } await rm(path, options); } }), /cleanup fault/);
  await install(base, []); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" }); assert.deepEqual(await files(base, "beta"), { "SKILL.md": "old" });
});

test("restart finalizes only an all-committed journal and fails closed for malformed paths", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); const tx = "123e4567-e89b-12d3-a456-426614174001"; await writeTree(base, "alpha", { "SKILL.md": "new" }); await writeTree(base, `.alpha.backup-${tx}`, { "SKILL.md": "old" });
  await journal(base, tx, [{ state: "started" }, { state: "staged", id: "alpha", nonce: tx }, { state: "backed-up", id: "alpha", nonce: tx }, { state: "committed", id: "alpha", nonce: tx }, { state: "all-committed" }]); await install(base, []); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "new" });
  await journal(base, tx, [{ state: "started" }, { state: "committed", id: "../../outside", nonce: tx }]); await assert.rejects(install(base, []), /Recovery required/);
  await rm(join(base, ".agents/skills/.project-skill-installer.journal")); await journal(base, tx, [{ state: "started" }, { state: "staged", id: "alpha", nonce: tx }, { state: "committed", id: "alpha", nonce: tx }, { state: "backed-up", id: "alpha", nonce: tx }]); await assert.rejects(install(base, []), /Recovery required/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "new" });
  await rm(join(base, ".agents/skills/.project-skill-installer.journal")); await journal(base, tx, [{ state: "started" }, { state: "staged", id: "alpha", nonce: tx }, { state: "backed-up", id: "alpha", nonce: tx }, { state: "rolled-back", id: "alpha", nonce: tx }, { state: "committed", id: "alpha", nonce: tx }]); await assert.rejects(install(base, []), /Recovery required/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "new" }); await readFile(join(base, ".agents/skills/.project-skill-installer.journal"));
});

test("recovery retains a missing backed-up generation with an ambiguous destination", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); const tx = "123e4567-e89b-12d3-a456-426614174002"; await writeTree(base, "alpha", { "SKILL.md": "current" }); await journal(base, tx, [{ state: "started" }, { state: "staged", id: "alpha", nonce: tx }, { state: "backed-up", id: "alpha", nonce: tx }]);
  await assert.rejects(install(base, []), /Recovery required: missing backup/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "current" }); await readFile(join(base, ".agents/skills/.project-skill-installer.journal"));
});

test("create, flush, rename, cleanup, rollback, and lock faults preserve a recoverable generation", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); const make = async () => action(base, "alpha", { "SKILL.md": "new" }, "replace"); await writeTree(base, "alpha", { "SKILL.md": "old" });
  await assert.rejects(install(base, [await make()], { journalCreate: async () => { throw new Error("create fault"); } }), /create fault/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" });
  let flush = false; await assert.rejects(install(base, [await make()], { journalFlush: async () => { if (!flush) { flush = true; throw new Error("flush fault"); } } }), /flush fault/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" });
  let calls = 0; await assert.rejects(install(base, [await make()], { rename: async (from, to) => { if (++calls === 2) throw new Error("rename fault"); await rename(from, to); } }), /rename fault/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" });
  for (const after of [3, 5]) { let syncs = 0; await assert.rejects(install(base, [await make()], { syncDirectory: async () => { if (++syncs === after) throw new Error("sync fault"); } }), /sync fault/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" }); await assert.rejects(readFile(join(base, ".agents/skills/.project-skill-installer.journal"))); }
  calls = 0; await assert.rejects(install(base, [await make()], { rename: async (from, to) => { if (++calls === 2) throw new Error("swap fault"); await rename(from, to); }, rm: async (path, options) => { if (path.includes(".stage-")) throw new Error("rollback fault"); await rm(path, options); } }), /Recovery required/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" }); await install(base, []); await assert.rejects(readFile(join(base, ".agents/skills/.project-skill-installer.journal")));
  calls = 0; let flushes = 0; await assert.rejects(install(base, [await make()], { rename: async (from, to) => { if (++calls === 2) throw new Error("swap fault"); await rename(from, to); }, journalFlush: async () => { if (++flushes === 4) throw new Error("rollback journal fault"); } }), /Recovery required/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "old" }); await readFile(join(base, ".agents/skills/.project-skill-installer.journal")); await install(base, []);
  let cleanup = false; await assert.rejects(install(base, [await make()], { rm: async (path, options) => { if (!cleanup && path.includes(".backup-")) { cleanup = true; throw new Error("cleanup fault"); } await rm(path, options); } }), /Finalization incomplete/); assert.deepEqual(await files(base, "alpha"), { "SKILL.md": "new" }); await install(base, []);
  const lock = await acquireLock(base); await assert.rejects(install(base, [await make()]), /lock/); await lock();
});
