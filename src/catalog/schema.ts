export const STACKS = ["nodejs", "react", "spring-boot", "sap-ui5"] as const;
export type Stack = (typeof STACKS)[number];
export interface CatalogFile { readonly path: string; readonly digest: string }
export interface Skill { readonly id: string; readonly stacks: readonly Stack[]; readonly files: readonly CatalogFile[] }
export interface Catalog { readonly schemaVersion: 2; readonly catalogVersion: string; readonly skills: readonly Skill[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => key in value);
const fail = (message: string): never => { throw new Error(`Invalid catalog: ${message}`); };
const skillId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const filePath = /^(?:SKILL\.md|references\/[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/;

export function parseCatalog(value: unknown): Catalog {
  if (!isRecord(value)) throw new Error("Invalid catalog: manifest shape");
  const manifest = value;
  if (!keysAre(manifest, ["schemaVersion", "catalogVersion", "skills"])) fail("manifest shape");
  const input = manifest as { schemaVersion: unknown; catalogVersion: unknown; skills: unknown };
  if (input.schemaVersion !== 2 || typeof input.catalogVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(input.catalogVersion) || !Array.isArray(input.skills)) throw new Error("Invalid catalog: metadata");
  let previousId = ""; const ids = new Set<string>();
  const skills = input.skills.map((entry: unknown): Skill => {
    if (!isRecord(entry)) throw new Error("Invalid catalog: skill entry");
    if (!keysAre(entry, ["id", "stacks", "files"]) || typeof entry.id !== "string" || !skillId.test(entry.id) || !Array.isArray(entry.stacks) || entry.stacks.length === 0 || !entry.stacks.every((stack): stack is Stack => typeof stack === "string" && STACKS.includes(stack as Stack)) || new Set(entry.stacks).size !== entry.stacks.length || !Array.isArray(entry.files) || entry.files.length === 0) fail("skill entry");
    const skill = entry as { id: string; stacks: Stack[]; files: unknown[] };
    if (ids.has(skill.id) || previousId >= skill.id) fail("skill ID order"); ids.add(skill.id); previousId = skill.id;
    let previousPath = ""; let skillMd = 0; const paths = new Set<string>();
    const files = skill.files.map((file: unknown): CatalogFile => {
      if (!isRecord(file)) throw new Error("Invalid catalog: file entry");
      if (!keysAre(file, ["path", "digest"]) || typeof file.path !== "string" || !filePath.test(file.path) || typeof file.digest !== "string" || !/^[a-f0-9]{64}$/.test(file.digest)) fail("file entry");
      const catalogFile = file as { path: string; digest: string };
      if (paths.has(catalogFile.path) || previousPath >= catalogFile.path) fail("file order"); paths.add(catalogFile.path); previousPath = catalogFile.path; if (catalogFile.path === "SKILL.md") skillMd += 1;
      return Object.freeze({ ...catalogFile });
    });
    if (skillMd !== 1) fail("SKILL.md");
    return Object.freeze({ id: skill.id, stacks: Object.freeze([...skill.stacks]), files: Object.freeze(files) });
  });
  return Object.freeze({ schemaVersion: 2, catalogVersion: input.catalogVersion, skills: Object.freeze(skills) });
}
