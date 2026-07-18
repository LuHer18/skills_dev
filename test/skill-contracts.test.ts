import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ids = ["nodejs-architecture", "nodejs-quality-safeguards", "nodejs-runtime-integration", "nodejs-testing", "react-architecture", "react-quality-safeguards", "react-state-data-integration", "react-testing"] as const;
const common = ["inspect repository architecture", "detected versions", "matching official documentation", "state the assumption or ask", "behavior-verifiable tests"];
const taxonomy = {
  "react-architecture": { required: ["component APIs", "composition", "client/server", "framework boundary"], excluded: ["form ownership", "keyboard behavior", "test level"] },
  "react-state-data-integration": { required: ["state ownership", "derived state", "form ownership", "async data"], excluded: ["component APIs", "keyboard behavior", "test level"] },
  "react-quality-safeguards": { required: ["accessibility", "security", "privacy", "observability"], excluded: ["component APIs", "form ownership", "test level"] },
  "react-testing": { required: ["user-visible behavior", "test level", "async boundary", "existing test tools"], excluded: ["component APIs", "form ownership", "keyboard behavior"] },
  "nodejs-architecture": { required: ["app/library/CLI", "ESM/CommonJS", "package exports", "public boundaries"], excluded: ["resource owner", "trust boundary", "test level"] },
  "nodejs-runtime-integration": { required: ["async I/O", "resource owner", "cancellation", "graceful shutdown"], excluded: ["package exports", "trust boundary", "test level"] },
  "nodejs-quality-safeguards": { required: ["trust boundary", "secrets", "PII", "diagnostics"], excluded: ["package exports", "resource owner", "test level"] },
  "nodejs-testing": { required: ["observable behavior", "boundary failures", "existing runner", "deterministic I/O"], excluded: ["package exports", "resource owner", "trust boundary"] },
} as const;
const headings = ["Activation Contract", "Hard Rules", "Decision Gates", "Execution Steps", "Output Contract", "References"];
const lexicalTokens = (body: string) => body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

test("production skill contracts keep constrained metadata, ordered sections, taxonomy, and adaptive safeguards", async () => {
  for (const id of ids) {
    const text = await readFile(new URL(`../../catalog/skills/${id}/SKILL.md`, import.meta.url), "utf8");
    assert.equal(text.includes("\r"), false, `${id} uses LF`);
    const frontmatter = text.match(/^---\n([\s\S]+?)\n---\n\n([\s\S]+)$/);
    assert.ok(frontmatter, `${id} has constrained frontmatter`);
    const [, metadata, body] = frontmatter;
    assert.match(metadata, new RegExp(`^name: ${id}$`, "m"));
    assert.match(metadata, /^description: "Trigger: [^"\n]+"$/m);
    assert.match(metadata, /^license: Apache-2\.0$/m);
    assert.match(metadata, /^metadata:\n  author: "LuHer18"\n  version: "1\.0"$/m);
    let offset = -1;
    for (const heading of headings) { const next = body.indexOf(`## ${heading}`); assert.ok(next > offset, `${id} orders ${heading}`); offset = next; }
    const count = lexicalTokens(body).length;
    assert.ok(count >= 180 && count <= 450, `${id} body has ${count} recommended tokens`);
    assert.ok(count <= 1000, `${id} body stays below hard token limit`);
    const normalized = body.toLowerCase();
    for (const marker of [...common, ...taxonomy[id].required]) assert.ok(normalized.includes(marker.toLowerCase()), `${id} includes ${marker}`);
    for (const marker of taxonomy[id].excluded) assert.equal(normalized.includes(marker.toLowerCase()), false, `${id} excludes ${marker}`);
    assert.match(body, /No bundled references; verify matching official docs before API-specific work\./);
  }
});
