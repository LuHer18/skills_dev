# Install project-local agent skills offline

`project-skill-installer` detects supported project evidence and installs matching bundled skills into `.agents/skills/<skill-id>/SKILL.md`. It is a Node.js 22+ pnpm CLI for macOS and Windows; it never downloads a catalog or contacts the network at runtime.

## Quick path

```text
pnpm install --frozen-lockfile
pnpm build
pnpm exec project-skill-installer --dry-run --cwd path/to/project
```

Run without `--cwd` to analyze the current directory. `--dry-run` prints the exact plan without prompts, locks, directories, or writes. Use `--force` only to replace every colliding skill in a non-interactive run.

## Detection evidence

| Stack | Root evidence |
|---|---|
| Node.js | Parseable `package.json` |
| React | Direct `react` or `react-dom` dependency key |
| Spring Boot | Boot Maven declaration or Gradle plugin |
| SAP UI5 | `ui5.yaml` plus `manifest.json` with `sap.app`, or direct `@ui5/cli` dependency |

Matches are deterministic, deduplicated by skill ID, and installed locally. The catalog is bundled in the package and integrity-checked before planning, so it works offline.

## Safety and outcomes

Existing skills are confirmed one at a time in a TTY. Non-interactive collisions are skipped unless `--force` is supplied. A multi-skill write uses one lock, staging, sibling backups, and rollback; failed recovery retains and reports paths for manual recovery.

| Exit | Meaning |
|---:|---|
| 0 | Success, dry-run, no match, or skipped collisions |
| 1 | Detection, catalog, safety, lock, write, or rollback failure |
| 2 | Invalid arguments |

## Release status

The package name and executable are provisionally `project-skill-installer`. Publication is deliberately deferred: the package remains `private: true` until an npm account and name availability are resolved.
