# Argus — The All-Seeing Solidity Security Agent (OpenCode Plugin)

## TL;DR

> **Quick Summary**: Build `opencode-argus`, an OpenCode plugin providing a 4-agent security auditing system (Argus orchestrator + Sentinel/Pythia/Scribe specialists) with 8 custom tools wrapping Slither/Foundry/Solodit/SCVD, a hybrid knowledge base (curated SKILL.md files merged from multiple sources + SCVD searchable local index with auto-sync), and professional markdown report generation.
> 
> **Deliverables**:
> - Publishable npm package `opencode-argus` 
> - 4 agents (Argus primary + 3 subagents) registered via `config` handler
> - 8 custom tools (Slither, Forge test, Forge fuzz, Solodit search, contract analyzer, pattern checker, report generator, knowledge sync)
> - Curated SKILL.md knowledge base merged & deduplicated from DeFiFoFum fork + kadenzipfel references + Cyfrin checklist + SmartBugs/DeFiHackLabs examples
> - SCVD searchable local index (7,769+ findings, auto-synced via API)
> - Audit state management across sessions (compaction + event hooks)
> - Solodit MCP server registration
> - Companion plugin documentation (Trail of Bits skills marketplace integration)
> - Full TDD test suite
> 
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 5 waves + sub-wave 4b
> **Critical Path**: Scaffold → Config Handler + Tools → Agent Prompts → Knowledge Import + SCVD Pipeline → Dedup + Assembly → Integration Testing

---

## Context

### Original Request
Build Argus (`opencode-argus`), an OpenCode plugin for Solidity smart contract security auditing. The original planning document (`argus-planning-prompt.md`) provided a comprehensive vision but contained 6 critical architectural mismatches with how OpenCode plugins actually work.

### Interview Summary
**Key Discussions**:
- **Architecture correction**: Agents are `AgentConfig` objects registered via `config` handler, NOT TypeScript classes. Orchestration is prompt-driven via Task tool delegation, not code-driven.
- **Agent consolidation**: Merged Medusa+Hoplite into "Sentinel" (vulnerability finder). Kept Pythia (research) and Scribe (reporting). Argus as primary agent.
- **Knowledge delivery**: SKILL.md system for on-demand loading instead of prompt injection (token economics).
- **Knowledge strategy (revised)**: Hybrid approach — curated SKILL.md files merged from multiple external sources (DeFiFoFum fork, kadenzipfel, Cyfrin, SmartBugs) + SCVD searchable local index with auto-sync. Trail of Bits skills as companion plugin (no duplication). Solodit via MCP (real-time queries).
- **DeFiFoFum coordination**: Fork and extend — take colleague's fofum-solidity-skills content, restructure from monolithic to modular, maintain independently.
- **Integration priority**: Standalone OpenCode plugin first. OhO integration as future phase.
- **Testing**: TDD with bun test.
- **Reports**: Markdown only for v1.

**Research Findings**:
- OpenCode plugin API verified from official docs + OhO source code reverse-engineering
- `experimental.chat.system.transform` CONFIRMED to exist (was incorrectly marked as non-existent in initial analysis)
- Agent registration via `config.agent` mutation CONFIRMED from OhO's `agent-config-handler.ts`
- Skills delivery via `config.skills.paths` CONFIRMED from OpenCode source
- `config.skills.urls` supports remote skill repos with `index.json` manifest — enables dynamic skill loading
- MCP registration via `config.mcp` mutation CONFIRMED from OhO's `mcp-config-handler.ts`
- Slither JSON output schema: `{ success, error, results: { detectors: [{ check, impact, confidence, description, elements }] } }`
- Foundry: `forge test --json`, `forge inspect <contract> abi|storage-layout`, `forge coverage --report json`
- Solodit MCP: `@lyuboslavlyubenov/solodit-mcp` npm package, local stdio MCP with `search_findings` and `get_finding` tools
- DeFiFoFum fofum-solidity-skills: Claude Code plugin with 1 SKILL.md + 26 resources, 100+ checklist items, 5 exploit categories, 5 protocol guides, 6 agents, MIT license
- kadenzipfel/smart-contract-vulnerabilities: 39 LLM-optimized `/references/` files with detection heuristics and false positive guidance, MIT license, 2,371 stars
- Trail of Bits skills: OpenCode plugin marketplace, CC-BY-SA-4.0, directly installable via `/plugin marketplace add trailofbits/skills`
- SCVD (api.scvd.dev): REST API, 7,769 findings from 213 reports, SWC/CWE taxonomy, CC0 license, Ethereum Foundation funded
- Cyfrin audit-checklist: Structured JSON (221 items), auto-synced from Solodit, IDs with remediation and references
- SmartBugs curated: 143 annotated vulnerable contracts with `vulnerabilities.json`, Apache-2.0

### Metis Review
**Identified Gaps** (addressed):
- `experimental.chat.system.transform` DOES exist — corrected from initial analysis. Used for global audit context injection.
- Skills delivery from npm requires `config.skills.paths` in config handler to register plugin's skills directory.
- Per-agent tool access confirmed via `tools: { [key: string]: boolean }` in AgentConfig.
- ToolContext provides `abort: AbortSignal` for cancellation support in long-running tools.
- Subagent delegation mechanism: via Task tool or `@subagent` mention in Argus's prompt. Needs prototype validation.

---

## Work Objectives

### Core Objective
Build a production-quality OpenCode plugin that transforms any LLM into a Solidity security auditor with access to professional tooling (Slither, Foundry), a hybrid knowledge base (curated SKILL.md merged from best-in-class external sources + SCVD searchable index with 7,769+ findings), and structured audit workflows.

### Concrete Deliverables
- npm package `opencode-argus` installable via `plugin: ["opencode-argus"]` in `opencode.json`
- 4 registered agents: Argus (primary), Sentinel (subagent), Pythia (subagent), Scribe (subagent)
- 8 registered custom tools with Zod-validated arguments (7 original + `argus_sync_knowledge`)
- Curated SKILL.md knowledge base: merged & deduplicated from DeFiFoFum fork + kadenzipfel + Cyfrin + SmartBugs/DeFiHackLabs
- SCVD local search index with auto-sync pipeline (queryable by SWC/CWE, severity, protocol, keyword)
- Solodit MCP server auto-registered
- Companion plugin documentation for Trail of Bits skills marketplace
- Audit state preserved across session compactions
- Professional markdown audit report generation
- Full test suite (TDD with bun test)

### Definition of Done
- [ ] `bun build` succeeds with zero errors
- [ ] `bun test` passes all tests
- [ ] Plugin loads in OpenCode without errors
- [ ] All 4 agents appear in OpenCode UI (Argus as primary tab, 3 subagents via @mention)
- [ ] All 8 tools callable by agents
- [ ] Curated SKILL.md files present, deduplicated, with valid frontmatter
- [ ] SCVD local index populated and searchable
- [ ] `argus_sync_knowledge` tool syncs from SCVD API + kadenzipfel
- [ ] Solodit MCP registered and functional
- [ ] Full audit workflow executes on a test Foundry project
- [ ] Report generation produces professional markdown output

### Must Have
- Plugin entry point with proper `Plugin` type export
- Config handler registering agents, MCPs, and skills
- All 8 tools with structured JSON returns and error handling (7 original + `argus_sync_knowledge`)
- Agent prompts with audit methodology, severity classification, and delegation instructions
- Compaction hook preserving audit state
- Curated SKILL.md knowledge base: DeFiFoFum content forked and restructured to modular format, merged with kadenzipfel references (39 patterns), Cyfrin checklist (221 items transformed), SmartBugs/DeFiHackLabs code examples — all deduplicated into a single unified set
- SCVD local search index: REST API client for api.scvd.dev, local index (SQLite or JSON) queryable by SWC/CWE/severity/protocol/keyword, auto-sync on plugin init (lightweight freshness check) + manual sync via `argus_sync_knowledge` tool
- Enhanced `argus_check_patterns` tool: queries both SKILL.md patterns AND SCVD local index for comprehensive coverage
- Companion documentation: how to install Trail of Bits skills marketplace alongside Argus (no content duplication)
- DeFiHackLabs exploit PoCs referenced via GitHub URLs (optional git submodule for development only)
- Report template with Executive Summary, Scope, Methodology, Findings by Severity, Recommendations
- Abort signal support in all long-running tools
- Project type auto-detection (Hardhat vs Foundry)
- Attribution: MIT license compliance for DeFiFoFum fork, kadenzipfel content; CC0 for SCVD; Apache-2.0 for SmartBugs

### Must NOT Have (Guardrails)
- NO PDF report generation (v1 is markdown only)
- NO OhO-specific integration hooks (standalone first)
- NO direct Solodit API scraping (use MCP server only for Solodit — SCVD has its own API which IS used directly)
- NO custom UI components or TUI modifications
- NO model-specific prompt tuning (prompts must work across models)
- NO arbitrary background processes — subagent parallelism IS allowed (Argus may dispatch Sentinel and Pythia simultaneously via Task tool with `run_in_background`), but no custom background threads or worker pools
- All vulnerability patterns must be derived from verified real-world sources (DeFiFoFum, kadenzipfel, Cyfrin, SCVD, SmartBugs). AI agents may restructure, merge, and format this content into SKILL.md files, but must NOT fabricate vulnerability descriptions, exploit details, or detection heuristics without a source reference
- NO duplication of Trail of Bits skills content — reference as companion plugin only
- NO `as any`, `@ts-ignore`, or type suppression in TypeScript
- NO hardcoded file paths — all paths relative to project/plugin directory
- NO state stored in global variables — use proper state management patterns

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (greenfield)
- **Automated tests**: TDD (RED → GREEN → REFACTOR)
- **Framework**: bun test
- **Pattern**: Given/When/Then style assertions
- **Setup task**: Test infrastructure setup is Task 1

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Plugin loading | Bash (bun) | Import plugin, verify export type |
| Tool execution | Bash (bun test) | Unit tests with mocked CLI outputs |
| Agent registration | Bash (bun) | Load plugin, check config.agent keys |
| Skills loading | Bash (ls + cat) | Verify SKILL.md files exist with valid frontmatter |
| SCVD index | Bash (bun test) | Test index build, search queries, sync pipeline |
| Knowledge sync | Bash (bun test) | Test sync tool with mocked SCVD API responses |
| MCP registration | Bash (bun) | Load plugin, check config.mcp keys |
| Report generation | Bash (bun test) | Generate report, validate markdown structure |
| Integration | Bash (bun) | Full audit on test fixture project |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — Start Immediately):
├── Task 1: Project scaffold + test infrastructure [quick]
├── Task 2: Plugin config schema + loader [quick]
├── Task 3: Audit state types + finding store [quick]
├── Task 4: Project detector (Hardhat/Foundry) [quick]
├── Task 5: Solidity parser utilities [quick]
└── Task 6: Test fixture Solidity project [quick]

Wave 2 (Core Tools — After Wave 1):
├── Task 7: argus_slither_analyze tool (depends: 1, 4) [deep]
├── Task 8: argus_forge_test tool (depends: 1, 4) [deep]
├── Task 9: argus_forge_fuzz tool (depends: 1, 4) [deep]
├── Task 10: argus_analyze_contract tool (depends: 1, 5) [deep]
├── Task 11: argus_check_patterns tool (depends: 1, 3) [deep]
├── Task 12: argus_solodit_search tool (depends: 1) [unspecified-high]
└── Task 13: argus_generate_report tool (depends: 1, 3) [deep]

Wave 3 (Agents + Hooks — After Wave 2):
├── Task 14: Config handler — agent registration (depends: 2, 7-13) [deep]
├── Task 15: Config handler — MCP + Skills registration (depends: 2) [quick]
├── Task 16: Argus orchestrator prompt (depends: 14) [artistry]
├── Task 17: Sentinel agent prompt (depends: 14) [artistry]
├── Task 18: Pythia agent prompt (depends: 14) [artistry]
├── Task 19: Scribe agent prompt (depends: 14) [artistry]
├── Task 20: System prompt transform hook (depends: 3) [quick]
├── Task 21: Compaction hook — audit state preservation (depends: 3) [unspecified-high]
├── Task 22: Tool tracking hook — finding accumulation (depends: 3) [unspecified-high]
└── Task 23: Event hook — session lifecycle (depends: 3) [quick]

Wave 4a (Knowledge Import + SCVD Pipeline — parallel with Wave 3):
├── Task 24: Fork & restructure DeFiFoFum knowledge base [deep]
├── Task 25: Import & merge kadenzipfel vulnerability references [unspecified-high]
├── Task 26: Import & transform Cyfrin checklist + SmartBugs examples [unspecified-high]
├── Task 27: SCVD sync pipeline + local search index [deep]
└── Task 28: DeFiHackLabs exploit PoC references (GitHub URLs) [quick]

Wave 4b (Dedup + Sync Tool + Docs — After Wave 4a):
├── Task 29: Knowledge deduplication & quality pass (depends: 24-26, 28) [deep]
├── Task 30: argus_sync_knowledge tool + auto-sync hook (depends: 27) [deep]
└── Task 31: Companion plugin docs + knowledge README (depends: 29) [writing]

Wave 5 (Integration + Plugin Assembly — After Waves 3, 4b):
├── Task 32: Plugin entry point assembly (depends: 14-23, 29-31) [deep]
├── Task 33: Integration test — full audit pipeline (depends: 32, 6) [deep]
├── Task 34: Package.json, README, npm publish prep (depends: 32) [quick]
└── Task 35: opencode-argus.jsonc config schema + example (depends: 32) [quick]

Wave FINAL (After ALL tasks — independent review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA — full audit on test project (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 7 → Task 14 → Task 16 → Task 32 → Task 33 → F1-F4
Knowledge Path: Task 24 → Task 29 → Task 31 → Task 32
SCVD Path: Task 27 → Task 30 → Task 32
Max Concurrent: 7 (Wave 2), 5 (Wave 4a)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 7-13 | 1 |
| 2 | — | 14, 15 | 1 |
| 3 | — | 11, 13, 20-23 | 1 |
| 4 | — | 7, 8, 9 | 1 |
| 5 | — | 10 | 1 |
| 6 | — | 33 | 1 |
| 7 | 1, 4 | 14 | 2 |
| 8 | 1, 4 | 14 | 2 |
| 9 | 1, 4 | 14 | 2 |
| 10 | 1, 5 | 14 | 2 |
| 11 | 1, 3 | 14, 30 | 2 |
| 12 | 1 | 14 | 2 |
| 13 | 1, 3 | 14 | 2 |
| 14 | 2, 7-13 | 16-19, 32 | 3 |
| 15 | 2 | 32 | 3 |
| 16-19 | 14 | 32 | 3 |
| 20-23 | 3 | 32 | 3 |
| 24 | — | 29 | 4a |
| 25 | — | 29 | 4a |
| 26 | — | 29 | 4a |
| 27 | 1 | 30 | 4a |
| 28 | — | 29 | 4a |
| 29 | 24-26, 28 | 31, 32 | 4b |
| 30 | 27, 11 | 32 | 4b |
| 31 | 29 | 32 | 4b |
| 32 | 14-23, 29-31 | 33, 34, 35 | 5 |
| 33 | 32, 6 | F1-F4 | 5 |
| 34-35 | 32 | — | 5 |
| F1-F4 | 33 | — | FINAL |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **6** | T1-T6 → `quick` |
| 2 | **7** | T7-T10 → `deep`, T11 → `deep`, T12 → `unspecified-high`, T13 → `deep` |
| 3 | **10** | T14 → `deep`, T15 → `quick`, T16-T19 → `artistry`, T20 → `quick`, T21-T22 → `unspecified-high`, T23 → `quick` |
| 4a | **5** | T24 → `deep`, T25-T26 → `unspecified-high`, T27 → `deep`, T28 → `quick` |
| 4b | **3** | T29 → `deep`, T30 → `deep`, T31 → `writing` |
| 5 | **4** | T32-T33 → `deep`, T34-T35 → `quick` |
| FINAL | **4** | F1 → `oracle`, F2-F3 → `unspecified-high`, F4 → `deep` |

---

## TODOs

- [x] 1. Project Scaffold + Test Infrastructure

  **What to do**:
  - Run `bun init` to create the project
  - Set up `tsconfig.json` with strict mode, ES2022 target, moduleResolution bundler
  - Set up `bunfig.toml` with test configuration
  - Create `src/index.ts` with minimal `Plugin` type export skeleton
  - Install dependencies: `@opencode-ai/plugin`, `zod`
  - Create test setup file (`test-setup.ts`) and verify `bun test` runs
  - Create directory structure: `src/{tools,hooks,state,utils,agents}/`, `skills/`, `tests/fixtures/`

  **Must NOT do**:
  - Do not install any Solidity-specific dependencies (peer deps handled by user)
  - Do not create actual tool/hook implementations yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-6)
  - **Blocks**: Tasks 7-13
  - **Blocked By**: None

  **References**:
  - **Pattern References**: OhO's `package.json` and `tsconfig.json` at https://github.com/code-yeongyu/oh-my-opencode
  - **API References**: OpenCode plugin entry point pattern: `const MyPlugin: Plugin = async (ctx) => { return { tool: {}, config: async (config) => {}, event: async ({ event }) => {} } }`
  - **External References**: `@opencode-ai/plugin` npm package — provides `Plugin` type and `tool()` helper

  **Acceptance Criteria**:
  - [ ] `bun build` exits with code 0
  - [ ] `bun test` runs and reports 0 tests (no tests yet, but harness works)
  - [ ] `src/index.ts` exports a `Plugin`-typed function
  - [ ] All directories created: `src/tools/`, `src/hooks/`, `src/state/`, `src/utils/`, `skills/`, `tests/fixtures/`

  **QA Scenarios**:
  ```
  Scenario: Plugin module exports valid Plugin type
    Tool: Bash (bun)
    Preconditions: Project initialized with dependencies installed
    Steps:
      1. Run `bun build`
      2. Run `bun -e "import p from './src/index.ts'; console.log(typeof p)"`
    Expected Result: Output is "function"
    Evidence: .sisyphus/evidence/task-1-plugin-export.txt

  Scenario: Test infrastructure works
    Tool: Bash (bun test)
    Preconditions: test-setup.ts exists
    Steps:
      1. Create a trivial test file `tests/smoke.test.ts` with `test("smoke", () => expect(true).toBe(true))`
      2. Run `bun test`
    Expected Result: 1 test passes, exit code 0
    Evidence: .sisyphus/evidence/task-1-test-infra.txt
  ```

  **Commit**: YES
  - Message: `chore(scaffold): initialize opencode-argus plugin with TDD infrastructure`
  - Files: `package.json`, `tsconfig.json`, `bunfig.toml`, `src/index.ts`, `test-setup.ts`
  - Pre-commit: `bun test`

---

- [x] 2. Plugin Config Schema + Loader

  **What to do**:
  - Create `src/plugin-config.ts` with Zod schema for `opencode-argus.jsonc` config
  - Schema fields: `agents` (model overrides per agent), `tools` (Slither/Foundry config), `knowledge` (custom patterns dir, `scvd.enabled` boolean default true, `scvd.apiUrl` string default "https://api.scvd.dev", `autoSync` boolean default true, `customSkillsDir` string optional), `reporting` (format, severity threshold, gas analysis), `solodit` (enabled flag)
  - Create `loadArgusConfig()` function that reads project-level and user-level config with defaults
  - Config file locations: `.opencode/opencode-argus.jsonc` (project) and `~/.config/opencode/opencode-argus.jsonc` (global)
  - Write TDD tests first: valid config parsing, default values, partial overrides, invalid config handling

  **Must NOT do**:
  - No OhO-specific config fields
  - No runtime model resolution (just store model preferences)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-6)
  - **Blocks**: Tasks 14, 15
  - **Blocked By**: None

  **References**:
  - **Pattern References**: OhO's `src/plugin-config.ts` — config loading with Zod validation and multi-level merge
  - **API References**: Zod schema patterns — `z.object({}).optional().default({})`
  - **External References**: OpenCode plugin config pattern from docs — JSONC format with `$schema` field

  **Acceptance Criteria**:
  - [ ] `bun test src/plugin-config.test.ts` → PASS (all config tests)
  - [ ] Default config loads when no config file exists
  - [ ] Partial config merges correctly with defaults
  - [ ] Invalid config throws descriptive ZodError

  **QA Scenarios**:
  ```
  Scenario: Default config loads without config file
    Tool: Bash (bun test)
    Steps:
      1. Call `loadArgusConfig("/nonexistent/path")`
      2. Assert all fields have default values
    Expected Result: Config object with all defaults populated
    Evidence: .sisyphus/evidence/task-2-default-config.txt

  Scenario: Invalid config throws descriptive error
    Tool: Bash (bun test)
    Steps:
      1. Pass config with `agents.argus.model: 123` (wrong type)
      2. Assert ZodError is thrown with field path
    Expected Result: ZodError with message containing "agents.argus.model"
    Evidence: .sisyphus/evidence/task-2-invalid-config.txt
  ```

  **Commit**: NO (groups with Wave 1)

---

- [x] 3. Audit State Types + Finding Store

  **What to do**:
  - Create `src/state/types.ts` with TypeScript interfaces: `AuditState`, `Finding`, `FindingSeverity`, `AuditPhase`, `ContractProfile`, `ToolExecution`
  - Create `src/state/audit-state.ts` — in-memory audit state manager (singleton per session)
  - Create `src/state/finding-store.ts` — finding accumulation, deduplication (by check+file+line), severity classification
  - `AuditState`: contracts reviewed, findings list, tools executed, current phase, scope, start time
  - `Finding`: id, check name, severity, confidence, description, file, lines, source (slither/manual/pattern), remediation
  - `FindingSeverity`: Critical | High | Medium | Low | Informational
  - Write TDD tests: finding creation, dedup logic, severity filtering, state transitions

  **Must NOT do**:
  - No file-based persistence yet (that's hooks' job)
  - No global state — use factory pattern returning state instances

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4-6)
  - **Blocks**: Tasks 11, 13, 20-23
  - **Blocked By**: None

  **References**:
  - **Pattern References**: OhO's `src/plugin-state.ts` — state management with factory pattern
  - **API References**: Slither's detector result schema: `{ check, impact, confidence, description, elements: [{ source_mapping: { filename_relative, lines } }] }`

  **Acceptance Criteria**:
  - [ ] `bun test src/state/` → PASS
  - [ ] Finding dedup correctly identifies duplicate findings (same check + file + line range)
  - [ ] Severity filtering returns correct subsets
  - [ ] State serialization works (for compaction hook)

  **QA Scenarios**:
  ```
  Scenario: Finding deduplication works correctly
    Tool: Bash (bun test)
    Steps:
      1. Add finding: reentrancy-eth at Vault.sol:10-15
      2. Add same finding again: reentrancy-eth at Vault.sol:10-15
      3. Assert store.findings.length === 1
    Expected Result: Single finding, duplicate rejected
    Evidence: .sisyphus/evidence/task-3-dedup.txt

  Scenario: State serializes for compaction
    Tool: Bash (bun test)
    Steps:
      1. Create state with 3 findings, 2 contracts reviewed
      2. Call state.serialize()
      3. Assert output is valid string containing contracts and finding counts
    Expected Result: Serialized string with "Contracts: 2, Findings: 3"
    Evidence: .sisyphus/evidence/task-3-serialize.txt
  ```

  **Commit**: NO (groups with Wave 1)

---

- [x] 4. Project Detector (Hardhat/Foundry)

  **What to do**:
  - Create `src/utils/project-detector.ts`
  - Detect project type by checking for: `foundry.toml` (Foundry), `hardhat.config.js/ts` (Hardhat), both (mixed)
  - Parse `foundry.toml` for: src directory, test directory, remappings, solc version
  - Parse `hardhat.config.js/ts` for: paths, solidity version, networks
  - Read `remappings.txt` if present
  - Return `ProjectConfig` object: `{ type: 'foundry' | 'hardhat' | 'mixed' | 'unknown', srcDir, testDir, solcVersion, remappings }`
  - TDD tests with fixture directories

  **Must NOT do**:
  - No npm install or dependency management
  - No compilation — just detection and config parsing

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5-6)
  - **Blocks**: Tasks 7, 8, 9
  - **Blocked By**: None

  **References**:
  - **External References**: Foundry docs — `foundry.toml` config options. Slither's framework detection logic.

  **Acceptance Criteria**:
  - [ ] `bun test src/utils/project-detector.test.ts` → PASS
  - [ ] Correctly detects Foundry project from `foundry.toml`
  - [ ] Correctly detects Hardhat project from `hardhat.config.ts`
  - [ ] Returns `unknown` for projects without framework config

  **QA Scenarios**:
  ```
  Scenario: Detects Foundry project
    Tool: Bash (bun test)
    Steps:
      1. Create temp dir with foundry.toml containing `src = "src"`, `test = "test"`
      2. Call detectProject(tempDir)
      3. Assert result.type === "foundry" and result.srcDir === "src"
    Expected Result: { type: "foundry", srcDir: "src", testDir: "test" }
    Evidence: .sisyphus/evidence/task-4-foundry-detect.txt

  Scenario: Returns unknown for empty directory
    Tool: Bash (bun test)
    Steps:
      1. Create empty temp dir
      2. Call detectProject(tempDir)
    Expected Result: { type: "unknown" }
    Evidence: .sisyphus/evidence/task-4-unknown-detect.txt
  ```

  **Commit**: NO (groups with Wave 1)

---

- [x] 5. Solidity Parser Utilities

  **What to do**:
  - Create `src/utils/solidity-parser.ts`
  - Functions: `extractContractInfo(filePath)` using `forge inspect <contract> abi` and `forge inspect <contract> storage-layout`
  - Parse ABI to extract: public/external functions, state variables, events, modifiers
  - Detect patterns: Ownable, AccessControl, ReentrancyGuard, Pausable (by checking inheritance/imports)
  - Map external call targets from ABI + source reading
  - Return `ContractProfile`: functions (with visibility/mutability), state vars, events, inheritance, access control pattern, external calls
  - TDD with fixture Solidity contracts

  **Must NOT do**:
  - No custom Solidity parser — use `forge inspect` output
  - No compilation — assume project is already compiled

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4, 6)
  - **Blocks**: Task 10
  - **Blocked By**: None

  **References**:
  - **External References**: `forge inspect Counter abi` returns JSON ABI array. `forge inspect Counter storage-layout` returns storage slot info.

  **Acceptance Criteria**:
  - [ ] `bun test src/utils/solidity-parser.test.ts` → PASS
  - [ ] Correctly extracts function signatures with visibility
  - [ ] Detects Ownable/AccessControl patterns
  - [ ] Handles `forge inspect` failures gracefully

  **QA Scenarios**:
  ```
  Scenario: Extracts function signatures from ABI
    Tool: Bash (bun test)
    Steps:
      1. Mock `forge inspect` output with sample ABI JSON
      2. Call extractContractInfo("Counter")
      3. Assert functions array contains { name: "increment", visibility: "external", mutability: "nonpayable" }
    Expected Result: ContractProfile with correct function list
    Evidence: .sisyphus/evidence/task-5-abi-parse.txt

  Scenario: Handles forge inspect failure gracefully
    Tool: Bash (bun test)
    Steps:
      1. Mock `forge inspect` to return error (non-zero exit)
      2. Call extractContractInfo("NonExistent")
    Expected Result: Returns empty ContractProfile with error field set, no throw
    Evidence: .sisyphus/evidence/task-5-forge-error.txt
  ```

  **Commit**: NO (groups with Wave 1)

---

- [x] 6. Test Fixture Solidity Project

  **What to do**:
  - Create `tests/fixtures/vulnerable-vault/` — a minimal Foundry project with intentional vulnerabilities
  - Include `foundry.toml` with standard config
  - Create contracts:
    - `VulnerableVault.sol` — reentrancy vulnerability (external call before state update), missing access control on withdraw
    - `Token.sol` — basic ERC20 with no return value on transfer (non-standard)
    - `PriceOracle.sol` — manipulable price oracle using single source
    - `GovernanceToken.sol` — missing time lock on governance actions
  - Create basic test file `VulnerableVault.t.sol` that compiles but doesn't catch the vulnerabilities
  - Ensure `forge build` compiles the project
  - These fixtures are used by integration tests in Task 33

  **Must NOT do**:
  - No complex DeFi protocol — keep it simple and educational
  - No external dependencies (OpenZeppelin etc.) — inline simple implementations

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-5)
  - **Blocks**: Task 33
  - **Blocked By**: None

  **References**:
  - **External References**: SmartBugs curated dataset (https://github.com/smartbugs/smartbugs-curated) — examples of vulnerable contracts. Trail of Bits building-secure-contracts examples.

  **Acceptance Criteria**:
  - [ ] `forge build` in `tests/fixtures/vulnerable-vault/` succeeds
  - [ ] At least 4 distinct vulnerabilities present across contracts
  - [ ] Slither finds at least 3 issues when run against this project
  - [ ] `forge test` passes (tests exist but don't catch vulns)

  **QA Scenarios**:
  ```
  Scenario: Fixture project compiles
    Tool: Bash (forge)
    Preconditions: Foundry installed
    Steps:
      1. cd tests/fixtures/vulnerable-vault/
      2. Run `forge build`
    Expected Result: Build succeeds, all 4 contracts compile
    Evidence: .sisyphus/evidence/task-6-forge-build.txt

  Scenario: Slither finds vulnerabilities in fixtures
    Tool: Bash (slither)
    Preconditions: Slither installed
    Steps:
      1. cd tests/fixtures/vulnerable-vault/
      2. Run `slither . --json -`
      3. Parse JSON, count detectors with impact High or Critical
    Expected Result: At least 3 findings with impact >= High
    Evidence: .sisyphus/evidence/task-6-slither-findings.txt
  ```

  **Commit**: YES (with Wave 1 group)
  - Message: `feat(core): add config schema, types, project detector, parser utils, test fixtures`
  - Pre-commit: `bun test`

- [x] 7. `argus_slither_analyze` Tool

  **What to do**:
  - Create `src/tools/slither-tool.ts` using `tool()` helper from `@opencode-ai/plugin`
  - Args (Zod): `target` (string, file/dir/"."), `detectors` (string[] optional), `exclude` (string[] optional), `solc_version` (string optional)
  - Execute: spawn `slither <target> --json -` with optional `--detectors`, `--exclude-detectors`, `--filter-paths node_modules`
  - Parse JSON output: extract `results.detectors[]`, map each to `Finding` type from Task 3
  - Categorize by severity: map Slither's `impact` field (High/Medium/Low/Informational) to our `FindingSeverity`
  - Handle errors: compilation failure (exit 1), analysis error (exit 2), slither not installed, timeout
  - Support `context.abort` (AbortSignal) for cancellation
  - Use `context.metadata()` to set descriptive title in UI
  - Return structured summary: `{ success, findingsCount, findings: [...], executionTime, errors }`
  - TDD: mock Slither CLI output, test parsing, error handling, abort

  **Must NOT do**:
  - No direct Python API calls — CLI wrapper only
  - No Slither installation management

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8-13)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 1, 4

  **References**:
  - **Pattern References**: OhO's tool pattern: `tool({ description, args: { param: tool.schema.string() }, async execute(args, context) { ... } })`
  - **API References**: Slither JSON output: `{ success: bool, error: string|null, results: { detectors: [{ check, impact, confidence, description, elements }] } }`
  - **External References**: Slither detectors list: https://github.com/crytic/slither/wiki/Detector-Documentation

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/slither-tool.test.ts` → PASS
  - [ ] Parses real Slither JSON output correctly
  - [ ] Returns structured findings with severity classification
  - [ ] Handles "slither not found" gracefully (descriptive error message)
  - [ ] Handles compilation errors gracefully
  - [ ] Respects AbortSignal for cancellation

  **QA Scenarios**:
  ```
  Scenario: Parses Slither JSON output correctly
    Tool: Bash (bun test)
    Steps:
      1. Mock Slither output with 3 findings (1 High, 1 Medium, 1 Low)
      2. Call tool execute with target "."
      3. Assert result.findingsCount === 3
      4. Assert findings are correctly categorized by severity
    Expected Result: 3 findings with correct severity mapping
    Evidence: .sisyphus/evidence/task-7-slither-parse.txt

  Scenario: Handles Slither not installed
    Tool: Bash (bun test)
    Steps:
      1. Mock process spawn to return ENOENT
      2. Call tool execute
    Expected Result: Returns { success: false, error: "Slither not found. Install with: pip install slither-analyzer" }
    Evidence: .sisyphus/evidence/task-7-slither-missing.txt
  ```

  **Commit**: NO (groups with Wave 2)

---

- [x] 8. `argus_forge_test` Tool

  **What to do**:
  - Create `src/tools/forge-test-tool.ts`
  - Args (Zod): `match_test` (string optional), `match_contract` (string optional), `fork_url` (string optional), `verbosity` (number 1-5, default 3), `gas_report` (boolean optional), `coverage` (boolean optional, default false)
  - Execute: spawn `forge test` with `--json`, optional `--match-test`, `--match-contract`, `--fork-url`, `-v{n}`, `--gas-report`
  - When `coverage` is true: additionally run `forge coverage --report json`, parse output into `coverageReport` field
    - Coverage report structure: per-file line/branch/function coverage percentages
    - Identify functions with 0% coverage — these are high-priority audit targets
  - Parse JSON test results: test name, status (pass/fail), gas used, type (unit/fuzz)
  - For fuzz tests: capture runs count, mean/median gas
  - Support `context.abort` for cancellation
  - Return: `{ summary: { passed, failed, skipped, total }, tests: [...], gasReport?: {...}, coverageReport?: { files: [{ path, lines, branches, functions, uncoveredFunctions: string[] }] }, executionTime }`
  - TDD: mock forge output, test parsing, error cases

  **Must NOT do**:
  - No test file creation — just execution
  - No test result storage — just return to agent

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 9-13)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 1, 4

  **References**:
  - **API References**: `forge test --json` output: `{ tests: [{ name, status, gas, type }], summary: { passed, failed, skipped, total } }`
  - **External References**: Foundry docs — forge test CLI flags

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/forge-test-tool.test.ts` → PASS
  - [ ] Correctly parses test results with pass/fail counts
  - [ ] Gas report parsing works when enabled
  - [ ] Coverage report parsing works: identifies files, percentages, uncovered functions
  - [ ] Handles forge not installed error

  **QA Scenarios**:
  ```
  Scenario: Parses forge test JSON output
    Tool: Bash (bun test)
    Steps:
      1. Mock forge test --json output with 5 tests (3 pass, 1 fail, 1 skip)
      2. Assert summary.passed === 3, summary.failed === 1
    Expected Result: Correct test summary
    Evidence: .sisyphus/evidence/task-8-forge-test.txt

  Scenario: Coverage report identifies uncovered functions
    Tool: Bash (bun test)
    Steps:
      1. Mock forge coverage --report json output with 3 files (80%, 50%, 0% coverage)
      2. Call tool with coverage=true
      3. Assert coverageReport.files has 3 entries
      4. Assert file with 0% has uncoveredFunctions listing all function names
    Expected Result: Coverage report with per-file percentages and uncovered function names
    Evidence: .sisyphus/evidence/task-8-forge-coverage.txt

  Scenario: Handles forge not installed
    Tool: Bash (bun test)
    Steps:
      1. Mock process spawn to return ENOENT
    Expected Result: { success: false, error: "Foundry not found. Install: curl -L https://foundry.paradigm.xyz | bash" }
    Evidence: .sisyphus/evidence/task-8-forge-missing.txt
  ```

  **Commit**: NO (groups with Wave 2)

---

- [x] 9. `argus_forge_fuzz` Tool

  **What to do**:
  - Create `src/tools/forge-fuzz-tool.ts`
  - Args (Zod): `match_test` (string optional), `runs` (number default 256, max 10000), `seed` (number optional), `fork_url` (string optional)
  - Execute: spawn `forge test` with fuzz config (FOUNDRY_FUZZ_RUNS env var or foundry.toml override)
  - Capture counterexamples from verbose output when tests fail
  - Parse counterexample format: extract failing inputs, revert reasons
  - Return: `{ results: [...], counterexamples: [{ testName, inputs, revertReason }], totalRuns, executionTime }`
  - TDD: mock fuzz output with counterexamples

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-8, 10-13)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 1, 4

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/forge-fuzz-tool.test.ts` → PASS
  - [ ] Counterexample extraction works from verbose output
  - [ ] Respects max runs limit (10000)

  **QA Scenarios**:
  ```
  Scenario: Extracts counterexamples from fuzz failures
    Tool: Bash (bun test)
    Steps:
      1. Mock forge output with fuzz failure: "Counterexample: amount=0"
      2. Assert counterexamples array has 1 entry with inputs.amount === "0"
    Expected Result: Parsed counterexample with test name and failing input
    Evidence: .sisyphus/evidence/task-9-fuzz-counterexample.txt
  ```

  **Commit**: NO (groups with Wave 2)

---

- [x] 10. `argus_analyze_contract` Tool

  **What to do**:
  - Create `src/tools/contract-analyzer-tool.ts`
  - Args (Zod): `file_path` (string, path to .sol file)
  - Execute: Use `forge inspect` to extract ABI, storage layout, method signatures
  - Parse Solidity source file to identify: imports, inheritance chain, modifiers used, external call targets
  - Use parser utilities from Task 5
  - Detect access control patterns: Ownable, AccessControl, custom modifiers
  - Map state-changing functions and their protection (which modifiers guard them)
  - Identify delegatecall usage, selfdestruct, and assembly blocks
  - Return: `ContractProfile` with functions, state vars, inheritance, access control, external calls, risk indicators
  - TDD with fixture contracts

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-9, 11-13)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 1, 5

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/contract-analyzer-tool.test.ts` → PASS
  - [ ] Extracts all public/external functions with correct visibility
  - [ ] Detects Ownable pattern from inheritance
  - [ ] Identifies unprotected state-changing functions

  **QA Scenarios**:
  ```
  Scenario: Analyzes VulnerableVault contract
    Tool: Bash (bun test)
    Steps:
      1. Point analyzer at fixture VulnerableVault.sol
      2. Assert external functions include "withdraw" with no access modifier
      3. Assert risk indicators include "unprotected-state-change"
    Expected Result: ContractProfile with withdraw flagged as unprotected
    Evidence: .sisyphus/evidence/task-10-analyze-vault.txt
  ```

  **Commit**: NO (groups with Wave 2)

---

- [x] 11. `argus_check_patterns` Tool

  **What to do**:
  - Create `src/tools/pattern-checker-tool.ts`
  - Args (Zod): `target` (string, file/dir), `patterns` (string[] optional — categories to check)
  - Load matching SKILL.md files from knowledge base (read the pattern files)
  - Match contract source code against known vulnerability signatures
  - Pattern categories: reentrancy, oracle-manipulation, flash-loan, access-control, erc4626, delegatecall, signature-replay, front-running, donation-attack, price-manipulation
  - For each match: extract code location, pattern name, severity, real-world exploit reference
  - Pattern matching strategy: regex-based code pattern detection + AST-aware checks using forge inspect data
  - **Design with extensible MatchSource interface**:
    - Define `MatchSource` type: `{ source: string, matches: Match[] }` where `Match` = `{ pattern, severity, file, lines, description, exploitReference }`
    - Return: `{ sources: MatchSource[], patternsChecked, executionTime }` — each source is a separate entry
    - Initial implementation: single source `{ source: "pattern-db", matches: [...] }`
    - Task 30 adds `{ source: "scvd", matches: [...] }` via the same interface without modifying existing code
    - Args include `include_scvd` (boolean, default true) — ignored in this task, wired by Task 30
  - TDD with fixture contracts

  **Must NOT do**:
  - No ML-based pattern detection — deterministic regex/AST matching only
  - No false positive suppression — report all matches
  - No SCVD query logic in this task — only define the extensible interface; Task 30 plugs in the SCVD source

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-10, 12-13)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 1, 3

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/pattern-checker-tool.test.ts` → PASS
  - [ ] Detects reentrancy pattern in VulnerableVault fixture
  - [ ] Returns matches with file location and severity
  - [ ] Handles missing pattern files gracefully

  **QA Scenarios**:
  ```
  Scenario: Detects reentrancy pattern
    Tool: Bash (bun test)
    Steps:
      1. Run pattern checker on VulnerableVault.sol with patterns=["reentrancy"]
      2. Assert matches array has at least 1 entry
      3. Assert match severity is "High"
    Expected Result: Reentrancy match found with High severity
    Evidence: .sisyphus/evidence/task-11-reentrancy-pattern.txt
  ```

  **Commit**: NO (groups with Wave 2)

---

- [x] 12. `argus_solodit_search` Tool

  **What to do**:
  - Create `src/tools/solodit-search-tool.ts`
  - Args (Zod): `query` (string), `severity` (string[] optional), `limit` (number default 10)
  - This tool acts as a convenience wrapper — it calls the Solodit MCP server's `search_findings` tool
  - If Solodit MCP is available: proxy the search request to MCP tool
  - If Solodit MCP is NOT available: return helpful error message explaining how to enable it
  - Parse and format Solodit results: title, severity, description, protocol, remediation
  - Cross-reference results with current audit context (mention if finding matches contracts in scope)
  - Return: `{ results: [{ title, severity, description, protocol, url, remediation }], totalFound, query }`
  - TDD: mock MCP responses

  **Must NOT do**:
  - No direct Solodit API scraping — MCP server only
  - No caching of Solodit results

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-11, 13)
  - **Blocks**: Task 14
  - **Blocked By**: Task 1

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/solodit-search-tool.test.ts` → PASS
  - [ ] Returns formatted results from MCP response
  - [ ] Handles MCP not available gracefully

  **QA Scenarios**:
  ```
  Scenario: Formats Solodit MCP results
    Tool: Bash (bun test)
    Steps:
      1. Mock MCP response with 3 vulnerability entries
      2. Call tool with query "reentrancy ERC4626"
      3. Assert results formatted with title, severity, description
    Expected Result: 3 formatted vulnerability results
    Evidence: .sisyphus/evidence/task-12-solodit-search.txt

  Scenario: Handles MCP not available
    Tool: Bash (bun test)
    Steps:
      1. Simulate MCP connection failure
    Expected Result: Helpful error: "Solodit MCP not available. Add to opencode.json: ..."
    Evidence: .sisyphus/evidence/task-12-solodit-unavailable.txt
  ```

  **Commit**: NO (groups with Wave 2)

---

- [x] 13. `argus_generate_report` Tool

  **What to do**:
  - Create `src/tools/report-generator-tool.ts`
  - Args (Zod): `project_name` (string), `scope` (string[] — contracts in scope), `include_executive_summary` (boolean default true), `severity_threshold` (string default "low")
  - Read accumulated findings from audit state (Task 3)
  - Deduplicate and correlate findings across tools (Slither + patterns + manual)
  - Generate professional markdown report following this structure:
    1. **Executive Summary** — Overview, risk assessment, key findings count by severity
    2. **Scope** — Contracts audited, commit hash, framework
    3. **Methodology** — Tools used, approach taken
    4. **Findings** — Grouped by severity (Critical → Informational), each with: ID, title, severity, location, description, impact, PoC (if available), recommendation
    5. **Recommendations** — Prioritized action items
    6. **Appendix** — Tool outputs, gas analysis (if available)
  - Return: `{ report: string (markdown), findingsCount: { critical, high, medium, low, informational }, filename: string }`
  - TDD: test report generation with mock findings

  **Must NOT do**:
  - No PDF generation (v1 is markdown only)
  - No file writing — return markdown string for the agent to write

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-12)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 1, 3

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/report-generator-tool.test.ts` → PASS
  - [ ] Report contains all 5 sections (Executive Summary through Recommendations)
  - [ ] Findings correctly grouped by severity
  - [ ] Report markdown renders correctly

  **QA Scenarios**:
  ```
  Scenario: Generates report with correct structure
    Tool: Bash (bun test)
    Steps:
      1. Populate audit state with 5 findings (1 Critical, 2 High, 1 Medium, 1 Low)
      2. Call generate report for "TestVault" project
      3. Assert markdown contains "# Executive Summary", "## Critical", "## High"
      4. Assert findings count matches: critical=1, high=2, medium=1, low=1
    Expected Result: Complete markdown report with all sections
    Evidence: .sisyphus/evidence/task-13-report-gen.txt

  Scenario: Severity threshold filters findings
    Tool: Bash (bun test)
    Steps:
      1. Set severity_threshold to "medium"
      2. Assert Low and Informational findings excluded from report
    Expected Result: Report only contains Critical, High, Medium findings
    Evidence: .sisyphus/evidence/task-13-severity-filter.txt
  ```

  **Commit**: YES
  - Message: `feat(tools): implement all 7 custom audit tools`
  - Pre-commit: `bun test`

- [x] 14. Config Handler — Agent Registration

  **What to do**:
  - Create `src/hooks/config-handler.ts`
  - Implement `config` handler function that mutates the OpenCode config object
  - Create `src/constants/defaults.ts` with:
    ```typescript
    export const DEFAULT_MODELS = {
      argus: "anthropic/claude-opus-4-6",
      sentinel: "anthropic/claude-sonnet-4-6",
      pythia: "anthropic/claude-sonnet-4-6",
      scribe: "anthropic/claude-sonnet-4-5-20250929",
    } as const
    ```
  - Register 4 agents in `config.agent` using defaults:
    - `argus`: `{ mode: "primary", model: DEFAULT_MODELS.argus, description: "Solidity security auditor — the All-Seeing Guardian", prompt: "...", tools: { argus_*: true }, temperature: 0.1 }`
    - `sentinel`: `{ mode: "subagent", model: DEFAULT_MODELS.sentinel, description: "Static analysis and testing specialist — finds vulnerabilities through Slither and Foundry", prompt: "...", tools: { argus_slither_analyze: true, argus_forge_test: true, argus_forge_fuzz: true, argus_analyze_contract: true, argus_check_patterns: true } }`
    - `pythia`: `{ mode: "subagent", model: DEFAULT_MODELS.pythia, description: "Vulnerability researcher — searches Solodit, knowledge base, and web for known exploits", prompt: "...", tools: { argus_solodit_search: true, argus_check_patterns: true } }`
    - `scribe`: `{ mode: "subagent", model: DEFAULT_MODELS.scribe, description: "Audit report writer — generates professional markdown reports", prompt: "...", tools: { argus_generate_report: true } }`
  - Use agent prompts from Tasks 16-19 (placeholder until those complete)
  - Apply model overrides from plugin config (Task 2): `argusConfig.agents?.argus?.model ?? DEFAULT_MODELS.argus` etc.
  - Preserve existing `config.agent` entries (spread operator)
  - TDD: test that config handler adds all 4 agents correctly

  **Must NOT do**:
  - No OhO-specific agent registration patterns
  - No model resolution logic beyond simple override
  - Do not modify existing agents (build, plan, etc.)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 15-23)
  - **Blocks**: Tasks 16-19, 32
  - **Blocked By**: Tasks 2, 7-13

  **References**:
  - **Pattern References**: OhO's `agent-config-handler.ts` — `params.config.agent = { ...agentConfig, ...builtinAgents }`
  - **API References**: `AgentConfig` from `@opencode-ai/sdk`: `{ model?, prompt?, mode?, hidden?, description?, tools?, permission?, temperature?, steps? }`

  **Acceptance Criteria**:
  - [ ] `bun test src/hooks/config-handler.test.ts` → PASS
  - [ ] config.agent contains "argus", "sentinel", "pythia", "scribe" after handler runs
  - [ ] Argus has mode "primary", others have mode "subagent"
  - [ ] Model overrides from plugin config are applied
  - [ ] Existing config.agent entries are preserved

  **QA Scenarios**:
  ```
  Scenario: Registers all 4 agents
    Tool: Bash (bun test)
    Steps:
      1. Call config handler with empty config object
      2. Assert config.agent has keys: argus, sentinel, pythia, scribe
      3. Assert argus.mode === "primary"
      4. Assert sentinel.mode === "subagent"
    Expected Result: 4 agents registered with correct modes
    Evidence: .sisyphus/evidence/task-14-agent-registration.txt

  Scenario: Model overrides applied from plugin config
    Tool: Bash (bun test)
    Steps:
      1. Set plugin config with agents.argus.model = "openai/gpt-5.2"
      2. Call config handler
      3. Assert config.agent.argus.model === "openai/gpt-5.2"
    Expected Result: Custom model applied to Argus agent
    Evidence: .sisyphus/evidence/task-14-model-override.txt
  ```

  **Commit**: YES
  - Message: `feat(config): register agents, MCPs, and skills via config handler`
  - Pre-commit: `bun test`

---

- [x] 15. Config Handler — MCP + Skills Registration

  **What to do**:
  - Extend `src/hooks/config-handler.ts` (or create `src/hooks/mcp-skills-handler.ts`)
  - Register Solodit MCP in `config.mcp`:
    ```typescript
    config.mcp = { ...(config.mcp ?? {}), "solodit-mcp": { type: "local", command: ["npx", "-y", "@lyuboslavlyubenov/solodit-mcp"], enabled: argusConfig.solodit?.enabled ?? true, timeout: 10000 } }
    ```
  - Register Skills directory in `config.skills.paths`:
    - Resolve the plugin's `skills/` directory path (relative to the installed npm package)
    - Append to existing paths: `config.skills = { ...config.skills, paths: [...(config.skills?.paths ?? []), pluginSkillsDir] }`
  - Optionally register `config.skills.urls` for remote skill repos if configured in plugin config
  - Add companion plugin guidance in agent prompts: mention Trail of Bits skills marketplace as recommended companion (`/plugin marketplace add trailofbits/skills`)
  - Respect plugin config `solodit.enabled` flag
  - TDD: test MCP and skills registration

  **Must NOT do**:
  - No Solodit API key management (MCP handles auth)
  - No skill content creation (that's Tasks 24-31)
  - No Trail of Bits content bundling — reference as companion plugin only

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 14, 16-23)
  - **Blocks**: Task 32
  - **Blocked By**: Task 2

  **References**:
  - **Pattern References**: OhO's `mcp-config-handler.ts` — `config.mcp = { ...builtinMcps, ...userMcp }`
  - **API References**: MCP config: `{ type: "local", command: string[], enabled: boolean, timeout: number }`

  **Acceptance Criteria**:
  - [ ] `bun test` → PASS
  - [ ] config.mcp contains "solodit-mcp" entry
  - [ ] config.skills.paths includes plugin's skills directory
  - [ ] Solodit MCP disabled when config says so

  **QA Scenarios**:
  ```
  Scenario: Registers Solodit MCP
    Tool: Bash (bun test)
    Steps:
      1. Call config handler with empty config
      2. Assert config.mcp["solodit-mcp"] exists
      3. Assert command includes "solodit-mcp"
    Expected Result: MCP registered with correct command
    Evidence: .sisyphus/evidence/task-15-mcp-registration.txt
  ```

  **Commit**: NO (groups with Task 14)

---

- [x] 16. Argus Orchestrator Prompt

  **What to do**:
  - Create `src/agents/argus-prompt.ts` — exports the Argus system prompt string
  - Prompt content must include:
    - **Identity**: "You are Argus Panoptes, the All-Seeing Guardian" — orchestrator role
    - **Methodology**: 7-step audit methodology (Reconnaissance → Automated Scanning → Manual Review → Attack Surface Mapping → Vulnerability Research → Testing → Reporting)
    - **Severity Classification**: Critical/High/Medium/Low/Informational with clear definitions
    - **Delegation Instructions**: When and how to delegate to Sentinel (@sentinel for analysis/testing), Pythia (@pythia for research), Scribe (@scribe for reporting). Include parallel dispatch guidance: Sentinel and Pythia CAN run simultaneously (independent tasks), Scribe runs AFTER findings are collected.
    - **Tool Awareness**: List of available tools and when to use each
    - **Key Principles**: Never assume safety, check every access control, trace fund flows, consider multi-tx attacks, checks-effects-interactions, second-order effects
    - **Output Format**: Structured finding format the agent should follow
    - **Fallback Procedures**: When Slither unavailable → proceed with manual review via `argus_analyze_contract` + `argus_check_patterns`, note limitation in report. Forge unavailable → skip testing phase, flag in report. SCVD API offline → use cached index, note staleness. Any tool timeout → report partial results with caveat, don't retry automatically.
  - Prompt should be comprehensive but focused (target: 3000-5000 tokens)
  - Export as function that can be parameterized if needed
  - NO TDD for prompts — prompts are verified via integration tests

  **Must NOT do**:
  - No model-specific tuning — prompt must work across models
  - No hardcoded file paths or project references
  - No OhO references (Sisyphus, etc.)

  **Recommended Agent Profile**:
  - **Category**: `artistry`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 14-15, 17-23)
  - **Blocks**: Task 32
  - **Blocked By**: Task 14

  **References**:
  - **Pattern References**: Original planning doc's System Prompt Injection section (lines 223-264) — good foundation for methodology and principles
  - **External References**: Trail of Bits building-secure-contracts — audit methodology. BailSec report structure — professional audit patterns.

  **Acceptance Criteria**:
  - [ ] Prompt string exported from `src/agents/argus-prompt.ts`
  - [ ] Contains all 7 methodology steps
  - [ ] Contains severity classification definitions
  - [ ] Contains delegation instructions for all 3 subagents
  - [ ] Token count between 3000-5000

  **Commit**: NO (groups with Wave 3)

---

- [x] 17. Sentinel Agent Prompt

  **What to do**:
  - Create `src/agents/sentinel-prompt.ts`
  - Sentinel is the merged Medusa+Hoplite — vulnerability finder via tools
  - Prompt content:
    - **Identity**: "You are Sentinel — the guardian who finds vulnerabilities through rigorous analysis and testing"
    - **Capabilities**: Slither static analysis, Forge testing, Forge fuzzing, contract analysis, pattern checking
    - **Workflow**: Run Slither first for broad scan → analyze specific contracts → run targeted tests → fuzz suspicious functions → check against pattern database
    - **Output Format**: Return findings in structured format: `[SEVERITY] Finding Title | File:Lines | Description | Impact | Recommendation`
    - **Tool Usage Guide**: When to use each tool, what arguments to use, how to interpret results
  - Target: 2000-3000 tokens

  **Recommended Agent Profile**:
  - **Category**: `artistry`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 14

  **Acceptance Criteria**:
  - [ ] Prompt exported from `src/agents/sentinel-prompt.ts`
  - [ ] Contains tool usage guide for all 5 analysis tools
  - [ ] Contains structured output format

  **Commit**: NO (groups with Wave 3)

---

- [x] 18. Pythia Agent Prompt

  **What to do**:
  - Create `src/agents/pythia-prompt.ts`
  - Pythia is the research specialist
  - Prompt content:
    - **Identity**: "You are Pythia — the Oracle who consults the knowledge bases and vulnerability databases"
    - **Capabilities**: Solodit search, pattern checking, Skills knowledge loading
    - **Workflow**: Research known exploits → cross-reference with current contracts → identify applicable attack vectors → provide historical context
    - **Research Strategy**: Start broad (protocol type) → narrow (specific patterns) → deep-dive (exploit case studies)
    - **Output Format**: Research findings with severity assessment, real-world precedents, and applicability analysis
  - Target: 1500-2500 tokens

  **Recommended Agent Profile**:
  - **Category**: `artistry`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 14

  **Acceptance Criteria**:
  - [ ] Prompt exported from `src/agents/pythia-prompt.ts`
  - [ ] Contains research workflow and strategy
  - [ ] References Solodit search and Skills system

  **Commit**: NO (groups with Wave 3)

---

- [x] 19. Scribe Agent Prompt

  **What to do**:
  - Create `src/agents/scribe-prompt.ts`
  - Scribe is the report writer
  - Prompt content:
    - **Identity**: "You are Scribe — the historian who transforms raw findings into professional audit reports"
    - **Capabilities**: Report generation tool, finding aggregation
    - **Report Structure**: Executive Summary → Scope → Methodology → Findings (by severity) → Recommendations → Appendix
    - **Writing Style**: Professional, concise, actionable. Each finding: clear description, root cause, impact assessment, PoC (if available), specific remediation steps
    - **Quality Standards**: No ambiguous language, every finding must be verifiable, recommendations must be specific code changes
  - Target: 1500-2500 tokens

  **Recommended Agent Profile**:
  - **Category**: `artistry`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 14

  **Acceptance Criteria**:
  - [ ] Prompt exported from `src/agents/scribe-prompt.ts`
  - [ ] Contains report structure template
  - [ ] Contains writing quality standards

  **Commit**: NO (groups with Wave 3)

---

- [x] 20. System Prompt Transform Hook

  **What to do**:
  - Create `src/hooks/system-prompt-hook.ts`
  - Implement `experimental.chat.system.transform` hook
  - Inject global audit context into ALL agents when audit is active:
    - Severity classification definitions
    - Current audit state summary (contracts in scope, findings so far, current phase)
    - Available Argus tools list with brief descriptions
  - Only inject when working on Solidity projects (check for foundry.toml or hardhat.config)
  - Keep injection concise (500-800 tokens max)
  - TDD: test injection content and conditional logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] `bun test src/hooks/system-prompt-hook.test.ts` → PASS
  - [ ] System prompt contains severity definitions
  - [ ] System prompt contains current audit state
  - [ ] No injection when project is not Solidity

  **Commit**: NO (groups with Wave 3)

---

- [x] 21. Compaction Hook — Audit State Preservation

  **What to do**:
  - Create `src/hooks/compaction-hook.ts`
  - Implement `experimental.session.compacting` hook
  - Serialize current audit state into compaction context:
    - Contracts audited (list)
    - Findings count by severity
    - Tools executed (which tools have been run)
    - Current audit phase
    - Key decisions made
  - Format as `<argus-audit-state>` XML tag for clear parsing
  - TDD: test serialization format and content

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] `bun test src/hooks/compaction-hook.test.ts` → PASS
  - [ ] Compaction context contains finding counts by severity
  - [ ] XML tag format is parseable

  **Commit**: NO (groups with Wave 3)

---

- [x] 22. Tool Tracking Hook — Finding Accumulation

  **What to do**:
  - Create `src/hooks/tool-tracking-hook.ts`
  - Implement `tool.execute.after` hook
  - When any `argus_*` tool completes, parse the result and update audit state:
    - `argus_slither_analyze`: Extract findings, add to store
    - `argus_forge_test`: Record test results
    - `argus_forge_fuzz`: Record fuzz results, counterexamples
    - `argus_check_patterns`: Extract pattern matches, add to store
    - `argus_analyze_contract`: Update contracts reviewed
  - Deduplicate findings across tools (same vulnerability reported by Slither AND pattern checker)
  - TDD: test finding extraction from each tool output format

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] `bun test src/hooks/tool-tracking-hook.test.ts` → PASS
  - [ ] Slither findings correctly extracted and added to store
  - [ ] Cross-tool deduplication works (Slither + pattern checker report same issue)

  **Commit**: NO (groups with Wave 3)

---

- [x] 23. Event Hook — Session Lifecycle

  **What to do**:
  - Create `src/hooks/event-hook.ts`
  - Implement `event` handler for session lifecycle:
    - `session.created`: Initialize fresh audit state for new session
    - `session.idle`: Auto-save audit state (serialize to context for next session)
    - `session.error`: Log audit state for recovery
  - Clean up audit state on session delete
  - TDD: test event handling for each event type

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 32
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] `bun test src/hooks/event-hook.test.ts` → PASS
  - [ ] Fresh state created on session.created
  - [ ] State preserved on session.idle

  **Commit**: YES
  - Message: `feat(agents+hooks): add agent prompts, system transform, compaction, tool tracking, events`
  - Pre-commit: `bun test`

- [ ] 24. Fork & Restructure DeFiFoFum Knowledge Base

  **What to do**:
  - Fork content from DeFiFoFum's `fofum-solidity-skills` repository (MIT license — attribute in each file header)
  - Source repo: https://github.com/DeFiFoFum/fofum-solidity-skills/tree/main/plugins/solidity-audit
  - **Write all output to staging directory**: `skills/.staging/defifofum/` (NOT directly to `skills/`)
  - Task 29 will merge all staging directories into the final `skills/` structure
  - Restructure from monolithic format (1 SKILL.md + resources/) into modular SKILL.md files:
    - Split the main `SKILL.md` (275 lines, 5-phase methodology) → `skills/.staging/defifofum/methodology/audit-workflow/SKILL.md`
    - Split `resources/severity.md` → `skills/.staging/defifofum/methodology/severity-classification/SKILL.md`
    - Split `resources/report-template.md` → `skills/.staging/defifofum/methodology/report-template/SKILL.md`
    - Split `resources/weird-tokens.md` → `skills/.staging/defifofum/vulnerability-patterns/weird-tokens/SKILL.md`
    - Split `resources/checklist.md` (100+ items) → `skills/.staging/defifofum/checklists/general-audit/SKILL.md`
    - Split `resources/exploits/reentrancy.md` (DAO, Cream, Fei, Rari) → `skills/.staging/defifofum/vulnerability-patterns/reentrancy/SKILL.md`
    - Split `resources/exploits/access-control.md` (Ronin, Parity, Wormhole, Poly) → `skills/.staging/defifofum/vulnerability-patterns/access-control/SKILL.md`
    - Split `resources/exploits/oracle.md` → `skills/.staging/defifofum/vulnerability-patterns/oracle-manipulation/SKILL.md`
    - Split `resources/exploits/flash-loan.md` → `skills/.staging/defifofum/vulnerability-patterns/flash-loan-attacks/SKILL.md`
    - Split `resources/exploits/logic-bugs.md` → `skills/.staging/defifofum/vulnerability-patterns/logic-errors/SKILL.md`
    - Split `resources/protocols/lending.md` → `skills/.staging/defifofum/protocol-patterns/lending-borrowing/SKILL.md`
    - Split `resources/protocols/amm.md` → `skills/.staging/defifofum/protocol-patterns/amm-dex/SKILL.md`
    - Split `resources/protocols/staking.md` → `skills/.staging/defifofum/protocol-patterns/staking-vesting/SKILL.md`
    - Split `resources/protocols/governance.md` → `skills/.staging/defifofum/protocol-patterns/dao-governance/SKILL.md`
    - Split `resources/protocols/bridges.md` → `skills/.staging/defifofum/protocol-patterns/bridges-cross-chain/SKILL.md`
  - Each SKILL.md must have YAML frontmatter: `name`, `description` (1-1024 chars)
  - Add attribution header to each file: `<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->`
  - Preserve all code examples, real exploit references, and severity data
  - Target: 15-18 modular SKILL.md files from DeFiFoFum content

  **Must NOT do**:
  - No AI-generated content — strictly fork and restructure existing curated content
  - No modification of exploit data, code examples, or severity classifications
  - No inclusion of DeFiFoFum's agent definitions (we have our own)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4a (with Tasks 25-28)
  - **Blocks**: Task 29
  - **Blocked By**: None

  **References**:
  - **Source Repository**: https://github.com/DeFiFoFum/fofum-solidity-skills/tree/main/plugins/solidity-audit
  - **Key Files**: `skills/fofum-audit/SKILL.md` (275 lines), `resources/checklist.md` (320 lines), `resources/exploits/*.md`, `resources/protocols/*.md`
  - **License**: MIT — requires attribution

  **Acceptance Criteria**:
  - [ ] 15+ SKILL.md files created with valid YAML frontmatter
  - [ ] Each has attribution header referencing DeFiFoFum source
  - [ ] All Solidity code examples preserved from source
  - [ ] Each file's `name` matches parent directory name
  - [ ] Methodology SKILL.md preserves the 5-phase audit workflow

  **QA Scenarios**:
  ```
  Scenario: All forked SKILL.md files have valid frontmatter
    Tool: Bash
    Steps:
      1. Find all SKILL.md files under skills/
      2. For each: parse YAML frontmatter, assert "name" and "description" present
      3. Assert "description" length between 1-1024 chars
      4. Assert file contains "Source: DeFiFoFum" attribution
    Expected Result: All files pass validation
    Evidence: .sisyphus/evidence/task-24-defifofum-fork.txt

  Scenario: No content was lost during restructuring
    Tool: Bash
    Steps:
      1. Count total Solidity code blocks across all forked SKILL.md files
      2. Count total real-world exploit references (DAO, Cream, Ronin, etc.)
      3. Assert code block count >= 20 (DeFiFoFum source has ~25)
      4. Assert exploit reference count >= 15 (DeFiFoFum covers ~20 exploits)
    Expected Result: Content preservation confirmed
    Evidence: .sisyphus/evidence/task-24-content-check.txt
  ```

  **Commit**: NO (groups with Wave 4a)

---

- [ ] 25. Import & Merge kadenzipfel Vulnerability References

  **What to do**:
  - Import from https://github.com/kadenzipfel/smart-contract-vulnerabilities (MIT license)
  - Source: the `/references/` directory (39 LLM-optimized vulnerability patterns)
  - **Write all output to staging directory**: `skills/.staging/kadenzipfel/` (NOT directly to `skills/`)
  - Task 29 will merge all staging directories into the final `skills/` structure
  - Transform each `references/*.md` file into SKILL.md format:
    - Add YAML frontmatter (`name`, `description`)
    - Preserve: Preconditions, Vulnerable Pattern, Detection Heuristics, False Positives, Remediation sections
    - Add attribution: `<!-- Source: kadenzipfel/smart-contract-vulnerabilities (MIT) -->`
  - Write ALL kadenzipfel content to staging — do NOT attempt to merge with DeFiFoFum here:
    - Each kadenzipfel reference → `skills/.staging/kadenzipfel/vulnerability-patterns/{topic}/SKILL.md`
    - Task 29 handles the actual merge/dedup across staging directories
  - kadenzipfel topics to import (all 39 references):
    - `reentrancy`, `access-control`, `oracle-manipulation`, `flash-loan-attacks`, `logic-errors` (overlap with DeFiFoFum — Task 29 will merge)
    - `delegatecall-proxy`, `erc4626-vault`, `signature-replay`, `price-manipulation`, `donation-attacks`, `rounding-errors`, `selfdestruct-force-send`, `storage-collision`, `gas-manipulation`, `timestamp-dependence`, `denial-of-service`, `unsafe-external-calls`, `centralization-risk`, `weak-randomness`, `array-deletion`, `shadowing-variables`, `front-running-mev`, `unchecked-return-values`, `tx-origin-phishing`, `uninitialized-storage`, `integer-overflow` (unique to kadenzipfel)
  - Target: 39 SKILL.md files in `skills/.staging/kadenzipfel/`

  **Must NOT do**:
  - No AI-generated vulnerability descriptions — use kadenzipfel's curated content
  - No removal of DeFiFoFum content during merge — only additive

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4a (with Tasks 24, 26-28)
  - **Blocks**: Task 29
  - **Blocked By**: None

  **References**:
  - **Source Repository**: https://github.com/kadenzipfel/smart-contract-vulnerabilities/tree/main/references
  - **Format**: Markdown with sections: Preconditions, Vulnerable Pattern, Detection Heuristics, False Positives, Remediation
  - **License**: MIT

  **Acceptance Criteria**:
  - [ ] 39 SKILL.md files in `skills/.staging/kadenzipfel/vulnerability-patterns/`
  - [ ] All files have YAML frontmatter and kadenzipfel attribution
  - [ ] Each preserves Detection Heuristics and False Positives sections from source
  - [ ] No files written outside staging directory

  **QA Scenarios**:
  ```
  Scenario: All kadenzipfel references imported to staging
    Tool: Bash
    Steps:
      1. Count SKILL.md files in skills/.staging/kadenzipfel/
      2. Assert count >= 35 (some kadenzipfel references may map to fewer topics)
      3. Assert each has YAML frontmatter with "name" and "description"
      4. Assert each contains "Detection Heuristics" section
    Expected Result: 35+ staged files with valid frontmatter
    Evidence: .sisyphus/evidence/task-25-kadenzipfel-staging.txt

  Scenario: No files written outside staging
    Tool: Bash
    Steps:
      1. Check skills/vulnerability-patterns/ (final directory) is empty or unchanged
      2. All kadenzipfel content is in skills/.staging/kadenzipfel/ only
    Expected Result: Staging isolation confirmed
    Evidence: .sisyphus/evidence/task-25-staging-isolation.txt
  ```

  **Commit**: NO (groups with Wave 4a)

---

- [ ] 26. Import & Transform Cyfrin Checklist + SmartBugs Examples

  **What to do**:
  - **Write all output to staging directory**: `skills/.staging/cyfrin-smartbugs/` (NOT directly to `skills/`)
  - Task 29 will merge all staging directories into the final `skills/` structure
  - **Cyfrin Checklist** (https://github.com/Cyfrin/audit-checklist):
    - Parse `checklist.json` (221 structured items with IDs, descriptions, remediations, references)
    - Transform into SKILL.md checklist format organized by category:
      - `skills/.staging/cyfrin-smartbugs/checklists/cyfrin-general/SKILL.md` — Main checklist items
      - `skills/.staging/cyfrin-smartbugs/checklists/defi-specific/SKILL.md` — DeFi-focused items
      - `skills/.staging/cyfrin-smartbugs/checklists/gas-optimization/SKILL.md` — Gas items
      - `skills/.staging/cyfrin-smartbugs/checklists/best-practices/SKILL.md` — General best practices
    - Keep Cyfrin's structured IDs (e.g., `SOL-AM-DOSA-1`) for traceability
    - Add attribution: `<!-- Source: Cyfrin/audit-checklist -->`
    - Do NOT merge with DeFiFoFum here — Task 29 handles cross-source merge
  - **SmartBugs Curated** (https://github.com/smartbugs/smartbugs-curated, Apache-2.0):
    - Parse `vulnerabilities.json` (143 annotated contracts with line-level vulnerability info)
    - Extract vulnerable code patterns and their DASP categories
    - Create `skills/.staging/cyfrin-smartbugs/references/smartbugs-examples/SKILL.md` linking to notable vulnerable contracts with code snippets
    - Organize code examples by DASP category for Task 29 to merge into corresponding vulnerability SKILL.md files
  - Target: 3-4 new checklist SKILL.md files + enrichment of existing vulnerability SKILL.md files with SmartBugs code

  **Must NOT do**:
  - No wholesale copying of SmartBugs .sol files into the plugin (reference, don't bundle full contracts)
  - No Cyfrin items without attribution

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4a (with Tasks 24-25, 27-28)
  - **Blocks**: Task 29
  - **Blocked By**: None

  **References**:
  - **Cyfrin Source**: https://github.com/Cyfrin/audit-checklist/blob/main/checklist.json — structured JSON with categories, IDs, descriptions, remediations, solodit references
  - **SmartBugs Source**: https://github.com/smartbugs/smartbugs-curated/blob/master/vulnerabilities.json — vulnerability index with line annotations
  - **Licenses**: Cyfrin (unspecified — verify before publish, attribute), SmartBugs (Apache-2.0)

  **Acceptance Criteria**:
  - [ ] 3+ checklist SKILL.md files created/enriched with Cyfrin items
  - [ ] General audit checklist has 150+ unique items (merged DeFiFoFum + Cyfrin)
  - [ ] SmartBugs code patterns added to relevant vulnerability SKILL.md files
  - [ ] All Cyfrin items retain their structured IDs
  - [ ] Attribution headers present on all affected files

  **QA Scenarios**:
  ```
  Scenario: Cyfrin checklist items transformed correctly
    Tool: Bash
    Steps:
      1. Read skills/checklists/general-audit/SKILL.md
      2. Assert contains items with Cyfrin ID format (SOL-XX-YYYY-N)
      3. Assert total checklist items >= 150
    Expected Result: Merged checklist with Cyfrin IDs and 150+ items
    Evidence: .sisyphus/evidence/task-26-cyfrin-checklist.txt

  Scenario: SmartBugs examples referenced in vulnerability skills
    Tool: Bash
    Steps:
      1. Grep all SKILL.md files for "SmartBugs" or "smartbugs-curated"
      2. Assert at least 5 files reference SmartBugs examples
    Expected Result: SmartBugs examples integrated into >=5 vulnerability skills
    Evidence: .sisyphus/evidence/task-26-smartbugs-refs.txt
  ```

  **Commit**: NO (groups with Wave 4a)

---

- [ ] 27. SCVD Sync Pipeline + Local Search Index

  **What to do**:
  - Create `src/knowledge/scvd-client.ts` — REST API client for SCVD (https://api.scvd.dev)
    - Endpoints: `GET /findings?severity=X&limit=N`, `GET /stats`, `GET /snapshots` (bulk JSONL/CSV)
    - Parse SCVD schema: `scvd_id`, `title`, `description_md`, `severity`, `taxonomy.swc[]`, `taxonomy.cwe[]`, `repo.url`, `sections.recommendation_md`, `sections.poc_md`
    - Handle pagination, rate limiting, network errors gracefully
    - Support `AbortSignal` for cancellation
  - Create `src/knowledge/scvd-index.ts` — local search index
    - Store findings in a local JSON index file (`~/.cache/opencode-argus/scvd-index.json`)
    - Index fields: SWC codes, CWE codes, severity, title keywords, protocol name
    - Implement search: `searchIndex(query: { swc?, severity?, keyword?, limit? })` → `FindingResult[]`
    - Track sync metadata: `lastSyncTimestamp`, `totalFindings`, `syncVersion`
  - Create `src/knowledge/scvd-sync.ts` — sync orchestration
    - `syncAll()`: Full sync — download all findings via snapshots endpoint, build index
    - `syncIncremental()`: Check `/stats` for new finding count, only fetch new if changed
    - `getSyncStatus()`: Return last sync time, finding count, index health
  - TDD: test API client with mocked responses, test index building and searching, test sync logic

  **Must NOT do**:
  - No SQLite dependency (keep it simple — JSON index is sufficient for 7,769 entries at ~5MB)
  - No API key management in code — accept as config parameter
  - No blocking startup — sync must be non-blocking (fire and forget on init)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4a (with Tasks 24-26, 28)
  - **Blocks**: Task 30
  - **Blocked By**: Task 1 (needs project scaffold for test infrastructure)

  **References**:
  - **API**: https://api.scvd.dev — REST API, CC0 license
  - **Schema**: `{ scvd_id, doc_id, finding_index, title, description_md, severity, taxonomy: { swc: [], cwe: [] }, repo: { url, commit, lines }, sections: { description_md, recommendation_md, poc_md } }`
  - **Stats Example**: `GET /stats` → `{ total: 7769, by_severity: { High: 2639, Medium: 2490, Low: 636, ... } }`

  **Acceptance Criteria**:
  - [ ] `bun test src/knowledge/scvd-client.test.ts` → PASS
  - [ ] `bun test src/knowledge/scvd-index.test.ts` → PASS
  - [ ] `bun test src/knowledge/scvd-sync.test.ts` → PASS
  - [ ] API client parses SCVD response schema correctly
  - [ ] Search index returns relevant results for SWC code queries
  - [ ] Incremental sync detects when no new findings exist (skips full download)
  - [ ] Handles network errors gracefully (returns cached data if available)

  **QA Scenarios**:
  ```
  Scenario: SCVD API client parses findings correctly
    Tool: Bash (bun test)
    Steps:
      1. Mock SCVD API response with 3 findings (1 High SWC-107, 1 Medium SWC-116, 1 Low)
      2. Call scvdClient.fetchFindings({ severity: "High" })
      3. Assert result has 1 finding with swc containing "SWC-107"
    Expected Result: Parsed finding with correct taxonomy
    Evidence: .sisyphus/evidence/task-27-scvd-client.txt

  Scenario: Local index search by SWC code
    Tool: Bash (bun test)
    Steps:
      1. Build index from 50 mock findings covering 10 SWC categories
      2. Search for SWC-107 (reentrancy)
      3. Assert results contain only reentrancy-related findings
    Expected Result: Filtered results matching SWC-107
    Evidence: .sisyphus/evidence/task-27-scvd-search.txt

  Scenario: Sync handles network failure gracefully
    Tool: Bash (bun test)
    Steps:
      1. Mock network timeout on SCVD API call
      2. Call syncIncremental() with existing cached index
      3. Assert function returns cached data, does not throw
    Expected Result: Graceful fallback to cached index
    Evidence: .sisyphus/evidence/task-27-scvd-offline.txt
  ```

  **Commit**: NO (groups with Wave 4a)

---

- [ ] 28. DeFiHackLabs Exploit PoC References

  **What to do**:
  - **Write output to staging directory**: `skills/.staging/exploit-case-studies/`
  - Create `skills/.staging/exploit-case-studies/exploit-reference/SKILL.md` — master exploit reference skill that:
    - Lists top 15 exploits with **GitHub URL links** to DeFiHackLabs Foundry reproductions
    - Structure per exploit: Name, Date, Amount Lost, Vulnerability Type, DeFiHackLabs GitHub URL, Key Lesson
    - URL format: `https://github.com/SunWeb3Sec/DeFiHackLabs/blob/main/src/test/{ExploitName}.sol`
    - Exploits to cover: DAO ($60M), Parity ($300M), bZx ($8M), Euler ($197M), Nomad ($190M), Ronin ($625M), Wormhole ($326M), Cream ($130M), Harvest ($34M), Compound ($80M), Poly Network ($611M), Mango Markets ($114M), Beanstalk ($182M), Wintermute ($160M), BadgerDAO ($120M)
  - Create `skills/.staging/exploit-case-studies/how-to-reproduce/SKILL.md` — instructions for cloning DeFiHackLabs and running PoCs with Foundry
  - Use GitHub URLs (not local submodule paths) so skills work for npm-installed users
  - Optionally add `.gitmodules` for development convenience only (not required for plugin functionality)
  - Target: 2 SKILL.md files in staging

  **Must NOT do**:
  - No copying of DeFiHackLabs Solidity files into the plugin (reference via GitHub URLs only)
  - No local submodule path references in SKILL.md content (npm users won't have the submodule)
  - No license file modification (DeFiHackLabs has no explicit license — reference only, don't redistribute)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4a (with Tasks 24-27)
  - **Blocks**: Task 29
  - **Blocked By**: None

  **References**:
  - **Source**: https://github.com/SunWeb3Sec/DeFiHackLabs — 100+ Foundry exploit reproductions, 1,902 stars
  - **Test Location**: `src/test/*.sol` — each file is a standalone Foundry test reproducing a real exploit

  **Acceptance Criteria**:
  - [ ] `skills/.staging/exploit-case-studies/exploit-reference/SKILL.md` references 15 exploits
  - [ ] All exploit references use GitHub URLs (https://github.com/SunWeb3Sec/DeFiHackLabs/...)
  - [ ] No local submodule path references in SKILL.md content
  - [ ] `how-to-reproduce/SKILL.md` has Foundry setup and clone instructions

  **QA Scenarios**:
  ```
  Scenario: Exploit skill references use GitHub URLs
    Tool: Bash
    Steps:
      1. Read skills/.staging/exploit-case-studies/exploit-reference/SKILL.md
      2. Assert contains at least 15 exploit entries
      3. Assert each entry has: Name, Date, Amount, Vulnerability Type, GitHub URL
      4. Assert all URLs match pattern "https://github.com/SunWeb3Sec/DeFiHackLabs/"
      5. Assert ZERO references to "submodules/" local paths
    Expected Result: 15 exploits with GitHub URL references, no local paths
    Evidence: .sisyphus/evidence/task-28-exploit-urls.txt
  ```

  **Commit**: NO (groups with Wave 4a)

---

- [ ] 29. Knowledge Deduplication & Quality Pass

  **What to do**:
  - After Tasks 24-26 and 28 complete, merge all staging directories into the final `skills/` structure
  - **Merge from staging directories**:
    - Read all SKILL.md files from: `skills/.staging/defifofum/`, `skills/.staging/kadenzipfel/`, `skills/.staging/cyfrin-smartbugs/`, `skills/.staging/exploit-case-studies/`
    - Group by topic name (e.g., all sources with `name: reentrancy` are candidates for merge)
    - For each topic covered by multiple sources:
      - Create single authoritative `skills/{category}/{topic}/SKILL.md`
      - Merge content: DeFiFoFum provides Real-World Exploits + methodology, kadenzipfel provides Detection Heuristics + False Positives, Cyfrin provides checklist items, SmartBugs provides code examples
      - Preserve ALL attribution headers from each source
    - For topics covered by only one source: copy directly to `skills/{category}/{topic}/SKILL.md`
    - Eliminate redundant code examples (keep most comprehensive/modern versions)
    - Ensure each checklist item appears exactly once
  - **Quality validation**:
    - Verify all YAML frontmatter is valid: `name` matches directory, `description` 1-1024 chars
    - Verify all Solidity code examples are syntactically reasonable (no obviously broken snippets)
    - Verify no SKILL.md exceeds 5000 words (split if needed)
    - Verify directory structure is consistent: `skills/{category}/{topic}/SKILL.md`
  - **Cleanup**: Remove `skills/.staging/` directory after successful merge
  - **Inventory creation**:
    - Create `skills/INVENTORY.md` listing all SKILL.md files with: path, source(s), topic, word count
    - This inventory is used by Task 31 for documentation
  - Target: Final unified knowledge base with 35-45 deduplicated SKILL.md files

  **Must NOT do**:
  - No deletion of content without replacement — only merge/consolidate
  - No AI-generated filler to pad thin SKILL.md files
  - No modification of attribution headers

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4b (sequential after 24-26, 28)
  - **Blocks**: Tasks 31, 32
  - **Blocked By**: Tasks 24, 25, 26, 28

  **Acceptance Criteria**:
  - [ ] No two SKILL.md files cover the same vulnerability topic
  - [ ] All SKILL.md files have valid YAML frontmatter (name, description 1-1024)
  - [ ] `skills/INVENTORY.md` lists all files with source attribution
  - [ ] Total SKILL.md count between 35-45 (deduplicated from initial imports)
  - [ ] No SKILL.md exceeds 5000 words
  - [ ] All Solidity code examples are syntactically reasonable

  **QA Scenarios**:
  ```
  Scenario: No duplicate topics across knowledge base
    Tool: Bash
    Steps:
      1. Extract "name" from all SKILL.md frontmatter
      2. Assert all names are unique (no duplicates)
      3. Read INVENTORY.md, assert file count matches actual SKILL.md count
    Expected Result: All names unique, inventory accurate
    Evidence: .sisyphus/evidence/task-29-dedup-check.txt

  Scenario: All frontmatter valid
    Tool: Bash
    Steps:
      1. Find all SKILL.md files recursively under skills/
      2. For each: parse YAML, assert "name" present and matches parent dir
      3. Assert "description" length between 1 and 1024
    Expected Result: 100% frontmatter validation pass
    Evidence: .sisyphus/evidence/task-29-frontmatter-valid.txt
  ```

  **Commit**: YES
  - Message: `feat(knowledge): import, merge, and deduplicate knowledge base from DeFiFoFum, kadenzipfel, Cyfrin, SmartBugs, DeFiHackLabs`
  - Pre-commit: `ls skills/ && cat skills/INVENTORY.md`

---

- [ ] 30. `argus_sync_knowledge` Tool + Auto-Sync Hook

  **What to do**:
  - Create `src/tools/sync-knowledge-tool.ts` using `tool()` helper from `@opencode-ai/plugin`
  - Args (Zod): `force` (boolean, default false — force full re-sync)
  - **SCVD sync only** — kadenzipfel is a one-time import (Tasks 25/29), not a live sync source
  - Execution flow:
    1. If `force` or first-time: call `syncAll()` from SCVD sync module (Task 27)
    2. If incremental: call `syncIncremental()` — checks SCVD `/stats` for new findings
    3. Return: `{ success, scvd: { newFindings, totalIndexed, lastSync }, errors }`
  - Create auto-sync hook in `src/hooks/knowledge-sync-hook.ts`:
    - On plugin `config` handler: trigger lightweight incremental sync (non-blocking)
    - Use `setTimeout` or `Promise.resolve().then()` to avoid blocking plugin init
    - Log sync status: "SCVD index: 7,769 findings (last synced: 2h ago)" or "SCVD sync failed: offline, using cached index"
  - Enhance `argus_check_patterns` tool (Task 11) — register SCVD as additional `MatchSource`:
    - Task 11 defined the extensible `MatchSource` interface with `{ source, matches }` 
    - Add SCVD source: when `include_scvd` is true (default), query SCVD local index for SWC codes matching detected patterns
    - Register: `{ source: "scvd", matches: [{ pattern: scvd_id, severity, description: title, exploitReference: recommendation }] }`
    - This does NOT modify Task 11's core logic — it adds an additional source to the `sources` array
  - TDD: test sync tool with mocked SCVD API, test auto-sync hook, test check_patterns SCVD MatchSource integration

  **Must NOT do**:
  - No blocking plugin startup — sync must be fire-and-forget
  - No sync without user's SCVD config (skip if not configured)
  - No storing API keys in code — read from plugin config
  - No kadenzipfel git sync — kadenzipfel is a one-time import only

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4b (after Task 27 + Task 11)
  - **Blocks**: Task 32
  - **Blocked By**: Tasks 27, 11

  **References**:
  - **SCVD API**: https://api.scvd.dev — endpoints documented in Task 27
  - **kadenzipfel repo**: https://github.com/kadenzipfel/smart-contract-vulnerabilities — one-time import source (Tasks 25/29), NOT synced by this tool
  - **Pattern References**: Task 11's `argus_check_patterns` tool — extend its output schema
  - **Hook Pattern**: OhO's config handler pattern for non-blocking init operations

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/sync-knowledge-tool.test.ts` → PASS
  - [ ] `bun test src/hooks/knowledge-sync-hook.test.ts` → PASS
  - [ ] Sync tool returns structured summary with SCVD finding counts
  - [ ] Auto-sync hook runs non-blocking (plugin init completes in <100ms even if sync fails)
  - [ ] `argus_check_patterns` enhanced with SCVD MatchSource (uses extensible interface from Task 11)
  - [ ] Handles SCVD API offline gracefully (uses cached index)

  **QA Scenarios**:
  ```
  Scenario: Sync tool performs incremental SCVD sync
    Tool: Bash (bun test)
    Steps:
      1. Mock SCVD /stats returning total: 7800 (31 new since last sync of 7769)
      2. Mock SCVD /findings returning 31 new findings
      3. Call sync tool with force=false
      4. Assert result.scvd.newFindings === 31
    Expected Result: Incremental sync fetches only new findings
    Evidence: .sisyphus/evidence/task-30-sync-incremental.txt

  Scenario: Auto-sync hook doesn't block plugin init
    Tool: Bash (bun test)
    Steps:
      1. Mock SCVD API with 5 second delay
      2. Measure plugin init time
      3. Assert init completes in < 100ms (sync is non-blocking)
    Expected Result: Plugin loads immediately, sync happens in background
    Evidence: .sisyphus/evidence/task-30-autosync-nonblocking.txt

  Scenario: check_patterns includes SCVD results
    Tool: Bash (bun test)
    Steps:
      1. Create index with 5 reentrancy findings (SWC-107)
      2. Run check_patterns on fixture with reentrancy, include_scvd=true
      3. Assert output contains scvdMatches array with SWC-107 findings
    Expected Result: Pattern check results enriched with SCVD data
    Evidence: .sisyphus/evidence/task-30-check-patterns-scvd.txt
  ```

  **Commit**: NO (groups with Wave 4b)

---

- [ ] 31. Companion Plugin Docs + Knowledge README

  **What to do**:
  - Create `skills/README.md` documenting the knowledge base:
    - Architecture diagram (text): bundled skills → SCVD index → companion plugins
    - Source attribution table: each source with license, URL, what was imported
    - SKILL.md format specification (for contributors)
    - How to add custom SKILL.md files
  - Create `docs/companion-plugins.md`:
    - Trail of Bits skills marketplace: installation instructions (`/plugin marketplace add trailofbits/skills`), what it adds, why no duplication
    - Solodit MCP: already auto-registered by Argus, how to use, query examples
    - kadenzipfel: one-time import source, how patterns were merged into knowledge base, how to manually re-import if kadenzipfel updates significantly
    - SCVD integration: how the local index works, how to configure API key
  - Knowledge config schema already defined in Task 2 (`knowledge.scvd.enabled`, `knowledge.autoSync`, etc.) — document those fields, do not redefine
  - Ensure the README references the `skills/INVENTORY.md` created in Task 29

  **Must NOT do**:
  - No duplication of Trail of Bits content — reference only
  - No Solodit API documentation (that's the MCP server's job)

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4b (with Tasks 29, 30)
  - **Blocks**: Task 32
  - **Blocked By**: Task 29

  **References**:
  - **Trail of Bits marketplace**: https://github.com/trailofbits/skills — CC-BY-SA-4.0
  - **SCVD API**: https://api.scvd.dev — CC0
  - **INVENTORY.md**: Created by Task 29

  **Acceptance Criteria**:
  - [ ] `skills/README.md` documents all knowledge sources with attribution
  - [ ] `docs/companion-plugins.md` has Trail of Bits + Solodit + SCVD instructions
  - [ ] Knowledge config section added to plugin config schema
  - [ ] No Trail of Bits content duplicated — only installation instructions

  **QA Scenarios**:
  ```
  Scenario: Knowledge README documents all sources
    Tool: Bash
    Steps:
      1. Read skills/README.md
      2. Assert contains: "DeFiFoFum", "kadenzipfel", "Cyfrin", "SmartBugs", "DeFiHackLabs", "SCVD"
      3. Assert each source has License and URL
    Expected Result: All 6 sources documented with attribution
    Evidence: .sisyphus/evidence/task-31-knowledge-readme.txt

  Scenario: Companion docs reference Trail of Bits correctly
    Tool: Bash
    Steps:
      1. Read docs/companion-plugins.md
      2. Assert contains installation command for Trail of Bits
      3. Assert does NOT contain any copied Trail of Bits skill content
    Expected Result: Reference-only, no duplication
    Evidence: .sisyphus/evidence/task-31-companion-docs.txt
  ```

  **Commit**: YES
  - Message: `feat(knowledge): add SCVD sync pipeline, sync tool, auto-sync hook, companion docs`
  - Pre-commit: `bun test`

---

- [ ] 32. Plugin Entry Point Assembly

  **What to do**:
  - Assemble `src/index.ts` — the final plugin entry point
  - Wire all components together:
    ```typescript
    const ArgusPlugin: Plugin = async (ctx) => {
      const argusConfig = loadArgusConfig(ctx.directory)
      const auditState = createAuditState()
      
      return {
        tool: { /* all 8 tools (7 core + sync_knowledge) */ },
        config: configHandler(argusConfig, ctx),  // registers agents, MCP, skills, triggers auto-sync
        "experimental.chat.system.transform": systemPromptHook(auditState, ctx),
        "experimental.session.compacting": compactionHook(auditState),
        "tool.execute.after": toolTrackingHook(auditState),
        event: eventHook(auditState),
      }
    }
    export default ArgusPlugin
    ```
  - Ensure single default export (OpenCode treats all exports as plugin instances)
  - Verify types match OpenCode's `Plugin` interface
  - Add logging via `ctx.client.app.log()`
  - TDD: integration test that loads the full plugin

  **Must NOT do**:
  - No additional exports (OpenCode warning)
  - No side effects outside the plugin function

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 33-35)
  - **Blocks**: Tasks 33, 34, 35
  - **Blocked By**: Tasks 14-23, 29-31

  **References**:
  - **Pattern References**: OhO's `src/index.ts` — single default export, comment warning about multiple exports

  **Acceptance Criteria**:
  - [ ] `bun build` succeeds
  - [ ] Single default export of `Plugin` type
  - [ ] All 8 tools registered (7 core + argus_sync_knowledge)
  - [ ] Config handler wired (agents, MCP, skills, auto-sync)
  - [ ] All 4 hooks wired

  **QA Scenarios**:
  ```
  Scenario: Plugin loads without errors
    Tool: Bash (bun)
    Steps:
      1. Import the plugin: `import p from './src/index.ts'`
      2. Call plugin with mock context
      3. Assert returned object has: tool (8 entries), config, experimental.chat.system.transform, experimental.session.compacting, tool.execute.after, event
    Expected Result: All hooks and 8 tools present in return value
    Evidence: .sisyphus/evidence/task-32-plugin-assembly.txt
  ```

  **Commit**: NO (groups with Wave 5)

---

- [ ] 33. Integration Test — Full Audit Pipeline

  **What to do**:
  - Create `tests/integration/full-audit.test.ts`
  - Test the complete audit pipeline against the fixture project (Task 6):
    1. Load plugin with mock context pointing to `tests/fixtures/vulnerable-vault/`
    2. Call config handler — verify agents registered
    3. Execute `argus_slither_analyze` on fixture project — verify findings returned
    4. Execute `argus_analyze_contract` on VulnerableVault.sol — verify contract profile
    5. Execute `argus_check_patterns` — verify pattern matches
    6. Execute `argus_forge_test` — verify test results
    7. Execute `argus_generate_report` — verify markdown report structure
    8. Verify compaction hook serializes state correctly
    9. Verify tool tracking hook accumulated findings from steps 3-6
  - This is the END-TO-END test that proves the plugin works
  - May require Slither + Foundry installed (mark as integration test, separate from unit tests)

  **Must NOT do**:
  - No mocking of external tools (this is the real integration test)
  - No network calls (Solodit MCP not required for integration test)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 32, 34-35)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 32, 6

  **Acceptance Criteria**:
  - [ ] Integration test passes end-to-end
  - [ ] Slither finds ≥3 vulnerabilities in fixture
  - [ ] Pattern checker finds ≥2 matches
  - [ ] Report generates with correct finding counts
  - [ ] Audit state has accumulated findings from all tools

  **QA Scenarios**:
  ```
  Scenario: Full audit pipeline on fixture project
    Tool: Bash (bun test --filter integration)
    Preconditions: Slither and Foundry installed
    Steps:
      1. Run full integration test suite
      2. Verify all assertions pass
    Expected Result: All integration tests pass
    Evidence: .sisyphus/evidence/task-33-integration.txt
  ```

  **Commit**: NO (groups with Wave 5)

---

- [ ] 34. Package.json, README, npm Publish Prep

  **What to do**:
  - Update `package.json` with: name "opencode-argus", version "0.1.0", description, keywords (solidity, security, audit, opencode, plugin), main entry point, files to include, peer dependencies (slither-analyzer, foundry), repository, license
  - Create `README.md`: Installation, Quick Start, Agents overview, Tools reference, Knowledge Base description, Configuration
  - Create `AGENTS.md` for OpenCode agent discovery
  - Ensure `skills/` directory is included in npm package (`files` field)
  - Verify `bun build` produces valid dist output

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Task 32

  **Acceptance Criteria**:
  - [ ] `npm pack` produces valid tarball
  - [ ] README has installation and quick start sections
  - [ ] skills/ included in package files

  **Commit**: NO (groups with Wave 5)

---

- [ ] 35. Config Schema + Example Config File

  **What to do**:
  - Generate JSON schema for `opencode-argus.jsonc` from Zod schema (Task 2)
  - Create example config file: `examples/opencode-argus.jsonc` with all options documented
  - Create example `opencode.json` showing plugin installation: `{ "plugin": ["opencode-argus"] }`
  - Document all configuration options in comments

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Task 32

  **Acceptance Criteria**:
  - [ ] Example config file validates against schema
  - [ ] All config options documented

  **Commit**: YES
  - Message: `feat(plugin): assemble entry point, integration tests, publish prep`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, import module, check config keys). Verify SCVD index populated, sync tool functional, knowledge base deduplicated, all attributions present. For each "Must NOT Have": search codebase for forbidden patterns (PDF generation, OhO hooks, `as any`, hardcoded paths, duplicated Trail of Bits content). Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun build` + `bun test`. Review all source files for: `as any`/`@ts-ignore`, empty catches, console.log in prod code, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify all tools have proper error handling and abort signal support.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Install the plugin in an OpenCode instance. Run a full audit on the test fixture project: verify all 4 agents load, all 8 tools execute, SKILL.md files are discoverable, SCVD index searchable, sync tool works, Solodit MCP connects, report generates correctly. Test edge cases: missing Slither, missing Foundry, empty project, compilation errors, SCVD API offline, kadenzipfel repo unreachable.
  Output: `Agents [4/4] | Tools [8/8] | Skills [N loaded] | SCVD [indexed/search] | Sync [PASS/FAIL] | Report [PASS/FAIL] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual code. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Flag any PDF generation code, OhO integration, direct API scraping, or hardcoded paths.
  Output: `Tasks [N/N compliant] | Must-NOT violations [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

| After Task(s) | Message | Verification |
|------------|---------|--------------|
| 1 | `chore(scaffold): initialize opencode-argus plugin with TDD infrastructure` | `bun test` |
| 2-6 | `feat(core): add config schema, types, project detector, parser utils, test fixtures` | `bun test` |
| 7-13 | `feat(tools): implement all 7 core audit tools` | `bun test` |
| 14-15 | `feat(config): register agents, MCPs, and skills via config handler` | `bun test` |
| 16-23 | `feat(agents+hooks): add agent prompts, system transform, compaction, tool tracking, events` | `bun test` |
| 24-28 | `feat(knowledge): fork DeFiFoFum, import kadenzipfel + Cyfrin + SmartBugs + DeFiHackLabs to staging` | `ls skills/.staging/` |
| 29 | `feat(knowledge): deduplicate and validate unified knowledge base` | `cat skills/INVENTORY.md` |
| 30-31 | `feat(knowledge): add SCVD sync pipeline, sync tool, auto-sync hook, companion docs` | `bun test` |
| 32-35 | `feat(plugin): assemble entry point, integration tests, publish prep` | `bun test` |

---

## Success Criteria

### Verification Commands
```bash
bun build          # Expected: zero errors, clean build
bun test           # Expected: all tests pass
bun run typecheck  # Expected: zero type errors
```

### Final Checklist
- [ ] All 4 agents registered and visible in OpenCode
- [ ] All 8 tools callable and returning structured results
- [ ] 35-45 deduplicated SKILL.md files present with valid frontmatter
- [ ] SCVD local index populated with 7,000+ findings, searchable
- [ ] `argus_sync_knowledge` tool syncs from SCVD + kadenzipfel
- [ ] Auto-sync hook fires on plugin init (non-blocking)
- [ ] `argus_check_patterns` enriched with SCVD cross-references
- [ ] Solodit MCP server registered in config
- [ ] Companion docs reference Trail of Bits marketplace (no content duplication)
- [ ] All sources attributed (DeFiFoFum MIT, kadenzipfel MIT, SCVD CC0, SmartBugs Apache-2.0)
- [ ] DeFiHackLabs exploits referenced via GitHub URLs (no local path dependencies)
- [ ] skills/INVENTORY.md lists all SKILL.md files with sources
- [ ] Audit state preserved across compaction
- [ ] Report generation produces valid markdown
- [ ] Zero `as any` / `@ts-ignore` in codebase
- [ ] All tools handle cancellation via AbortSignal
- [ ] Project auto-detects Hardhat vs Foundry
- [ ] Plugin installable via `plugin: ["opencode-argus"]`
