# Changelog

## 0.5.6 (2026-05-01)

### Fixes
- Mutate config objects in-place instead of replacing with spread — prevents lost config updates across hooks
- Defensive guards in `tool.execute.after` hook prevent MCP tool crashes from propagating
- Use deduped findings in report pipeline; resolve `check_patterns` path handling
- Resolve `argus doctor` false warnings, gas parser Unicode bug, and lint errors
- Don't overwrite task tool output — only truncate `argus_*` tool results
- Restore production readiness checks accidentally weakened in earlier refactor

### Improvements
- Skill category frontmatter added to 5 protocol-pattern and 6 checklist SKILL.md files — `argus doctor` now reports accurate category counts
- Tighten permissive config schema fields
- Clarify Bun-native package exports in README and `package.json`
- Align Argus agent prompts and operator runbook documentation

## 0.5.3 (2026-03-23)

### Features
- **Themis quality gate** — new 5th agent running on `openai/gpt-5.4` for independent cross-validation of audit pipeline output. Compares raw findings against Scribe's deduped output and the final report; performs second-opinion research via Solodit and skill checklists.

### Fixes
- Use `openai/gpt-5.4` for Themis (gpt-5.4-pro not available on openai provider)
- Resolve `read_findings` regression and dedup data loss after Themis integration
- Defense-in-depth path normalization and finding-field aliases at store/tool layer
- Bypass event materialization in report pipeline — read findings directly from audit state
- Thread `projectDir` into `processToolResult` (previously only wired for `record_finding`)
- Inherit parent run ID for child session coalescence — prevents fragmented audit trail
- Add `title`/`name` as `check` aliases and `location` as `file+lines` alias in finding normalization
- Rebuild `dist/` bundle (was 10 days stale, missing recent fixes)

### Internal
- Delete migration module — premature abstraction for non-existent legacy state

## 0.5.0 (2026-03-23)

### Features
- Startup version log line for runtime diagnostics
- Manager-per-session isolation with DRY finding processors

### Fixes (critical concurrency)
- Mutex timeout no longer releases lock — prevents concurrent critical sections
- Move `currentState` assignment inside mutex to prevent CAS race
- `processQueue` re-entrancy guard no longer blocks task drain
- Bound `statesBySessionId` and `sinksBySessionId` maps to prevent unbounded memory growth
- Deduplicate findings by ID in `addFinding` — prevents duplicate report entries
- Prevent `activateSession` race — move `pendingSinkCreations` guard before try block

### Fixes (reliability)
- Path containment and URL scheme validation in forge tools and artifact resolver
- Retry SCVD sync on 429/503; lock error category for concurrency
- Slither default cwd computed lazily instead of captured at module load
- Config loader uses Zod-parsed data, preserving defaults and transforms
- Signal handlers exit properly and listeners cleaned up on reset
- Handle corrupted JSON gracefully in `loadIndex` — returns null instead of crashing
- Clear forge inspect timeout timer on normal process exit
- Async `appendFile` for `global-run-index` instead of `appendFileSync`
- `parseTrpcData` tries standard JSON first to prevent data corruption
- Resolve session lifecycle leaks, scoping bugs, and resource cleanup
- DRY forge errors, promise safety, memory bounds, path traversal bypass
- Resolve 4 report quality issues
- Remove misplaced supplemental heuristics from `oracle-manipulation` and `flash-loan` SKILL.md
- Remove `getActiveCount()` no-op in `session.idle` handler
- Remove exit handler and clear `agentTrackerRef` on full dispose — prevents handler leak

### Refactors
- Remove `audit_state` from report generator (migrated to `report_input` contract)
- Extract canonical agent name constants to single source of truth
- Extract `safeEmitToSink`, `PHASE_ORDER`, `formatError`, `countBySeverity`, `estimateTokens` to shared modules
- Use `isArgusFamily` from shared module instead of inline agent checks
- Export `normalizeText` from `finding-fingerprint` as single source of truth

## 0.4.0 (2026-03-07)

### Features
- Comprehensive E2E lifecycle test for full audit pipeline
- Session-scoped state files prevent multi-instance contamination
- Infer audit phase advancement from tool completion

### Fixes (production hardening)
- Rewrite state persistence with async mutex, strict config, event sink timeout
- Deterministic finding IDs, truncation handling, session isolation, plugin teardown
- Event sink fallback, hook dedup, pattern loader errors, strict config schema
- Sub-agent `run_id` alignment via `EventSink.runId` property
- Idempotent `bindSession` and sub-agent `EventSink` reuse
- Multi-instance `EventSink` contamination — preserve fresh sessionId on state recovery
- Orphan process cleanup, `record_finding` response fields, Solodit enrichment, truncation handling
- Extract `sessionId` from SDK Event properties (was looking at non-existent top-level field)
- Solodit MCP HTTP primary with tRPC fallback; port `3000` → `54173`
- Resolve duplicate journal sequences, canonical report pipeline, Solodit filtering, `run_id` propagation
- Cross-run findings aggregation for multi-agent audits
- Accept parent sessions as valid writers in run finalization
- Suppress plugin init stdout/stderr noise in OpenCode
- Extract `lines` from `location` even when `file` is set; default `lines` to `[0,0]`

### Refactors
- Extract `forge-runner`, `type-guards`, `validation-constants`, `stopwords` to shared modules

## 0.3.6 (2026-02-23)

### Features
- Enforce event-backed finding observations in reporting (schema v2)
- Materialize findings artifact on session finalization
- Materialize deterministic findings artifact
- Preflight completeness checks before report generation
- Reporting gate hints for argus
- Dual-root path resolver with `.argus`-first precedence
- Hard tool coverage gate — block report generation when key audit tools are missing
- Reminder on missing key tool coverage

### Fixes
- Use last-event timestamp for findings artifact determinism
- Harden tool summary rendering against partial objects
- Unify UTC date source for filename and body
- Gate report generation on orchestration preflight
- Validate `toolsExecuted` entries
- Use resolver paths in `recordRun` and wire migration parity metrics
- Canonicalize report filenames; track finalization results; emit tool events without state

### Migration
- Migrate writes to `.argus/` with legacy `.opencode/` read fallback
- Unify `argus-scribe-report` input contract
- State-first orchestration policy added to agent prompts
- Test suites migrated to schema v2 observation model

### Docs
- Production cutover and rollback runbook (`docs/operator-runbook.md`)
- Migration docs and tests aligned with `.argus` canonical root
- Background retrieval remediation guidance

## 0.3.5 (2026-02-23)

### Fixes
- Apply biome formatting to pre-existing files
- Refresh forge cache

### CI
- Gate on orchestration and report regressions
- Degraded orchestration regression matrix

## 0.3.3 (2026-02-21)

### CI
- Pin Foundry to v1.5.1 stable and remove duplicate triggers
- Apply biome formatting in test files

### Fixes
- Flush and sync audit state before archiving on session delete
- Add finding alias normalization as defense-in-depth in report path
- Remove contradictory report generation instructions from Scribe prompt
- Enforce strict 5s startup cap for Solodit MCP

## 0.3.1 (2026-02-21)

### CI
- Add E2E job with Forge + Slither

### Fixes
- BUG-1: tracking hook coverage
- BUG-5: Solodit availability handling
- BUG-6: operational blocks in all 4 agent prompts
- Inject task status into argus-context block
- Write report to disk via `Bun.write`; add `output_dir` config
- Add metadata fields to patterns; strip comments/strings before matching
- Support real forge JSON format with `extractJson` stripping
- Await Solodit startup and check availability before search

### Features
- Populate `externalCalls[]`, inheritance, and modifiers via `@solidity-parser/parser` AST

## 0.3.0 (2026-02-21)

### Features
- **15 case studies** of major DeFi exploits (Euler, Nomad, Ronin, Cream Finance, and more)
- **Audit PDF extraction pipeline** — generic ingestion of public audit reports; expanded to 85 BailSec reports yielding 1,683 findings
- **Dynamic pattern discovery** via `pattern_category` frontmatter — no separate config needed
- Consolidate YAML pattern packs into SKILL.md `detection_rules` (single source of truth)
- New tools: `forge_coverage`, `proxy_detection`, `gas_analysis`
- 5 new vulnerability skills, including `fee-on-transfer-tokens` and `unsafe-erc20-transfers`
- Append-only run journal and cross-project run index
- Finding clustering and end-to-end ingestion pipeline
- Skill analysis library with TF-IDF similarity scoring and quality gates
- New CLI command: `argus check-skills` (duplicate and similarity detection)
- Refine agent prompts and tool tracking; fix `onComplete` callback

### Fixes
- Address Copilot review findings across 13 files
- Harden report generator against malformed findings
- State durability — archive on delete, debounced save, error logging
- Forge CWD resolution, pattern checker error handling, steps safety net
- Sentinel prompt docs and fixture sanitization
- `argus doctor` exit code validation and `hasFailure` flag
- Bounded timeouts on utility spawn calls
- Isolate plugin entry point to single default export
- Reset sync lock in observability test `beforeEach` for CI isolation
- Resolve all production and test lint violations

### Internal
- Migrate to async `Bun.spawn`; Solodit retry; `child_process` cleanup
- Remove dead code (`event-hook`, `plugin-state`, `setDispatcher`)
- Rename `event-hook-v2` to `event-hook`
- Migrate builtin patterns to YAML and add 13 pattern packs
- Strict Biome config, CI workflow, and lint scripts

### Docs
- Update README with post-consolidation counts and detection rules
- Update INVENTORY.md

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
