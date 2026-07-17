export const STACKS = ["nodejs", "react", "spring-boot", "sap-ui5"] as const;
export type Stack = (typeof STACKS)[number];
export interface Skill { id: string; stacks: Stack[]; path: string; digest: string }
export interface Catalog { schemaVersion: 1; catalogVersion: string; skills: Skill[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
function fail(message: string): never { throw new Error(`Invalid catalog: ${message}`); }

export function parseCatalog(value: unknown): Catalog {
  if (!isRecord(value)) throw new Error("Invalid catalog: manifest shape");
  const manifest: Record<string, unknown> = value;
  if (!keysAre(manifest, ["schemaVersion", "catalogVersion", "skills"])) fail("manifest shape");
  if (manifest.schemaVersion !== 1 || typeof manifest.catalogVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.catalogVersion) || !Array.isArray(manifest.skills)) fail("metadata");
  const ids = new Set<string>(); const paths = new Set<string>();
  const skills = manifest.skills.map((entry: unknown): Skill => {
    if (!isRecord(entry)) fail("skill entry");
    const skill: Record<string, unknown> = entry;
    if (!keysAre(skill, ["id", "stacks", "path", "digest"]) ||
      typeof skill.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id) ||
       !Array.isArray(skill.stacks) || skill.stacks.length === 0 ||
       !skill.stacks.every((stack): stack is Stack => typeof stack === "string" && STACKS.includes(stack as Stack)) ||
       new Set(skill.stacks).size !== skill.stacks.length || typeof skill.path !== "string" ||
       skill.path !== `skills/${skill.id}/SKILL.md` ||
       !/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(skill.path) ||
      typeof skill.digest !== "string" || !/^[a-f0-9]{64}$/.test(skill.digest)) fail("skill entry");
    if (ids.has(skill.id) || paths.has(skill.path)) fail("duplicate skill");
    ids.add(skill.id); paths.add(skill.path);
    return { id: skill.id, stacks: [...skill.stacks], path: skill.path, digest: skill.digest };
  });
  return { schemaVersion: 1, catalogVersion: manifest.catalogVersion, skills: skills.sort((left, right) => left.id.localeCompare(right.id)) };
}
