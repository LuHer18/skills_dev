---
name: react-testing
description: "Trigger: React tests, UI behavior, async interaction. Prove user-visible React behavior with existing tools."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for React user-visible behavior, test level selection, async boundary handling, and test tool decisions. Inspect repository architecture, tooling, detected versions, and matching official documentation before using framework-specific helpers or assumptions.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Test observed outcomes and accessible interactions rather than implementation details. Reuse existing test tools and fixtures. Do not invent framework helpers, timers, rendering environments, or unsupported versions.

## Decision Gates
Choose the smallest test level that proves the risk, identify the async boundary, and confirm the existing test tools and runtime. Define stable observable outcomes, data setup, and cleanup. If evidence is incomplete, state the assumption or ask. Follow matching official documentation for framework behavior.

## Execution Steps
Write a failing behavior example before changing the contract when practical. Exercise user actions, loading, success, error, and cleanup outcomes at the relevant boundary. Keep time, network, and data deterministic through current conventions. Add behavior-verifiable tests using existing project tools and run the focused command before broader checks.

## Output Contract
Report selected test level, user-visible behavior, async boundary, fixtures, command result, and remaining risk. State assumptions and untested boundaries clearly. Separate dependency or architecture proposals for approval. Do not claim framework APIs or versions beyond repository evidence and official documentation.

## References
No bundled references; verify matching official docs before API-specific work.
