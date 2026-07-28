import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

const fail = (message: string): never => { throw new Error(`Invalid catalog: ${message}`); };

export async function readVerifiedAsset(path: string, digest: string): Promise<Buffer> {
  const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) fail("asset is not a regular file");
  const bytes = await readFile(path);
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("asset is not UTF-8"); }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || bytes.includes(0) || bytes.includes(13)) fail("asset bytes");
  if (createHash("sha256").update(bytes).digest("hex") !== digest) fail("asset digest mismatch");
  return Buffer.from(bytes);
}
