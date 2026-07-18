import { appendFile, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { acquireLock } from "./lock.js";
import { inventoryTree, revalidateInventory, safeExisting, safeTree, skillRoot, target } from "./paths.js";
import type { VerifiedSkillTree } from "../catalog/loader.js";
import type { Discovery } from "../plan.js";

export type InstallDecision = "install" | "replace" | "skip";
export interface InstallAction { readonly id: string; readonly digest: string; readonly tree: VerifiedSkillTree; readonly decision: InstallDecision; readonly discovery: Discovery }
export interface InstallFs {
  readonly mkdir?: (path: string, options: { recursive?: boolean }) => Promise<string | undefined>;
  readonly writeFile?: (path: string, data: string | Buffer) => Promise<void>;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly rm?: (path: string, options: { recursive?: boolean; force?: boolean }) => Promise<void>;
  readonly createLock?: (path: string) => Promise<void>; readonly releaseLock?: (path: string) => Promise<void>;
  readonly journalCreate?: (path: string) => Promise<void>; readonly journalUpdate?: (path: string, line: string) => Promise<void>; readonly journalFlush?: (path: string) => Promise<void>; readonly nonce?: () => string;
}
export interface InstallResult { readonly actions: readonly { id: string; status: InstallDecision | "fail" }[]; readonly outcome: "success" | "failure" }
type Record = { action: InstallAction; target: string; stage: string; backup: string; moved: boolean; committed: boolean };
const journalPath = (root: string) => join(skillRoot(root), ".project-skill-installer.journal");
const defaults = { mkdir: (path: string, options: { recursive?: boolean }) => mkdir(path, options), writeFile: (path: string, data: string | Buffer) => writeFile(path, data), rename, rm: (path: string, options: { recursive?: boolean; force?: boolean }) => rm(path, options), journalCreate: (path: string) => writeFile(path, ""), journalUpdate: (path: string, line: string) => appendFile(path, line), journalFlush: async (path: string) => { const handle = await open(path, "r+"); try { await handle.sync(); } finally { await handle.close(); } }, nonce: randomUUID };
async function exists(path: string) { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }

async function stage(record: Record, fs: Pick<InstallFs, "mkdir" | "writeFile"> & { mkdir: NonNullable<InstallFs["mkdir"]>; writeFile: NonNullable<InstallFs["writeFile"]> }) {
  await fs.mkdir(record.stage, {});
  for (const path of record.action.tree.paths) { await fs.mkdir(dirname(join(record.stage, path)), { recursive: true }); await fs.writeFile(join(record.stage, path), record.action.tree.bytes(path)); }
  const expected = [...new Map(record.action.tree.paths.flatMap((path) => { const directories = path.split("/").slice(0, -1).map((_, index, parts) => ({ path: parts.slice(0, index + 1).join("/"), kind: "directory" as const })); return [...directories, { path, kind: "file" as const, digest: createHash("sha256").update(record.action.tree.bytes(path)).digest("hex") }]; }).map((entry) => [entry.path, entry] as const)).values()].sort((left, right) => left.path.localeCompare(right.path));
  const actual = await inventoryTree(record.stage); if (actual.length !== expected.length || actual.some((entry, index) => entry.path !== expected[index].path || entry.kind !== expected[index].kind || entry.digest !== ("digest" in expected[index] ? expected[index].digest : undefined))) throw new Error(`Staged tree verification failed: ${record.action.id}`);
}

export async function install(root: string, input: readonly InstallAction[], injected: InstallFs = {}): Promise<InstallResult> {
  const fs = { ...defaults, ...injected }; const actions = [...input].sort((a, b) => a.id.localeCompare(b.id)); const skills = skillRoot(root);
  await safeTree(root, root); await safeExisting(join(root, ".agents")); await fs.mkdir(skills, { recursive: true }); await safeTree(root, skills);
  const journalFile = journalPath(root); if (await exists(journalFile)) throw new Error(`Recovery required: orphan journal at ${journalFile}`);
  const release = await acquireLock(root, fs); const records: Record[] = []; let finalized = false;
  const journal = async (state: string, record?: Record) => { await fs.journalUpdate(journalFile, `${JSON.stringify({ state, id: record?.action.id, target: record?.target, stage: record?.stage, backup: record?.backup })}\n`); await fs.journalFlush(journalFile); };
  try {
    await fs.journalCreate(journalFile); await journal("started");
    for (const action of actions) {
      if (action.decision === "skip") continue;
      const destination = target(root, action.id); if (destination !== action.discovery.target) throw new Error(`Discovery target mismatch: ${action.id}`); await safeTree(skills, destination);
      if (action.decision === "install" && action.discovery.state !== "absent") throw new Error(`Discovery state mismatch: ${action.id}`); if (action.decision === "replace" && action.discovery.state !== "directory") throw new Error(`Discovery state mismatch: ${action.id}`);
      const nonce = fs.nonce(); const record: Record = { action, target: destination, stage: join(skills, `.${action.id}.stage-${nonce}`), backup: join(skills, `.${action.id}.backup-${nonce}`), moved: false, committed: false }; records.push(record); await journal("planned", record); await stage(record, fs); await journal("staged", record);
      if (action.decision === "install") { if (await exists(destination)) throw new Error(`Target appeared after discovery: ${destination}`); } else await revalidateInventory(destination, action.discovery.inventory);
      if (action.decision === "replace") { await fs.rename(destination, record.backup); record.moved = true; await revalidateInventory(record.backup, action.discovery.inventory); await journal("old-backed-up", record); }
      await fs.rename(record.stage, destination); record.committed = true; await journal("committed", record);
    }
    finalized = true; for (const record of records) await fs.rm(record.backup, { recursive: true, force: true }); await fs.rm(journalFile, { force: true }); await release(); return { actions: actions.map((action) => ({ id: action.id, status: action.decision })), outcome: "success" };
  } catch (error) {
    if (finalized) { const cleanup = records.filter((record) => record.moved).map((record) => record.backup).concat(journalFile); try { await release(); } catch (releaseError) { cleanup.push(String(releaseError)); } throw new Error(`Finalization incomplete: ${error instanceof Error ? error.message : "Cleanup failed"}; committed replacements retained; cleanup required: ${cleanup.sort().join(", ")}`); }
    const recovery: string[] = []; for (const record of [...records].reverse()) { let failed = false; try { if (record.committed) await fs.rm(record.target, { recursive: true, force: true }); } catch { failed = true; } try { if (record.moved) await fs.rename(record.backup, record.target); } catch { failed = true; } try { await fs.rm(record.stage, { recursive: true, force: true }); } catch { failed = true; } if (failed) recovery.push(`${record.target} (backup ${record.backup}, stage ${record.stage})`); }
    try { if (!recovery.length) await fs.rm(journalFile, { force: true }); } catch { recovery.push(journalFile); } try { await release(); } catch (releaseError) { recovery.push(String(releaseError)); } throw new Error(`${error instanceof Error ? error.message : "Mutation failed"}${recovery.length ? `; Recovery required: ${recovery.sort().join(", ")}` : ""}`);
  }
}
