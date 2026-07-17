import type { Stack } from "../catalog/schema.js";
import { detectPackageJson } from "./package-json.js";
import { detectSpringBoot } from "./spring-boot.js";
import { detectUi5Files } from "./ui5.js";

export interface Detection { stacks: readonly Stack[]; warnings: readonly string[] }
const order: Stack[] = ["nodejs", "react", "spring-boot", "sap-ui5"];
export async function detectStacks(root: string): Promise<Detection> {
  const [packageJson, spring, ui5] = await Promise.all([detectPackageJson(root), detectSpringBoot(root), detectUi5Files(root)]);
  const matches = new Set<Stack>([...packageJson.stacks, ...(spring ? ["spring-boot" as const] : []), ...(ui5.matched ? ["sap-ui5" as const] : [])]);
  return { stacks: order.filter((stack) => matches.has(stack)), warnings: [...packageJson.warnings, ...ui5.warnings] };
}
