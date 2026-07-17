import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export async function detectUi5Files(root: string): Promise<{ matched: boolean; warnings: string[] }> {
  try { if (!(await stat(join(root, "ui5.yaml"))).isFile()) return { matched: false, warnings: [] }; }
  catch { return { matched: false, warnings: [] }; }
  try {
    const manifest: unknown = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    return { matched: typeof manifest === "object" && manifest !== null && "sap.app" in manifest, warnings: [] };
  } catch { return { matched: false, warnings: ["Unable to parse root manifest.json"] }; }
}
