import type { Discovery, PlannedSkill } from "./plan.js";

export interface Collision { readonly id: string; readonly target: string; readonly warning: string }
export interface Prompt { readonly isTTY: boolean; readonly confirm: (collision: Collision) => Promise<boolean> }
export type CollisionDecision = "install" | "replace" | "skip";

export async function resolveCollisions(actions: readonly PlannedSkill[], discoveries: ReadonlyMap<string, Discovery>, prompt: Prompt, force: boolean): Promise<readonly CollisionDecision[]> {
  const decisions: CollisionDecision[] = [];
  for (const action of [...actions].sort((left, right) => left.id.localeCompare(right.id))) {
    const discovery = discoveries.get(action.id); if (!discovery || discovery.state === "absent") decisions.push("install");
    else if (force) decisions.push("replace");
    else if (!prompt.isTTY) decisions.push("skip");
    else decisions.push((await prompt.confirm({ id: action.id, target: discovery.target, warning: `Replace the entire skill tree at ${discovery.target}? This removes every existing file, including user-added files. [y/N]` })) ? "replace" : "skip");
  }
  return decisions;
}
