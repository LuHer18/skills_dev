import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

const escapes = (root: string, child: string) => {
  const relation = relative(root, child);
  return relation === "" || relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || relation.includes(".." + "/");
};

export async function readVerifiedAsset(catalogRoot: string, assetPath: string, digest: string): Promise<Buffer> {
  const root = await realpath(catalogRoot);
  const candidate = resolve(root, assetPath);
  if (escapes(root, candidate)) throw new Error("Invalid catalog: asset escapes catalog root");
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid catalog: asset is not a regular file");
  if (escapes(root, await realpath(candidate))) throw new Error("Invalid catalog: asset resolves outside catalog root");
  const bytes = await readFile(candidate);
  if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("Invalid catalog: asset digest mismatch");
  return bytes;
}
