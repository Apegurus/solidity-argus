# solidity-argus

**The All-Seeing Solidity Security Auditor for OpenCode**

[![npm version](https://img.shields.io/npm/v/solidity-argus)](https://www.npmjs.com/package/solidity-argus) [![license](https://img.shields.io/npm/l/solidity-argus)](./LICENSE)

---

## Overview

**solidity-argus** is a security auditing plugin for [OpenCode](https://opencode.ai) that brings professional-grade Solidity smart contract auditing directly into your AI coding workflow.

Argus Panoptes — the mythological all-seeing giant — orchestrates a team of 4 specialized AI agents to conduct comprehensive security audits: static analysis, vulnerability research, dynamic testing, and professional report generation.

**What it does:**
- Runs Slither static analysis and Foundry tests automatically
- Searches 7,769+ real-world audit findings via SCVD and Solodit
- Matches code against 55 curated vulnerability pattern files
- Generates professional markdown audit reports with severity classifications
- Follows a rigorous 7-step audit methodology (Reconnaissance → Report)

**Why it's useful:**
- Catches reentrancy, oracle manipulation, access control flaws, flash loan vectors, and 35+ other vulnerability classes
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
| `@argus` | Orchestrator — coordinates the full audit | claude-opus-4-6 |
| `@sentinel` | Static analysis & testing specialist | claude-sonnet-4-6 |
| `@pythia` | Vulnerability researcher | claude-sonnet-4-6 |
| `@scribe` | Audit report writer | claude-sonnet-4-6 |

### @argus — The Orchestrator
Argus Panoptes is the lead auditor. It follows a 7-step methodology (Reconnaissance, Automated Scanning, Manual Review, Attack Surface Mapping, Vulnerability Research, Testing & Verification, Reporting) and delegates to Sentinel, Pythia, and Scribe as needed.

### @sentinel — The Executor
Runs Slither, writes and executes Foundry tests, performs fuzz testing. Your tactical executor for all dynamic and static analysis tasks.

### @pythia — The Researcher
Searches Solodit and SCVD for historical exploits, checks vulnerability pattern databases, and provides research context for similar protocols and known attack vectors.

### @scribe — The Reporter
Transforms raw findings into professional, structured markdown audit reports with severity classifications, impact assessments, and actionable recommendations.

---

## Tools

| Tool | Agent | Description |
|------|-------|-------------|
| `argus_slither_analyze` | Sentinel | Runs Slither static analysis on Solidity contracts; detects reentrancy, uninitialized variables, unchecked returns, and more |
| `argus_analyze_contract` | Sentinel | Generates a deep structural profile of a contract: functions, state variables, modifiers, inheritance tree |
| `argus_check_patterns` | Sentinel, Pythia | Scans code against a library of complex vulnerability patterns (regex/AST-based) covering 35+ vulnerability classes |
| `argus_solodit_search` | Pythia | Searches Solodit's database of real-world audit reports for similar protocols and historical findings |
| `argus_forge_test` | Sentinel | Runs existing or newly written Foundry/Forge tests; essential for PoC verification |
| `argus_forge_fuzz` | Sentinel | Fuzzes specific functions with random inputs to find edge cases and invariant violations |
| `argus_generate_report` | Scribe | Generates the final structured audit report in professional markdown format |
| `argus_sync_knowledge` | Argus | Syncs the local vulnerability database from SCVD (api.scvd.dev) |

---

## Knowledge Base

The plugin ships with **55 curated SKILL.md files** organized into 5 categories:

| Category | Files | Description |
|----------|-------|-------------|
| Vulnerability Patterns | 38 | Reentrancy, oracle manipulation, flash loans, access control, overflow/underflow, and 33 more |
| Methodology | 3 | Audit workflow, report templates, severity classification |
| Protocol Patterns | 5 | AMM/DEX, bridges, governance, lending, staking security guides |
| Checklists | 6 | Cyfrin audit checklists (DeFi core, integrations, upgrades, gas, best practices) |
| References | 2 | DeFi exploit reference index, SmartBugs vulnerable contract examples |

**Sources:** Trail of Bits, Cyfrin, DeFiFoFum, kadenzipfel, SunWeb3Sec, smartbugs

### Pattern Packs

Pattern packs are YAML files containing collections of regular expression patterns used for vulnerability detection. These packs allow Argus to scan code for known security flaws without requiring full static analysis tools.

- **Location:** `skills/patterns/`
- **Available Packs:**
  - `access-control.yaml` — Ownership and permission checks
  - `erc4626.yaml` — Vault standard security patterns
  - `flash-loan.yaml` — Flash loan attack vectors
  - `oracle.yaml` — Price manipulation and staleness checks
  - `proxy.yaml` — Upgradeability and initialization flaws
  - `reentrancy.yaml` — State change and external call ordering
  - `signature.yaml` — Malleability and replay protection

#### Custom Pattern Packs

You can create custom pattern packs by adding YAML files to your configured `customSkillsDir`. Each pack must follow this structure:

```yaml
pack_name: "My Custom Pack"
pack_version: "1.0"
patterns:
  - name: "Insecure Transfer"
    category: "access-control"
    severity: "High"
    regex: "transfer\\(msg\\.sender, .+\\)"
    description: "Detects potentially insecure transfers to the caller"
```

**SCVD Integration:** The plugin connects to [api.scvd.dev](https://api.scvd.dev) for 7,769+ real-world audit findings. Sync with `argus_sync_knowledge` or configure `knowledge.autoSync: true`.

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
- **Pattern packs** — Versioned via `PATTERN_PACK_VERSION` and updated on package release.
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
- Cached locally in `~/.cache/opencode-argus/scvd-index.json`
- Refreshed on-demand when `knowledge.autoSync: true`
- Trail of Bits skills git-cloned on install and updated via companion plugin
- Example: SCVD findings indexed locally, queried without network latency

---

## Configuration

Create `.opencode/solidity-argus.jsonc` in your project root:

```jsonc
{
  "agents": {
    "argus": { "model": "anthropic/claude-opus-4-6" },
    "sentinel": { "model": "anthropic/claude-sonnet-4-6" },
    "pythia": { "model": "anthropic/claude-sonnet-4-6" },
    "scribe": { "model": "anthropic/claude-sonnet-4-6" }
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
    "port": 3000
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

### Prompt Channel (Static Identity)

Each of the 4 Argus agents has a static prompt file defining its role, methodology, and tool instructions:

- `src/agents/argus-prompt.ts` — Orchestrator methodology (7-step audit framework)
- `src/agents/sentinel-prompt.ts` — Static analysis & testing instructions
- `src/agents/pythia-prompt.ts` — Vulnerability research methodology
- `src/agents/scribe-prompt.ts` — Report generation format and structure

These prompts **never change at runtime** and establish the agent's core identity and decision-making framework.

### Hook Channel (Dynamic State Injection)

The `experimental.chat.system.transform` hook injects dynamic audit state into the system context on every turn. This includes:

- Current audit phase (Reconnaissance, Automated Scanning, etc.)
- Findings discovered so far (count, severity distribution)
- Tools executed and their results
- Session-specific audit state (contract under review, scope, etc.)

**Critical Rule:** This hook is **Argus-family gated**. Only agents in `{argus, sentinel, pythia, scribe}` receive injected context. All other agents receive `undefined` (no injection).

**Session→Agent Mapping Pattern:**
1. `chat.params` hook captures `(sessionID, agentName)` pairs during each turn
2. `system.transform` hook looks up the agent by sessionID
3. If agent is in the Argus family, inject audit state; otherwise, return `undefined`

This prevents context pollution and ensures non-audit agents operate independently.

### Skill-Load Channel (On-Demand Knowledge)

Agents load specialized knowledge on-demand via the `argus_skill_load` tool:

- **Vulnerability Patterns** — 38 SKILL.md files covering reentrancy, oracle manipulation, flash loans, etc.
- **Protocol Patterns** — 5 files for AMM/DEX, bridges, governance, lending, staking
- **Methodology** — 3 files for audit workflow, report templates, severity classification
- **Checklists** — 6 Cyfrin audit checklists
- **References** — 2 files for exploit index and vulnerable contract examples

This channel is **lazy-loaded** — agents request skills only when needed, reducing context overhead.

### Implementation Notes

- **Phase 1 (Current):** `system.transform` is `undefined` (line 84 in `src/create-hooks.ts`). Agent-gated injection will replace this in Phase 2.
- **Global transforms forbidden:** No global system context injection unless agent-gated and minimal. Prevents context window overflow.
- **Audit state persistence:** State is saved to `.opencode/argus-state.json` and restored on session restart (see `Persistent Audit State` section).

---

## New in v2: Modular Architecture

This release restructures solidity-argus into a modular factory-based architecture with several new infrastructure features:

### CLI Tools

Run diagnostics and setup from the command line:

```bash
# Check that Slither, Foundry, and SCVD are available
argus doctor

# Generate a starter .opencode/solidity-argus.jsonc config
argus init

# Validate SKILL.md files against schema
argus lint-skills

# Install optional dependencies (Slither, Foundry)
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
2. **User-level** — `~/.config/solidity-argus/config.jsonc`
3. **Project-level** — `.opencode/solidity-argus.jsonc`

### Background Agent Management

Background tasks (knowledge sync, long-running analysis) are tracked with configurable concurrency limits and lifecycle callbacks:

```jsonc
{
  "background": {
    "max_concurrent": 3,
    "cleanup_interval_ms": 60000
  }
}
```

### Persistent Audit State

Audit progress survives session restarts. State is saved to `.opencode/argus-state.json` and automatically restored on next session.

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
