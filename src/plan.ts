import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Catalog, Skill, Stack } from "./catalog/schema.js";
import type { VerifiedSkillTree } from "./catalog/loader.js";
import { safeTree, skillRoot, target } from "./install/paths.js";

export interface InventoryEntry { readonly path: string; readonly kind: "file" | "directory"; readonly digest?: string }
export interface Discovery { readonly id: string; readonly target: string; readonly state: "absent" | "directory"; readonly inventory: readonly InventoryEntry[] }
export interface PlannedSkill { readonly id: string; readonly digest: string; readonly tree: VerifiedSkillTree }
export interface Plan { readonly stacks: readonly Stack[]; readonly actions: readonly PlannedSkill[] }

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function createPlan(stacks: readonly Stack[], catalog: Catalog, trees: ReadonlyMap<string, VerifiedSkillTree>): Plan {
  const matched = catalog.skills.filter((skill) => skill.stacks.some((stack) => stacks.includes(stack)));
  const byId = new Map<string, Skill>(matched.map((skill) => [skill.id, skill]));
  const actions = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)).map((skill) => {
    const tree = trees.get(skill.id); if (!tree) throw new Error(`Verified tree missing: ${skill.id}`);
    const skillFile = skill.files.find((file) => file.path === "SKILL.md"); if (!skillFile) throw new Error(`SKILL.md missing: ${skill.id}`);
    return Object.freeze({ id: skill.id, digest: skillFile.digest, tree });
  });
  return Object.freeze({ stacks: Object.freeze([...stacks]), actions: Object.freeze(actions) });
}

async function inventory(root: string, prefix = ""): Promise<InventoryEntry[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }); const found: InventoryEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name; const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Unsafe symlink: ${join(root, path)}`);
    if (stat.isDirectory()) found.push({ path, kind: "directory" }, ...await inventory(root, path));
    else if (stat.isFile()) found.push({ path, kind: "file", digest: digest(await readFile(join(root, path)) as Buffer) });
    else throw new Error(`Unsafe destination node: ${join(root, path)}`);
  }
  return found;
}

/** Read-only collision discovery shared by dry-run and execution. Unit 3A revalidates this inventory at mutation. */
export async function discoverDestinations(root: string, actions: readonly PlannedSkill[]): Promise<ReadonlyMap<string, Discovery>> {
  const skills = skillRoot(root); await safeTree(root, skills); const discoveries = new Map<string, Discovery>();
  for (const action of actions) {
    const destination = target(root, action.id);
    try { await safeTree(skills, destination); const stat = await lstat(destination); if (!stat.isDirectory()) throw new Error(`Expected skill directory: ${destination}`); discoveries.set(action.id, Object.freeze({ id: action.id, target: destination, state: "directory", inventory: Object.freeze(await inventory(destination)) })); }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") discoveries.set(action.id, Object.freeze({ id: action.id, target: destination, state: "absent", inventory: Object.freeze([]) })); else throw error; }
  }
  return discoveries;
}
