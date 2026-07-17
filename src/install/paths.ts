import { lstat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const inside = (parent: string, child: string) => { const value = relative(parent, child); return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !value.includes(`${sep}..${sep}`)); };
export const skillRoot = (root: string) => resolve(root, ".agents", "skills");
export const target = (root: string, id: string) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Unsafe skill ID: ${id}`);
  const value = resolve(skillRoot(root), id); if (!inside(skillRoot(root), value)) throw new Error(`Unsafe target: ${id}`); return value;
};
export async function safeExisting(path: string, directory = true): Promise<void> {
  try { const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error(`Unsafe symlink: ${path}`); if (directory && !stat.isDirectory()) throw new Error(`Expected directory: ${path}`); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export async function safeTree(root: string, path: string): Promise<void> {
  if (!inside(root, path)) throw new Error(`Path escapes root: ${path}`);
  let current = root; await safeExisting(current); for (const segment of relative(root, path).split(sep)) { if (!segment) continue; current = resolve(current, segment); await safeExisting(current); }
}
