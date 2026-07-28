import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test("dry-run and execution share tree collision decisions and whole-tree warning", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "cli-tree-collision-")); t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(join(base, ".agents/skills/react/references"), { recursive: true }); await writeFile(join(base, ".agents/skills/react/SKILL.md"), "old"); await writeFile(join(base, ".agents/skills/react/references/user.md"), "user");
  const output: string[] = []; const prompts: string[] = [];
  const dependencies: AppDependencies = { cwd: () => base, resolve: (value) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["react"], warnings: [] }), write: (value) => output.push(value), prompt: { isTTY: true, confirm: async (collision) => { prompts.push(collision.warning); return false; } } };
  assert.equal(await runApp(["--dry-run"], dependencies), 0);
  assert.match(output[0], /skip react/);
  assert.equal(await runApp([], dependencies), 0);
  assert.match(output[1], /skip react/);
  assert.match(prompts[0], /Replace the entire skill tree at .*This removes every existing file, including user-added files/);
  assert.equal(await readFile(join(base, ".agents/skills/react/references/user.md"), "utf8"), "user");
  assert.equal(await runApp(["--force"], dependencies), 0);
  assert.equal(await readFile(join(base, ".agents/skills/react/SKILL.md"), "utf8"), "x");
  await assert.rejects(readFile(join(base, ".agents/skills/react/references/user.md")));
  assert.match(output.at(-1) ?? "", /replace react/);
  await symlink(tmpdir(), join(base, ".agents/skills/react/unsafe"));
  assert.equal(await runApp(["--dry-run"], dependencies), 1);
  assert.match(output.at(-1) ?? "", /Unsafe symlink/);
});

test("force warns before replacing existing trees but not when installation has no collision", async (t) => {
  const collision = await mkdtemp(join(tmpdir(), "cli-force-warning-")); const absent = await mkdtemp(join(tmpdir(), "cli-force-absent-"));
  t.after(() => Promise.all([rm(collision, { recursive: true, force: true }), rm(absent, { recursive: true, force: true })]));
  await mkdir(join(collision, ".agents/skills/react"), { recursive: true }); await writeFile(join(collision, ".agents/skills/react/SKILL.md"), "old");
  const output: string[] = []; const dependencies: AppDependencies = { cwd: () => collision, resolve: (value) => value, loadCatalog: async () => loaded, detectStacks: async () => ({ stacks: ["react"], warnings: [] }), write: (value) => output.push(value) };
  assert.equal(await runApp(["--force"], dependencies), 0);
  assert.match(output[0], /^Warning: --force replaces the entire skill tree at .* This removes every existing file, including user-added files\.\n$/);
  assert.match(output[1], /Outcome: success/);
  const noCollision: string[] = [];
  assert.equal(await runApp(["--force"], { ...dependencies, cwd: () => absent, write: (value) => noCollision.push(value) }), 0);
  assert.equal(noCollision.some((value) => value.startsWith("Warning: --force")), false);
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
  const actions = ["beta", "alpha"].map((id) => ({ id, digest: id[0].repeat(64), tree: new VerifiedSkillTree(new Map([["SKILL.md", Buffer.from(id)]])) }));
  const discoveries = new Map(actions.map((action) => [action.id, { id: action.id, target: `/skills/${action.id}`, state: "directory" as const, inventory: [] }]));
  assert.deepEqual(await resolveCollisions(actions, discoveries, { isTTY: true, confirm: async (collision) => { asked.push(collision.id); return collision.id === "alpha"; } }, false), ["replace", "skip"]);
  assert.deepEqual(asked, ["alpha", "beta"]);
  assert.deepEqual(await resolveCollisions(actions, discoveries, { isTTY: false, confirm: async () => true }, false), ["skip", "skip"]);
  assert.deepEqual(await resolveCollisions(actions, discoveries, { isTTY: false, confirm: async () => false }, true), ["replace", "replace"]);
});

test("TTY collision confirmations wait for each preceding confirmation", async () => {
  const actions = ["beta", "alpha"].map((id) => ({ id, digest: id[0].repeat(64), tree: new VerifiedSkillTree(new Map([["SKILL.md", Buffer.from(id)]])) }));
  const discoveries = new Map(actions.map((action) => [action.id, { id: action.id, target: `/skills/${action.id}`, state: "directory" as const, inventory: [] }]));
  const asked: string[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const result = resolveCollisions(actions, discoveries, { isTTY: true, confirm: async (collision) => {
    asked.push(collision.id);
    if (collision.id === "alpha") await pending;
    return true;
  } }, false);
  await Promise.resolve();
  assert.deepEqual(asked, ["alpha"]);
  release?.();
  assert.deepEqual(await result, ["replace", "replace"]);
});
