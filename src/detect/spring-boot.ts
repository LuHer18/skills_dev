import { readFile } from "node:fs/promises";
import { join } from "node:path";

function sanitizeGradle(text: string): string {
  let result = "";
  let state: "code" | "line-comment" | "block-comment" | "single" | "double" | "triple-single" | "triple-double" = "code";
  let preserveString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const mask = (value: string | undefined) => value === "\n" ? "\n" : " ";
    if (state === "code") {
      if (text.startsWith("'''", index) || text.startsWith('"""', index)) { state = text[index] === "'" ? "triple-single" : "triple-double"; result += "   "; index += 2; }
      else if (character === "'" || character === '"') { preserveString = /\bid\s*\(?\s*$/.test(result); state = character === "'" ? "single" : "double"; result += preserveString ? character : " "; }
      else if (character === "/" && text[index + 1] === "/") { state = "line-comment"; result += "  "; index += 1; }
      else if (character === "/" && text[index + 1] === "*") { state = "block-comment"; result += "  "; index += 1; }
      else result += character;
    } else if (state === "line-comment") { result += mask(character); if (character === "\n") state = "code"; }
    else if (state === "block-comment") {
      if (character === "*" && text[index + 1] === "/") { result += "  "; index += 1; state = "code"; } else result += mask(character);
    } else if ((state === "triple-single" && text.startsWith("'''", index)) || (state === "triple-double" && text.startsWith('"""', index))) { result += "   "; index += 2; state = "code"; }
    else if ((state === "single" && character === "'") || (state === "double" && character === '"')) { result += preserveString ? character : " "; state = "code"; preserveString = false; }
    else { result += preserveString ? character : mask(character); if (character === "\\") result += preserveString ? text[++index] ?? "" : mask(text[++index]); }
  }
  return result;
}

export async function detectSpringBoot(root: string): Promise<boolean> {
  for (const file of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    try {
      const text = await readFile(join(root, file), "utf8");
      const evidence = file === "pom.xml" ? text.replace(/<!--[\s\S]*?-->/g, "") : sanitizeGradle(text);
      if (file === "pom.xml" ? /<artifactId>spring-boot-(?:starter-)?parent<\/artifactId>|<artifactId>spring-boot[^<]*<\/artifactId>/.test(evidence) : /(?:^|[;{}])\s*id\s*\(?\s*["']org\.springframework\.boot["']/m.test(evidence)) return true;
    } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
  }
  return false;
}
