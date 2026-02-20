# Changelog

## 0.2.0 (2026-02-20)

### Bug Fixes
- Fixed JSONC parser corrupting strings containing block comment syntax (`/* */`)
- Fixed audit state manager dropping writes when save is in-flight (save coalescing)
- Fixed Solodit HTTP fallback using wrong MCP tool name and ignoring configured port
- Fixed background manager dispatcher permanently set to noop
- Fixed logger crash on circular references and BigInt values
- Fixed `extractJson` capturing too much content (uses depth-counting bracket matcher)
- Fixed `dispatch()` mutating global concurrency limit from per-task options
- Fixed tool error recovery mutating audit state directly without persistence
- Fixed `find` command `-maxdepth` option ordering in binary-utils and slither-tool
- Fixed NaN propagation in dependency scanner for non-semver version specs
- Fixed test cleanup pattern that doesn't work in bun:test (beforeEach return)
- Fixed config file detection matching overly generic `config.json` filenames
- Fixed `SolditConfigSchema` typo (now `SoloditConfigSchema`)
- Fixed `readJsoncFile` returning `any` type (now `Record<string, unknown>`)
- Fixed `hasBinary` using shell interpolation (now uses `Bun.spawnSync`)
- Fixed via_ir error message to mention `solc-select`
- Fixed skills README referencing old `opencode-argus.jsonc` config name
- Fixed README documenting wrong config paths and non-existent config fields

### Improvements
- Added `@opencode-ai/sdk` as peer dependency for type-safe Config import
- Added `system-prompt` to `HookName` union type for config-driven disabling
- Added `setDispatcher()` method to background manager for post-creation wiring
- Added `maxConcurrent` constructor option to background manager (wired from config)
- Added save coalescing loop to audit state manager for concurrent write safety
- Added Trail of Bits clone error logging and pinned branch reference
- Added Solodit MCP child process tracking for lifecycle awareness
- Improved `deepMerge` array deduplication to handle objects (JSON-based)
- Improved `extractJson` to use depth-counting bracket matcher
- Replaced module-level mutable `latestAgentTracker` with typed ref pattern

## 0.1.0 (2026-02-18)

Initial release of solidity-argus.

### Agents
- **@argus** — Orchestrator, coordinates full 7-step audit methodology (claude-opus-4-6)
- **@sentinel** — Static analysis & testing specialist (claude-sonnet-4-6)
- **@pythia** — Vulnerability researcher via Solodit/SCVD (claude-sonnet-4-6)
- **@scribe** — Audit report writer (claude-sonnet-4-6)

### Tools
- `argus_slither_analyze` — Slither static analysis with auto-flatten fallback
- `argus_analyze_contract` — Deep structural contract profiling
- `argus_check_patterns` — 35+ vulnerability pattern matching (regex/AST)
- `argus_solodit_search` — Search 7,769+ real-world audit findings
- `argus_forge_test` — Foundry test execution
- `argus_forge_fuzz` — Fuzz testing for edge cases
- `argus_generate_report` — Professional markdown audit reports
- `argus_sync_knowledge` — SCVD vulnerability database sync

### Architecture
- Modular factory-based architecture: `create-tools`, `create-hooks`, `create-managers`, `plugin-interface`
- Multi-level config: user (`~/.config/opencode/`) + project (`.opencode/`) with deep merge
- Hook enable/disable via `disabled_hooks` config
- Push-only hook mutation for multi-plugin compatibility

### Features
- Background agent management with configurable concurrency
- Persistent audit state (survives session restarts)
- Error recovery with full context capture
- Context window monitoring with adaptive injection sizing
- Audit continuation enforcement (7-step methodology)

### CLI
- `argus doctor` — Check Slither/Foundry/SCVD availability
- `argus init` — Generate starter config
- `argus install` — Register plugin in OpenCode config

### Knowledge Base
- 55 curated SKILL.md files across 5 categories
- Sources: Trail of Bits, Cyfrin, DeFiFoFum, SunWeb3Sec, smartbugs
- SCVD integration for 7,769+ real-world findings
