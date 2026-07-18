---
name: react-quality-safeguards
description: "Trigger: React accessibility, security, privacy, performance, observability. Apply evidence-based production safeguards."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for React accessibility, security, privacy, performance, and observability safeguards. Inspect repository architecture, tooling, detected versions, and matching official documentation before selecting controls, measurements, or framework-specific implementation details.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Apply only safeguards relevant to the actual trust, data, rendering, or operational boundary. Avoid security theater, hidden personal data, unmeasured performance claims, and invented platform APIs.

## Decision Gates
Identify user impact, trust boundary, sensitive data, rendered semantics, operational signals, and performance measurement method. Determine which safeguards apply and why. If evidence is incomplete, state the assumption or ask. Follow matching official documentation for framework-specific behavior.

## Execution Steps
Use semantic accessible output and verify assistive interaction where applicable. Validate untrusted input at the owning boundary, minimize personal data exposure, and preserve existing error policy. Measure before optimizing. Emit useful project-convention signals without leaking secrets. Add behavior-verifiable tests using existing project tools for applicable safeguards.

## Output Contract
Report applicable accessibility, security, privacy, observability, and performance checks with evidence and exclusions. State assumptions, measurement method, and residual risk. Separate any dependency or architecture change for approval. Do not claim controls, APIs, or versions not established by repository evidence and official documentation.

## References
No bundled references; verify matching official docs before API-specific work.
