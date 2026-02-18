# opencode-argus

**The All-Seeing Solidity Security Auditor for OpenCode**

`[npm version badge placeholder]` `[license badge placeholder]` `[bun badge placeholder]`

---

## Overview

**opencode-argus** is a security auditing plugin for [OpenCode](https://opencode.ai) that brings professional-grade Solidity smart contract auditing directly into your AI coding workflow.

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

Add `opencode-argus` to your OpenCode configuration:

```json
{
  "plugin": ["opencode-argus"]
}
```

Or install via npm/bun:

```bash
bun add opencode-argus
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
| `@scribe` | Audit report writer | claude-sonnet-4-5 |

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

**SCVD Integration:** The plugin connects to [api.scvd.dev](https://api.scvd.dev) for 7,769+ real-world audit findings. Sync with `argus_sync_knowledge` or configure `knowledge.autoSync: true`.

---

## Configuration

Create `.opencode/opencode-argus.jsonc` in your project root:

```jsonc
{
  // Agent model overrides (optional — defaults shown)
  "agents": {
    "argus": { "model": "anthropic/claude-opus-4-6" },
    "sentinel": { "model": "anthropic/claude-sonnet-4-6" },
    "pythia": { "model": "anthropic/claude-sonnet-4-6" },
    "scribe": { "model": "anthropic/claude-sonnet-4-5" }
  },

  // Tool paths (optional — auto-detected if in PATH)
  "tools": {
    "slitherPath": "/usr/local/bin/slither",
    "forgePath": "/usr/local/bin/forge"
  },

  // Knowledge base configuration
  "knowledge": {
    "scvd": {
      "enabled": true,
      "apiUrl": "https://api.scvd.dev"
    },
    "autoSync": true,
    // Optional: path to additional custom SKILL.md files
    "customSkillsDir": "./my-custom-skills"
  },

  // Reporting configuration
  "reporting": {
    "format": "markdown",
    // Minimum severity to include in reports: critical | high | medium | low | informational
    "severityThreshold": "low",
    "gasAnalysis": false
  },

  // Solodit integration
  "solodit": {
    "enabled": true
  }
}
```

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
