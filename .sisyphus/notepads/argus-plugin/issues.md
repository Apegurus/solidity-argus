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
