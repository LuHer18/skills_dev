import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { skillRoot } from "./paths.js";

export interface LockFs {
  readonly createLock?: (path: string) => Promise<void>;
  readonly releaseLock?: (path: string) => Promise<void>;
}

export async function acquireLock(root: string, fs: LockFs = {}): Promise<() => Promise<void>> {
  const path = join(skillRoot(root), ".project-skill-installer.lock");
  const create = fs.createLock ?? (async (value: string) => { const handle = await open(value, "wx"); await handle.close(); });
  const release = fs.releaseLock ?? ((value: string) => rm(value));
  try { await create(path); } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Installer lock is already held");
    throw error;
  }
  return async () => {
    try { await release(path); } catch (error) { throw new Error(`Failed to release installer lock: ${String(error)}`); }
  };
}
