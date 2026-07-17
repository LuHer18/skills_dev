import type { PlannedSkill } from "./plan.js";

export interface Collision { readonly id: string; readonly target: string; readonly oldDigest: string; readonly newDigest: string }
export interface Prompt { readonly isTTY: boolean; readonly confirm: (collision: Collision) => Promise<boolean> }
export type CollisionDecision = "install" | "replace" | "skip";

export async function resolveCollisions(actions: readonly PlannedSkill[], collisions: ReadonlyMap<string, Omit<Collision, "id" | "newDigest">>, prompt: Prompt, force: boolean): Promise<readonly CollisionDecision[]> {
  const decisions: CollisionDecision[] = [];
  for (const action of [...actions].sort((left, right) => left.id.localeCompare(right.id))) {
    const existing = collisions.get(action.id);
    if (!existing) decisions.push("install");
    else if (force) decisions.push("replace");
    else if (!prompt.isTTY) decisions.push("skip");
    else decisions.push((await prompt.confirm({ id: action.id, newDigest: action.digest, ...existing })) ? "replace" : "skip");
  }
  return decisions;
}
