---
name: react-state-data-integration
description: "Trigger: React state, forms, async data, integration. Clarify state and data ownership without coupling layers."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for React state ownership, derived state, form ownership, async data, and integration boundaries. Inspect repository architecture, tooling, detected versions, and matching official documentation before choosing APIs, data layers, or framework conventions.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Keep one clear owner for mutable state, derive values instead of duplicating them, and use immutable updates. Do not invent caches, transport clients, or framework data behavior without evidence.

## Decision Gates
Classify each value as local, shared, URL, server, or derived state. Identify form ownership, async data authority, failure behavior, and detected framework/runtime. If evidence is incomplete, state the assumption or ask. Follow matching official documentation for version-specific integrations.

## Execution Steps
Trace reads, writes, loading, errors, cancellation, and invalidation through current boundaries. Keep request lifecycle ownership explicit and avoid copying remote data into unrelated state. Synchronize only real external systems. Add behavior-verifiable tests using existing project tools for visible pending, success, and failure outcomes.

## Output Contract
Report the state owner, derived values, form owner, data authority, external boundary, assumptions, and observable checks. Separate any dependency or architecture proposal for approval. Do not claim a supported API or version beyond repository evidence and official documentation.

## References
No bundled references; verify matching official docs before API-specific work.
