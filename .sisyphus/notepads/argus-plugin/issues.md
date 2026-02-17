# Argus Plugin — Issues & Gotchas

<!-- Append entries below. Never overwrite. Format: ## [TIMESTAMP] Task: {N} -->

## [2026-02-17T22:51:36Z] Bootstrap
- AgentConfig from `@opencode-ai/sdk` (verify package name during implementation)
- `config.skills.paths` resolves relative to installed npm package — use `__dirname` or `import.meta.dir`
- Solodit MCP: `@lyuboslavlyubenov/solodit-mcp` npm package
- SCVD API: api.scvd.dev — CC0 license, no auth required, but handle rate limits
- Task 27 warns: No SQLite dependency — JSON index only (~5MB for 7,769 entries)
- Task 30: Auto-sync MUST be non-blocking (<100ms plugin init even if SCVD offline)
- Cyfrin checklist license: unspecified — verify before publish, attribute anyway

## [2026-02-17T23:43:00Z] Task 8
- Direct calls to executor helpers in tests bypass Zod defaults; without internal normalization, `verbosity` can be undefined and command construction breaks.
- Forge JSON status strings vary (`Success`/`Failure`/`Skipped` vs lowercase variants); status mapping must be case-insensitive.
- When `forge coverage --report json` fails or emits invalid JSON, return structured tool output with `success: false` instead of throwing.

## [2026-02-17T23:28:28Z] Task 9
- Counterexample parsing is sensitive to greedy regex: `args=\((.*)\)` can consume trailing test metadata and corrupt extracted inputs/test names.
- Foundry can emit fail metadata and counterexample details on separate lines; parser must retain previous test context to attach orphan counterexamples.

## [2026-02-17T23:32:17Z] Task 10
- `extractContractInfo` does not take an `AbortSignal`, so cancellation is best-effort only; guard with abort-aware wrapping and return a clear `contract analysis aborted` error when signal trips.
- OpenZeppelin checks must focus on import lines to avoid false positives from comments or unrelated identifiers in function bodies.

## [2026-02-17T23:36:31Z] Task 11
- Tool schema defaults (`include_scvd: tool.schema.boolean().default(true)`) make the generated `patternCheckerTool.execute` arg type require `include_scvd` in direct unit calls; tests invoking `execute` directly must pass it explicitly.

## [2026-02-17T23:59:00Z] Task 13
- Tool schema defaults in `tool()` can produce stricter generated `execute` argument types for direct test invocations; tests calling `reportGeneratorTool.execute` must pass `include_executive_summary` and `severity_threshold` explicitly to satisfy TypeScript diagnostics.
