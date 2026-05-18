# Batch 1 — Flagship Solidity Audit Skills: Competitive Analysis

> Source: https://github.com/pashov/ai-web3-security
> Generated: 2026-05-18
> Methodology: Medium-depth review — README, repo tree, key SKILL.md + agent prompts + judging rubrics.
> Scope: 8 repos — the Solidity-focused subset of the hub directory.

---

## Repos analyzed

| # | Repo | ⭐ | License | Stack | Type | Last push |
|---|------|----|---------|-------|------|-----------|
| 1 | [pashov/skills](https://github.com/pashov/skills) | **720** | MIT | Python/Shell | Skill collection (2 skills) | 2026-04-22 |
| 2 | [OpenZeppelin/openzeppelin-skills](https://github.com/OpenZeppelin/openzeppelin-skills) | **176** | AGPL-3.0 | Markdown-only | Skill collection (9 skills, multi-lang) | 2026-04-14 |
| 3 | [Cyfrin/solskill](https://github.com/Cyfrin/solskill) | **138** | AGPL-3.0 | Markdown-only | Skill collection (3 skills) | 2026-05-06 |
| 4 | [Archethect/sc-auditor](https://github.com/Archethect/sc-auditor) | **104** | (none listed) | **TypeScript** | MCP server + skill | 2026-03-13 |
| 5 | [kadenzipfel/scv-scan](https://github.com/kadenzipfel/scv-scan) | **98** | (none) | Markdown-only | Single skill | 2026-03-11 |
| 6 | [alt-research/SolidityGuard](https://github.com/alt-research/SolidityGuard) | **92** | Proprietary | Python + Tauri | Skill + CLI + Desktop + Web | 2026-04-22 |
| 7 | [DarkNavySecurity/web3-skills](https://github.com/DarkNavySecurity/web3-skills) | **66** | MIT | Python/Markdown | Skill collection (3 skills) | 2026-05-09 |
| 8 | [CDSecurity/cdsecurity-skills](https://github.com/CDSecurity/cdsecurity-skills) | **31** | MIT | Shell/Markdown | Skill collection (2 skills) | 2026-04-08 |

Excluded as too small / inactive / not Solidity audit focus: `quillai-network/qs_skills`, `auditmos/skills`, `Archethect/sc-auditor` (we kept it — it's substantial), `KannAILabs/Solidity-AI-security-auditor`, `zerocoolailabs/ZeroSkills`. Will note any standout in the cross-cutting section.

---

## Per-repo deep-dive

### 1. pashov/skills :: solidity-auditor + x-ray (THE FLAGSHIP)

**One-line**: Two Claude Code skills — `solidity-auditor` (fast <5min security feedback) and `x-ray` (pre-audit recon with threat model, invariants, entry points, git analysis).

#### Architecture: solidity-auditor

A **single orchestrator skill** that spawns **8 parallel specialized "hacking agents"** via a bundle-file pattern. From [`solidity-auditor/SKILL.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/SKILL.md):

```
Turn 1 — Discover. Parallel: find .sol, glob references, Read VERSION, fetch remote VERSION
Turn 2 — Prepare. Build 8 agent bundles via `cat` (source.md + agent-specific files)
Turn 3 — Spawn. 8 parallel foreground Agent calls
Turn 4 — Deduplicate, validate, output (single-pass)
```

The **8 specialized hacking agents** ([`references/hacking-agents/`](https://github.com/pashov/skills/tree/main/solidity-auditor/references/hacking-agents)):

| Agent | Specialty (one-line) |
|---|---|
| `vector-scan-agent` | Scans against the master `attack-vectors.md` (110KB knowledge base) |
| `math-precision-agent` | Rounding, precision loss, division-before-mult |
| `access-control-agent` | "You are an attacker that exploits permission models" — maps roles, hijacks init, escalates, confused deputies |
| `economic-security-agent` | "Unlimited capital and flash loans" — breaks dependencies, exploits FoT/rebase, atomic extract, ERC compliance |
| `execution-trace-agent` | Cross-function state flow / reentrancy paths |
| `invariant-agent` | Math invariants that should always hold |
| `periphery-agent` | Edge cases, external integrations |
| `first-principles-agent` | First-principles reasoning (no patterns — derive from semantics) |

Plus [`shared-rules.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/references/hacking-agents/shared-rules.md): cross-cutting rules every agent inherits ("weaponize that pattern across every other contract", "every FINDING must have a `proof:` field", "one vulnerability per item").

#### Architecture: x-ray

Pre-audit scan with **Python scripts** — [`scripts/analyze_git_security.py`](https://github.com/pashov/skills/blob/main/x-ray/scripts/analyze_git_security.py), [`scripts/enumerate.sh`](https://github.com/pashov/skills/blob/main/x-ray/scripts/enumerate.sh), [`scripts/generate_svg.py`](https://github.com/pashov/skills/blob/main/x-ray/scripts/generate_svg.py). References: `threats.md` (48KB), `templates.md` (46KB). Output: **threat model, invariants, entry points, git-history security analysis, visual SVG diagrams.**

#### Methodology — judging rubric

[`references/judging.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/references/judging.md): **4 sequential gates**:

1. **Refutation** — Construct the strongest argument the finding is wrong. Concrete refutation → REJECTED. Speculative → continues.
2. **Reachability** — Prove vulnerable state exists in a live deployment. Structurally impossible → REJECTED. Requires privileged action → DEMOTE.
3. **Trigger** — Prove unprivileged actor executes the attack profitably. Costs exceed extraction → REJECTED.
4. **Impact** — Material harm to identifiable victim. Self-harm → REJECTED. Dust-level → DEMOTE.

**Confidence scoring**: Start at 100, deduct -20 partial path / -15 bounded impact / -10 specific state. ≥80 gets description + fix. Below: description only.

**Safe-patterns list** (do not flag): `unchecked` in 0.8+, explicit narrowing casts in 0.8+, MINIMUM_LIQUIDITY burn, SafeERC20, `nonReentrant` (only flag cross-contract), two-step admin transfer.

**Do Not Report**: linter/compiler issues, gas opts, naming, NatSpec, admin-by-design, missing events, centralization without exploit path.

#### Eval system (CRITICAL)

[`evals/runner.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/evals/runner.md) + [`evals/compare.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/evals/compare.md) + 3 ground-truth benchmark files ([`benchmarks/dodo.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/evals/benchmarks/dodo.md), `megapot.md`, `pooltogether.md`).

Runner: shallow-clones each benchmark repo into `/tmp/eval-{name}`, runs `claude --print --plugin-dir /tmp/audit-plugin "run solidity auditor skill"`, compares output to ground truth, writes `summary.md` with recall metrics (FOUND / LEAD / MISSED, per-severity).

This is **a working measurement harness** — they can quantify whether a prompt edit improves or regresses detection.

#### Output format

[`report-formatting.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/references/report-formatting.md): Sorted findings by confidence (highest first), threshold cutoff (≥80 gets Fix block, <80 description only), separate "Leads" section, mandatory disclaimer, hard-coded path `assets/findings/{project}-pashov-ai-audit-report-{YYYYMMDD-HHMMSS}.md`.

#### UX & install

Trigger via Claude Code natural language:
```
Install https://github.com/pashov/skills/ and run solidity auditor with all different agents possible on the codebase
update skills to latest version
```

Skill auto-checks remote VERSION, prints `⚠️ You are not using the latest version. Please upgrade for best security coverage.` on mismatch.

#### Gap vs solidity-argus

- ✅ We have: multi-agent (5 generic), audit phases, severity, persistent state, knowledge skills, slither integration
- ⚠️ Partial: we have `themis` for validation; they have 4-gate sequential rubric
- ❌ **Missing in us — HIGH PRIORITY**:
  - **Specialized vulnerability-class hunt agents** (math / access-control / economic / invariant / periphery / first-principles / execution-trace / vector-scan). Our `sentinel` is generic.
  - **Eval/benchmark harness** with real protocols (DODO, megapot, pooltogether) + automatic ground-truth comparison.
  - **`x-ray` pre-audit recon skill** — git history security analysis, threat model generation, SVG diagrams.
  - **Confidence numeric scoring** (0-100) with deduction rules.
  - **`proof:` field MANDATORY for every FINDING** — concrete values/trace required.
  - **`group_key` deduplication format** (`Contract | function | bug-class`).
  - **Safe-patterns explicit allowlist** (don't flag).
  - **Composite chain detection** ("if A feeds into B's precondition…").
  - **Remote VERSION check + upgrade warning**.
- 💡 Borrow:
  - 4-gate sequential rubric structure ([`judging.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/references/judging.md))
  - Bundle-file pattern (source + agent-specific) for parallel agents
  - Shared-rules.md pattern — common rules every agent inherits

---

### 2. DarkNavySecurity/web3-skills (Track record: $22K Immunefi)

**One-line**: 3 skills — `contract-auditor` (Solidity), `client-auditor` (Go/Rust/C node software), `exploit-investigator` (on-chain forensics + PoC).

#### Architecture: contract-auditor

6-stage **orchestrator** ([`contract-auditor/SKILL.md`](https://github.com/DarkNavySecurity/web3-skills/blob/main/contract-auditor/SKILL.md)):

```
Stage 1 — Reconnaissance (file discovery, version check)
Stage 2 — Context Building & Analysis (SINGLE subagent does both — context map + threat/trust/allocation plan)
Stage 3 — Delegated Hunting (parallel hunt agents per allocated call-paths)
Stage 4 — Merge, Dedup, Coverage Assessment (Entry Point Census ground truth)
Stage 5 — Adversarial Challenge (DEEP mode only)
Stage 6 — Report
```

**State checkpoints** preserved across context compaction — every stage writes `{temp_dir}/...` files and reloads from disk.

Sub-agents ([`references/agents/`](https://github.com/DarkNavySecurity/web3-skills/tree/main/contract-auditor/references/agents)):
- `context-and-analysis-agent` — builds context map + threat/trust model + per-agent call-path allocation
- `hunt-agent` — given DFS traversal of assigned paths
- `adversarial-agent` — falsifier challenges every preliminary finding (DEEP mode only)

#### Finding validation protocol (CRITICAL)

[`references/validation/finding-protocol.md`](https://github.com/DarkNavySecurity/web3-skills/blob/main/contract-auditor/references/validation/finding-protocol.md):

**5 severity tiers** with scaled validation rigor:
- Critical/High → Full 3 Hard Gates + 6D Scoring + PoC Quantification
- Medium → Gates 1–3 required, profit can be indirect
- Low → Gate 1 only (concrete code), Gates 2-3 relaxed
- Design Advisory → specific code + documented intent + non-obvious consequence (no attack path required)
- Informational → specific location + valid observation

**Filter 0 — Design Intent Gate**: read NatSpec/comments/naming. Clearly intentional → DROP (or report as Design Advisory if non-obvious consequence). Applies at all severity levels.

**6D Adversarial Scoring** (-3 to +1 per dimension): Guards, Reentrancy, Access control, Design intent, Economic feasibility, Dry run. Mechanical verdict from sum: ≤-6 DISCARD, -5 to -1 DOWNGRADE, 0 to +2 EMIT, ≥+3 ESCALATE.

**Prerequisite Tier Table** caps maximum severity:
- Tier 0 (None, public EOA) → Critical
- Tier 1 (victim signs/approves) → High
- Tier 2 (specific market condition) → High
- Tier 3 (non-standard token) → Medium
- Tier 4 (attacker needs role) → Low
- Tier 5 (admin compromise) → Low only with concrete mechanism

#### Adversarial falsifier agent

[`adversarial-agent.md`](https://github.com/DarkNavySecurity/web3-skills/blob/main/contract-auditor/references/agents/adversarial-agent.md): **6-check structured falsification** per preliminary finding:
1. Design Intent
2. Prerequisite Reachability + Tier Classification
3. Guard Analysis (incl. **payability gate** — verify `payable` keyword if `msg.value` involved)
4. Economic Feasibility (gas + flash loan fees + slippage + MEV + net profit)
5. Trust Model Verification
6. Execution Dry Run (concrete values, step-by-step)

Verdicts: UPHELD / DOWNGRADED / DISPROVED. Then **composability pass** — do any 2 findings compound?

#### exploit-investigator (UNIQUE)

[`exploit-investigator/`](https://github.com/DarkNavySecurity/web3-skills/tree/main/exploit-investigator): post-exploit forensics skill. Prompts: analyst / data_collector / decompiler / planner / poc_generator / validator. Python scripts: `fetch_sourcecode.py`, `decode_calldata.py`, `funds_flow.py`, `fetch_tac.py`. Integrates with **Gigahorse TAC server** (decompilation). Foundry template: `BaseExploit.t.sol`.

#### Gap vs solidity-argus

- ✅ We have: orchestrator + agents, severity, persistent state, slither/forge integration
- ⚠️ Partial: themis does some validation; their **6D scoring + prerequisite tier table** is sharper
- ❌ **Missing in us — HIGH PRIORITY**:
  - **Filter 0 — Design Intent Gate** (drop intentional behaviors before any validation)
  - **5-tier severity with scaled validation rigor** (Critical/High requires full protocol, Low requires only Gate 1)
  - **Prerequisite Tier Table** capping max severity
  - **6D Adversarial Scoring** with mechanical verdict from numeric sum
  - **Payability gate** in falsification (specific check for `msg.value` paths)
  - **Coverage assessment** with Entry Point Census (compare agent-reported coverage M vs ground truth)
  - **exploit-investigator skill** — post-exploit forensics + PoC scaffolding
  - **Design Advisory severity tier** (documented behavior with non-obvious consequences — neither dropped nor flagged as bug)
- 💡 Borrow:
  - 6-check falsification protocol
  - Tier table for prerequisite severity caps
  - DEEP mode flag (toggle the adversarial pass — saves cost on quick runs)
  - Entry Point Census as coverage ground truth

---

### 3. Archethect/sc-auditor (TYPESCRIPT — same stack as us!)

**One-line**: Claude Code/Codex CLI skill + 8 MCP tools. v2.0.0 was a ground-up rewrite to a **prompt-driven multi-agent orchestration model**. Explicitly says: *"Inspired by @pashov's structured agent lane methodology and adversarial verification approach."*

#### Architecture

**Map → Hunt → Attack → Verify → Conflict Resolution → Report** (from [`skills/security-auditor/SKILL.md`](https://github.com/Archethect/sc-auditor/blob/main/skills/security-auditor/SKILL.md)).

**6 parallel hunt lanes** (vs pashov's 8):
- Callback liveness
- Accounting / entitlement
- Semantic consistency
- Token / oracle statefulness
- Economic differentials
- Adversarial deep (auto-trigger for cross-contract attack paths)

#### Devil's Advocate verification (CRITICAL UNIQUE PATTERN)

This is **the** pattern that's unique and most actionable for our themis agent:

1. **ATTACK phase** runs formal **Devil's Advocate (DA) 6-dimension scoring** on every finding
2. **VERIFY phase** runs a **Skeptic** ([`assets/prompts/skeptic.md`](https://github.com/Archethect/sc-auditor/blob/main/skills/security-auditor/assets/prompts/skeptic.md)) with **inversion mandate**:
   - If ATTACK invalidated → Skeptic tries to RESURRECT (find why guards don't actually block)
   - If ATTACK sustained → Skeptic tries to NEGATE (find guards ATTACK missed)
   - **MUST do fresh independent analysis. CANNOT copy ATTACK scores.**
3. **JUDGE phase** ([`assets/prompts/judge.md`](https://github.com/Archethect/sc-auditor/blob/main/skills/security-auditor/assets/prompts/judge.md)) resolves conflicts using **"prove it or lose it"** — burden of proof on disagreeing party.

Output schemas are strict **JSON** — Skeptic + Judge MUST emit only JSON (no prose, no markdown fences) matching exact schemas. This enables tool-chain composition.

#### Proof-or-Demote (CRITICAL)

> ATTACK agents must attempt at least one proof method (Foundry PoC, Echidna, Medusa, Halmos) for confirmed vulnerabilities. In benchmark mode, unproven HIGH/MEDIUM findings are automatically demoted.

`benchmark_mode_visible` flag in judge output controls whether unproven findings appear.

#### Checkpoint discipline

Every agent self-checkpoints to `.sc-auditor-work/checkpoints/<phase>-<id>.json` as its FINAL step. Orchestrator double-saves. Before using ANY prior phase data, **reload from disk** — never rely on in-context data alone (survives context compaction). Manifest at `.sc-auditor-work/checkpoints/manifest.json` tracks status per phase (`complete | partial | not_started`).

#### Hard-negatives (NOVEL)

[`assets/hard-negatives/`](https://github.com/Archethect/sc-auditor/tree/main/skills/security-auditor/assets/hard-negatives) — 5 files of explicit **"looks dangerous but is safe"** patterns to avoid false positives. Each pattern has: Why It Looks Bad / Why It's Safe / Key Indicators. Examples:

- Unlimited approval to immutable router (Uniswap V2/V3, battle-tested)
- Approve-Transfer-Revoke in single tx (atomic, no mempool exposure)
- SafeERC20 forceApprove usage
- Permit2 with signature and deadline
- Approval to timelock-protected upgradeable contract

#### MCP tools (8)

[`src/mcp/tools/`](https://github.com/Archethect/sc-auditor/tree/main/src/mcp/tools): `run-slither`, `run-aderyn` (Cyfrin Rust analyzer), `run-echidna`, `run-medusa`, `run-halmos`, `generate-foundry-poc`, `get-checklist`, `search-findings` (Solodit).

Note: **Aderyn** is in their tool stack but NOT in ours. Aderyn is Cyfrin's Rust-based static analyzer — modern alternative/companion to Slither.

#### Gap vs solidity-argus

- ✅ We have: orchestrator, multi-agent, persistent state (`.argus/sessions/`), slither, forge fuzz/test
- ⚠️ Partial: themis does validation but **not in 2-stage DA→Skeptic→Judge format with proof burden**
- ❌ **Missing in us — HIGH PRIORITY**:
  - **2-stage DA + Skeptic + Judge** with inversion mandate ("prove it or lose it")
  - **Strict JSON output schemas** for sub-agents (enables tool-chain composition)
  - **Proof-or-Demote** — HIGH/MEDIUM findings without PoC get demoted
  - **`hard-negatives/` directory** — explicit "looks dangerous but is safe" patterns
  - **Aderyn integration** (Cyfrin Rust static analyzer; companion to Slither)
  - **Echidna / Medusa / Halmos** integration (we have forge fuzz; they have invariant testing + symbolic exec)
  - **Manifest-based phase tracking** for resumability after compaction
  - **`benchmark_mode_visible` flag** — hide unproven findings in benchmark runs
  - **`.claude-plugin/marketplace.json` + `plugin.json`** for Claude Code native distribution
- 💡 Borrow IMMEDIATELY:
  - Skeptic inversion mandate (verbatim)
  - JSON output schema discipline
  - Hard-negatives folder structure + content
  - Devil's Advocate 6D protocol

---

### 4. alt-research/SolidityGuard (104 PATTERNS, EVMBench 100%)

**One-line**: "Advanced Solidity/EVM smart contract security auditor — 104 vulnerability patterns, 9 tools, 100% CTF + EVMBench (120/120)." Proprietary license.

#### Capabilities (TRACK-RECORD CLAIMS)

- **104 vulnerability patterns** (ETH-001 to ETH-104) — significantly more than our 51
- **9-tool integration**: Slither, Mythril, Echidna, Aderyn, Foundry v1.0, Medusa v1, Halmos, Certora, EVMBench
- **3 application surfaces**: CLI, Web ([solidityguard.org](https://solidityguard.org)), Desktop (Tauri v2)
- **Docker support** for local-only scanning
- **9 specialized sub-agents**
- **7-phase deep audit**: scan, verify, parallel agents, exploit PoC, dynamic verification, fuzz, report
- **Self-claimed benchmarks**: 100% DeFiVulnLabs (56/56), 100% Paradigm CTF 2021-2023 (24/24), 100% R3CTF 2025 + HTB CA 2025 (5/5). EVMBench: 120/120 (100%). *(Note: their pattern scanner is the pre-scan input — these numbers measure pattern coverage, not adversarial robustness)*

#### Vulnerability pattern taxonomy ([`VULNERABILITY_PATTERNS.md`](https://github.com/alt-research/SolidityGuard/blob/main/.claude/skills/solidity-guard/skills/vulnerability-scanner/resources/VULNERABILITY_PATTERNS.md))

104 patterns organized into clear categories. Each has: ID (ETH-XXX), Pattern name, Severity, SWC ID, Detection criteria. Categories:

- Reentrancy (5)
- Access Control (7)
- Arithmetic (5)
- External Calls (6)
- Oracle & Price (5)
- Storage (5)
- Logic (7)
- Token (8)
- Proxy (6)
- DeFi (11)
- Gas & DoS (5)
- Miscellaneous (10)
- **Transient Storage / EIP-1153 (5)** — TSTORE collisions, reentrancy bypass via low-gas calls, delegatecall exposure
- **EIP-7702 / Pectra (4)** — `tx.origin == msg.sender` no longer reliable, malicious EOA delegation, cross-chain auth replay
- **ERC-4337 Account Abstraction (4+)** — at line 150+ (we only got 150 lines)

**This is the most modern pattern set we've seen — it covers Pectra and EIP-1153 risks that landed in 2025.** Our patterns library doesn't have these.

#### 7-phase deep audit + 7 slash commands

[`.claude/commands/`](https://github.com/alt-research/SolidityGuard/tree/main/.claude/commands): `audit`, `deep-audit`, `generate-fuzz`, `report`, `scan-access-control`, `scan-reentrancy`, `verify-exploit`. Granular slash commands per workflow stage.

#### Multi-skill organization

[`.claude/skills/solidity-guard/skills/`](https://github.com/alt-research/SolidityGuard/tree/main/.claude/skills/solidity-guard/skills): nested sub-skills under a parent skill: `access-control-reviewer`, `defi-analyzer`, `entry-point-analyzer`, `fuzz-generator`, `reentrancy-auditor`, `report-generator`, `spec-compliance`, `storage-analyzer`, `vulnerability-scanner`.

This is a **nested-skill plugin architecture**.

#### Gap vs solidity-argus

- ✅ We have: slither, forge, fuzz, multi-agent, 51 vuln patterns
- ⚠️ Partial: our 51 patterns vs their 104 (we lack 2025-era patterns)
- ❌ **Missing in us — CRITICAL PRIORITY**:
  - **EIP-1153 / Transient Storage patterns (5)** — TSTORE collisions, reentrancy bypass, delegatecall exposure
  - **EIP-7702 / Pectra patterns (4)** — `tx.origin == msg.sender` assumption broken, malicious EOA delegation, cross-chain replay
  - **ERC-4337 / Account Abstraction patterns (4+)**
  - **Mythril, Echidna, Medusa, Halmos, Certora, Aderyn integrations** — we only have Slither + Forge fuzz
  - **Granular slash commands** per workflow stage (`/scan-reentrancy`, `/verify-exploit`, etc.)
  - **Nested skill architecture** — parent orchestrator + sub-skills
  - **`exploit_verifier.py`** — dynamic verification of generated exploits
  - **`finding_merger.py`** — dedicated dedup module
  - **Benchmark-validated detection** (CTF + EVMBench)
- 💡 Borrow:
  - 104-pattern taxonomy (especially EIP-1153 / EIP-7702 / ERC-4337 — 2025+ ground)
  - Granular slash commands per workflow stage
  - Multi-surface delivery (Web at solidityguard.org)

⚠️ **License caveat**: SolidityGuard is **proprietary** (per their badge). We can't copy their code, but we CAN borrow their **public pattern taxonomy** (which is essentially a documented checklist, not code).

---

### 5. kadenzipfel/scv-scan

**One-line**: Single Claude Code skill scanning Solidity codebases against **36 vulnerability types**. Sourced from `kadenzipfel/smart-contract-vulnerabilities` (which we already ingest, but possibly out of sync).

#### Architecture

**4 phases** ([`SKILL.md`](https://github.com/kadenzipfel/scv-scan/blob/main/SKILL.md)):
1. **Load Cheatsheet** — read `references/CHEATSHEET.md` (single condensed file) in full FIRST
2. **Codebase Sweep** — two passes: (A) Syntactic grep on cheatsheet keywords, (B) Semantic read-through for logic bugs that don't grep
3. **Selective Deep Validation** — read full reference for each candidate; walk every Detection Heuristic; check every False Positive condition
4. **Report**

#### The CHEATSHEET pattern (NOVEL)

[`references/CHEATSHEET.md`](https://github.com/kadenzipfel/scv-scan/blob/main/references/CHEATSHEET.md): 553-line single file with ALL 36 vuln classes, each entry:

```markdown
## <Vulnerability Name>

**Reference:** `<full-ref-file>.md`

<one-paragraph description>

```solidity
<minimal vulnerable pattern>
```

### Grep-able keywords
`keyword1`, `keyword2`, `keyword3`
```

**Why this matters**: A single file the LLM reads at session start gives ambient awareness of ALL vuln classes WITHOUT loading 36 full references. Full references are read on-demand during validation only.

We have `skills/INVENTORY.md` but it's just a directory listing — not a condensed-pattern cheatsheet with grep keywords.

#### Reference-file structure

Each full reference file has the same sections:
- **Preconditions** — what must be true
- **Vulnerable Pattern** — annotated anti-pattern
- **Detection Heuristics** — step-by-step reasoning
- **False Positives** — when the pattern appears but isn't exploitable ⚡
- **Remediation**

Our skill files follow a similar structure (per our README), but the **False Positives** section is **inconsistent or absent** in several of our 51 vulnerability patterns. This is the highest-leverage source of audit noise reduction.

#### Gap vs solidity-argus

- ✅ We have: 51 vuln pattern skills (vs their 36 — but ours overlap with theirs since we share kadenzipfel as source)
- ⚠️ Partial: we have similar structure but **False Positives is not consistently present**
- ❌ Missing in us:
  - **Single CHEATSHEET.md** — condensed quick-reference for ALL patterns
  - **Two-pass syntactic + semantic sweep** as explicit workflow steps
  - **Mandatory False Positives section** in every reference
- 💡 Borrow IMMEDIATELY:
  - Build a [`skills/CHEATSHEET.md`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/skills/CHEATSHEET.md) consolidating our 51 patterns into the same condensed format (1-paragraph description + grep keywords per pattern)
  - Audit our 51 vuln pattern files for consistent "False Positives" sections — add where missing
  - Sync with the upstream `kadenzipfel/smart-contract-vulnerabilities` repo (verify our 51 vs their latest)

---

### 6. OpenZeppelin/openzeppelin-skills

**One-line**: OZ-published **secure-development** skills (NOT audit). 9 skills covering Solidity, Cairo, Stylus, Stellar. Focus: integrating OZ libraries correctly.

#### Architecture

**Skills organized by development lifecycle phase** (per [`dev/PRINCIPLES.md`](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/dev/PRINCIPLES.md)):
- **Setup** (`setup-{solidity,cairo,stylus,stellar}-contracts`) — scaffolding, deps, imports
- **Develop** (`develop-secure-contracts`) — pattern discovery from installed library source, CLI generators, minimal-diff output
- **Upgrade** (`upgrade-{solidity,cairo,stylus,stellar}-contracts`) — proxies, initializers, storage compatibility

#### Key principle: pattern discovery from source

> The primary methodology is **pattern discovery from the installed dependency source**. Rather than relying on prior knowledge, it locates the installed library, browses its directory structure, reads the relevant component source and docs, and extracts the minimal set of changes required.

**Library source is always imported, never copied into user code.** Output is a "minimal diff."

#### Native Claude Code plugin manifest

[`.claude-plugin/marketplace.json`](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/.claude-plugin/marketplace.json) + [`.claude-plugin/plugin.json`](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/.claude-plugin/plugin.json) — proper Claude Code plugin manifest. We don't have these. (Pashov, Cyfrin, CDSecurity, Archethect, SolidityGuard, DarkNavy all DO.)

#### CLI integration

The `develop-secure-contracts` skill uses `@openzeppelin/contracts-cli` to generate reference contract implementations as a **generate-compare-apply** flow: generate baseline → generate feature variant → diff → apply.

#### Gap vs solidity-argus

- ✅ We have: solidity-focused audit
- ❌ Not in scope (audit vs dev-time skills) but interesting:
  - Multi-chain (Cairo / Stylus / Stellar) — could be future expansion
  - **Native Claude Code plugin manifest** (`.claude-plugin/`)
  - **Upgrade-safety dedicated skill** (separate from audit — different methodology)
  - Pattern-discovery-from-source methodology (read installed lib code, derive minimal diff)
- 💡 Borrow:
  - Add `.claude-plugin/marketplace.json` + `plugin.json` so users can install via `/plugin marketplace add Apegurus/solidity-argus`
  - Consider an `upgrade-safety` skill separate from the audit workflow

---

### 7. Cyfrin/solskill

**One-line**: Cyfrin's secure-dev skills. 3 skills: `solidity` (production-grade standards), `battlechain` (deployment), `battlechain-tutorial` (interactive wizard). Stars: 138, AGPL-3.0.

#### Distribution mechanism (NOTABLE)

Two install patterns from [`README.md`](https://github.com/Cyfrin/solskill/blob/main/README.md):

```bash
# Pattern A: npx skills add
npx skills add cyfrin/solskill --skill solidity
npx skills add cyfrin/solskill           # all skills

# Pattern B: Claude Code marketplace
/plugin marketplace add Cyfrin/solskill
/plugin install solidity@solskill
```

The `npx skills add` pattern uses a third-party package distribution mechanism for skills. The `/plugin marketplace add` pattern is Claude Code native.

#### Scope

Production-grade Solidity development standards (code quality, testing patterns, security practices, Foundry workflows) — these are **dev-time defensive** rather than **audit-time offensive**. Different use case from us.

The **BattleChain** skills are for Cyfrin's pre-mainnet L2 ("battle-test smart contracts with real funds" — Safe Harbor agreements, whitehat workflows). Niche and product-specific.

#### Gap vs solidity-argus

- ✅ We have: audit-focused, multi-agent
- ❌ Different use case (dev-time vs audit-time)
- 💡 Borrow:
  - `/plugin marketplace add` install pattern (same as OpenZeppelin recommendation)
  - **`npx skills add`** — investigate this third-party distribution as a secondary install path

---

### 8. CDSecurity/cdsecurity-skills (AUDIT-PREP, not audit)

**One-line**: 2 skills — `audit-prep` (8-phase Foundry/Hardhat readiness check) and `rust-audit-prep` (5-phase Anchor/Solana). Explicitly NOT bug-hunters.

#### Architecture

[`audit-prep/SKILL.md`](https://github.com/CDSecurity/cdsecurity-skills/blob/main/audit-prep/SKILL.md): 8-phase pipeline + 3 parallel sub-agents:
- **Agent A — Testing** (Phases 1+2: Test Coverage, Test Quality)
- **Agent B — Source Analysis** (Phases 3+4+6: NatSpec, Code Hygiene, Best Practices)
- **Agent C — Infrastructure** (Phases 5+7+8: Deps, Deploy, Project Context)

#### Audit readiness scoring

Output is a **scored Audit Readiness Report** (0-100 per phase, overall score). Categorical buckets: "Almost Ready" / "Needs Work" etc.

8 phases (from the SKILL flags): `coverage` | `quality` | `docs` | `hygiene` | `deps` | `practices` | `deploy` | `context`. Plus optional `scan` (static analysis).

CLI flags: `--fix` (auto-apply: NatSpec stubs, console removal, pragma locking, SafeERC20 wrapping), `--diff <ref>` (scope to changed files since git ref), `--ci` (JSON output, exit-code-driven score threshold).

#### Disclaimer (notable for messaging)

> These tools are **not bug hunters**. They do not find vulnerabilities, detect complex bugs, or perform any form of security analysis. They are **not a substitute for a security audit**.
>
> They check that your project's tests, documentation, code hygiene, and infrastructure are in order *before* an audit begins, so auditors can spend their time on what matters: finding real bugs.

Clear scope-setting, manages expectations, complementary to (not replacing) audit.

#### Gap vs solidity-argus

- ✅ We have: audit; we DO NOT do pre-audit hygiene checking
- ❌ **Missing in us — MEDIUM PRIORITY**:
  - **Audit-prep / readiness-scoring workflow** — distinct skill separate from audit
  - **`--fix` flag** for auto-applying mechanical fixes (NatSpec stubs, etc.)
  - **`--diff <ref>`** scope-to-changed-files (PR-friendly)
  - **`--ci`** JSON output + exit-code-driven threshold (CI integration)
- 💡 Borrow:
  - Pre-audit readiness skill (orthogonal to current audit skill — could be `argus-prep` companion)
  - CI/diff flags for incremental analysis

---

## Cross-cutting patterns (themes across multiple repos)

These are patterns appearing in 2+ repos that we should treat as **community standard**:

### Pattern A — Specialized hunt agents by vulnerability class

**Seen in**: pashov (8 agents), Archethect (6 lanes), DarkNavy (3 agents), SolidityGuard (9 agents). All decompose audit into **vulnerability-class-specific lanes** (access-control / math / economics / etc.) rather than running a single generic auditor.

Our `sentinel` is a single generic agent. **This is the #1 architectural gap.**

### Pattern B — Devil's Advocate / Skeptic with inversion

**Seen in**: Archethect (explicit DA + Skeptic + Judge), DarkNavy (6-check falsifier), pashov (Gate 1 Refutation). All run an **adversarial pass** that tries to BREAK each finding before publication.

Our `themis` does cross-validation of dedup/severity but doesn't run **inversion-mandate skeptic** — i.e., themis doesn't try to *prove findings wrong*. Adding this would significantly improve precision.

### Pattern C — Proof-or-Demote

**Seen in**: Archethect ("ATTACK agents must attempt at least one proof method… unproven HIGH/MEDIUM auto-demoted"), pashov ("every FINDING must have a `proof:` field"), DarkNavy (Critical/High requires PoC Quantification).

Our `argus_forge_test` runs existing tests but doesn't **require** sentinel/pythia to generate PoC for Critical/High before they're published. Findings can be published without runnable proof.

### Pattern D — Hard-negatives / Safe-patterns explicit allowlist

**Seen in**: Archethect (5 hard-negatives files), pashov ("Safe patterns (do not flag)" list in judging.md), DarkNavy (Filter 0 Design Intent Gate).

We have implicit assumptions but no explicit catalogue of "this looks dangerous but is safe — do not flag."

### Pattern E — Eval / benchmark infrastructure

**Seen in**: pashov (`evals/` with DODO/megapot/pooltogether ground truth), SolidityGuard (DeFiVulnLabs, Paradigm CTF, R3CTF, HTB CA, EVMBench), Archethect (`benchmark_mode_visible`), CDSecurity (`evals/evals.json` + `grade.sh`).

**We have zero self-eval infrastructure.** This is the biggest *credibility* gap. Without benchmarks, we can't claim performance, can't measure regressions on prompt edits, and can't compete on the EVMBench leaderboard.

### Pattern F — Cheatsheet pattern (condensed pattern reference)

**Seen in**: kadenzipfel (`CHEATSHEET.md` single file for 36 patterns), partially DarkNavy (`checklist.md`), partially pashov (`attack-vectors.md` 110KB — but this is dense not condensed).

We have `INVENTORY.md` but it's a directory listing, not a condensed "name + 1-paragraph + grep keywords" lookup.

### Pattern G — Native Claude Code plugin manifest

**Seen in**: Archethect, OZ, CDSecurity, Cyfrin (via marketplace), SolidityGuard, DarkNavy. All ship `.claude-plugin/marketplace.json` + `plugin.json`.

We're an OpenCode plugin. To reach the Claude Code user base (which is the dominant ecosystem in this hub), we need a parallel Claude Code packaging.

### Pattern H — Checkpoint discipline / resumability

**Seen in**: Archethect (manifest-driven phase tracking + reload-from-disk before each phase), DarkNavy (state checkpoints across context compaction), pashov (file-based bundles read fresh by each agent).

Our `.argus/sessions/` persists state but I'm not sure we resume cleanly mid-phase after context compaction — worth verifying.

### Pattern I — Pre-audit recon / scoping skill (distinct from audit)

**Seen in**: pashov (`x-ray`), CDSecurity (`audit-prep`), 0xRayaa/scoping-bee (in Batch 3). Industry consensus: pre-audit recon is a **separate skill**, not bundled into audit.

### Pattern J — Granular slash commands per phase

**Seen in**: SolidityGuard (`/scan-reentrancy`, `/scan-access-control`, `/verify-exploit`, `/generate-fuzz`, etc.), Archethect (`/security-auditor`).

We have a single `@argus` agent entrypoint. Granular commands would help users invoke specific workflow stages.

### Pattern K — Aderyn integration

**Seen in**: Archethect (MCP tool), SolidityGuard (in their 9-tool list). Aderyn is Cyfrin's Rust-based static analyzer — modern companion to Slither.

We have only Slither.

### Pattern L — 2025+ vulnerability patterns (Pectra, EIP-1153, ERC-4337)

**Seen in**: SolidityGuard only (so far) — but they're a leading indicator. Our patterns library doesn't cover:
- EIP-1153 Transient Storage (TSTORE collision, reentrancy bypass via low-gas calls, delegatecall exposure, type-safety bypass)
- EIP-7702 / Pectra (`tx.origin == msg.sender` no longer reliable, malicious EOA delegation, cross-chain auth replay, `extcodesize == 0` not reliable)
- ERC-4337 Account Abstraction (paymaster exploits, validation phase abuse, etc.)

These will become **the** audit topic for 2026 mainnets. Adding them now positions us ahead.

---

## Gap matrix — solidity-argus vs the field

Legend: ✅ have | 🟡 partial | ❌ missing | ➕ already-planned

| Capability | pashov | DarkNavy | Archethect | SolidityGuard | OZ | Cyfrin | kadenzipfel | CDSec | us | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Specialized hunt agents by vuln class | ✅ 8 | ✅ 3 | ✅ 6 | ✅ 9 | — | — | — | ✅ 3 | ❌ | 🔴 Critical |
| Devil's Advocate / Skeptic inversion | 🟡 | ✅ 6-check | ✅ DA+Skeptic+Judge | 🟡 | — | — | — | — | 🟡 themis | 🔴 Critical |
| Proof-or-Demote | ✅ proof field | ✅ Critical/High requires PoC | ✅ benchmark_mode_visible | 🟡 | — | — | — | — | ❌ | 🔴 Critical |
| Eval/benchmark harness | ✅ 3 protocols | — | ✅ benchmark mode | ✅ CTF + EVMBench | — | — | — | ✅ grade.sh | ❌ | 🔴 Critical |
| Hard-negatives / Safe-patterns allowlist | ✅ judging.md list | ✅ Filter 0 | ✅ 5 files | — | — | — | — | — | ❌ | 🟠 High |
| Cheatsheet (condensed all-patterns ref) | 🟡 attack-vectors | 🟡 checklist | — | — | — | — | ✅ | — | ❌ | 🟠 High |
| Pre-audit recon skill | ✅ x-ray | — | — | — | — | — | — | ✅ audit-prep | ❌ | 🟠 High |
| Native Claude Code plugin manifest | — | — | ✅ | ✅ | ✅ | ✅ | — | — | ❌ | 🟠 High |
| Aderyn integration | — | — | ✅ | ✅ | — | — | — | — | ❌ | 🟡 Medium |
| Echidna / Medusa / Halmos / Certora | — | — | ✅ | ✅ | — | — | — | — | ❌ | 🟡 Medium |
| 2025+ patterns (EIP-1153, 7702, 4337) | — | — | — | ✅ 13+ | — | — | — | — | ❌ | 🟠 High |
| Confidence numeric scoring (0-100) | ✅ | — | ✅ via DA | — | — | — | — | ✅ phase score | ❌ | 🟡 Medium |
| Composability / chain detection | ✅ | ✅ | — | — | — | — | — | — | ❌ | 🟡 Medium |
| Granular slash commands per phase | — | — | 🟡 | ✅ 7 | — | — | — | — | ❌ | 🟡 Medium |
| `--diff <ref>` PR/incremental mode | — | — | — | — | — | — | — | ✅ | ❌ | 🟡 Medium |
| `--ci` JSON output + threshold | — | — | — | — | — | — | — | ✅ | ❌ | 🟡 Medium |
| Manifest-driven checkpoint/resume | — | ✅ | ✅ | — | — | — | — | — | 🟡 | 🟡 Medium |
| Visual diagram generation (SVG) | ✅ | — | — | — | — | — | — | — | ❌ | 🟢 Low |
| Git-history security analysis | ✅ | — | — | — | — | — | — | — | ❌ | 🟢 Low |
| Coverage Entry-Point Census | — | ✅ | — | — | — | — | — | — | ❌ | 🟡 Medium |
| `exploit-investigator` post-attack | — | ✅ | — | — | — | — | — | — | ❌ | 🟢 Low |
| Multi-chain SCMS expansion (Cairo/Stellar) | — | — | — | — | ✅ | — | — | — | ❌ | 🟢 Low |
| Solodit / SCVD knowledge | — | — | ✅ | — | — | — | — | — | ✅ | — |
| Slither + forge integrated | — | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ | — |
| 50+ vuln pattern skills | ✅ via attack-vectors | ✅ checklist | ✅ checklist | ✅ 104 | — | — | ✅ 36 | — | ✅ 51 | — |
| Persistent session state | — | ✅ | ✅ | — | — | — | — | — | ✅ | — |

---

## Prioritized recommendations

### 🔴 Critical (foundational — do first)

1. **Add specialized hunt agents to sentinel** (Pattern A)
   - Decompose sentinel into vulnerability-class agents matching pashov/Archethect/SolidityGuard.
   - Concrete proposal: replace `sentinel` with N parallel agents: `sentinel-access-control`, `sentinel-math-precision`, `sentinel-economic`, `sentinel-invariant`, `sentinel-execution-trace`, `sentinel-periphery`, `sentinel-first-principles`, `sentinel-vector-scan`.
   - Each gets a small specialized prompt (1-3KB) + the shared rules + source bundle.
   - Effort: large — touches `src/agents/` architecture + hook injection + tool registry. ~1-2 weeks.

2. **Add 2-stage Devil's Advocate + Skeptic to themis** (Pattern B)
   - Reshape `themis` to run as two phases:
     - **Phase A (DA)**: 6-check falsification per finding (port from DarkNavy `adversarial-agent.md`)
     - **Phase B (Skeptic)**: inversion-mandate review of DA verdicts (port from Archethect `skeptic.md`)
   - Output strict JSON schemas (per Archethect's pattern).
   - Effort: medium — `src/agents/themis-prompt.ts` rewrite + JSON schema validators. ~3-5 days.

3. **Add Proof-or-Demote enforcement** (Pattern C)
   - For findings at Critical/High severity, require sentinel to produce a Foundry PoC OR a fuzz invariant violation BEFORE scribe accepts them.
   - Add `proof:` field as MANDATORY for Critical/High in `argus_record_finding` schema.
   - Add a `benchmark_mode` flag that demotes/hides unproven findings.
   - Effort: small — schema change + sentinel prompt update. ~1-2 days.

4. **Build eval/benchmark harness** (Pattern E)
   - Create `evals/` directory with:
     - `evals/benchmarks/{protocol}.md` — ground-truth findings (start with 3-5: pooltogether, dodo, megapot like pashov; OR pick 3 from a recent Code4rena/Sherlock contest)
     - `evals/runner.ts` — clones repo, runs argus, captures output
     - `evals/compare.ts` — semantic matching of report vs ground truth (port from pashov `compare.md`)
     - `evals/results/` — per-run summary.md with recall metrics
   - Goal: be able to run `bun evals/runner.ts` and get a recall % vs ground truth.
   - Stretch: enroll in EVMBench publicly to validate claims.
   - Effort: medium — scripting + ground-truth curation. ~3-5 days for harness + 1-2 days per benchmark.

### 🟠 High (high-leverage adds)

5. **Add 2025+ vulnerability patterns** (Pattern L)
   - 13+ new SKILL.md files for: EIP-1153 Transient Storage (5), EIP-7702 / Pectra (4), ERC-4337 Account Abstraction (4).
   - Source: SolidityGuard's [`VULNERABILITY_PATTERNS.md`](https://github.com/alt-research/SolidityGuard/blob/main/.claude/skills/solidity-guard/skills/vulnerability-scanner/resources/VULNERABILITY_PATTERNS.md) (taxonomy is public knowledge; we recreate per our format).
   - Effort: small — pattern file authoring. ~1 day per category, ~3 days total.

6. **Build skills/CHEATSHEET.md** (Pattern F)
   - Single file consolidating all 51 vulnerability patterns: 1-paragraph description + grep-able keywords + reference to full file.
   - Port kadenzipfel's format ([`CHEATSHEET.md`](https://github.com/kadenzipfel/scv-scan/blob/main/references/CHEATSHEET.md)).
   - Loaded automatically at start of every audit (sentinel reads it first).
   - Effort: small — ~1 day mechanical aggregation.

7. **Add hard-negatives/ catalogue** (Pattern D)
   - New directory `skills/hard-negatives/` with files documenting "looks dangerous but is safe" patterns.
   - Start with Archethect's 5 (approval-abuse, callback-grief, entitlement-drift, rounding-entitlement, semantic-drift). Adapt to our format.
   - Inject into sentinel/themis prompts as "before flagging, check hard-negatives."
   - Effort: small — ~2 days authoring.

8. **Add x-ray-style pre-audit recon skill** (Pattern I)
   - New skill `argus-prep` (or expand `argus` orchestrator with a `--mode=recon` flag).
   - Produces: file-level inventory, entry-point catalogue, threat model, invariants list, trust model.
   - Stretch: add git-history analysis (port `analyze_git_security.py`), SVG architecture diagram.
   - Effort: medium — new agent + scripts. ~5-7 days.

9. **Add `.claude-plugin/` manifest for parallel Claude Code distribution** (Pattern G)
   - Add `.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json` so users can install via `/plugin marketplace add Apegurus/solidity-argus` in Claude Code.
   - Reach: the hub's audience is overwhelmingly Claude Code users.
   - Effort: tiny — ~half a day. (Caveat: requires runtime support — our skills/tools are bun/TS; need to verify they run under plain Claude Code without OpenCode runtime, OR ship a different surface — e.g., bundled prompts only.)

### 🟡 Medium (quality-of-life and parity)

10. **Integrate Aderyn alongside Slither** (Pattern K) — new `argus_aderyn_analyze` tool. Effort: ~2-3 days.
11. **Integrate Echidna + Medusa + Halmos** for invariant + symbolic — new tools. Effort: ~3-5 days each.
12. **Add granular slash commands** (`/argus scan-reentrancy`, `/argus verify-exploit`, etc.). Effort: ~2 days.
13. **Add `--diff <ref>` PR mode** for incremental analysis. Effort: ~2 days.
14. **Add `--ci` JSON output + score threshold + exit code**. Effort: ~1 day.
15. **Audit our 51 patterns for consistent "False Positives" sections** — add where missing. Effort: ~2-3 days.
16. **Confidence numeric scoring** (0-100) with deduction rules, replacing simple severity labels in findings. Effort: ~2 days.
17. **Composability / chain detection** at the dedup stage. Effort: ~2 days.

### 🟢 Low (nice-to-have)

18. SVG architecture diagram generation
19. Git-history security analysis script
20. Post-exploit forensics skill (`argus-forensics`)
21. Multi-chain (Cairo/Stylus/Stellar) expansion

---

## Open questions for user

1. **Scope of borrowing**: Some patterns require code rewrites (e.g., specialized hunt agents touch the agent architecture). Are you up for that level of restructuring, or do you want to prefer additive changes (new skills, new tools) over modifying existing agents?

2. **Eval target**: For the benchmark harness, should we start with public contests (Code4rena, Sherlock) or replicate pashov's benchmarks (DODO, megapot, pooltogether)?

3. **EVMBench enrollment**: Worth publicly competing on OpenAI's EVMBench leaderboard? SolidityGuard claims 100% — that's the bar. Or do we treat this as internal-only?

4. **Claude Code parallel distribution**: Worth the effort to ship a Claude-Code-native variant? Our current Bun/TS code wouldn't run under plain Claude Code skills (which are markdown/shell/python). A parallel "prompt-only" Claude Code package would mean maintaining two surfaces.

5. **License-sensitive borrowing**: SolidityGuard is proprietary. Their pattern *names + descriptions* are public (in their VULNERABILITY_PATTERNS.md) but we should treat their detection scripts as off-limits and rewrite from primary sources (SWC, EIP specs, public exploit analyses). Confirm we're comfortable with that line.

---

## Repos NOT covered in B1 (too small / different scope)

- `quillai-network/qs_skills`, `auditmos/skills`, `KannAILabs/Solidity-AI-security-auditor`, `zerocoolailabs/ZeroSkills`, `DarkNavy/web3-skills/client-auditor` (non-Solidity scope) — quick spot-check showed none are bigger than ~20⭐ or offer patterns we don't already see in the leaders. Will fold into B2/B3 only if directly relevant.

---

## Next batches

- **B2**: Multi-lang / auditor agent architectures (Grimoire, finite-monkey, hound, krait, GPTScan, weasel, forefy/.context, plamen, nemesis-auditor) — likely surfaces additional architecture innovations
- **B3**: Specialized workflows (scoping-bee, foundry-poc-mainnet-fork, trident-fuzz, K.I.T, The-Judge, claudit, hackenproof-triage) — likely surfaces workflow gaps (scoping, PoC scaffolding, known-findings dedup, triage rubrics)

Status: B1 ✅ — B2 / B3 pending.
