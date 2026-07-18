---
name: nodejs-runtime-integration
description: "Trigger: Node.js I/O, process, network, data lifecycle, cancellation, shutdown. Integrate runtime resources conservatively."
license: Apache-2.0
metadata:
  author: "LuHer18"
  version: "1.0"
---

## Activation Contract
Use for Node.js async I/O, process, network, data, or lifecycle integration. Start by: inspect repository architecture, runtime metadata, `package.json`, lockfiles, detected versions, and existing operational conventions.

## Hard Rules
Preserve established architecture and dependencies; ask before changing either. Make async I/O ownership, completion, failure, and cleanup explicit. Name the resource owner for sockets, streams, servers, clients, timers, and transactions. Inspect matching official documentation before version- or API-specific advice. Preserve error contracts and make cancellation explicit where the established runtime supports it.

## Decision Gates
| Evidence | Action |
| --- | --- |
| Resource lifetime is known | Keep acquisition and cleanup with its resource owner. |
| Cancellation or graceful shutdown is required | Handle only owned resources and preserve in-flight behavior. |
| Evidence absent | State the assumption or ask; do not invent an API, version, dependency, or architecture. |

## Execution Steps
1. Trace inputs, outputs, lifetimes, and failure paths across the integration.
2. Use existing async conventions and surface cancellation outcomes deliberately.
3. Register process signals only for resources this component owns.
4. Add behavior-verifiable tests using existing tools for success, timeout, cancellation, and cleanup paths.

## Output Contract
Report resource ownership, lifecycle, cancellation and graceful shutdown behavior, preserved error contracts, assumptions, and observable checks.

## References
No bundled references; verify matching official docs before API-specific work.
