---
name: nodejs-architecture
description: "Trigger: Node.js architecture, modules, package boundaries, ESM, CommonJS, CLI. Preserve adaptive application, library, or CLI boundaries."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for Node.js module placement, package surfaces, or application, library, and CLI boundaries. Start by: inspect repository architecture, `package.json`, lockfiles, runtime metadata, and detected versions.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Determine the app/library/CLI shape, ESM/CommonJS mode, entry points, and package exports before recommending imports or file layout. Inspect matching official documentation before version- or API-specific advice. Do not widen public boundaries or introduce dual-module packaging without target evidence.

## Decision Gates
| Evidence | Action |
| --- | --- |
| Product shape established | Place code in its existing app, library, or CLI boundary. |
| Module mode and package exports established | Follow the existing resolution and public boundaries. |
| Evidence absent | State the assumption or ask; do not invent an API, version, dependency, or architecture. |

## Execution Steps
1. Map entry points, callers, owned package surfaces, and build/test tooling.
2. Keep internal modules private unless an established public boundary requires exposure.
3. Match the detected module syntax and resolution rules.
4. Record assumptions and add behavior-verifiable tests using existing tools.

## Output Contract
Report the detected product shape, module mode, affected boundaries, assumptions, and observable behavior checks. Identify any architecture or dependency change requiring approval.

## References
No bundled references; verify matching official docs before API-specific work.
