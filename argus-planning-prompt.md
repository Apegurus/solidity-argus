# Argus — The All-Seeing Solidity Security Agent

## Planning Prompt for OpenCode Plugin Development

---

## Mission

Build **Argus** (`opencode-argus`), an OpenCode plugin that provides an orchestrator + specialist agent system focused on Solidity smart contract security auditing, vulnerability detection, and best practices enforcement. Named after Argus Panoptes — the hundred-eyed guardian of Greek mythology — this plugin watches code from every angle, ensuring nothing escapes its gaze.

Argus is a **hybrid plugin**: it runs standalone as an independent OpenCode plugin, but includes integration hooks for Oh-My-OpenCode (OhO) so it can operate alongside Sisyphus and friends as a complementary specialist team.

---

## Architecture Overview

### Plugin Type
- OpenCode plugin (`@opencode-ai/plugin` SDK)
- TypeScript monorepo structure
- Published as npm package: `opencode-argus`
- Also usable as local plugin in `.opencode/plugins/`

### Agent Hierarchy (Orchestrator + Specialists)

```
ARGUS (Orchestrator)
├── MEDUSA (Static Analyzer) — Runs Slither, parses results, triages findings
├── PYTHIA (Researcher/Oracle) — Searches Solodit, vulnerability databases, researches exploit patterns
├── HOPLITE (Test Warrior) — Runs Foundry tests, fuzzing, writes PoC exploits
└── SCRIBE (Reporter) — Generates professional audit reports with severity classification
```

**Agent Naming Rationale (Greek Mythology Theme):**
- **Argus Panoptes** — "The All-Seeing" guardian with a hundred eyes. The orchestrator that sees everything and coordinates the audit.
- **Medusa** — Her gaze turned things to stone; she petrifies (freezes) bad code by catching vulnerabilities through static analysis. Her "many snakes" = many detectors running simultaneously.
- **Pythia** — The Oracle of Delphi who possessed divine knowledge. She consults the knowledge bases, past audits, and vulnerability databases to provide wisdom.
- **Hoplite** — Greek heavy infantry soldier. The warrior who actively attacks contracts through fuzzing and test execution, writing proof-of-concept exploits.
- **Scribe** — The Greek scribes who documented history. Transforms raw findings into structured, professional audit reports.

### Model Assignment (Multi-Model Approach)
Following OhO's pattern of assigning the right model to the right task:

| Agent | Role | Recommended Model | Rationale |
|-------|------|-------------------|-----------|
| Argus | Orchestrator | Opus 4.6 | Needs strongest reasoning for audit coordination and final judgment |
| Medusa | Static Analysis | Claude Sonnet 4.6 | Fast, reliable for parsing tool output and triaging |
| Pythia | Research | GPT5.2 / GPT-5.3-Codex | Excellent for deep research, large context windows for reading audit reports |
| Hoplite | Testing/Fuzzing | Claude Sonnet 4.5 | Good at code generation (test writing, PoC exploits) |
| Scribe | Reporting | Claude Sonnet 4.5 | Fast writing, good at structured document generation |

Models should be configurable via `opencode-argus.jsonc` config, following OhO's model resolution pipeline pattern (override → UI selection → provider cache → fallback chain).

---

## Core Custom Tools

The plugin registers these custom tools via the OpenCode plugin `tool()` helper:

### 1. `argus_slither_analyze`
```
Description: Run Slither static analysis on Solidity contracts
Args:
  - target: string (file path, directory, or "." for entire project)
  - detectors: string[] (optional — specific detectors to run, e.g., ["reentrancy-eth", "arbitrary-send-eth"])
  - exclude: string[] (optional — detectors to exclude)
  - solc_version: string (optional — specific solc version)
Execute:
  - Auto-detects project type (Hardhat/Foundry)
  - Runs `slither <target> --json -` to get structured output
  - Parses JSON results into categorized findings (Critical/High/Medium/Low/Informational)
  - Returns structured summary with file locations, confidence levels, and descriptions
```

### 2. `argus_forge_test`
```
Description: Run Foundry test suite with optional verbosity and filtering
Args:
  - match_test: string (optional — regex pattern for specific tests)
  - match_contract: string (optional — regex for specific test contracts)
  - fork_url: string (optional — RPC URL for mainnet forking)
  - verbosity: number (1-5, default 3)
  - gas_report: boolean (optional — include gas usage report)
Execute:
  - Runs `forge test` with specified options
  - Parses test results and gas reports
  - Returns structured pass/fail summary with gas analysis
```

### 3. `argus_forge_fuzz`
```
Description: Run Foundry fuzz testing with configurable parameters
Args:
  - match_test: string (optional — test pattern to fuzz)
  - runs: number (default 256, max 10000)
  - seed: number (optional — reproducible fuzzing)
  - fork_url: string (optional)
Execute:
  - Runs `forge test` with fuzz configuration
  - Captures any failing fuzz inputs as counterexamples
  - Returns fuzz results with counterexample analysis
```

### 4. `argus_solodit_search`
```
Description: Search Solodit vulnerability database for known issues related to specific patterns, protocols, or vulnerability types
Args:
  - query: string (search query — e.g., "reentrancy ERC4626 vault")
  - severity: string[] (optional — filter by ["Critical", "High", "Medium", "Low"])
  - limit: number (default 10)
Execute:
  - Queries Solodit MCP server or API
  - Returns matching vulnerability reports with impact, description, and remediation
  - Cross-references with current audit context
```

### 5. `argus_analyze_contract`
```
Description: Deep analysis of a Solidity contract — extracts entry points, state-changing functions, access control patterns, inheritance tree, external calls, and storage layout
Args:
  - file_path: string (path to .sol file)
Execute:
  - Parses Solidity AST (using solc --ast or forge inspect)
  - Identifies: public/external functions, modifiers, state variables, events
  - Maps: inheritance hierarchy, external call targets, delegatecall usage
  - Detects: access control patterns (Ownable, AccessControl, custom)
  - Returns structured contract profile
```

### 6. `argus_generate_report`
```
Description: Generate a professional audit report from accumulated findings
Args:
  - format: "markdown" | "pdf" | "json"
  - project_name: string
  - scope: string[] (contracts in scope)
  - include_executive_summary: boolean (default true)
Execute:
  - Aggregates all findings from the session
  - Deduplicates and correlates findings across tools
  - Generates report following professional audit report structure (similar to BailSec format)
  - Includes: Executive Summary, Scope, Methodology, Findings (by severity), Recommendations
```

### 7. `argus_check_patterns`
```
Description: Check contracts against curated vulnerability pattern database (built from BailSec audits, Solodit findings, and common DeFi exploit patterns)
Args:
  - target: string (file or directory)
  - patterns: string[] (optional — specific pattern categories to check, e.g., ["reentrancy", "oracle-manipulation", "flash-loan", "access-control", "erc4626"])
Execute:
  - Runs pattern matching against curated knowledge base
  - Cross-references with known vulnerability signatures
  - Returns matches with severity, description, and real-world exploit references
```

---

## Knowledge System (Three-Layer Architecture)

### Layer 1: Baked-In Knowledge Base (Shipped with Plugin)
Curated markdown files extracted from real audit reports and vulnerability databases, organized by category:

```
knowledge/
├── vulnerability-patterns/
│   ├── reentrancy.md          # Patterns, examples, mitigations from real audits
│   ├── oracle-manipulation.md
│   ├── flash-loan-attacks.md
│   ├── access-control.md
│   ├── integer-overflow.md
│   ├── front-running-mev.md
│   ├── delegatecall-proxy.md
│   ├── erc4626-vault.md
│   ├── cross-chain-bridge.md
│   ├── governance-attacks.md
│   ├── price-manipulation.md
│   ├── donation-attacks.md
│   └── signature-replay.md
├── protocol-patterns/
│   ├── amm-dex.md            # Common AMM security considerations
│   ├── lending-borrowing.md
│   ├── staking-vesting.md
│   ├── token-standards.md     # ERC20/721/1155 pitfalls
│   └── upgradeable-contracts.md
├── checklists/
│   ├── general-audit.md       # Derived from Cyfrin/audit-checklist (380+ items)
│   ├── defi-specific.md
│   ├── gas-optimization.md
│   └── best-practices.md
└── exploit-case-studies/
    ├── dao-hack-2016.md
    ├── parity-multisig-2017.md
    ├── bZx-flash-loan-2020.md
    ├── euler-finance-2023.md
    ├── nomad-bridge-2022.md
    └── ... (top 20-30 most instructive exploits)
```

**Sources to extract from:**
- **BailSec repo** (https://github.com/bailsec/BailSec) — 60+ professional audit PDFs covering 1inch, Euler, Gamma, Camelot, Smardex, Uniswap V4, etc. Extract key vulnerability patterns, common findings, and severity classifications.
- **Cyfrin/audit-checklist** (https://github.com/Cyfrin/audit-checklist) — 380+ audit checklist items
- **TradMod/awesome-audits-checklists** (https://github.com/TradMod/awesome-audits-checklists) — Meta-collection of audit checklists
- **smartbugs/smartbugs-curated** (https://github.com/smartbugs/smartbugs-curated) — Annotated vulnerable contracts dataset
- **sirhashalot/SCV-List** (https://github.com/sirhashalot/SCV-List) — Mainnet vulnerability database
- **Trail of Bits building-secure-contracts** (https://github.com/crytic/building-secure-contracts) — ToB's security guidelines

### Layer 2: MCP Server Integration (On-Demand)
- **Solodit MCP Server** — Real-time search of 8,000+ vulnerability database entries
- **Exa/Web Search** — Research latest exploits, CVEs, and security advisories (reuse OhO's if available)
- **Context7** — Look up official Solidity docs, OpenZeppelin docs (reuse OhO's if available)

### Layer 3: Project Context (Runtime)
- Auto-detect project structure (Hardhat vs Foundry vs mixed)
- Parse `foundry.toml`, `hardhat.config.ts`, `remappings.txt`
- Read existing test files to understand coverage
- Analyze `package.json`/dependencies for known vulnerable library versions
- Check for existing audit reports in the project

---

## System Prompt Injection

Via `experimental.chat.system.transform` hook, inject Solidity security context:

```typescript
"experimental.chat.system.transform": async (input, output) => {
  output.system.push(`
<argus-context>
You are Argus Panoptes, the All-Seeing Guardian — a Solidity smart contract security specialist.

## Your Capabilities
- Run Slither static analysis via argus_slither_analyze
- Execute Foundry tests and fuzzing via argus_forge_test / argus_forge_fuzz
- Search 8,000+ known vulnerabilities via argus_solodit_search
- Deep contract analysis via argus_analyze_contract
- Pattern matching against curated vulnerability database via argus_check_patterns
- Professional audit report generation via argus_generate_report

## Audit Methodology
When auditing, follow this systematic approach:
1. **Reconnaissance**: Understand the project structure, dependencies, and scope
2. **Automated Scanning**: Run Slither and pattern checks to catch low-hanging fruit
3. **Manual Review**: Deep-dive into business logic, access control, and state management
4. **Attack Surface Mapping**: Identify entry points, external calls, and trust boundaries
5. **Vulnerability Research**: Cross-reference patterns with known exploits via Solodit
6. **Testing**: Write and run targeted tests/fuzzing for suspected vulnerabilities
7. **Reporting**: Generate findings with severity, impact, PoC, and remediation

## Severity Classification
- **Critical**: Direct loss of funds, protocol takeover, or irreversible state corruption
- **High**: Conditional loss of funds, significant protocol disruption, or privilege escalation
- **Medium**: Temporary DoS, griefing, minor fund leakage, or gas manipulation
- **Low**: Code quality, gas optimization, or minor deviations from best practices
- **Informational**: Suggestions, style improvements, documentation gaps

## Key Principles
- Never assume code is safe — verify every assumption
- Check access control on EVERY state-changing function
- Trace the flow of funds through all paths
- Consider multi-transaction attack sequences (flash loans, sandwich attacks)
- Verify that all external calls follow checks-effects-interactions pattern
- Look for the "second-order" effects of state changes
- Question every invariant — can it be violated through unexpected sequences?
</argus-context>
  `)
}
```

---

## Plugin Hooks

### Core Hooks
```typescript
// System prompt injection with audit context
"experimental.chat.system.transform": async (input, output) => { ... }

// Compaction hook — preserve audit state across compactions
"experimental.session.compacting": async (input, output) => {
  output.context.push(`
    <argus-audit-state>
    Contracts audited: ${auditState.contractsReviewed.join(", ")}
    Findings so far: ${auditState.findings.length} (${auditState.findingsBySeverity})
    Tools run: ${auditState.toolsExecuted.join(", ")}
    Current phase: ${auditState.currentPhase}
    </argus-audit-state>
  `)
}

// Tool output processing — parse and enrich Slither/Forge output
"tool.execute.after": async (input, output) => {
  if (input.tool.startsWith("argus_")) {
    // Track findings, update audit state
  }
}

// Session events — initialize/cleanup audit state
event: async ({ event }) => {
  if (event.type === "session.created") { /* init audit state */ }
  if (event.type === "session.idle") { /* save progress */ }
}
```

### OhO Integration Hooks (When OhO is present)
```typescript
// Register Argus as a delegatable agent in OhO's system
// Sisyphus can delegate security tasks to Argus like:
// "Argus, audit the contracts in src/vaults/"

// Detect OhO presence and register as a specialist category
if (ohoDetected) {
  // Register as "security" category agent
  // Expose argus_audit_full as a background task target
  // Hook into OhO's todo system for security-related todos
}
```

---

## Configuration Schema

`opencode-argus.jsonc` (project-level) or `~/.config/opencode/opencode-argus.jsonc` (global):

```jsonc
{
  // Agent model overrides
  "agents": {
    "argus": { "model": "claude-opus-4-7" },
    "medusa": { "model": "claude-sonnet-4-6" },
    "pythia": { "model": "gemini-2.5-pro" },
    "hoplite": { "model": "claude-sonnet-4-6" },
    "scribe": { "model": "claude-sonnet-4-6" }
  },

  // Tool configuration
  "tools": {
    "slither": {
      "enabled": true,
      "path": "slither",          // or custom path
      "default_detectors": [],     // empty = all
      "exclude_detectors": ["naming-convention"]
    },
    "foundry": {
      "enabled": true,
      "forge_path": "forge",
      "default_fuzz_runs": 256,
      "fork_url": ""               // default RPC for mainnet forking
    },
    "solodit": {
      "enabled": true
      // MCP server config handled separately
    }
  },

  // Knowledge base
  "knowledge": {
    "use_builtin": true,           // use baked-in knowledge
    "custom_patterns_dir": "",     // path to additional pattern files
    "auto_research": true          // auto-search Solodit during audit
  },

  // Report settings
  "reporting": {
    "default_format": "markdown",
    "include_gas_analysis": true,
    "include_test_coverage": true,
    "severity_threshold": "low"    // minimum severity to include
  },

  // OhO integration
  "oho_integration": {
    "enabled": true,               // auto-detected, but can force off
    "register_as_category": "security",
    "allow_background_delegation": true
  }
}
```

---

## File Structure

```
opencode-argus/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
├── AGENTS.md                           # Agent descriptions for OpenCode
├── src/
│   ├── index.ts                        # Plugin entry point — exports ArgusPlugin
│   ├── plugin-config.ts                # Config schema and loading
│   ├── agents/
│   │   ├── index.ts                    # Agent registry
│   │   ├── argus-orchestrator.ts       # Main orchestrator logic
│   │   ├── medusa-analyzer.ts          # Static analysis specialist
│   │   ├── pythia-researcher.ts        # Vulnerability research specialist
│   │   ├── hoplite-tester.ts           # Testing/fuzzing specialist
│   │   └── scribe-reporter.ts          # Report generation specialist
│   ├── tools/
│   │   ├── index.ts                    # Tool registry
│   │   ├── slither-tool.ts             # Slither integration
│   │   ├── forge-test-tool.ts          # Forge test runner
│   │   ├── forge-fuzz-tool.ts          # Forge fuzz runner
│   │   ├── solodit-search-tool.ts      # Solodit MCP/API integration
│   │   ├── contract-analyzer-tool.ts   # Deep contract analysis
│   │   ├── pattern-checker-tool.ts     # Knowledge base pattern matching
│   │   └── report-generator-tool.ts    # Audit report generation
│   ├── hooks/
│   │   ├── index.ts                    # Hook registry
│   │   ├── system-prompt-hook.ts       # System prompt injection
│   │   ├── compaction-hook.ts          # Audit state preservation
│   │   ├── tool-tracking-hook.ts       # Finding accumulation
│   │   └── oho-integration-hook.ts     # OhO compatibility layer
│   ├── knowledge/
│   │   ├── index.ts                    # Knowledge base loader
│   │   ├── vulnerability-patterns/     # Curated vulnerability patterns (markdown)
│   │   ├── protocol-patterns/          # Protocol-specific security patterns
│   │   ├── checklists/                 # Audit checklists
│   │   └── exploit-case-studies/       # Real-world exploit analyses
│   ├── state/
│   │   ├── audit-state.ts              # Session audit state management
│   │   └── finding-store.ts            # Finding accumulation and dedup
│   └── utils/
│       ├── solidity-parser.ts          # AST parsing utilities
│       ├── project-detector.ts         # Hardhat/Foundry auto-detection
│       └── severity-classifier.ts      # Finding severity classification
├── docs/
│   ├── installation.md
│   ├── configuration.md
│   ├── agents.md
│   ├── tools-reference.md
│   └── oho-integration.md
└── tests/
    ├── tools/
    ├── hooks/
    └── fixtures/                       # Sample Solidity contracts for testing
```

---

## Phase 1 Implementation Plan

### Step 1: Scaffold & Core Plugin
- Initialize project with `bun init`
- Set up TypeScript config, build pipeline
- Implement basic plugin entry point (`src/index.ts`)
- Implement config schema and loader
- Register with OpenCode plugin system

### Step 2: Custom Tools (Medusa's Arsenal)
- Implement `argus_slither_analyze` — most critical tool
- Implement `argus_forge_test` and `argus_forge_fuzz`
- Implement `argus_analyze_contract` (AST parsing)
- Implement `argus_solodit_search` (MCP integration)
- Test each tool independently

### Step 3: Knowledge Base Construction
- Extract and curate patterns from BailSec audit PDFs (top 20-30 most relevant)
- Process Cyfrin audit checklist into structured markdown
- Write vulnerability pattern files with real examples and mitigations
- Create protocol-specific security guides (AMM, lending, vaults, etc.)
- Write 15-20 exploit case studies from major historical hacks

### Step 4: System Prompt & Hooks
- Implement `experimental.chat.system.transform` with full audit context
- Implement compaction hook to preserve audit state
- Implement tool tracking hook for finding accumulation
- Implement session event handlers

### Step 5: Agent Orchestration
- Define agent prompts/personas for each specialist
- Implement background agent spawning (delegate to Medusa, Pythia, etc.)
- Implement Argus orchestration logic (which specialist to call when)
- Wire up finding deduplication and correlation

### Step 6: Report Generation
- Implement `argus_generate_report` with professional structure
- Support markdown output (PDF as stretch goal)
- Include executive summary generation
- Auto-classify and deduplicate findings

### Step 7: OhO Integration
- Detect OhO presence at plugin load
- Register Argus agents as delegatable specialists
- Hook into OhO's category system
- Support background task delegation from Sisyphus

### Step 8: Testing & Polish
- Create test fixture Solidity contracts with known vulnerabilities
- End-to-end test: full audit pipeline on test project
- Documentation
- npm package preparation and publish

---

## Key Commands / Interaction Patterns

Users interact with Argus through natural language in OpenCode:

```
# Full audit
"Argus, audit the contracts in src/contracts/"

# Quick security check
"Run a quick security scan on VaultStrategy.sol"

# Specific vulnerability research
"Check if this vault contract is vulnerable to donation attacks"

# Interactive deep-dive
"Analyze the access control in GovernanceToken.sol — who can mint?"

# Generate report
"Generate an audit report for the Vault contracts"

# Pattern-specific check
"Check all contracts for reentrancy and oracle manipulation patterns"

# Research mode
"Research recent ERC4626 vault exploits and check our implementation against them"
```

---

## Dependencies

### Runtime Dependencies
- `@opencode-ai/plugin` — OpenCode plugin SDK
- `zod` — Schema validation for tool args

### Peer Dependencies (User Must Have Installed)
- `slither-analyzer` — Python package (`pip install slither-analyzer`)
- `foundry` — Forge, Cast, Anvil (`curl -L https://foundry.paradigm.xyz | bash`)
- `solc` — Solidity compiler (managed by Foundry or standalone)

### Development Dependencies
- `typescript`
- `bun` (build tool)
- `@types/bun`

---

## Success Criteria

1. **Tool Integration**: All 7 custom tools execute correctly and return structured results
2. **Knowledge Quality**: Vulnerability pattern database covers top 50 most common Solidity issues with real-world examples
3. **Orchestration**: Argus correctly delegates to specialists and synthesizes results
4. **Report Generation**: Produces audit reports comparable in structure to BailSec's professional reports
5. **OhO Compatibility**: Seamlessly operates alongside OhO when present, standalone when not
6. **Developer Experience**: Simple install (`plugin: ["opencode-argus"]`), auto-detects project type, works out of the box

---

## References

- OpenCode Plugin Docs: https://opencode.ai/docs/plugins/
- OpenCode Custom Tools: https://opencode.ai/docs/custom-tools/
- Oh-My-OpenCode: https://github.com/code-yeongyu/oh-my-opencode
- Trail of Bits Skills: https://github.com/trailofbits/skills
- BailSec Audit Reports: https://github.com/bailsec/BailSec
- Cyfrin Audit Checklist: https://github.com/Cyfrin/audit-checklist
- Solodit Vulnerability DB: https://solodit.cyfrin.io
- SmartBugs Curated: https://github.com/smartbugs/smartbugs-curated
- SCV-List: https://github.com/sirhashalot/SCV-List
- Awesome Audit Checklists: https://github.com/TradMod/awesome-audits-checklists
- Slither: https://github.com/crytic/slither
- Foundry: https://github.com/foundry-rs/foundry
- Solodit MCP Server: https://www.pulsemcp.com/servers/lyuboslavlyubenov-solodit
