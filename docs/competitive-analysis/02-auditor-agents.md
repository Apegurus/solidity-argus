# Batch 2 — Auditor Agents & Methodologies: Competitive Analysis

> Source: https://github.com/pashov/ai-web3-security
> Generated: 2026-05-18
> Methodology: README + repo tree + key SKILL.md / prompt files.
> Scope: 11 multi-lang or framework-level auditor agents from the hub.

---

## Repos analyzed

| # | Repo | ⭐ | License | Stack | Type |
|---|------|----|---------|-------|------|
| 1 | [scabench-org/hound](https://github.com/scabench-org/hound) | **768** | Apache-2.0 | Python | Framework — knowledge-graph driven AI auditor + paper |
| 2 | [BradMoonUESTC/finite-monkey-engine](https://github.com/BradMoonUESTC/finite-monkey-engine) | **350** | (none) | Python | Engine — Planning→Reasoning→Validation pipeline, RAG-backed |
| 3 | [PlamenTSV/plamen](https://github.com/PlamenTSV/plamen) | **231** | MIT | Python | 18-100 agent orchestrator across 8 phases, multi-chain + L1 nodes |
| 4 | [0xiehnnkta/nemesis-auditor](https://github.com/0xiehnnkta/nemesis-auditor) | **220** | MIT | Markdown-only | Iterative dual-agent loop (Feynman + State) |
| 5 | [GPTScan/GPTScan](https://github.com/GPTScan/GPTScan) | **101** | AGPL-3.0 | Java/Python | Academic (ICSE'24 paper) — GPT + program analysis |
| 6 | [forefy/.context](https://github.com/forefy/.context) | **97** | MIT | Python | Multi-expert skill collection (Solidity + Anchor + Vyper + TON + Sui Move) |
| 7 | [JoranHonig/grimoire](https://github.com/JoranHonig/grimoire) | **62** | MIT | Shell | "Toolkit that learns" — operator-amplification skill |
| 8 | [slvDev/weasel](https://github.com/slvDev/weasel) | **25** | MIT | **Rust** | MCP-native static analyzer ("talk to your analyzer") |
| 9 | [ZealynxSecurity/krait](https://github.com/ZealynxSecurity/krait) | **13** | MIT | TypeScript | 16-angle detector (4 lenses × 4 mindsets), 100% precision Code4rena |
| 10 | [Monethic/monethic-maia](https://github.com/Monethic/monethic-maia) | **7** | AGPL | Markdown-only | 192 detectors across EVM/Move-Aptos/Move-Sui, 8-phase prompts |
| 11 | [konstantinvelev/AI](https://github.com/konstantinvelev/AI) | **3** | (none) | Markdown-only | Two small skills (protocol-breakdown + findings-writer) |

---

## Per-repo highlights

### 1. scabench-org/hound (768⭐, by Bernhard Mueller — has academic paper)

**One-line**: Language-agnostic AI auditor that autonomously builds and refines adaptive knowledge graphs for deep, iterative code reasoning. Published paper: https://arxiv.org/html/2510.09633v1.

**Novel architectural patterns:**
- **Knowledge-graph-driven analysis** — auto-generates aspect-oriented graphs (SystemArchitecture, call graph, value flows, access control, math). Graph IS the audit substrate.
- **Senior/junior pattern (LLM tiering)** — lightweight "scout" models for exploration, heavyweight "strategist" models for deep reasoning. Mirrors expert workflows + saves cost.
- **Belief / hypothesis system** — observations, assumptions, hypotheses evolve with confidence scores (0.0-1.0). Long-horizon cumulative audits.
- **Two-mode audit**: `--mode sweep` (systematic component-by-component) followed by `--mode intuition` (deep targeted exploration of monetary flows / contradictions / privilege bypasses).
- **Live chatbot UI to steer audit** at http://127.0.0.1:5280 — Watch Activity/Plan/Findings, send Steer commands.
- **Multi-provider abstraction** (OpenAI, Gemini, Anthropic, DeepSeek, xAI) via [`llm/*_provider.py`](https://github.com/scabench-org/hound/tree/main/llm) + `unified_client.py`.
- **`scabench/` is the BENCHMARK** — Hound is from the scabench-org. Means our tool could be **evaluated by scabench** as a measurement of recall.

**Gap vs us**:
- ❌ Missing: knowledge-graph audit substrate, scout/strategist model tiering, confidence-scored hypotheses, multi-provider abstraction, live steering UI
- 💡 Borrow: senior/junior model tiering pattern (use cheaper models for recon, expensive for deep dives), hypothesis confidence as first-class field, **enroll in scabench** as external benchmark

### 2. BradMoonUESTC/finite-monkey-engine (350⭐, Chinese origin, multi-language)

**One-line**: Security analysis pipeline **Planning → Reasoning → Validation**. RAG-backed (LanceDB merged 2-table) with PostgreSQL persistence. Supports Solidity, Rust, C++, Move.

**Novel patterns:**
- **3-stage explicit pipeline** with stage-specific docs ([`docs/PLANNING_CODEX_REFACTOR_PLAN.md`](https://github.com/BradMoonUESTC/finite-monkey-engine/blob/main/docs/PLANNING_CODEX_REFACTOR_PLAN.md), `docs/REASONING_MULTI_AGENT_REFACTOR_PLAN.md`, `docs/VALIDATION_CODEX_REFACTOR_PLAN.md`, `docs/PLANNING_COVERAGE_REPAIR_PLAN.md`).
- **Tree-sitter function parsing** + **Codex CLI** as scan executor — uses Codex's filesystem access to read business flows.
- **Tasks persisted as `Fi × checklist (rule_key)`** — each function × each checklist rule = one task. Highly enumerable and traceable.
- **PostgreSQL persistence** for results (vs our file-based `.argus/sessions/`) — enables cross-session queries and reporting dashboards.
- **LanceDB RAG** with merged 2-table architecture for vulnerability lookup.
- **Workspace restriction** — Codex CLI always runs with `--cd <project_root>` derived from `datasets.json[project_id].path`.

**Gap vs us**:
- ❌ Missing: PostgreSQL backend (we use file-based state), LanceDB RAG (we have SCVD index but not embeddings), Codex CLI execution path
- 💡 Borrow: Function × checklist rule = task model (much more granular than our current finding-level granularity), explicit stage docs

### 3. PlamenTSV/plamen (231⭐, MIT, AUTONOMOUS scaling 18-100 agents)

**One-line**: Autonomous Web3 security auditor orchestrating **18-100 AI agents** across 8 phases. Supports EVM/Solidity, Solana/Anchor, Aptos Move, Sui Move, Soroban/Stellar, **L1 Go/Rust node clients**.

**Novel patterns:**
- **18-100 parallel agents per audit run** — extreme parallelism. Depth agents: `depth-consensus-invariant`, `depth-edge-case`, `depth-external`, `depth-network-surface`, `depth-state-trace`, `depth-token-flow`.
- **Per-chain skill libraries** — `agents/skills/{evm,aptos,sui,...}/` with 16-21 skills each. EVM has skills like: `centralization-risk`, `cross-chain-message-integrity`, `cross-chain-timing`, `economic-design-audit`, `event-correctness`, `external-precondition-audit`, `flash-loan-interaction`, `fork-ancestry`, `migration-analysis`, `oracle-analysis`, `semi-trusted-roles`, `share-allocation-fairness`, `staking-receipt-tokens`, `storage-layout-safety`, `temporal-parameter-staleness`, `token-flow-tracing`, `verification-protocol`, `zero-state-return`.
- **L1 node-client skills** ([`agents/skills/injectable/l1/`](https://github.com/PlamenTSV/plamen/tree/main/agents/skills/injectable/l1)) — `bls-aggregation-audit`, `consensus-math-correctness`, `consensus-safety-invariants`, `consensus-tx-identity-invariants`, `cross-environment-semantic-drift`, `data-availability-enforcement`, `dependency-audit-nodeclient`, `execution-client-hardening`, `fork-choice-audit`, `gossip-cache-invariance`, `hardfork-activation-and-protocol-upgrade`, `light-client-proof-verification`, `mempool-asymmetric-dos`, `p2p-dos-and-eclipse`, `peer-scoring-correctness`, `rpc-surface-audit`, `rust-unsafe-audit`, `state-sync-pruning`, `validator-lifecycle-and-slashing` — **this is far beyond Solidity audit; this is L1 client engineering**.
- **Custom MCP servers**: `custom-mcp/slither-mcp/` and `custom-mcp/farofino-mcp/` (git submodules) — they ship their own MCP servers.
- **`integration-hazard-research` skill** as separate skill — explicit research-mode skill.
- **`fork-ancestry` skill** — track which protocol a code base forked from and known-bugs of that ancestor.
- **OpenGrep rules** baked in (`agents/skills/injectable/l1/_opengrep-rules/*.yaml`) — `go-integer-underflow-p2p`, `go-panic-in-endblocker`, `rust-unwrap-in-preauth`.
- **`plamen rag`** builds optional vulnerability DB (~6GB RAM) — local RAG vulnerability database, separate from per-skill knowledge.
- **`plamen setup` toolchain wizard** — auto-installs Foundry, Solana CLI, Anchor, etc.

**Important**: Krait (ZealynxSecurity) explicitly credits Plamen for "Devil's Advocate verification methodology" — so Plamen is upstream for DA patterns we already covered in B1.

**Gap vs us**:
- ❌ Missing: multi-chain (Solana/Aptos/Sui/Soroban/L1) coverage, custom MCP server packaging, OpenGrep integration, RAG vulnerability DB, **fork-ancestry tracking**, integration-hazard separation
- 💡 Borrow:
  - **`fork-ancestry`** skill (track forks and known ancestor bugs)
  - **`integration-hazard-research`** as a separate skill (for evaluating external dependencies)
  - OpenGrep rule format for compiled detection patterns (lighter than full SKILL.md for trivial patterns)
  - Per-chain skill organization (when we expand beyond Solidity)

### 4. 0xiehnnkta/nemesis-auditor (220⭐, MIT)

**One-line**: Iterative dual-agent loop — **Feynman Auditor** (first-principles questioning) + **State Inconsistency Auditor** (coupled state desync). Alternates until convergence (max 6 passes). Language-agnostic.

**Novel patterns:**
- **Feynman technique applied to code**: "If you cannot explain WHY a line exists, you do not understand the code — and where understanding breaks down, bugs hide." 28+ questions per function across 7 categories.
- **State Inconsistency phase** — explicit 8-step methodology:
  1. Map all coupled state pairs (`balance ↔ checkpoint`, `stake ↔ rewardDebt`)
  2. Find every mutation path for each state variable
  3. Cross-check that every mutation updates ALL coupled state
  4. Check operation ordering within functions
  5. Compare parallel code paths (withdraw vs liquidate, transfer vs burn)
  6. Trace multi-step user journeys for stale state accumulation
  7. Detect masking/defensive code that hides broken invariants
  8. Verification gate
- **Iterative cross-feed**: Feynman suspects → State audit targets; State gaps → Feynman interrogation points. Each pass surfaces what the previous missed.
- **Convergence stop condition** — no new findings in a pass (max 6 passes).
- **Discovery path** field in finding format: `Feynman-only | State-only | Cross-feed Pass N -> Pass M` — tells reader which pass found it.

**Gap vs us**:
- ❌ Missing: iterative convergence loops between specialized agents (we run sentinel/pythia once), Feynman-style first-principles questioning, dedicated state-coupling analysis as a phase
- 💡 Borrow IMMEDIATELY:
  - **State-coupling-pair mapping** as an explicit early phase (we audit functions but don't systematically enumerate `(state_a, state_b)` invariant pairs)
  - **Iterative cross-feed loop** — after sentinel + pythia round 1, feed back to a second round on top suspects (small effort, big precision gain)
  - **`discovery_path`** field in finding schema — provenance is GOLD for debugging false positives

### 5. GPTScan/GPTScan (101⭐, ICSE'24 ACADEMIC paper)

**One-line**: Academic — ChatGPT + program analysis for **logic vulnerability detection**. Published at ICSE 2024.

**Novel patterns (paper-grade):**
- **10 specific rule files** in [`src/rules/*.yml`](https://github.com/GPTScan/GPTScan/tree/main/src/rules) covering canonical logic bugs:
  - `ApprovalNotClear` — approval flow ambiguity
  - `FirstDeposit` — first-depositor attack
  - `Flashloan_Buy` / `Flashloan_Price` / `Flashloan_Vote` — three distinct flash loan abuse patterns
  - `FrontRun` — front-running
  - `Slippage` — missing slippage protection
  - `UnauthorizedTransfer` — unauthorized transfer paths
  - `WrongOrder_Checkpoint` / `WrongOrder_Interest` — wrong CEI / interest accrual ordering
- **Java JARs**: `SolidityCallgraph-1.0-SNAPSHOT.jar`, `SolidityStaticAnalysis-1.0-SNAPSHOT.jar` — custom static analysis backend instead of Slither.
- **Datasets** (well-curated benchmarks we should run our tool against):
  - [Web3Bugs](https://github.com/MetaTrustLabs/GPTScan-Web3Bugs)
  - [DefiHacks](https://github.com/MetaTrustLabs/GPTScan-DefiHacks)
  - [Top200](https://github.com/MetaTrustLabs/GPTScan-Top200)
- **`whitelist_preprocess.py` + `modifier_whitelist.json`** — explicit modifier allowlist for FP reduction.

**Citation:** Sun, Wu, Xue, Liu et al., "GPTScan: Detecting Logic Vulnerabilities in Smart Contracts by Combining GPT with Program Analysis", ICSE 2024.

**Gap vs us**:
- ❌ Missing: academic-grade rule format (YAML files with formal structure), Web3Bugs/DefiHacks/Top200 benchmark integration, modifier whitelist for FP reduction
- 💡 Borrow:
  - Run our tool against **Web3Bugs, DefiHacks, Top200** as benchmarks (publishable comparison)
  - YAML rule format for compiled logic rules (lighter than full SKILL.md for narrow patterns)
  - **Modifier whitelist JSON** — explicit list of modifiers that grant trust → reduces FP across many findings

### 6. forefy/.context (97⭐, MIT)

**One-line**: Multi-language audit skill collection (Solidity, Anchor, Vyper, TON FunC/Tact, Sui Move). Marketed: "AI Agent Skills for Smart Contract Auditing to generate triaged, industry grade report findings, code locations, pocs, attacker story flow graphs and more".

**Novel patterns:**
- **Multi-platform support** — full Anchor skill libraries with deep `fv-anc-*-cl*` categorization. Each Anchor vuln has its own file (e.g., `fv-anc-3-cl11-no-reload-after-account-mutation.md`).
- **Multi-expert framework** — [`skills/smart-contract-audit/multi-expert.md`](https://github.com/forefy/.context/blob/main/skills/smart-contract-audit/multi-expert.md) + `infrastructure-audit/MULTI-EXPERT.md` + `infrastructure-audit/TRIAGER.md`. Multiple expert perspectives synthesized via a triager.
- **`gdocs-audit-report`** skill — Google Docs API integration! Outputs reports directly to a shared Google Doc with formatting. ([`skills/gdocs-audit-report/scripts/gdocs_auth.py`](https://github.com/forefy/.context/blob/main/skills/gdocs-audit-report/scripts/gdocs_auth.py))
- **`auditor-quiz`** skill — interview/training mode. Quiz auditors on patterns. Useful for onboarding.
- **`sandboxed-audit-runner`** — runs untrusted code in sandbox. Critical for hostile-codebase audits.
- **`context-window-to-skill`** — META-SKILL that converts current session context into a reusable skill. Self-bootstrapping.
- **`blockchain-forensics`** — incident-response skill set: `advanced-techniques`, `attribution-techniques`, `laundering-patterns`, `osint-framework`, `professional-development`, `reporting-standards`, `threat-landscape`, `tool-reference`.
- **`infrastructure-audit`** as separate skill from contract audit — covers the OFF-CHAIN parts (RPC servers, key management, deployment pipelines).
- **`git-commit`** skill — automated commit message generation.
- **Custom marketplace**: `npx skills add forefy/.context` (npm registry-backed) plus install.sh.

**Gap vs us**:
- ❌ Missing: Google Docs report output, sandboxed runner (security!), context-window-to-skill (could turn audit sessions into reusable patterns), blockchain forensics, infrastructure audit (off-chain components), auditor-quiz training mode
- 💡 Borrow:
  - **`sandboxed-audit-runner`** pattern — when scoping untrusted code, run analysis tools in sandbox first (similar to scoping-bee's recommendation in B3)
  - **`context-window-to-skill`** meta-pattern — after an audit, distill the session into a reusable SKILL.md
  - `infrastructure-audit` as a companion skill (off-chain components)
  - Google Docs output for collaborative reports (vs only markdown files)
  - `fork-ancestry`-style approach in their `fv-anc-N-clM-` naming → systematic Cause Library

### 7. JoranHonig/grimoire (62⭐, MIT, by a known auditor)

**One-line**: "A security research toolkit that learns." Built by JoranHonig (well-known Solidity auditor). Focus: **leverage operator skill, not replace it**.

**Novel patterns:**
- **`scribe` skill that BUILDS NEW CHECKS from findings** — "automatically analyzes your findings and build detection modules for them (which are automatically ran in your next audit)". This is **self-improving via accumulation**.
- **`cartography` skill** — claude memorizes feature/flow → code locations mapping. Then `"hey load context on the authentication flow"` instantly fetches relevant context.
- **`gc-cartography`** — "graph cleanup" sub-skill: detect overlaps between cartography maps, merge flows ([`skills/gc-cartography/scripts/detect-overlaps.sh`](https://github.com/JoranHonig/grimoire/blob/main/skills/gc-cartography/scripts/detect-overlaps.sh)).
- **`librarian` sub-agent** — focused on documentation/references with citation backing only. Keeps main context clean.
- **`finding-dedup`, `finding-draft`, `finding-review`** as separate sub-skills (not one giant skill).
- **`hypothesis generation`** as a documented concept ([`grimoire/concepts/hypothesis generation.md`](https://github.com/JoranHonig/grimoire/blob/main/grimoire/concepts/hypothesis%20generation.md)).
- **Philosophy docs** — `(trivial) verifiability.md`, `backpressure.md`, `the original sin.md`, `don't get in the way.md`, `personal grimoire.md`. The "don't get in the way" philosophy is explicit: minimum disruption to existing workflow.
- **Bridges Solodit MCP integration via `SOLODIT_API_KEY`** — same Solodit MCP we have.
- **Hooks system**: [`hooks/init/init-grimoire.sh`](https://github.com/JoranHonig/grimoire/blob/main/hooks/init/init-grimoire.sh) — auto-init on Claude Code session start.

**Gap vs us**:
- ❌ Missing: cartography (feature/flow → code mapping), self-improving via accumulated detection modules, sub-skill granularity (finding-dedup/draft/review separated)
- 💡 Borrow IMMEDIATELY:
  - **`cartography` pattern** — let argus build and persist a `flow → file:line` map in `.argus/cartography/` after first scan, then use it for fast context loading
  - **`scribe` self-improvement loop** — after each audit, distill new patterns into new SKILL.md files automatically (uses `context-window-to-skill` from forefy)
  - **Sub-skill split**: separate `finding-dedup` / `finding-draft` / `finding-review` so each is invokable independently

### 8. slvDev/weasel (25⭐, MIT, **Rust**)

**One-line**: "Solidity static analyzer you can talk to". Native MCP integration with Claude Code, Cursor, Windsurf, OpenAI Codex, Gemini CLI.

**Novel patterns:**
- **MCP as primary interface**: `weasel mcp add` registers as MCP server in any MCP-compatible AI tool. Natural-language invocation: "weasel poc for this reentrancy bug" / "weasel report this finding".
- **9 specialized skills** for Claude Code (PoC writing, report formatting, gas optimization, and more) — skills auto-activate based on user request.
- **Rust-native** — parallel detection, "blazing fast".
- **Auto-detection** of project type (Foundry/Hardhat/Truffle).
- **`weaselup` installer pattern** — `curl -L .../install | bash` → `weaselup` becomes a CLI manager.
- **GitHub Actions templates** — 7 workflow examples in `gh-actions-examples/` (basic + claude/gemini/openai variants + diff variants).
- **Extensive detector library** — many `src/detectors/{high,low,gas}/` files. Examples: `address_zero_check`, `array_length_in_loop`, `bool_storage`, `cached_state_variables`, `compound_assignment`, `count_down_loop`, `custom_errors_instead_of_revert_strings`, `default_value_initialization`, `delegatecall_in_loop`, `division_before_multiplication`, `division_by_zero`, `division_rounding`, `domain_separator_replay`, `duplicate_import`, `internal_function_not_called`, `msg_value_in_loop`, `payable_function`, `post_increment`, `shift_instead_of_mul_div`, `should_be_immutable`, `unchecked_loop_increment`, `unnecessary_variable_cache`, `unsafe_array_access`, `use_erc721a`, etc.

**Gap vs us**:
- ❌ Missing: MCP server primary interface, GitHub Actions integration templates, Rust-fast detectors
- 💡 Borrow:
  - **Expose argus tools as a separate MCP server** (`argus mcp serve`) for non-OpenCode tools (Claude Code, Cursor, Codex). Doubles distribution surface.
  - **GitHub Actions workflows** template library — ship 5-7 ready-to-use `argus-{claude,gemini,openai}-{diff,full}.yml` for users to drop into `.github/workflows/`
  - Auto-detect Foundry/Hardhat/Truffle in our reconnaissance phase

### 9. ZealynxSecurity/krait (13⭐ but BIG benchmark claims)

**One-line**: "AI-assisted security verification for Solidity smart contracts. 43 heuristics, 26 analysis modules, 8 kill gates, **100% precision** blind against 45 Code4rena contests." Pure Claude Code skill, free, MIT.

**Novel patterns:**
- **16 detection angles per function**: 4 lenses × 4 mindsets
- **4 mindsets** (incredibly clear LLM-prompting pattern):
  - **Attacker**: "How would I exploit this to drain funds or escalate privilege?"
  - **Accountant**: "Trace every wei — do the numbers add up?"
  - **Spec Auditor**: "Does the code match what docs, comments, and EIPs say it should do?"
  - **Edge Case Hunter**: "What breaks at zero, max, empty, self-referential, or reentrant?"
- **Consensus boost** — findings flagged by multiple mindsets get confidence boost; single-source findings get extra scrutiny.
- **8 kill gates**:
  - A: Generic best practice ("use SafeERC20")
  - B: Theoretical/unrealistic
  - C: Intentional design
  - D: Speculative (no WHO/WHAT/HOW MUCH)
  - E: Admin trust
  - F: Dust (<$100)
  - G: Out of context
  - H: Known issue
- **`/krait-review` second opinion** — re-examines killed findings (esp. gates C, E, B, F). Revived findings tagged "Worth Manual Review" — preserves zero-FP main report.
- **Self-improving methodology**: blind test → score → root-cause every miss → update methodology → re-test. **Self-attributes inspiration from pashov/skills, PlamenTSV/plamen, forefy/.context** (all MIT) — recall improved from 11% → 15.2% maintaining 100% precision.
- **Shadow audit transparency** — every result is verifiable in [`shadow-audits/`](https://github.com/ZealynxSecurity/krait/tree/main/shadow-audits) (claim).
- **Benchmark table publicly published** (v1 12% → v5 70% → v6.4 90% → v7 100% → v8 100% with recall 15.2%).
- **Web platform** at https://krait.zealynx.io — 845+ checks across 39 DeFi verticals, "Verify with AI" tailored prompts per check.
- **AI red-team patterns** — `patterns/ai-red-team/{prompt-injection,function-calling-abuse,context-window-manipulation,steganographic-injection,batch-*}.yaml` — protection against agentic-AI attacks.
- **Self-referencing "learned" patterns** — `patterns/learned/archive/{protocol}-{seq}-{pattern}.yaml` (amphora-001-cei-violation-reentrancy.yaml, basin-007-create2-frontrun.yaml, etc.) — each YAML is a pattern they LEARNED from a missed Code4rena finding.

**Gap vs us**:
- ❌ Missing: 4-mindset prompt structure, kill-gate severity catalog, second-opinion mode for revival, public shadow-audit benchmark transparency, AI red-team patterns library, "learned" patterns archive
- 💡 Borrow IMMEDIATELY:
  - **4 mindsets** verbatim into sentinel prompts (cheap quality boost — pure prompt engineering)
  - **8 kill gates** mapped to our themis / sentinel pipeline
  - **`patterns/learned/`** structure for accumulating new patterns from past audits (synergizes with grimoire's `scribe`)
  - **Public shadow-audit benchmark** — start one in our repo
  - **AI red-team patterns library** — prompt-injection defenses for the auditor itself

### 10. Monethic/monethic-maia (7⭐, AGPL-3.0)

**One-line**: 192 detectors across EVM (95) / Move-Aptos (49) / Move-Sui (48). 8-phase prompt-driven pipeline.

**Novel patterns:**
- **Per-category checklist files** — for EVM: `CAT-ACC.md`, `CAT-ASM.md`, `CAT-CRYPTO.md`, `CAT-DEX.md`, `CAT-ERC20.md`, `CAT-GAS.md`, `CAT-GEN.md`, `CAT-GOV.md`, `CAT-INTEG.md`, `CAT-LEND.md`, `CAT-MATH.md`, `CAT-NFT.md`, `CAT-ORACLE.md`, `CAT-PRED.md`, `CAT-PROXY.md`, `CAT-STABLE.md`, `CAT-STAKE.md`, `CAT-VAULT.md`, `CAT-VESTING.md`, `CAT-XCHAIN.md` — 20 categories.
- **Explicit protocol-category integration files** — `CAT-INTEG.md` covers Aave + Uniswap V3/V4 specifically. Per-protocol integration risks.
- **8-phase prompt pipeline** ([`prompts/`](https://github.com/Monethic/monethic-maia/tree/main/prompts)):
  - `01_bootstrap.md`
  - `02_recon.md`
  - `03_checklist_plan.md`
  - `04_scope_and_evidence.md`
  - `05_deep_file_sweep.md`
  - `06_candidate_generation.md`
  - **`07_adversarial_verifier.md`** ← echoes Archethect's adversarial pattern
  - `08_report_writer.md`
- **Generalist prompts as fallback** ([`prompts/generalist/`](https://github.com/Monethic/monethic-maia/tree/main/prompts/generalist)).
- **Output: HTML + Markdown** — `evm_audit.html` + `evm_audit.md` + `evm_audit_full.html` (includes FP + downgrades) + `evm_audit_full.md`. Click-to-open `file:///` link.
- **Regression cases** in [`evm/tests/regression_cases.md`](https://github.com/Monethic/monethic-maia/blob/main/evm/tests/regression_cases.md) — explicit regression test corpus.
- **`severity_policy.md` per chain** — separate severity policies per EVM/Move-Aptos/Move-Sui.
- **`rulepack.md` + `checklist_router.md`** — meta-files routing requests to specific category checklists.

**Gap vs us**:
- ❌ Missing: HTML report output (we're markdown-only), per-protocol integration files (Aave/UniV3/UniV4), regression test corpus, chain-specific severity policies, checklist_router meta-file
- 💡 Borrow:
  - **HTML output target** for browser-friendly viewing (markdown is fine for git, HTML is better for clients)
  - **`07_adversarial_verifier.md`** — independent confirmation of the pattern we already see in B1
  - **Per-protocol integration checklists** (Aave, UniV3, UniV4) — we have AMM/DEX as a general checklist, but protocol-specific would be more actionable
  - **Regression test corpus** — our patterns should each have a "this code SHOULD trigger" example file

### 11. konstantinvelev/AI (3⭐, tiny)

**One-line**: 2 small skills by a Web3 auditor — protocol-breakdown (mental-model builder) and findings-writer (formats for Code4rena/Sherlock/Cantina/Immunefi).

**Novel patterns:**
- **Pre-audit "breakdown" skill** — reads every contract, doc, test, script → delivers structured briefing covering architecture, **core logic with numeric examples**, money flows, invariants, prioritized battle plan. Solidity + Rust (Solana/Anchor + CosmWasm).
- **Findings-writer with platform-formatted output** — different format flags per platform (`-platform sherlock` / `-platform code4rena` / `-platform cantina` / `-platform immunefi`). Each platform has slightly different report conventions.

**Gap vs us**:
- ❌ Missing: pre-audit "breakdown" (similar to pashov's x-ray and scoping-bee in B3), platform-specific finding formatters
- 💡 Borrow: platform-specific output format flags for `argus_generate_report` (`--platform code4rena|sherlock|cantina|immunefi`)

---

## Cross-cutting themes (B2)

### Theme α — Self-improving auditors

**Seen in**: grimoire (`scribe` builds detection modules from findings), krait (blind-test → root-cause → update methodology → re-test loop with v1→v8 evolution), Hound (knowledge graphs refined iteratively), Plamen (RAG vulnerability DB), finite-monkey (Codex CLI execution + PostgreSQL persistence)

Our argus does **not learn** from past audits. Findings are written to reports but don't feed back into improved patterns. **Adding a "post-audit pattern distillation" step would let us systematically grow our 51 pattern files** over time.

### Theme β — Multi-mindset / multi-lens prompting

**Seen in**: krait (4 mindsets × 4 lenses = 16 angles), nemesis (Feynman + State pair), hound (sweep + intuition modes), Archethect from B1 (6 lanes)

Our sentinel is a single mindset. Easy wins by prompting sentinel to also analyze through **Attacker / Accountant / Spec Auditor / Edge Case Hunter** mindsets in parallel.

### Theme γ — Knowledge graph as audit substrate

**Seen in**: Hound (full KG-driven framework), grimoire (cartography skill memorizes flow→file:line mapping)

Our argus has `argus_analyze_contract` (returns one file's profile) but no project-wide graph. **A cartography layer would dramatically speed up multi-file analysis** and reduce per-finding code re-reads.

### Theme δ — Multi-chain expansion

**Seen in**: Plamen (EVM/Solana/Aptos/Sui/Stellar/L1 nodes), forefy (Solidity/Anchor/Vyper/TON/Sui Move), Maia (EVM/Move-Aptos/Move-Sui), nemesis (language-agnostic by design)

Our argus is Solidity-only. Long-term expansion target — but **not P0** unless user has a multi-chain need.

### Theme ε — Cite, don't fabricate

**Seen in**: grimoire (`librarian` only returns reference-backed info), The-Judge from B3 (live WebSearch verification, anti-hallucination guard)

We should add an explicit "no claims without citations" instruction layer for pythia.

### Theme ζ — MCP-first distribution

**Seen in**: weasel (MCP-native, MCP integration before skill), claudit from B3 (pure MCP), grimoire (Solodit MCP), Archethect from B1 (8 MCP tools)

Our argus_* tools are OpenCode-native plugin functions. **Wrapping them as an MCP server** would let users in Claude Code / Cursor / Codex consume our analysis without OpenCode.

### Theme η — Public benchmark transparency

**Seen in**: krait (publishes v1-v8 precision/recall against Code4rena), hound (scabench is the benchmark dataset), GPTScan (Web3Bugs/DefiHacks/Top200 datasets), SolidityGuard from B1 (EVMBench 120/120)

Echoes B1 finding #3. The reference benchmarks to enroll in:
- **EVMBench** (OpenAI, 40 real-world audits, 120 vulnerabilities, 3 modes)
- **scabench** (Hound's parent benchmark, less documented)
- **Web3Bugs / DefiHacks / Top200** (GPTScan datasets)
- **Code4rena public contests** (krait uses this — well-documented ground truth)

---

## Prioritized borrowing (B2)

### 🔴 Critical
- **4 mindsets × multi-lens** (krait) — pure prompt engineering, 1-day delivery, big precision impact
- **State-coupling-pair phase** (nemesis) — explicit early-phase enumeration of `(state_a, state_b)` invariants
- **Iterative cross-feed convergence loop** (nemesis) — 2-3 passes alternating between specialists
- **Public benchmark enrollment** (multiple) — combine with B1's eval-harness recommendation; enroll in EVMBench + Web3Bugs as baseline

### 🟠 High
- **Cartography skill** (grimoire) — flow → file:line map cached for fast context loads
- **Self-improvement / pattern distillation** (grimoire scribe + krait learned patterns) — post-audit auto-distill into new SKILL.md
- **MCP server wrapper** (weasel + claudit) — `argus mcp serve` for non-OpenCode tools
- **Kill-gate severity catalog** (krait — 8 gates A-H) — port into themis disposition logic
- **Senior/junior model tiering** (Hound) — scout for recon, strategist for deep — saves 50%+ on large audits
- **`fork-ancestry`** (Plamen) — track forked-from-X protocols and inherit-bug list
- **YAML rule format for compiled patterns** (GPTScan) — lighter than full SKILL.md
- **Modifier whitelist JSON** (GPTScan) — explicit trusted modifier list for FP reduction

### 🟡 Medium
- **HTML report output** (Maia)
- **Platform-specific finding formats** (konstantinvelev/AI) — `--platform code4rena|sherlock|cantina|immunefi`
- **GitHub Actions workflow templates** (weasel)
- **OpenGrep rules integration** (Plamen) — for trivial pattern detection
- **`integration-hazard-research`** as separate skill (Plamen)
- **`07_adversarial_verifier`** explicit phase prompt (Maia, echo of B1's DA pattern)
- **`auditor-quiz` training mode** (forefy)
- **`infrastructure-audit`** companion (forefy)
- **`sandboxed-audit-runner`** (forefy) — security for hostile-codebase analysis
- **`context-window-to-skill`** meta-skill (forefy) — distill audit session into reusable SKILL.md

### 🟢 Low
- **Knowledge graph audit substrate** (Hound) — big architecture change; defer
- **PostgreSQL persistence backend** (finite-monkey) — overkill for our scale
- **Multi-chain expansion** (Plamen et al.) — defer until customer demand
- **Live chatbot steering UI** (Hound) — nice-to-have, low ROI now
- **Google Docs report output** (forefy gdocs) — niche

---

## Open questions

1. **Self-improvement loop**: Do we want argus to auto-generate new SKILL.md files from past audits? Pros: knowledge compounds. Cons: quality control (LLM-generated skills may be slop).
2. **MCP server packaging**: Are we open to maintaining a parallel MCP server entry point alongside the OpenCode plugin? Doubles maintenance but doubles distribution.
3. **Benchmark enrollment**: Should we publicly publish our benchmark numbers (à la krait, SolidityGuard, scabench)? Big upside if good, big downside if bad. Start internal, publish when ready?

---

## Repos not deep-dived

- konstantinvelev/AI (3⭐, very small — covered briefly above)
- We touched all 11. None were "skip entirely" worthy.

---

Status: B2 ✅ — B3 next.
