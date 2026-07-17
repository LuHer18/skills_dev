import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { install, type InstallFs } from "../src/install/transaction.js";
import { acquireLock } from "../src/install/lock.js";

const digest = (byte: string) => byte.repeat(64);
async function root() { return mkdtemp(join(tmpdir(), "skill-installer-")); }
async function skill(base: string, id: string, value: string) { const path = join(base, ".agents", "skills", id); await mkdir(path, { recursive: true }); await writeFile(join(path, "SKILL.md"), value); }
const action = (id: string, value: string, decision: "install" | "replace" | "skip" = "install") => ({ id, digest: digest(id[0]), bytes: Buffer.from(value), decision });
const oldDigest = (value: string) => createHash("sha256").update(value).digest("hex");

test("installs, replaces, skips, and reports ID-sorted deterministic outcomes", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  await skill(base, "beta", "old"); await skill(base, "skip", "keep");
  const result = await install(base, [action("beta", "new", "replace"), action("alpha", "new"), action("skip", "ignored", "skip")]);
  assert.deepEqual(result.actions, [{ id: "alpha", status: "install" }, { id: "beta", status: "replace" }, { id: "skip", status: "skip" }]);
  assert.equal(await readFile(join(base, ".agents/skills/alpha/SKILL.md"), "utf8"), "new");
  assert.equal(await readFile(join(base, ".agents/skills/beta/SKILL.md"), "utf8"), "new");
  assert.equal(await readFile(join(base, ".agents/skills/skip/SKILL.md"), "utf8"), "keep");
});

test("rejects symlinks and contention before mutation, and orphan journals fail closed", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(join(base, ".agents")); await symlink(tmpdir(), join(base, ".agents", "skills"));
  await assert.rejects(install(base, [action("alpha", "new")]), /symlink/);
  await rm(join(base, ".agents"), { recursive: true }); await mkdir(join(base, ".agents", "skills"), { recursive: true });
  const release = await acquireLock(base); await assert.rejects(install(base, [action("alpha", "new")]), /lock/); await release();
  const brokenRelease = await acquireLock(base); await rm(join(base, ".agents/skills/.project-skill-installer.lock")); await mkdir(join(base, ".agents/skills/.project-skill-installer.lock")); await assert.rejects(brokenRelease(), /Failed to release/); await rm(join(base, ".agents/skills/.project-skill-installer.lock"), { recursive: true, force: true });
  await writeFile(join(base, ".agents", "skills", ".project-skill-installer.journal"), "orphan");
  await assert.rejects(install(base, [action("alpha", "new")]), /Recovery required/);
});

test("mutation failures reverse creations and replacements, retaining recovery paths when rollback fails", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await skill(base, "beta", "old");
  let calls = 0;
  const fs: InstallFs = { rename: async (from: string, to: string) => { if (++calls === 3) throw new Error("injected rename"); return (await import("node:fs/promises")).rename(from, to); } };
  await assert.rejects(install(base, [action("alpha", "new"), action("beta", "new", "replace")], fs), /injected rename/);
  await assert.rejects(readFile(join(base, ".agents/skills/alpha/SKILL.md")));
  assert.equal(await readFile(join(base, ".agents/skills/beta/SKILL.md"), "utf8"), "old");
  calls = 0;
  const brokenRollback: InstallFs = { rename: async (from: string, to: string) => { if (++calls === 3 || calls === 4) throw new Error("injected rename"); return (await import("node:fs/promises")).rename(from, to); } };
  await assert.rejects(install(base, [action("alpha", "new"), action("beta", "new", "replace")], brokenRollback), /Recovery required: .*backup.*stage/);
});

test("fault seam covers pre-target, journal, stage, and commit boundaries", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  const target = join(base, ".agents/skills/alpha/SKILL.md");
  const cases: readonly [string, string, InstallFs][] = [
    ["root/skills mkdir", "mkdir", { mkdir: async () => { throw new Error("mkdir fault"); } }],
    ["lock create", "lock", { createLock: async () => { throw new Error("lock fault"); } }],
    ["journal create", "journal", { journalCreate: async () => { throw new Error("journal create fault"); } }],
    ["journal update", "journal", { journalUpdate: async () => { throw new Error("journal update fault"); } }],
    ["journal flush", "journal", { journalFlush: async () => { throw new Error("journal flush fault"); } }],
    ["stage mkdir", "stage", { mkdir: async (path, options) => path.includes(".stage-") ? Promise.reject(new Error("stage mkdir fault")) : mkdir(path, options) }],
    ["stage write", "stage", { writeFile: async (path, bytes) => path.includes(".stage-") ? Promise.reject(new Error("stage write fault")) : writeFile(path, bytes) }],
  ];
  for (const [name, expected, fs] of cases) {
    await rm(join(base, ".agents"), { recursive: true, force: true });
    await assert.rejects(install(base, [action("alpha", "new")], fs), new RegExp(expected));
    await assert.rejects(readFile(target), `target mutated before ${name}`);
  }
});

test("backup, commit, cleanup, and rollback faults preserve recoverability", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  await skill(base, "alpha", "old"); const target = join(base, ".agents/skills/alpha/SKILL.md");
  let renames = 0;
  await assert.rejects(install(base, [action("alpha", "new", "replace")], { rename: async (from, to) => { if (++renames === 1) throw new Error("backup fault"); await rename(from, to); } }), /backup fault/);
  assert.equal(await readFile(target, "utf8"), "old");
  renames = 0;
  await assert.rejects(install(base, [action("alpha", "new", "replace")], { rename: async (from, to) => { if (++renames === 2) throw new Error("commit fault"); await rename(from, to); } }), /commit fault/);
  assert.equal(await readFile(target, "utf8"), "old");
  let backupObserved = false;
  await assert.rejects(install(base, [action("alpha", "new", "replace")], { rm: async (path, options) => { if (path.includes(".backup-")) { backupObserved = (await lstat(target)).isFile(); throw new Error("cleanup fault"); } await rm(path, options); } }), /Finalization incomplete.*cleanup fault/);
  assert.equal(backupObserved, true, "backup survives until success cleanup"); assert.equal(await readFile(target, "utf8"), "new");
  await rm(join(base, ".agents/skills/.project-skill-installer.journal"));
  renames = 0;
  await assert.rejects(install(base, [action("alpha", "new", "replace")], { rename: async (from, to) => { if (++renames === 2 || renames === 3) throw new Error("rollback restore fault"); await rename(from, to); }, rm: async (path, options) => { if (path === target) throw new Error("rollback removal fault"); await rm(path, options); } }), /Recovery required: .*backup.*stage/);
});

test("lock-release failure is operational after a successful commit", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  await assert.rejects(install(base, [action("alpha", "new")], { releaseLock: async () => { throw new Error("release fault"); } }), /Failed to release installer lock/);
  assert.equal(await readFile(join(base, ".agents/skills/alpha/SKILL.md"), "utf8"), "new");
});

test("rollback recovery summary names every affected target, backup, and stage in sorted order", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await skill(base, "beta", "old");
  let renames = 0;
  await assert.rejects(install(base, [action("beta", "new", "replace"), action("alpha", "new")], {
    rename: async (from, to) => { if (++renames === 3 || renames === 4) throw new Error("rename fault"); await rename(from, to); },
    rm: async (path, options) => { if (basename(path) === "alpha") throw new Error("remove fault"); await rm(path, options); },
  }), (error: Error) => {
    const message = error.message; const alpha = join(base, ".agents/skills/alpha"); const beta = join(base, ".agents/skills/beta");
    assert.ok(message.includes(`${alpha} (backup ${join(base, ".agents/skills/.alpha.backup-")}`));
    assert.ok(message.includes(`${beta} (backup ${join(base, ".agents/skills/.beta.backup-")}`));
    assert.ok(message.indexOf(alpha) < message.indexOf(beta)); return true;
  });
});

test("recorded decisions reject targets that appear or change after discovery", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true }));
  await skill(base, "alpha", "appeared");
  await assert.rejects(install(base, [{ ...action("alpha", "new"), expectedDigest: undefined }]), /appeared after discovery/);
  await skill(base, "beta", "old"); await writeFile(join(base, ".agents/skills/beta/SKILL.md"), "changed");
  await assert.rejects(install(base, [{ ...action("beta", "new", "replace"), expectedDigest: oldDigest("old") }]), /changed after discovery/);
  assert.equal(await readFile(join(base, ".agents/skills/alpha/SKILL.md"), "utf8"), "appeared"); assert.equal(await readFile(join(base, ".agents/skills/beta/SKILL.md"), "utf8"), "changed");
});

test("cleanup failure after an irreversible boundary retains committed replacements and remaining backup", async (t) => {
  const base = await root(); t.after(() => rm(base, { recursive: true, force: true })); await skill(base, "alpha", "old-alpha"); await skill(base, "beta", "old-beta");
  await assert.rejects(install(base, ["alpha", "beta"].map((id) => ({ ...action(id, `new-${id}`, "replace"), expectedDigest: oldDigest(`old-${id}`) })), { rm: async (path, options) => { if (path.includes(".beta.backup-")) throw new Error("cleanup fault"); await rm(path, options); } }), /Finalization incomplete.*cleanup fault/);
  assert.equal(await readFile(join(base, ".agents/skills/alpha/SKILL.md"), "utf8"), "new-alpha"); assert.equal(await readFile(join(base, ".agents/skills/beta/SKILL.md"), "utf8"), "new-beta");
  const backup = (await readdir(join(base, ".agents/skills"))).find((name) => name.startsWith(".beta.backup-")); assert.ok(backup); assert.equal(await readFile(join(base, ".agents/skills", backup, "SKILL.md"), "utf8"), "old-beta");
});
