import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadCatalog, type LoadedCatalog } from "./catalog/loader.js";
import { detectStacks, type Detection } from "./detect/index.js";
import { createPlan, discoverDestinations } from "./plan.js";
import { renderReport } from "./report.js";
import { install, toSingleFileTransactionActions } from "./install/transaction.js";
import { resolveCollisions, type Prompt } from "./prompt.js";

export interface CliOptions { readonly cwd?: string; readonly dryRun: boolean; readonly force: boolean; readonly help?: boolean; readonly version?: boolean }
export interface AppDependencies {
  readonly cwd: () => string;
  readonly resolve: (path: string) => string;
  readonly loadCatalog: () => Promise<LoadedCatalog>;
  readonly detectStacks: (root: string) => Promise<Detection>;
  readonly write: (text: string) => void;
  readonly prompt?: Prompt;
}

const help = "Usage: project-skill-installer [--cwd <path>] [--dry-run] [--force]\n";
const catalogRoot = fileURLToPath(new URL("../../catalog/", import.meta.url));
const optionTokens = new Set(["--cwd", "--dry-run", "--force", "--help", "--version", "-h", "-V"]);
const terminalPrompt: Prompt = { isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY), confirm: async (collision) => { const line = createInterface({ input: process.stdin, output: process.stdout }); try { return (await line.question(collision.warning)).trim().toLowerCase() === "y"; } finally { line.close(); } } };

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: { cwd?: string; dryRun: boolean; force: boolean; help?: boolean; version?: boolean } = { dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--cwd") { const value = argv[++index]; if (!value || optionTokens.has(value)) throw new Error("--cwd requires a path"); options.cwd = value; }
    else if (argument.startsWith("--cwd=")) { options.cwd = argument.slice("--cwd=".length); if (!options.cwd) throw new Error("--cwd requires a path"); }
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--version" || argument === "-V") options.version = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function runApp(argv: readonly string[], injected?: AppDependencies): Promise<number> {
  const dependencies = injected ?? { cwd: process.cwd, resolve, loadCatalog: () => loadCatalog(catalogRoot), detectStacks, write: (text: string) => process.stdout.write(text), prompt: terminalPrompt };
  try {
    const options = parseArgs(argv);
    if (options.help) { dependencies.write(help); return 0; }
    if (options.version) { dependencies.write("0.0.0\n"); return 0; }
    const root = dependencies.resolve(options.cwd ?? dependencies.cwd());
    const [catalog, detection] = await Promise.all([dependencies.loadCatalog(), dependencies.detectStacks(root)]);
    const plan = createPlan(detection.stacks, catalog.catalog, catalog.trees); const discoveries = await discoverDestinations(root, plan.actions);
    const decisions = await resolveCollisions(plan.actions, discoveries, dependencies.prompt ?? { isTTY: false, confirm: async () => false }, options.force);
    if (options.dryRun) { dependencies.write(renderReport(plan.actions.map((action, index) => ({ id: action.id, status: decisions[index] })), detection.warnings, "dry-run")); return 0; }
    if (options.force) for (const [index, action] of plan.actions.entries()) if (decisions[index] === "replace") dependencies.write(`Warning: --force replaces the entire skill tree at ${discoveries.get(action.id)!.target}. This removes every existing file, including user-added files.\n`);
    let result; try { result = await install(root, toSingleFileTransactionActions(plan.actions, decisions, discoveries)); } catch (error) { dependencies.write(renderReport(plan.actions.map((action) => ({ id: action.id, status: "fail" as const })), detection.warnings, "failure")); throw error; }
    dependencies.write(renderReport(result.actions, detection.warnings, result.outcome));
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Operational failure";
    dependencies.write(`Error: ${message}\n`);
    return message.startsWith("Unknown argument:") || message.includes("requires a path") ? 2 : 1;
  }
}
