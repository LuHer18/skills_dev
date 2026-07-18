import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, runApp, type AppDependencies } from "../src/app.js";
import { resolveCollisions } from "../src/prompt.js";
import { VerifiedSkillTree, type LoadedCatalog } from "../src/catalog/loader.js";

const loaded: LoadedCatalog = { catalog: { schemaVersion: 2, catalogVersion: "1.0.0", skills: [
  { id: "react", stacks: ["react"], files: [{ path: "SKILL.md", digest: "a".repeat(64) }] }
] }, trees: new Map([["react", new VerifiedSkillTree(new Map([["SKILL.md", Buffer.from("x")]]))]]) };

test("arguments support cwd, help, version, and reject invalid forms with exit 2", async () => {
  assert.deepEqual(parseArgs(["--cwd", "project", "--dry-run", "--force"]), { cwd: "project", dryRun: true, force: true });
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--version"]).version, true);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--cwd"]), /requires a path/);
  for (const option of ["--dry-run", "--help", "--force", "--version", "--cwd"]) {
    assert.throws(() => parseArgs(["--cwd", option]), /requires a path/);
    assert.equal(await runApp(["--cwd", option], { cwd: () => "/current", resolve: (value) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: [], warnings: [] }), write: () => {} }), 2);
  }
});

test("app renders stable dry-run reports without invoking mutation", async () => {
  const output: string[] = [];
  const dependencies: AppDependencies = {
    cwd: () => "/current", resolve: (value) => `/resolved/${value}`,
    loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["react"], warnings: ["warn"] }),
    write: (value) => output.push(value)
  };
  assert.equal(await runApp(["--cwd", "project", "--dry-run"], dependencies), 0);
  assert.deepEqual(output, ["Outcome: dry-run\nSkills:\n- install react\nWarnings:\n- warn\n"]);
  assert.equal(await runApp(["--bad"], dependencies), 2);
  assert.match(output[1], /Unknown argument/);
});

test("app performs a real temp-root install while dry-run remains zero-mutation", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "cli-install-")); t.after(() => rm(base, { recursive: true, force: true })); const output: string[] = [];
  const dependencies: AppDependencies = { cwd: () => base, resolve: (value) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["react"], warnings: [] }), write: (value) => output.push(value), prompt: { isTTY: false, confirm: async () => false } };
  assert.equal(await runApp([], dependencies), 0);
  assert.equal(await readFile(join(base, ".agents/skills/react/SKILL.md"), "utf8"), "x");
  const dry = await mkdtemp(join(tmpdir(), "cli-dry-")); t.after(() => rm(dry, { recursive: true, force: true }));
  assert.equal(await runApp(["--dry-run"], { ...dependencies, cwd: () => dry }), 0);
  await assert.rejects(readFile(join(dry, ".agents/skills/react/SKILL.md")));
  assert.match(output[0], /Outcome: success/);
  const collision = await mkdtemp(join(tmpdir(), "cli-collision-")); t.after(() => rm(collision, { recursive: true, force: true }));
  await (await import("node:fs/promises")).mkdir(join(collision, ".agents/skills/react"), { recursive: true }); await (await import("node:fs/promises")).writeFile(join(collision, ".agents/skills/react/SKILL.md"), "old");
  assert.equal(await runApp([], { ...dependencies, cwd: () => collision }), 0); assert.equal(await readFile(join(collision, ".agents/skills/react/SKILL.md"), "utf8"), "old");
  assert.equal(await runApp(["--force"], { ...dependencies, cwd: () => collision }), 0); assert.equal(await readFile(join(collision, ".agents/skills/react/SKILL.md"), "utf8"), "x");
});

test("collision decisions are per-skill in TTY and skipped unless force without TTY", async () => {
  const asked: string[] = [];
  const actions = [{ id: "beta", digest: "b".repeat(64), path: "skills/beta/SKILL.md" }, { id: "alpha", digest: "a".repeat(64), path: "skills/alpha/SKILL.md" }];
  const collisions = new Map(actions.map((action) => [action.id, { target: `/skills/${action.id}`, oldDigest: "old" }]));
  assert.deepEqual(await resolveCollisions(actions, collisions, { isTTY: true, confirm: async (collision) => { asked.push(collision.id); return collision.id === "alpha"; } }, false), ["replace", "skip"]);
  assert.deepEqual(asked, ["alpha", "beta"]);
  assert.deepEqual(await resolveCollisions(actions, collisions, { isTTY: false, confirm: async () => true }, false), ["skip", "skip"]);
  assert.deepEqual(await resolveCollisions(actions, collisions, { isTTY: false, confirm: async () => false }, true), ["replace", "replace"]);
});

test("TTY collision confirmations wait for each preceding confirmation", async () => {
  const actions = [{ id: "beta", digest: "b".repeat(64), path: "skills/beta/SKILL.md" }, { id: "alpha", digest: "a".repeat(64), path: "skills/alpha/SKILL.md" }];
  const collisions = new Map(actions.map((action) => [action.id, { target: `/skills/${action.id}`, oldDigest: "old" }]));
  const asked: string[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const result = resolveCollisions(actions, collisions, { isTTY: true, confirm: async (collision) => {
    asked.push(collision.id);
    if (collision.id === "alpha") await pending;
    return true;
  } }, false);
  await Promise.resolve();
  assert.deepEqual(asked, ["alpha"]);
  release?.();
  assert.deepEqual(await result, ["replace", "replace"]);
});
