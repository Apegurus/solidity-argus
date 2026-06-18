# Changelog

## 0.7.1 (2026-06-17)

### Fixes
- Scoped the bundled skills to the Argus agents. The plugin no longer registers its `skills/` directory or the Trail of Bits companion skills in OpenCode's global `config.skills.paths`, which had leaked all ~91 skill descriptions into the `<available_skills>` context of every skill-enabled agent — not just the Argus family. Argus agents still load skills on demand via the scoped `argus_skill_load` tool (its resolver reads the bundled skills, `customSkillsDir`, and the Trail of Bits cache directly), and the Trail of Bits companion clone is preserved.

## 0.7.0 (2026-06-17)

### Features
- Recorded build provenance in the event stream: `plugin_version` now carries a semver build descriptor (`0.7.0+g<sha>[.dirty]`) plus structured `build_commit`/`build_dirty` on session and finalization events, and a `prepack` stamp (`build-info.json`) lets npm-installed builds (which have no `.git`) report the exact commit they were built from.
- Upgraded the default Argus orchestrator model to `anthropic/claude-opus-4-8`.

### Fixes
- Report parity now validates deduped lineage against the deduped finding universe (matching `argus_persist_deduped`) instead of the raw projection, eliminating false "missing observation" Completeness Warnings that grew as findings accumulated.
- Closed a finalization gap where `run.finalized` was never emitted: the `session.idle` and Themis-disposition triggers now gate on run-scoped resolved-disposition state instead of a per-session `reportGenerated` copy, and `EventSink` finalization is idempotent so concurrent paths cannot append duplicate `run.finalized` events.
- Finalization no longer fails on legitimate subagent re-dispatch: the parent-child integrity check required one `correlation_id` per child session, but `correlation_id` is minted per dispatch and a child subagent session is reused/continued across remediation rounds, so remediated runs spuriously finalized with `invariantsPassed: false`. The sound one-parent-per-child and structural missing-`correlation_id` checks are retained.
- Reused finalized OpenCode sessions now reset stale audit state and bind to the correct run sink (no cross-run binding leakage).
- Enforced the rubric invariant that a `CONFIRMED` verdict requires `confidence_score >= 80` at ingest, dedup-merge, and report tiering, so a low-confidence finding can no longer reach the Findings tier under verdict-first routing.
- The report Methodology / tools-used list is now derived from the executed-tools ledger, so a report no longer claims a tool (e.g. Slither) ran when it did not.
- Regeneration ergonomics: invalid regeneration requests return a structured `INVALID_REGENERATION_OPTIONS` error with corrective guidance and no longer mutate the durable finding ID registry.
- Corrected the Slither detector-exclusion flag to `--exclude` (the invalid `--exclude-detectors` broke the entire Slither run).
- Broadened the `lack-of-precision` detection rule to match variable (not only numeric) divisors in division-before-multiplication, with added pattern-corpus coverage.
- `argus_record_finding` now stamps each observation with a per-call-unique `observation_id`. Previously repeated single-finding calls within one session all collided on `<sessionId>:1`, which let the deduper merge unrelated findings across different files; the response note now describes the transient `tool-local` run_id placeholder rather than conflicting with it.
- Finding-lineage validation now rejects a deduped finding whose mapped observations span more than one file (`cross_file_merges`), making accidental cross-file merges structurally impossible at persist time.

### Improvements
- The reporting-gate advisory reports `DELEGATED` once subagents are dispatched (coverage is verified run-scoped at report time) instead of a false `BLOCKED`, since key tools execute in subagent sessions the orchestrator's local ledger cannot observe.
- Strengthened severity calibration: the refutation rubric now requires impact reachable in the current code (not hypothetical/future code), and the access-control skill adds a value-flow rule distinguishing theft (asset to the caller) from griefing (asset to the rightful holder).

## 0.6.2 (2026-05-25)

### Features
- Added the specialist repetition watchdog and exposed the text-completion hook so Argus can interrupt repeated specialist loops and surface completion behavior through the plugin hook system.

### Fixes
- Made deduped report artifacts idempotent with stable semantic hashing, while preserving dropped-observation lineage through persistence and report reads.
- Hardened lineage validation diagnostics for invalid deduped artifacts, including mapped/dropped observation overlap.
- Improved contract analysis fallback by trying declared contract names when direct target resolution fails.
- Classified Forge coverage unknown-configuration-key failures without mutating Foundry configuration or suggesting unrelated IR retries.

### Internal
- Carried the v0.6.2 follow-up plan into repository documentation and stabilized temporary-state cleanup assertions.

## 0.6.1 (2026-05-23)

### Fixes
- Added a strict Argus direct-tool budget so the orchestrator delegates broad audits instead of spending all 50 OpenCode steps on direct `bash`/`read` reconnaissance, which could trigger OpenCode's max-steps assistant-prefill path on Anthropic models.
- Enforced one audit-specialist profile per task, with anti-loop checkpoints and structured handoff fields so Argus can synthesize specialist leads without bundled-profile drift.
- Required fresh approved Themis validation after remediation, preventing `remediated` dispositions from closing an audit without an approved follow-up verdict.
- Added strict report scope validation so `argus_generate_report` rejects findings outside the audited scope when `preflight_policy` is `strict-fail`.
- Exposed `quality_gate_policy` in the `argus_generate_report` tool schema so Scribe and Argus can request strict report-quality enforcement through the actual tool surface.
- Added paged `argus_read_findings` retrieval with `findings_offset` and `findings_limit` to keep large audit state readable without truncating canonical data.
- Retried Forge coverage with `--ir-minimum` for stack-too-deep, optimizer, config parse, and instrumentation failures.
- Required Pythia to perform bounded source reads before applying historical precedent and to avoid recording precedent-only findings.
- Added per-subagent task dispatch counts to dynamic Argus context for clearer audit-progress tracking.

## 0.6.0 (2026-05-19)

### Features
- Added the `audit-specialist` adversarial review agent, giving Argus a profile-driven specialist pass for access control, math precision, invariants, economic security, execution tracing, periphery review, first-principles review, and broad vector scanning.
- Added the bundled attack-vector deck and specialist-profile skills, expanding the curated knowledge base to 91 SKILL.md files across vulnerability patterns, methodology, protocol patterns, checklists, references, and case studies.

### Improvements
- Updated Argus, Themis, README, AGENTS, configuration defaults, state schemas, and skill resolution to recognize the 6-agent audit pipeline and audit-specialist tool access.
- Added regression and end-to-end coverage for audit-specialist registration, prompt boundaries, skill loading, finding recording, report generation, and full audit flows.

## 0.5.11 (2026-05-18)

### Fixes
- Reporting gates now require successful key-tool executions instead of counting failed attempts as complete, and the audit enforcer shares the same key-tool logic as report generation.
- Report generation now preserves canonical finding wording and renders source excerpts for readable findings, improving audit report evidence fidelity.
- Slither analysis now attempts direct Foundry/via-IR analysis before falling back to flattening, while preserving stderr on direct failures.
- Forge coverage now supports `match_path`, explicit `ir_minimum`, and automatic `--ir-minimum` retry for stack-too-deep failures.
- Themis validation is now a resolved disposition gate: Argus remains final judge, but finalization requires an approved, remediated, or explicitly overridden Themis disposition.

### Tools
- Added `argus_themis_disposition` for recording Argus' final disposition of Themis validation verdicts.

## 0.5.9 (2026-05-17)

### Fixes
- Hotfix: correct Sentinel/Pythia/Scribe default models from invalid `anthropic/claude-sonnet-4-7` to registry-valid `anthropic/claude-sonnet-4-6`, preventing `ProviderModelNotFoundError` during Argus background dispatch. Confirmed all default model IDs exist in the OpenCode model registry.
- `argus doctor` now checks Solodit through the local MCP health probe instead of a stale direct tRPC endpoint, eliminating a false `Solodit API: returned 500` warning when local Solodit search is healthy.
- Deduped report findings now preserve `observation_ids`, `observation_count`, `sources`, and `reported_by_agents` through normalization, allowing `argus_generate_report` to verify semantic raw-to-deduped parity by observation lineage instead of emitting an unverifiable-parity warning.

## 0.5.8 (2026-05-16)

### Fixes
- `argus doctor` — new **Install drift** check detects a stale `solidity-argus` install hoisted to `~/.cache/opencode/node_modules/solidity-argus` that silently shadows the canonical install under `~/.cache/opencode/packages/solidity-argus@latest/...`. The shadowing install caused every MCP tool call to fail with `undefined is not an object (evaluating 'result.toLowerCase')` for users whose hoisted copy was older than v0.5.6 (before the defensive guards in `tool.execute.after` landed). Doctor now reports a hard failure with the exact `rm -rf` command needed to remove the shadow, plus a softer warning when the hoisted install merely drifts from the running CLI version.
- Agent defaults were updated for Argus and Themis; Sentinel/Pythia/Scribe Sonnet defaults were corrected in v0.5.9.
- `argus_generate_report` — default report rendering now includes Informational findings, aligning the implementation fallback with the tool schema default and keeping severity summary counts synchronized with the rendered findings body.
- `argus_record_finding` — Slither-source findings with missing `impact`, `recommendation`, or `proofOfConcept` are preserved and returned with enrichment warnings instead of being rejected, preventing raw analyzer findings from being lost while still surfacing report-quality gaps for Scribe/finalization.
- Run finalization now fails invariants when the generated report contains a `Completeness Warning` or failed report `qualityGates`, so validation summaries cannot mark warning-bearing or quality-gate-failing reports as successful.
- Report preflight no longer emits false exact-fingerprint mismatch warnings for semantic deduplication artifacts that do not carry raw observation lineage; it now emits a lineage warning instead, while exact fingerprint parity is still enforced when lineage is available or no deduplication occurred.

### Internal
- New exported helpers in `src/cli/commands/doctor.ts`: `enumerateArgusInstallCandidates`, `detectInstallDrift`, `buildInstallDriftReport`, and the `ArgusInstall` / `InstallDriftReport` types — fully unit-tested with synthetic install records (no filesystem touch in tests).
- Added focused report-quality regressions covering default Informational rendering, Slither enrichment preservation warnings, warning-aware finalization, and the reporting pipeline end-to-end path.

## 0.5.7 (2026-05-12)

### Fixes (audit reporting pipeline)
- `argus_record_finding` — preserve `impact`, `recommendation`, `proofOfConcept` fields end-to-end through the event-capture path. Previously, the `tool-tracking-hook` processor stripped these fields when constructing the FindingStore payload, leaving every `finding.added` event with empty enrichment and rendering reports with placeholder "Impact details were not provided" text for all findings. Also include these fields in the tool's JSON response so the calling agent (Sentinel/Pythia) sees what was persisted. (Bug #3 in v0.5.6 smoke test)
- `argus_generate_report` — `tool.execute.after` materialization is no longer fail-fast. When a report is written successfully but the post-render `findings.json` materialization fails (e.g. due to a synthetic vs canonical `run_id` mismatch in the event stream), the tool now logs a warning instead of returning `error`. This unblocks the orchestrator's completion signal and lets Themis dispatch correctly. (Bug #2)
- `argus_generate_report` — Scribe-style deduped findings (high-level fields only — check, severity, impact, recommendation, etc.) are now normalized to canonical form at report time via `normalizeToCanonicalFinding`. Previously the merge step in `parseReportInputPayload` validated raw deduped findings against the strict canonical schema, failing with ~300 `REPORT_INPUT_DEDUPED_VALIDATION_FAILED` errors on Scribe's first attempt. (Bug #1)
- Scribe prompt — explicitly forbid passing `report_input`, `findings`, `toolsExecuted`, `session_id`, or any other field to `argus_generate_report`. Only `project_name`, `scope`, and `run_id` are valid arguments; the tool resolves the rest from durable state.
- Pythia prompt — explicit prohibition against the generic OpenCode `skill` tool. All audit knowledge MUST load via `argus_skill_load` (Pythia previously called the wrong tool twice during v0.5.6 smoke test, recovering itself but burning two turns). (Bug #4)
- `argus install` CLI — added `--global` flag. Running `argus install` without the flag in a directory with no project-local `opencode.json` now warns and asks for confirmation (default: no), instead of silently falling through to `~/.config/opencode/opencode.json` and loading the plugin in every OpenCode session globally. (Bug #5)

### Internal
- Extracted `materializeFindingsForRun` from `create-hooks.ts` into `findings-materializer.ts` for direct unit-testability (previously a closure-scoped helper).
- New end-to-end test `tests/e2e/audit-reporting-pipeline.test.ts` exercises the full `record_finding → persist_deduped → generate_report` flow against a temp project, asserting non-placeholder impact/recommendation content in the rendered report.
- Net test delta: +16 tests, 1408 passing / 0 failing.

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
- **Themis quality gate** — new 5th agent running on `openai/gpt-5.5` for independent cross-validation of audit pipeline output. Compares raw findings against Scribe's deduped output and the final report; performs second-opinion research via Solodit and skill checklists.

### Fixes
- Use `openai/gpt-5.5` for Themis (gpt-5.5-pro not available on openai provider)
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
- **@argus** — Orchestrator, coordinates full 7-step audit methodology (claude-opus-4-7)
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
