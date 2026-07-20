# Researcher AI contributor guide

## Product boundaries

- Treat AI Scientist executions as hostile workloads. Keep the default runner in `mock` mode and use `native` only inside a dedicated container.
- Never add a tool that accepts an arbitrary shell command, executable path, host path, or URL.
- Every scientific manuscript must retain the machine-generation disclosure required by the upstream license.
- Keep tenant identifiers out of filesystem paths; the store hashes them before use.
- Do not expose secrets in logs, tool results, command previews, artifacts, or tests.

## Verification

Run these before handing off a change:

```bash
npm run typecheck
npm test
npm run validate
npm run smoke
```

The upstream source is a pinned Git submodule. Update it deliberately, review its license and command-line contract, and update `UPSTREAM_COMMIT` in `scripts/validate-manifests.mjs` in the same change.
