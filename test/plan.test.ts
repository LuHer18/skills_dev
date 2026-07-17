import assert from "node:assert/strict";
import test from "node:test";
import { createPlan } from "../src/plan.js";
import type { Catalog } from "../src/catalog/schema.js";

const catalog: Catalog = {
  schemaVersion: 1, catalogVersion: "1.0.0", skills: [
    { id: "zeta", stacks: ["react"], path: "skills/zeta/SKILL.md", digest: "a".repeat(64) },
    { id: "alpha", stacks: ["nodejs", "react"], path: "skills/alpha/SKILL.md", digest: "b".repeat(64) },
    { id: "unused", stacks: ["sap-ui5"], path: "skills/unused/SKILL.md", digest: "c".repeat(64) }
  ]
};

test("plan joins stacks to catalog skills once in immutable ID order", () => {
  const plan = createPlan(["nodejs", "react"], catalog);
  assert.deepEqual(plan.actions.map((action) => action.id), ["alpha", "zeta"]);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.actions), true);
  assert.equal(Object.isFrozen(plan.actions[0]), true);
  assert.throws(() => (plan.actions as unknown as { push(value: unknown): number }).push({}), TypeError);
});
