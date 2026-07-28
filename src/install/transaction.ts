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
  readonly journalCreate?: (path: string) => Promise<void>; readonly journalUpdate?: (path: string, line: string) => Promise<void>; readonly journalFlush?: (path: string) => Promise<void>; readonly syncDirectory?: (path: string) => Promise<void>; readonly nonce?: () => string;
}
export interface InstallResult { readonly actions: readonly { id: string; status: InstallDecision | "fail" }[]; readonly outcome: "success" | "failure" }
type Record = { action: InstallAction; target: string; stage: string; backup: string; moved: boolean; committed: boolean };
type JournalState = "started" | "staged" | "backed-up" | "committed" | "rolled-back" | "all-committed" | "cleanup";
type JournalEvent = { version: 1; transaction: string; state: JournalState; id?: string; nonce?: string };
const journalPath = (root: string) => join(skillRoot(root), ".project-skill-installer.journal");
const defaults = { mkdir: (path: string, options: { recursive?: boolean }) => mkdir(path, options), writeFile: (path: string, data: string | Buffer) => writeFile(path, data), rename, rm: (path: string, options: { recursive?: boolean; force?: boolean }) => rm(path, options), journalCreate: (path: string) => writeFile(path, ""), journalUpdate: (path: string, line: string) => appendFile(path, line), journalFlush: async (path: string) => { const handle = await open(path, "r+"); try { await handle.sync(); } finally { await handle.close(); } }, syncDirectory: async (path: string) => { try { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } } catch (error: unknown) { const code = (error as NodeJS.ErrnoException).code ?? ""; if (!["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(code) && !(process.platform === "win32" && code === "EPERM")) throw error; } }, nonce: randomUUID };
async function exists(path: string) { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }

async function stage(record: Record, fs: Pick<InstallFs, "mkdir" | "writeFile"> & { mkdir: NonNullable<InstallFs["mkdir"]>; writeFile: NonNullable<InstallFs["writeFile"]> }) {
  await fs.mkdir(record.stage, {});
  for (const path of record.action.tree.paths) { await fs.mkdir(dirname(join(record.stage, path)), { recursive: true }); await fs.writeFile(join(record.stage, path), record.action.tree.bytes(path)); }
  const expected = [...new Map(record.action.tree.paths.flatMap((path) => { const directories = path.split("/").slice(0, -1).map((_, index, parts) => ({ path: parts.slice(0, index + 1).join("/"), kind: "directory" as const })); return [...directories, { path, kind: "file" as const, digest: createHash("sha256").update(record.action.tree.bytes(path)).digest("hex") }]; }).map((entry) => [entry.path, entry] as const)).values()].sort((left, right) => left.path.localeCompare(right.path));
  const actual = await inventoryTree(record.stage); if (actual.length !== expected.length || actual.some((entry, index) => entry.path !== expected[index].path || entry.kind !== expected[index].kind || entry.digest !== ("digest" in expected[index] ? expected[index].digest : undefined))) throw new Error(`Staged tree verification failed: ${record.action.id}`);
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
const validNonce = (nonce: unknown): nonce is string => typeof nonce === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce);
async function recover(root: string, fs: { rename: (from: string, to: string) => Promise<void>; rm: (path: string, options: { recursive?: boolean; force?: boolean }) => Promise<void>; syncDirectory: (path: string) => Promise<void>; journalUpdate: (path: string, line: string) => Promise<void>; journalFlush: (path: string) => Promise<void> }, file: string): Promise<void> {
  let events: JournalEvent[]; try { events = (await (await import("node:fs/promises")).readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as JournalEvent); } catch { throw new Error(`Recovery required: malformed journal at ${file}`); }
  const transaction = events[0]?.transaction; const states: JournalState[] = ["started", "staged", "backed-up", "committed", "rolled-back", "all-committed", "cleanup"];
  if (!validNonce(transaction) || !events.length || events[0].state !== "started" || events.some((event) => event.version !== 1 || event.transaction !== transaction || !states.includes(event.state) || (["started", "all-committed", "cleanup"].includes(event.state) ? event.id !== undefined || event.nonce !== undefined : !validId(event.id) || event.nonce !== transaction))) throw new Error(`Recovery required: invalid journal at ${file}`);
  const records = new Map<string, { stage: string; backup: string; backedUp: boolean; committed: boolean; restored: boolean }>(); let final = false; let cleaned = false;
  for (const [index, event] of events.entries()) { if (event.state === "started") { if (index) throw new Error(`Recovery required: impossible journal at ${file}`); continue; } if (event.state === "all-committed") { if (final || cleaned || [...records.values()].some((record) => !record.committed)) throw new Error(`Recovery required: impossible journal at ${file}`); final = true; continue; } if (event.state === "cleanup") { if (!final || cleaned || index !== events.length - 1) throw new Error(`Recovery required: impossible journal at ${file}`); cleaned = true; continue; } if (final || cleaned || !event.id) throw new Error(`Recovery required: impossible journal at ${file}`); let record = records.get(event.id); if (event.state === "staged") { if (record) throw new Error(`Recovery required: duplicate journal record at ${file}`); record = { stage: join(skillRoot(root), `.${event.id}.stage-${transaction}`), backup: join(skillRoot(root), `.${event.id}.backup-${transaction}`), backedUp: false, committed: false, restored: false }; records.set(event.id, record); } else if (!record || (event.state === "backed-up" && (record.backedUp || record.committed)) || (event.state === "committed" && (record.committed || record.restored)) || (event.state === "rolled-back" && (!record.backedUp || record.restored))) throw new Error(`Recovery required: impossible journal at ${file}`); if (event.state === "backed-up") record!.backedUp = true; if (event.state === "committed") record!.committed = true; if (event.state === "rolled-back") record!.restored = true; }
  for (const [id, record] of records) if (!final && record.backedUp) { const destination = target(root, id); await safeTree(skillRoot(root), destination); await safeTree(skillRoot(root), record.backup); if (record.restored ? !await exists(destination) : !await exists(record.backup)) throw new Error(`Recovery required: missing ${record.restored ? "restored target" : "backup"} at ${record.restored ? destination : record.backup}`); if (!record.restored) try { await inventoryTree(record.backup); } catch { throw new Error(`Recovery required: invalid backup at ${record.backup}`); } }
  for (const [id, record] of [...records.entries()].reverse()) { const destination = target(root, id); await safeTree(skillRoot(root), record.stage); await safeTree(skillRoot(root), record.backup); if (!final && record.committed && !record.restored) await fs.rm(destination, { recursive: true, force: true }); if (!final && record.backedUp && !record.restored) { await fs.rename(record.backup, destination); await fs.journalUpdate(file, `${JSON.stringify({ version: 1, transaction, state: "rolled-back", id, nonce: transaction })}\n`); await fs.journalFlush(file); await fs.syncDirectory(skillRoot(root)); } await fs.rm(record.stage, { recursive: true, force: true }); if (final) await fs.rm(record.backup, { recursive: true, force: true }); }
  await fs.rm(file, { force: true }); await fs.syncDirectory(skillRoot(root));
}

export async function install(root: string, input: readonly InstallAction[], injected: InstallFs = {}): Promise<InstallResult> {
  const fs = { ...defaults, ...injected }; const actions = [...input].sort((a, b) => a.id.localeCompare(b.id)); const skills = skillRoot(root);
  await safeTree(root, root); await safeExisting(join(root, ".agents")); await fs.mkdir(skills, { recursive: true }); await safeTree(root, skills);
  const journalFile = journalPath(root); const release = await acquireLock(root, fs); const records: Record[] = []; let finalized = false; const transaction = fs.nonce(); if (!validNonce(transaction)) { await release(); throw new Error("Unsafe transaction identity"); }
  const journal = async (state: JournalState, record?: Record) => { await fs.journalUpdate(journalFile, `${JSON.stringify({ version: 1, transaction, state, ...(record ? { id: record.action.id, nonce: transaction } : {}) })}\n`); await fs.journalFlush(journalFile); await fs.syncDirectory(skills); };
  if (await exists(journalFile)) {
    try { await recover(root, fs, journalFile); } catch (error) { try { await release(); } catch { /* Preserve the journal even when lock cleanup also fails. */ } throw error; }
  }
  try {
    await fs.journalCreate(journalFile); await journal("started");
    for (const action of actions) {
      if (action.decision === "skip") continue;
      const destination = target(root, action.id); if (destination !== action.discovery.target) throw new Error(`Discovery target mismatch: ${action.id}`); await safeTree(skills, destination);
      if (action.decision === "install" && action.discovery.state !== "absent") throw new Error(`Discovery state mismatch: ${action.id}`); if (action.decision === "replace" && action.discovery.state !== "directory") throw new Error(`Discovery state mismatch: ${action.id}`);
      const nonce = transaction; const record: Record = { action, target: destination, stage: join(skills, `.${action.id}.stage-${nonce}`), backup: join(skills, `.${action.id}.backup-${nonce}`), moved: false, committed: false }; records.push(record); await stage(record, fs); await journal("staged", record);
      if (action.decision === "install") { if (await exists(destination)) throw new Error(`Target appeared after discovery: ${destination}`); } else await revalidateInventory(destination, action.discovery.inventory);
      if (action.decision === "replace") { await fs.rename(destination, record.backup); record.moved = true; await fs.syncDirectory(skills); await revalidateInventory(record.backup, action.discovery.inventory); await journal("backed-up", record); }
      await fs.rename(record.stage, destination); record.committed = true; await fs.syncDirectory(skills); await journal("committed", record);
    }
    await journal("all-committed"); finalized = true; for (const record of records) await fs.rm(record.backup, { recursive: true, force: true }); await journal("cleanup"); await fs.rm(journalFile, { force: true }); await fs.syncDirectory(skills); await release(); return { actions: actions.map((action) => ({ id: action.id, status: action.decision })), outcome: "success" };
  } catch (error) {
    if (finalized) { const cleanup = records.filter((record) => record.moved).map((record) => record.backup).concat(journalFile); try { await release(); } catch (releaseError) { cleanup.push(String(releaseError)); } throw new Error(`Finalization incomplete: ${error instanceof Error ? error.message : "Cleanup failed"}; committed replacements retained; cleanup required: ${cleanup.sort().join(", ")}`); }
    const recovery: string[] = []; for (const record of [...records].reverse()) { let failed = false; try { if (record.committed) await fs.rm(record.target, { recursive: true, force: true }); } catch { failed = true; } try { if (record.moved) { await fs.rename(record.backup, record.target); await journal("rolled-back", record); } } catch { failed = true; } try { await fs.rm(record.stage, { recursive: true, force: true }); } catch { failed = true; } if (failed) recovery.push(`${record.target} (backup ${record.backup}, stage ${record.stage})`); }
    try { if (!recovery.length) await fs.rm(journalFile, { force: true }); } catch { recovery.push(journalFile); } try { await release(); } catch (releaseError) { recovery.push(String(releaseError)); } throw new Error(`${error instanceof Error ? error.message : "Mutation failed"}${recovery.length ? `; Recovery required: ${recovery.sort().join(", ")}` : ""}`);
  }
}
