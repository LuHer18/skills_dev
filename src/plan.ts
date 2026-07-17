import type { Catalog, Skill, Stack } from "./catalog/schema.js";

export interface PlannedSkill { readonly id: string; readonly digest: string; readonly path: string }
export interface Plan { readonly stacks: readonly Stack[]; readonly actions: readonly PlannedSkill[] }

export function createPlan(stacks: readonly Stack[], catalog: Catalog): Plan {
  const matched = catalog.skills.filter((skill) => skill.stacks.some((stack) => stacks.includes(stack)));
  const byId = new Map<string, Skill>(matched.map((skill) => [skill.id, skill]));
  const actions = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)).map((skill) =>
    Object.freeze({ id: skill.id, digest: skill.digest, path: skill.path })
  );
  return Object.freeze({ stacks: Object.freeze([...stacks]), actions: Object.freeze(actions) });
}
