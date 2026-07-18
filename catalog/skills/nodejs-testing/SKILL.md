---
name: nodejs-testing
description: "Trigger: Node.js tests, runtime boundaries, I/O failures, process behavior. Verify observable behavior with the existing runner."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for Node.js behavior tests across modules, I/O, network, process, and data boundaries. Start by: inspect repository architecture, tooling, runtime metadata, detected versions, the existing runner, and current test conventions.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Inspect matching official documentation before version- or API-specific advice. Verify observable behavior rather than implementation detail. Keep deterministic I/O through controlled clocks, fixtures, ports, environments, and cleanup. Cover boundary failures without masking the production error contract. Do not introduce a new runner, coverage target, or version-specific API without evidence.

## Decision Gates
| Evidence | Action |
| --- | --- |
| Existing runner and conventions exist | Extend them with the smallest behavior-focused coverage. |
| I/O or process boundary exists | Choose controlled fixtures or fakes that preserve observable behavior. |
| Evidence absent | State the assumption or ask; do not invent an API, version, dependency, or architecture. |

## Execution Steps
1. Define success, boundary failures, timeout, cancellation, and cleanup observations.
2. Select unit or integration scope based on the real boundary, not file location.
3. Isolate external state and make setup and teardown deterministic I/O.
4. Run behavior-verifiable tests using existing tools and record exact results.

## Output Contract
Report the existing runner, scenarios, fixtures, boundary failures, deterministic controls, assumptions, and observable results.

## References
No bundled references; verify matching official docs before API-specific work.
