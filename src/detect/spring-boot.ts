import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function detectSpringBoot(root: string): Promise<boolean> {
  for (const file of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    try {
      const text = await readFile(join(root, file), "utf8");
      if (file === "pom.xml" ? /<artifactId>spring-boot-(?:starter-)?parent<\/artifactId>|<artifactId>spring-boot[^<]*<\/artifactId>/.test(text) : /(?:id\s*\(?\s*["']org\.springframework\.boot["']|org\.springframework\.boot)/.test(text)) return true;
    } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
  }
  return false;
}
