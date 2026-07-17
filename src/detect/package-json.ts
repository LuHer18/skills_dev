import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Stack } from "../catalog/schema.js";

export interface PackageEvidence { stacks: Stack[]; warnings: string[] }
const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

export async function detectPackageJson(root: string): Promise<PackageEvidence> {
  let value: unknown;
  try { value = JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { stacks: [], warnings: [] };
    return { stacks: [], warnings: ["Unable to parse root package.json"] };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { stacks: [], warnings: ["Unable to parse root package.json"] };
  const dependencies = sections.flatMap((section) => {
    const field = (value as Record<string, unknown>)[section];
    return typeof field === "object" && field !== null && !Array.isArray(field) ? Object.keys(field) : [];
  });
  const stacks: Stack[] = ["nodejs"];
  if (dependencies.some((name) => name === "react" || name === "react-dom")) stacks.push("react");
  if (dependencies.includes("@ui5/cli")) stacks.push("sap-ui5");
  return { stacks, warnings: [] };
}
