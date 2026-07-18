---
name: nodejs-quality-safeguards
description: "Trigger: Node.js security, validation, secrets, errors, diagnostics, privacy. Apply relevant production safeguards without leakage."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for Node.js production safeguards around inputs, credentials, errors, telemetry, and sensitive data. Start by: inspect repository architecture, tooling, runtime metadata, detected versions, and existing operational policies.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Identify every trust boundary and validate untrusted input at the boundary using project conventions. Keep secrets out of source, diagnostics, and error responses. Treat PII as sensitive in logs, traces, metrics, and failures. Inspect matching official documentation before version- or API-specific advice. Emit useful diagnostics with correlation context without leaking credentials or personal data.

## Decision Gates
| Evidence | Action |
| --- | --- |
| Untrusted input crosses a trust boundary | Validate, normalize, and reject safely using established rules. |
| Secrets or PII may be exposed | Redact and use approved configuration and telemetry paths. |
| Evidence absent | State the assumption or ask; do not invent an API, version, dependency, or architecture. |

## Execution Steps
1. Map input sources, authentication context, data classification, and error exposure.
2. Preserve externally observable error contracts while preventing sensitive leakage.
3. Add actionable diagnostics consistent with operational conventions.
4. Add behavior-verifiable tests using existing tools for valid, invalid, and redacted outcomes.

## Output Contract
Report applicable safeguards, trust boundaries, validation behavior, diagnostics, data-handling assumptions, and observable checks.

## References
No bundled references; verify matching official docs before API-specific work.
