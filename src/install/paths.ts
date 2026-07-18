import { lstat, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

export interface InventoryEntry { readonly path: string; readonly kind: "file" | "directory"; readonly digest?: string }
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Inventory through lstat only: every entry is pinned by path, type, and file bytes. */
export async function inventoryTree(root: string, prefix = ""): Promise<InventoryEntry[]> {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true }); const result: InventoryEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name; const stat = await lstat(resolve(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Unsafe symlink: ${resolve(root, path)}`);
    if (stat.isDirectory()) result.push({ path, kind: "directory" }, ...await inventoryTree(root, path));
    else if (stat.isFile()) result.push({ path, kind: "file", digest: digest(await readFile(resolve(root, path)) as Buffer) });
    else throw new Error(`Unsafe destination node: ${resolve(root, path)}`);
  }
  return result;
}

export async function revalidateInventory(root: string, expected: readonly InventoryEntry[]): Promise<void> {
  const actual = await inventoryTree(root);
  if (actual.length !== expected.length || actual.some((entry, index) => entry.path !== expected[index].path || entry.kind !== expected[index].kind || entry.digest !== expected[index].digest)) throw new Error(`Target changed after discovery: ${root}`);
}
