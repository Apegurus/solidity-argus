# solidity-argus

**The All-Seeing Solidity Security Auditor for OpenCode**

[![npm version](https://img.shields.io/npm/v/solidity-argus)](https://www.npmjs.com/package/solidity-argus) [![license](https://img.shields.io/npm/l/solidity-argus)](./LICENSE)

---

## Overview

**solidity-argus** is a security auditing plugin for [OpenCode](https://opencode.ai) that brings professional-grade Solidity smart contract auditing directly into your AI coding workflow.

Argus Panoptes — the mythological all-seeing giant — orchestrates a team of 6 specialized AI agents to conduct comprehensive security audits: static analysis, vulnerability research, deep adversarial specialist review, dynamic testing, professional report generation, and independent validation.

**What it does:**
- Runs Slither static analysis and Foundry tests automatically
- Searches 7,769+ real-world audit findings via SCVD and Solodit
- Matches code against 103 curated SKILL.md knowledge files
- Generates professional markdown audit reports with severity classifications
- Follows a rigorous 7-step audit methodology (Reconnaissance → Report)

**Why it's useful:**
- Catches reentrancy, oracle manipulation, access control flaws, flash loan vectors, and 50+ vulnerability classes across 14 pattern categories
- Integrates seamlessly into OpenCode's agent system — no separate tooling setup required
- Knowledge base sourced from Trail of Bits, Cyfrin, DeFiFoFum, and the broader security community

---

## Installation

Add `solidity-argus` to your OpenCode configuration:

```json
{
  "plugin": ["solidity-argus"]
}
```

Or install via npm/bun:

```bash
bun add solidity-argus
```

`solidity-argus` is Bun/OpenCode-native. The package entrypoints and CLI bins intentionally point at TypeScript source executed by Bun/OpenCode, so use `bun` or `bunx` for CLI commands rather than Node-only runners.

---

## Quick Start

1. Open a Solidity project in OpenCode
2. Switch to the `@argus` agent
3. Say: `"Audit the VaultContract.sol for security vulnerabilities"`

Argus will automatically:
- Analyze the contract structure
- Run Slither (if available)
- Search for known vulnerability patterns
- Research historical exploits in similar protocols
- Generate a full audit report

---

## Agents

| Agent | Role | Model |
|-------|------|-------|
| `@argus` | Orchestrator — coordinates the full audit | claude-opus-4-8 |
| `@sentinel` | Static analysis & testing specialist | claude-sonnet-4-6 |
| `@pythia` | Vulnerability researcher | claude-sonnet-4-6 |
| `@audit-specialist` | Profile-driven adversarial specialist | claude-sonnet-4-6 |
| `@scribe` | Audit report writer | claude-sonnet-4-6 |
| `@themis` | Independent audit quality gate | gpt-5.5 |

### @argus — The Orchestrator
Argus Panoptes is the lead auditor. It follows a 7-step methodology (Reconnaissance, Automated Scanning, Manual Review, Attack Surface Mapping, Vulnerability Research, Testing & Verification, Reporting) and delegates to Sentinel, Pythia, Audit Specialist, Scribe, and Themis as needed.

### @sentinel — The Executor
Runs Slither, writes and executes Foundry tests, performs fuzz testing. Your tactical executor for all dynamic and static analysis tasks.

### @pythia — The Researcher
Searches Solodit and SCVD for historical exploits, checks vulnerability pattern databases, and provides research context for similar protocols and known attack vectors.

### @audit-specialist — The Adversarial Specialist
Runs focused deep/adversarial passes under profiles such as `vector-scan`, `access-control`, `math-precision`, `invariant`, `economic-security`, `execution-trace`, `periphery`, and `first-principles`. It records only confirmed findings and returns unproven trails as leads.

### @scribe — The Reporter
Transforms raw findings into professional, structured markdown audit reports with severity classifications, impact assessments, and actionable recommendations.

### @themis — The Quality Gate
Validates the completed audit by comparing raw findings, deduped findings, and the generated report. Themis challenges false positives, severity choices, and dropped findings before final delivery.

---

## Tools

| Tool | Agent | Description |
|------|-------|-------------|
| `argus_slither_analyze` | Sentinel, Audit Specialist | Runs Slither static analysis on Solidity contracts; detects reentrancy, uninitialized variables, unchecked returns, and more |
| `argus_analyze_contract` | Sentinel, Audit Specialist | Generates a deep structural profile of a contract: functions, state variables, modifiers, inheritance tree |
| `argus_check_patterns` | Sentinel, Pythia, Audit Specialist | Scans code against a library of complex vulnerability patterns (regex/AST-based) covering 50+ vulnerability classes across 14 pattern categories |
| `argus_proxy_detection` | Sentinel, Audit Specialist | Detects proxy patterns in Solidity contracts (ERC1967, UUPS, transparent, beacon, diamond) with confidence scoring |
| `argus_solodit_search` | Pythia, Audit Specialist | Searches Solodit's database of real-world audit reports for similar protocols and historical findings |
| `argus_forge_test` | Sentinel, Audit Specialist | Runs existing or newly written Foundry/Forge tests; essential for PoC verification |
| `argus_gas_analysis` | Sentinel, Audit Specialist | Runs forge gas report analysis, parses per-function gas metrics, and identifies high-gas hotspots above configurable threshold |
| `argus_forge_fuzz` | Sentinel, Audit Specialist | Fuzzes specific functions with random inputs to find edge cases and invariant violations |
| `argus_forge_coverage` | Sentinel, Audit Specialist | Runs forge coverage analysis and returns structured per-file coverage metrics (lines, statements, branches, functions) |
| `argus_list_skills` | Argus, Sentinel, Pythia, Audit Specialist, Themis | Lists Argus skill catalog metadata across bundled, custom, Trail of Bits, OpenCode, and Claude resolver roots without exposing full skill bodies |
| `argus_recommend_skills` | Argus, Sentinel, Pythia, Audit Specialist, Themis | Recommends relevant Argus skills from Solidity/protocol context using deterministic metadata scoring |
| `argus_skill_load` | Pythia, Audit Specialist, Themis | Loads curated SKILL.md knowledge files on demand for vulnerability patterns, protocol guidance, methodology, and case studies |
| `argus_record_finding` | Sentinel, Pythia, Audit Specialist | Records verified manual, static-analysis, research, or testing findings into durable audit state |
| `argus_read_findings` | Scribe, Themis | Reads persisted findings and audit artifacts for report generation and validation |
| `argus_persist_deduped` | Scribe | Persists deduplicated findings before final report generation and validation |
| `argus_generate_report` | Scribe | Generates the final structured audit report in professional markdown format |
| `argus_themis_disposition` | Argus | Records Argus' resolved disposition for Themis validation: approved, remediated, or explicitly overridden |
| `argus_sync_knowledge` | Argus | Syncs the local vulnerability database from SCVD (api.scvd.dev) |

---

## Knowledge Base

The plugin ships with **103 curated SKILL.md files** organized into 5 metadata categories:

| Category | Files | Description |
|----------|-------|-------------|
| Vulnerability Patterns | 60 | Reentrancy, oracle manipulation, flash loans, access control, ERC4626, governance, front-running, and more |
| Methodology | 12 | Audit workflow, report templates, severity classification, refutation rubric, and 8 audit-specialist profiles |
| Protocol Patterns | 7 | AMM/DEX, bridges, governance, lending, staking, concentrated liquidity, and liquid-staking/restaking security guides |
| Checklists | 6 | Cyfrin audit checklists (DeFi core, integrations, upgrades, gas, best practices) |
| References | 18 | DeFi exploit reference index, SmartBugs examples, attack-vector deck, and major DeFi exploit case studies |

**Sources:** Trail of Bits, Cyfrin, DeFiFoFum, kadenzipfel, SunWeb3Sec, smartbugs, BailSec, Argus

### Detection Rules

Vulnerability detection patterns are defined as `detection_rules` in SKILL.md frontmatter. The pattern checker scans effective resolver winners from every Argus skill root — bundled, `customSkillsDir`, Trail of Bits cache, OpenCode project/global, and Claude project/global — but only when a skill has both `pattern_category` and non-empty `detection_rules`.

- **51 vulnerability pattern skills** with detection rules across **14 categories**
- Categories: `reentrancy`, `oracle-manipulation`, `flash-loan`, `access-control`, `erc4626`, `proxy`, `signature`, `dos`, `front-running`, `governance`, `token-standard`, `gas-optimization`, `logic-error`, `delegatecall`

#### Adding Custom Detection Rules

Add custom detection rules by creating SKILL.md files in your `customSkillsDir`:

```yaml
---
name: my-custom-pattern
description: Detects insecure transfer patterns
category: vulnerability-pattern
pattern_category: access-control
detection_rules:
  - regex: 'transfer\(msg\.sender, .+\)'
    severity: High
    description: Potentially insecure transfer to caller
---
```

**SCVD Integration:** The plugin connects to [api.scvd.dev](https://api.scvd.dev) for 7,769+ real-world audit findings. Sync with `argus_sync_knowledge` or configure `knowledge.autoSync: true`.

### Audit PDF Extraction Pipeline

A generic pipeline for extracting security findings from public audit report PDFs and converting them into structured data for pattern creation.

**How it works:**
1. Downloads PDFs from configured GitHub repositories
2. Parses each PDF page-by-page using `pdf-parse`
3. Extracts findings using regex-based heading/severity/description detection
4. Deduplicates and categorizes findings into 11 categories
5. Outputs structured JSON to `scripts/audit-pdf-output/`

**Running the pipeline:**

```bash
bun scripts/audit-pdf-extract.ts
```

> **Note:** The extraction pipeline scripts are available in the [source repository](https://github.com/Apegurus/solidity-argus) only. They are not included in the npm package. If you installed `solidity-argus` via npm/bun, you'll need to clone the repository to run the extraction pipeline.

**Output files:**
- `scripts/audit-pdf-output/findings.json` — All extracted findings
- `scripts/audit-pdf-output/metadata.json` — Extraction stats, errors, source info
- `scripts/audit-pdf-output/by-category/*.json` — Findings grouped by category (reentrancy, access-control, oracle, etc.)

**Adding new audit sources:**

The pipeline uses a generic `AuditSource[]` interface. To add a new audit firm's reports, edit `scripts/audit-pdf-extract.ts` and add an entry to `DEFAULT_SOURCES`:

```typescript
{
  name: "AuditFirmName",
  repoRawBase: "https://raw.githubusercontent.com/org/repo/main",
  repoUrl: "https://github.com/org/repo",
  pdfFiles: [
    "Audit Report - Protocol Name.pdf",
    // ... more PDFs
  ],
}
```

**How agents leverage extracted findings:**

The extracted findings are used to create new SKILL.md vulnerability pattern files (e.g., `erc4626-exchange-rate-manipulation`, `missing-parameter-bounds`). These patterns are loaded on-demand by agents via `argus_skill_load` during audits. The extraction pipeline is a developer tool — agents don't run it directly.

### Case Studies

15 detailed case studies of major DeFi exploits are included in `skills/case-studies/`. Each provides deep narrative context: root cause analysis, attack flow, impact assessment, key transactions, and lessons learned.

**Sources:** Public exploit research from [rekt.news](https://rekt.news) and [SunWeb3Sec/DeFiHackLabs](https://github.com/SunWeb3Sec/DeFiHackLabs).

**How they complement SCVD:** SCVD provides breadth (7,769+ searchable findings by keyword). Case studies provide depth (detailed narratives of 15 major exploits). The `@pythia` agent uses both — SCVD for "has this pattern been seen before?" and case studies for "how did this type of exploit actually unfold?"

**Adding new case studies:**

1. Create a new directory under `skills/case-studies/<exploit-name>/`
2. Add a `SKILL.md` file with frontmatter (`name`, `description`, `category: reference`, `source_url`, `source_license`, `detection_rules`)
3. Include sections: Overview, Root Cause, Attack Flow, Impact, Key Transactions, Lessons
4. Add the entry to `skills/INVENTORY.md`

---

## Knowledge Ingestion Contract

All ingested knowledge sources must conform to a standardized metadata contract to ensure traceability, freshness, and compliance:

### Required Metadata Fields

Every knowledge source ingested into Argus must include:

- **`source`** — Human-readable source name (e.g., "Cyfrin", "Trail of Bits", "SCVD")
- **`url`** — Canonical URL to the source repository or API endpoint
- **`license`** — SPDX license identifier (e.g., "MIT", "Apache-2.0", "CC0")
- **`retrievedAt`** — ISO 8601 timestamp of when the knowledge was last fetched
- **`hash`** — SHA-256 hash of the ingested content for integrity verification
- **`version`** — Semantic version of the knowledge source (e.g., "1.2.3")
- **`provenance`** — Trust tier and source verification metadata

### Trust Tiers

Argus classifies knowledge sources into three trust tiers:

- **`bundled`** — Built-in skills and patterns. Highest trust, always available.
- **`companion`** — Installed separately (e.g., Trail of Bits). Medium trust.
- **`custom`** — User-provided skills in `customSkillsDir`. Lower trust, validated on load.

### Freshness Policy

Knowledge freshness is monitored automatically:

- **SCVD local index** — Stale if not synced within 7 days. `argus doctor` will warn if stale and suggest running `argus_sync_knowledge`.
- **Detection rules** — Versioned via `DETECTION_RULE_VERSION` and updated on package release.
- **Baked-in curated skills** — Updated only on package release; no automatic refresh.
- **On-demand live sources** — Retrieved per-request; never cached locally.

`argus doctor` reports the staleness of all indexed sources.

### Three Operating Modes

Argus supports three distinct knowledge ingestion patterns:

#### 1. Baked-in Curated
**Sources:** Cyfrin audit checklists, kadenzipfel vulnerability patterns, DeFiFoFum protocol guides

- Bundled directly with the plugin package
- Updated only on package release (via npm/bun)
- No network calls required; instant availability
- Example: `skills/checklists/cyfrin-defi-core.md`

#### 2. On-Demand Live
**Sources:** Solodit audit reports, SCVD real-time queries

- Retrieved per-request from external APIs
- Never cached locally; always fresh
- Network-dependent; graceful fallback if unavailable
- Example: `argus_solodit_search` queries Solodit's database on each call

#### 3. Hybrid Indexed
**Sources:** SCVD local index, Trail of Bits companion skills

- Local index synced periodically via `argus_sync_knowledge`
- Cached locally in `ARGUS_CACHE_DIR` (default: `~/.cache/solidity-argus/scvd-index.json`)
- Refreshed on-demand when `knowledge.autoSync: true`
- Trail of Bits skills git-cloned on install and updated via companion plugin
- Example: SCVD findings indexed locally, queried without network latency

---

## Configuration

Create `.argus/solidity-argus.jsonc` in your project root. `.opencode/solidity-argus.jsonc` remains supported as a project-level compatibility fallback:

```jsonc
{
  "agents": {
    "argus": { "model": "anthropic/claude-opus-4-8" },
    "sentinel": { "model": "anthropic/claude-sonnet-4-6" },
    "pythia": { "model": "anthropic/claude-sonnet-4-6" },
    "auditSpecialist": { "model": "anthropic/claude-sonnet-4-6" },
    "scribe": { "model": "anthropic/claude-sonnet-4-6" },
    "themis": { "model": "openai/gpt-5.5" }
  },

  "tools": {
    "slitherPath": "/usr/local/bin/slither",
    "forgePath": "/usr/local/bin/forge"
  },

  "knowledge": {
    "scvd": { "enabled": true, "apiUrl": "https://api.scvd.dev" },
    "autoSync": true,
    "customSkillsDir": "./my-custom-skills",
    "skillPrecedence": "bundled-first"
  },

  "reporting": {
    "format": "markdown",
    "severityThreshold": "low",
    "gasAnalysis": false
  },

  "solodit": {
    "enabled": true,
    "port": 54173
  },

  "disabled_hooks": [],

  "background": {
    "max_concurrent": 3
  }
}
```

---

## Context Delivery Architecture

Argus uses a **three-channel context delivery system** to inject dynamic audit state, methodology, and knowledge into agents at runtime. Each channel serves a distinct purpose:

### Decision Matrix: When to Use Each Channel

| Channel | Mechanism | Use Case | Scope | Mutability |
|---------|-----------|----------|-------|-----------|
| **Prompt** | Static agent identity files (`src/agents/*-prompt.ts`) | Methodology, personality, tool instructions, audit framework | Agent-specific | Never changes at runtime |
| **Hook** | `experimental.chat.system.transform` (agent-gated injection) | Audit progress, findings count, current phase, session state | Per-session | Changes every turn |
| **Skill-load** | `argus_skill_load` tool (on-demand) | Vulnerability patterns, protocol-specific knowledge, historical exploits | On-demand | Loaded when agent requests |
| **Skill discovery** | `argus_list_skills` / `argus_recommend_skills` | Metadata-only catalog search/recommendation before loading exact skills | On-demand | No full skill bodies exposed |

### Prompt Channel (Static Identity)

Each of the 6 Argus agents has a static prompt file defining its role, methodology, and tool instructions:

- `src/agents/argus-prompt.ts` — Orchestrator methodology (7-step audit framework)
- `src/agents/sentinel-prompt.ts` — Static analysis & testing instructions
- `src/agents/pythia-prompt.ts` — Vulnerability research methodology
- `src/agents/audit-specialist-prompt.ts` — Profile-driven adversarial review methodology
- `src/agents/scribe-prompt.ts` — Report generation format and structure
- `src/agents/themis-prompt.ts` — Independent validation and quality gate logic

These prompts **never change at runtime** and establish the agent's core identity and decision-making framework.

### Hook Channel (Dynamic State Injection)

The `experimental.chat.system.transform` hook injects dynamic audit state into the system context on every turn. This includes:

- Current audit phase (Reconnaissance, Automated Scanning, etc.)
- Findings discovered so far (count, severity distribution)
- Tools executed and their results
- Session-specific audit state (contract under review, scope, etc.)

**Critical Rule:** This hook is **Argus-family gated**. Only agents in `{argus, sentinel, pythia, audit-specialist, scribe, themis}` receive injected context. All other agents receive `undefined` (no injection).

**Session→Agent Mapping Pattern:**
1. `chat.params` hook captures `(sessionID, agentName)` pairs during each turn
2. `system.transform` hook looks up the agent by sessionID
3. If agent is in the Argus family, inject audit state; otherwise, return `undefined`

This prevents context pollution and ensures non-audit agents operate independently.

### Skill-Load Channel (On-Demand Knowledge)

Agents discover specialized knowledge with metadata-only `argus_list_skills` / `argus_recommend_skills` when the exact name is unknown, then load selected full knowledge on-demand via the `argus_skill_load` tool:

- **Vulnerability Patterns** — 60 SKILL.md files covering reentrancy, oracle manipulation, flash loans, ERC4626, governance, front-running, and more
- **Protocol Patterns** — 7 files for AMM/DEX, bridges, governance, lending, staking, concentrated liquidity, and liquid-staking/restaking
- **Methodology** — 12 files for audit workflow, report templates, severity classification, refutation rubric, and specialist profiles
- **Checklists** — 6 Cyfrin audit checklists
- **References** — 18 files for exploit index, vulnerable contract examples, attack-vector deck, and major DeFi exploit case studies

This channel is **lazy-loaded** — agents request skills only when needed, reducing context overhead.

### Implementation Notes

- **Dynamic injection:** `system.transform` uses agent-gated dynamic audit state injection via `createSystemPromptHook` (see `src/create-hooks.ts`).
- **Global transforms forbidden:** No global system context injection unless agent-gated and minimal. Prevents context window overflow.
- **Audit state persistence:** Active session state is stored under `.argus/sessions/state-{sessionId}.json` and archived to `.argus/archives/argus-state.{timestamp}.json` on teardown (see `Persistent Audit State` section).

---

## Modular Architecture

This release restructures solidity-argus into a modular factory-based architecture with several new infrastructure features:

### CLI Tools

Run diagnostics and setup from the command line:

```bash
# Check that Slither, Foundry, and SCVD are available
argus doctor

# Generate a starter .argus/solidity-argus.json config
argus init

# Validate SKILL.md files against schema
argus lint-skills

# Register solidity-argus in opencode.json (tools installed separately; see Requirements)
argus install
```

### Hook Enable/Disable

Selectively disable any hook via config:

```jsonc
{
  "disabled_hooks": ["context-monitor", "audit-enforcer"]
}
```

### Multi-Level Configuration

Config is resolved by merging three layers (last wins):

1. **Defaults** — Built-in sensible defaults
2. **User-level** — `~/.config/opencode/solidity-argus.jsonc`
3. **Project-level** — `.argus/solidity-argus.jsonc` (preferred) or `.opencode/solidity-argus.jsonc` (compatibility fallback)

### Background Agent Management

Background tasks (knowledge sync, long-running analysis) are tracked with configurable concurrency limits:

```jsonc
{
  "background": {
    "max_concurrent": 3
  }
}
```

### Persistent Audit State

Audit progress survives session restarts. Active runs persist to `.argus/sessions/state-{sessionId}.json` and teardown snapshots are archived to `.argus/archives/argus-state.{timestamp}.json`. `.opencode` remains a read fallback during migration.

### Error Recovery

Failed tool executions are captured with full context and automatically retried with exponential backoff when appropriate.

### Context Window Monitoring

Monitors token usage and adaptively reduces injection sizes when context pressure is high, preventing context window overflow during long audits.

---

## Companion Plugins

- **Trail of Bits Skills** — Additional security research skills from Trail of Bits auditors
- **Solodit MCP** — Direct MCP integration with Solodit's audit report database for richer vulnerability research

---

## Requirements

| Dependency | Required | Notes |
|------------|----------|-------|
| OpenCode | ✅ Required | The AI coding environment this plugin runs in |
| Bun | ✅ Required | `>=1.0.0` — runtime for the plugin |
| Slither | ⚠️ Optional | Enables `argus_slither_analyze`. Install: `pip install slither-analyzer` |
| Foundry/Forge | ⚠️ Optional | Enables `argus_forge_test` and `argus_forge_fuzz`. Install: `curl -L https://foundry.paradigm.xyz \| bash` |

If Slither or Foundry are unavailable, Argus gracefully falls back to manual review mode and notes the limitation in the audit report.

---

## License

MIT — see [LICENSE](./LICENSE) for details.
