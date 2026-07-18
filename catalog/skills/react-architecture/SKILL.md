---
name: react-architecture
description: "Trigger: React component architecture, composition, boundaries. Preserve and evolve React component APIs."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for React component APIs, composition, module placement, and client/server or framework boundary decisions. Inspect repository architecture, tooling, detected versions, and matching official documentation before proposing version-specific behavior.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Keep render logic pure, compose small public interfaces, and update inputs explicitly. Do not invent framework APIs, server behavior, or runtime boundaries when evidence is absent.

## Decision Gates
Identify the existing component boundary, ownership of public APIs, detected framework/runtime, and whether a client/server boundary exists. If evidence is incomplete, state the assumption or ask. Follow the matching framework documentation for framework-owned behavior.

## Execution Steps
Map the current module and component APIs before moving code. Prefer composition over new coupling. Keep rendering deterministic, isolate external synchronization outside render, and make boundary data explicit. Verify behavior-verifiable tests using existing project tools after each observable contract change.

## Output Contract
Report preserved architecture, affected component interfaces, framework boundary evidence, assumptions, and observable checks. Name proposed dependency or architecture changes separately for approval. Do not claim an API or version that repository evidence and official documentation do not establish.

## References
No bundled references; verify matching official docs before API-specific work.
