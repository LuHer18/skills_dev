import assert from "node:assert/strict";
import test from "node:test";
import { createPlan, discoverDestinations } from "../src/plan.js";
import { VerifiedSkillTree } from "../src/catalog/loader.js";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Catalog } from "../src/catalog/schema.js";

const catalog: Catalog = {
  schemaVersion: 2, catalogVersion: "1.0.0", skills: [
    { id: "alpha", stacks: ["nodejs", "react"], files: [{ path: "SKILL.md", digest: "b".repeat(64) }] },
    { id: "unused", stacks: ["sap-ui5"], files: [{ path: "SKILL.md", digest: "c".repeat(64) }] },
    { id: "zeta", stacks: ["react"], files: [{ path: "SKILL.md", digest: "a".repeat(64) }] }
  ]
};

test("plan joins stacks to catalog skills once in immutable ID order", () => {
  const trees = new Map(catalog.skills.map((skill) => [skill.id, new VerifiedSkillTree(new Map([["SKILL.md", Buffer.from(skill.id)]]))]));
  const plan = createPlan(["nodejs", "react"], catalog, trees);
  assert.deepEqual(plan.actions.map((action) => action.id), ["alpha", "zeta"]);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.actions), true);
  assert.equal(Object.isFrozen(plan.actions[0]), true);
  assert.throws(() => (plan.actions as unknown as { push(value: unknown): number }).push({}), TypeError);
});

test("tree plans retain verified nested references and discovery inventories safe directories", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "tree-plan-")); t.after(() => rm(base, { recursive: true, force: true }));
  const nested = new VerifiedSkillTree(new Map([["SKILL.md", Buffer.from("skill")], ["references/java-21.md", Buffer.from("reference")]]));
  const plan = createPlan(["react"], { ...catalog, skills: [catalog.skills[0]] }, new Map([["alpha", nested]]));
  assert.deepEqual(plan.actions[0].tree.paths, ["SKILL.md", "references/java-21.md"]);
  let discoveries = await discoverDestinations(base, plan.actions);
  assert.equal(discoveries.get("alpha")?.state, "absent");
  await mkdir(join(base, ".agents/skills/alpha/references"), { recursive: true });
  await writeFile(join(base, ".agents/skills/alpha/SKILL.md"), "old"); await writeFile(join(base, ".agents/skills/alpha/references/user.md"), "user");
  discoveries = await discoverDestinations(base, plan.actions);
  assert.deepEqual(discoveries.get("alpha")?.inventory.map((entry) => entry.path), ["references", "references/user.md", "SKILL.md"]);
  await symlink(tmpdir(), join(base, ".agents/skills/alpha/references/unsafe"));
  await assert.rejects(discoverDestinations(base, plan.actions), /Unsafe symlink/);
  await rm(join(base, ".agents/skills/alpha"), { recursive: true }); await writeFile(join(base, ".agents/skills/alpha"), "not a directory");
  await assert.rejects(discoverDestinations(base, plan.actions), /Expected directory/);
  if (process.platform !== "win32") {
    await rm(join(base, ".agents/skills/alpha")); await mkdir(join(base, ".agents/skills/alpha"));
    await promisify(execFile)("mkfifo", [join(base, ".agents/skills/alpha/unsafe")]);
    await assert.rejects(discoverDestinations(base, plan.actions), /Unsafe destination node/);
  }
});
