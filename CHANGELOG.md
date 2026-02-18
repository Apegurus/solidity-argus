# Changelog

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
