import { appendFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { acquireLock } from "./lock.js";
import { safeExisting, safeTree, skillRoot, target } from "./paths.js";

export type InstallDecision = "install" | "replace" | "skip";
export interface InstallAction { readonly id: string; readonly digest: string; readonly bytes: Buffer; readonly decision: InstallDecision; readonly expectedDigest?: string }
export interface InstallFs {
  readonly mkdir?: (path: string, options: { recursive?: boolean }) => Promise<string | undefined>;
  readonly writeFile?: (path: string, data: string | Buffer) => Promise<void>;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly rm?: (path: string, options: { recursive?: boolean; force?: boolean }) => Promise<void>;
  readonly createLock?: (path: string) => Promise<void>;
  readonly releaseLock?: (path: string) => Promise<void>;
  readonly journalCreate?: (path: string) => Promise<void>;
  readonly journalUpdate?: (path: string, line: string) => Promise<void>;
  readonly journalFlush?: (path: string) => Promise<void>;
  readonly nonce?: () => string;
}
export interface Collision { readonly id: string; readonly target: string; readonly oldDigest: string }
export interface InstallResult { readonly actions: readonly { id: string; status: InstallDecision | "fail" }[]; readonly outcome: "success" | "failure" }
type Record = { action: InstallAction; target: string; stage: string; backup: string; moved: boolean; committed: boolean };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const journalPath = (root: string) => join(skillRoot(root), ".project-skill-installer.journal");
const assertExpected = async (record: Record) => {
  if (record.action.decision === "install") { if (await exists(record.target)) throw new Error(`Target appeared after discovery: ${record.target}`); return; }
  try { const actual = hash(await readFile(join(record.target, "SKILL.md"))); if (record.action.expectedDigest && actual !== record.action.expectedDigest) throw new Error(`Target changed after discovery: ${record.target}`); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Target disappeared after discovery: ${record.target}`); throw error; }
};
const defaults = {
  mkdir: (path: string, options: { recursive?: boolean }) => mkdir(path, options),
  writeFile: (path: string, data: string | Buffer) => writeFile(path, data),
  rename,
  rm: (path: string, options: { recursive?: boolean; force?: boolean }) => rm(path, options),
  journalCreate: (path: string) => writeFile(path, ""),
  journalUpdate: (path: string, line: string) => appendFile(path, line),
  journalFlush: async (path: string) => { const handle = await open(path, "r+"); try { await handle.sync(); } finally { await handle.close(); } },
  nonce: randomUUID,
};

export async function discover(root: string, actions: readonly { id: string; digest: string }[]): Promise<ReadonlyMap<string, Collision>> {
  const skills = skillRoot(root); await safeTree(root, skills); const found = new Map<string, Collision>();
  for (const action of actions) { const path = target(root, action.id); await safeTree(skills, path); try { const stat = await lstat(path); if (!stat.isDirectory()) throw new Error(`Expected skill directory: ${path}`); const file = join(path, "SKILL.md"); await safeExisting(file, false); const fileStat = await lstat(file); if (!fileStat.isFile()) throw new Error(`Expected skill file: ${file}`); found.set(action.id, { id: action.id, target: file, oldDigest: hash(await readFile(file)) }); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  return found;
}

export async function install(root: string, input: readonly InstallAction[], injected: InstallFs = {}): Promise<InstallResult> {
  const fs = { ...defaults, ...injected }; const actions = [...input].sort((a, b) => a.id.localeCompare(b.id)); const skills = skillRoot(root);
  await safeTree(root, root); await safeExisting(join(root, ".agents")); await fs.mkdir(skills, { recursive: true }); await safeTree(root, skills);
  const journalFile = journalPath(root); if (await exists(journalFile)) throw new Error(`Recovery required: orphan journal at ${journalFile}`);
  const release = await acquireLock(root, fs); const records: Record[] = []; let finalized = false;
  const updateJournal = async (state: string, record?: Record) => {
    const line = `${JSON.stringify({ state, id: record?.action.id, target: record?.target, stage: record?.stage, backup: record?.backup })}\n`;
    await fs.journalUpdate(journalFile, line); await fs.journalFlush(journalFile);
  };
  try {
    await fs.journalCreate(journalFile); await updateJournal("started");
    for (const action of actions) {
      if (action.decision === "skip") continue;
      const destination = target(root, action.id); await safeTree(skills, destination);
      const nonce = fs.nonce(); const record: Record = { action, target: destination, stage: join(skills, `.${action.id}.stage-${nonce}`), backup: join(skills, `.${action.id}.backup-${nonce}`), moved: false, committed: false };
      records.push(record); await updateJournal("planned", record); await fs.mkdir(record.stage, {}); await fs.writeFile(join(record.stage, "SKILL.md"), action.bytes); await updateJournal("staged", record);
      await assertExpected(record);
      if (action.decision === "replace") { await fs.rename(destination, record.backup); record.moved = true; await updateJournal("old-backed-up", record); }
      await fs.rename(record.stage, destination); record.committed = true; await updateJournal("committed", record);
    }
    finalized = true;
    for (const record of records) await fs.rm(record.backup, { recursive: true, force: true });
    await fs.rm(journalFile, { force: true }); await release();
    return { actions: actions.map((action) => ({ id: action.id, status: action.decision })), outcome: "success" };
  } catch (error) {
    if (finalized) {
      const cleanup = records.filter((record) => record.moved).map((record) => record.backup).concat(journalFile);
      try { await release(); } catch (releaseError) { cleanup.push(String(releaseError)); }
      throw new Error(`Finalization incomplete: ${error instanceof Error ? error.message : "Cleanup failed"}; committed replacements retained; cleanup required: ${cleanup.sort().join(", ")}`);
    }
    const recovery: string[] = [];
    for (const record of [...records].reverse()) {
      let failed = false;
      try { if (record.committed) await fs.rm(record.target, { recursive: true, force: true }); } catch { failed = true; }
      try { if (record.moved) await fs.rename(record.backup, record.target); } catch { failed = true; }
      try { await fs.rm(record.stage, { recursive: true, force: true }); } catch { failed = true; }
      if (failed) recovery.push(`${record.target} (backup ${record.backup}, stage ${record.stage})`);
    }
    try { if (!recovery.length) await fs.rm(journalFile, { force: true }); } catch { recovery.push(journalFile); }
    try { await release(); } catch (releaseError) { recovery.push(String(releaseError)); }
    throw new Error(`${error instanceof Error ? error.message : "Mutation failed"}${recovery.length ? `; Recovery required: ${recovery.sort().join(", ")}` : ""}`);
  }
}
async function exists(path: string) { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
