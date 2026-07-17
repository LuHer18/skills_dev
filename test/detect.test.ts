import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { detectStacks } from "../src/detect/index.js";

async function root() { return mkdtemp(join(tmpdir(), "detect-")); }
async function withRoot(run: (directory: string) => Promise<void>) { const directory = await root(); try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }

test("detectors aggregate root Node, React, Spring Boot, and UI5 evidence deterministically", () => withRoot(async (directory) => {
  await Promise.all([
    writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { react: "*", "@ui5/cli": "*" } })),
    writeFile(join(directory, "pom.xml"), "<artifactId>spring-boot-starter-parent</artifactId>"),
    writeFile(join(directory, "ui5.yaml"), "specVersion: '3.0'"),
    writeFile(join(directory, "manifest.json"), JSON.stringify({ "sap.app": {} }))
  ]);
  assert.deepEqual((await detectStacks(directory)).stacks, ["nodejs", "react", "spring-boot", "sap-ui5"]);
}));

test("malformed package evidence is isolated from Spring Boot and UI5 file evidence", () => withRoot(async (directory) => {
  await Promise.all([writeFile(join(directory, "package.json"), "{"), writeFile(join(directory, "build.gradle.kts"), "id(\"org.springframework.boot\")"), writeFile(join(directory, "ui5.yaml"), "x"), writeFile(join(directory, "manifest.json"), "{")]);
  const result = await detectStacks(directory);
  assert.deepEqual(result.stacks, ["spring-boot"]);
  assert.deepEqual(result.warnings, ["Unable to parse root package.json", "Unable to parse root manifest.json"]);
}));

test("detectors ignore nested evidence and succeed with no root evidence", () => withRoot(async (directory) => {
  await mkdir(join(directory, "nested")); await writeFile(join(directory, "nested", "package.json"), JSON.stringify({ dependencies: { react: "*" } }));
  assert.deepEqual(await detectStacks(directory), { stacks: [], warnings: [] });
}));

test("Spring Boot recognizers ignore Maven XML and Gradle comments", () => withRoot(async (directory) => {
  await Promise.all([
    writeFile(join(directory, "pom.xml"), "<!-- <artifactId>spring-boot-starter-parent</artifactId> -->"),
    writeFile(join(directory, "build.gradle"), "// id 'org.springframework.boot'\n/* org.springframework.boot */")
  ]);
  assert.deepEqual((await detectStacks(directory)).stacks, []);
}));

test("Spring Boot Gradle comment handling preserves quoted delimiters without joining strings", () => withRoot(async (directory) => {
  await writeFile(join(directory, "build.gradle"), "def opening = '/*'\nid 'org.springframework.boot'\ndef closing = '*/'\ndef line = '//'");
  assert.deepEqual((await detectStacks(directory)).stacks, ["spring-boot"]);
  await writeFile(join(directory, "build.gradle"), "def delimiters = '// /* */'\ndef split = 'org.springframework.' + 'boot'");
  assert.deepEqual((await detectStacks(directory)).stacks, []);
}));

test("Spring Boot ignores plugin-shaped Gradle multiline strings but detects adjacent declarations", () => withRoot(async (directory) => {
  await writeFile(join(directory, "build.gradle"), "def single = '''\nid 'org.springframework.boot'\n'''\ndef double = \"\"\"\nid 'org.springframework.boot'\n\"\"\"");
  assert.deepEqual((await detectStacks(directory)).stacks, []);
  await writeFile(join(directory, "build.gradle.kts"), "val sample = \"\"\"\nid(\"org.springframework.boot\")\n\"\"\"\nid(\"org.springframework.boot\")");
  assert.deepEqual((await detectStacks(directory)).stacks, ["spring-boot"]);
}));
