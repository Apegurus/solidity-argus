# Argus Plugin — Architecture Decisions

<!-- Append entries below. Never overwrite. Format: ## [TIMESTAMP] Task: {N} -->

## [2026-02-17T22:51:36Z] Bootstrap
- Plugin in root `solidity-auditor/` directory (not a subdirectory)
- Standalone OpenCode plugin (no OhO integration in v1)
- TDD approach: write tests first (RED→GREEN→REFACTOR)
- Reports: markdown only (no PDF in v1)
- Knowledge: hybrid — curated SKILL.md files + SCVD searchable index
- Staging dirs for Wave 4a: `skills/.staging/{source}/` merged by Task 29
- DEFAULT_MODELS constant in `src/constants/defaults.ts`
- MatchSource extensible interface in Task 11 (Task 30 adds SCVD without modifying Task 11 core)
- DeFiHackLabs: GitHub URLs only (no submodule paths in SKILL.md content)
