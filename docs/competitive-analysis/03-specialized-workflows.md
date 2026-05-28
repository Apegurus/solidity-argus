# Batch 3 — Specialized Workflows: Competitive Analysis

> Source: https://github.com/pashov/ai-web3-security
> Generated: 2026-05-18
> Methodology: README + repo tree + key SKILL.md / agent prompts.
> Scope: 10 specialized-workflow repos (pre-audit scoping, PoC scaffolding, judging/FP filtering, known-findings dedup, triage, fuzzing, single-protocol scanners) + a freshness check on trailofbits/skills.

---

## Repos analyzed

| # | Repo | ⭐ | License | Stack | Specialty |
|---|------|----|---------|-------|-----------|
| 1 | [shuvonsec/claude-bug-bounty](https://github.com/shuvonsec/claude-bug-bounty) | **2,124** | MIT | Python | Full bug bounty workflow (web2 + web3) — 23 commands, 8 agents |
| 2 | [marchev/claudit](https://github.com/marchev/claudit) | **146** | MIT | TypeScript | Pure MCP server for Solodit (20k+ findings) |
| 3 | [cholakovvv/foundry-poc-mainnet-fork](https://github.com/cholakovvv/foundry-poc-mainnet-fork) | **61** | MIT | Markdown-only | Mainnet-fork Foundry PoC scaffolder |
| 4 | [hackenproof-public/skills](https://github.com/hackenproof-public/skills) | **29** | (none) | Markdown-only | Bug bounty triage marketplace (4 plugins) |
| 5 | [J4X-Security/K.I.T](https://github.com/J4X-Security/K.I.T) | **13** | MIT | Python | Known Issue Triager (canonical known-issues.json register) |
| 6 | [33Audits/cca-audit-agent](https://github.com/33Audits/cca-audit-agent) | **9** | (none) | Markdown-only | Uniswap CCA-specific vulnerability scanner |
| 7 | [heavyw8t/The-Judge](https://github.com/heavyw8t/The-Judge) | **7** | MIT | Markdown-only | Multi-stage adversarial FP filter |
| 8 | [gdroz3r/drozer-lite](https://github.com/gdroz3r/drozer-lite) | **4** | MIT | Markdown-only | 205-check pattern scanner across 14 profiles |
| 9 | [0xRayaa/scoping-bee](https://github.com/0xRayaa/scoping-bee) | **3** | MIT | Shell | Pre-audit scoping + threat-intel sandbox |
| 10 | [han-sec/trident-fuzz-skill](https://github.com/han-sec/trident-fuzz-skill) | **2** | (none) | Markdown-only | Solana/Anchor Trident invariant fuzzing |
| — | [trailofbits/skills](https://github.com/trailofbits/skills) | **5,270** | CC-BY-SA-4.0 | Multi | Trail of Bits skills marketplace — **cache freshness check** |

---

## Per-repo highlights

### 1. 0xRayaa/scoping-bee — Pre-audit scoping (FILLS A REAL GAP)

**One-line**: AI-powered pre-audit scoping for Solidity (Foundry/Hardhat) + Solana/Anchor (Rust). Outputs a structured scope report with flow diagrams, complexity scoring, prioritized hitlist, and time estimates.

**Critical novel patterns:**
- **Multi-source input** — accepts: GitHub URL, ZIP file, contract address on any block explorer (Etherscan/BSCScan/Polygonscan/Arbiscan/Optimism/Fantom/Avalanche/Base + testnets), or local directory. Supports verified-contract fetching from explorers.
- **10-phase Pre-Audit Threat Intelligence Scan** (run in sandbox FIRST, then move to local):
  - Phase 1: Code Behavior Analysis (HIGH)
  - Phase 2: HTML Fingerprint Matching (MED-HI)
  - Phase 3: Banner & Favicon Analysis (HIGH)
  - Phase 4: Client-Side JS Inspection (MED-HI)
  - Phase 5: Post-Signature Distributor Check (HIGH)
  - Phase 6: Codebase Profile Analysis (MED)
  - Phase 7: Function Purpose Analysis (MED-HI)
  - Phase 8: Dependency Audit (HIGH)
  - Phase 9: Reachability Analysis (MED)
  - Phase 10: OSS Feed & Vuln Check (MED-HI)
  
  Verdict: **CLEAN ✅ / WARNING ⚠️ / BLOCKED 🛑**
  
- **8 Mermaid diagram types** in [`scripts/codebase_visualizer.sh`](https://github.com/0xRayaa/scoping-bee/blob/main/scripts/codebase_visualizer.sh):
  1. Inheritance Hierarchy
  2. Inter-Contract Call Graph
  3. State Variable Map (class diagram)
  4. Access Control Flow (roles, modifiers, protected functions)
  5. External Dependency Graph (OZ, Solmate, custom imports)
  6. Function Flow (entry → internal → external)
  7. Complexity Heatmap (per-file metrics)
  8. Value Flow (deposit/withdraw/transfer paths)

- **nSLOC counter** (`sloc_counter.sh`) — strips pragma/imports/SPDX for Solidity, use/mod/attributes for Rust. Configurable pace (nSLOC/day) → time estimate.
- **42 attack surface checks** in `references/attack-surfaces.md` — 24 EVM-specific + 18 Solana-specific.
- **Complexity rubric** in `references/complexity-rubric.md`.
- **Scope report template** in `references/scope-report-template.md`.

**Gap vs us**:
- ❌ Missing: pre-audit scoping skill entirely, threat-intel sandbox scan, codebase complexity visualizer (Mermaid diagrams), nSLOC + pace-based time estimates, multi-source input handling (GitHub/ZIP/explorer address)
- 💡 Borrow IMMEDIATELY:
  - **Build `argus-prep` companion skill** (or `argus --mode=scope`) that:
    - Accepts multi-source input (URL/ZIP/address/dir)
    - Runs threat-intel sandbox first
    - Generates 8 Mermaid diagrams + complexity heatmap
    - Outputs scope report with time estimate
  - **Threat-intel sandbox-first workflow** — protect auditor host from hostile codebases (similar to forefy's `sandboxed-audit-runner`)
  - **Mermaid diagram generation** — visual reports beat textual ones for quick comprehension
  - **`--pace <nSLOC/day>`** flag for time estimation

### 2. cholakovvv/foundry-poc-mainnet-fork — PoC scaffolder (FILLS A REAL GAP)

**One-line**: Generates submission-ready Foundry PoCs against **mainnet-forked deployed contracts**. Validated across 4 production bounty findings.

**Critical novel patterns:**
- **Classification system upfront**:
  - (a) Frozen historical — state reached by block progression alone
  - (b) Forward-looking — depends on future state
  - (a+b) Both — past + future state combine
- **Real-address binding** — every protocol contract bound as `address constant` (no mocks)
- **Block-pinning** — forks at specific block where bug is reachable
- **Causal chain enforcement** — execute the full causal chain from triggering action to realized impact
- **End-state assertions** vary by impact type:
  - Theft → `assertGt(attackerAfter, attackerBefore)` + pool-near-zero
  - DoS → `vm.expectRevert`
  - Freeze → quantified stranding (e.g., `assertEq(recoverable, 0)`)
- **Won't do** (clear scope rules):
  - Non-EVM
  - Hardhat (Foundry only)
  - Local-state unit tests
  - Fuzz/invariant harnesses (different genre)
  - Guess addresses (flags blocker instead)
  - Bypass protocol pipelines (no `vm.store` shortcuts)
- **Public RPC fallback list** — tries drpc.org, mevblocker.io, eth-pokt.nodies.app when publicnode fails.
- **3 example templates** at [`examples/`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/tree/main/examples) — Claude pattern-matches user's finding shape to closest example.

**Gap vs us**:
- ❌ Missing: dedicated PoC scaffolder for mainnet-fork attacks (we have `argus_forge_test` but it runs existing tests, doesn't scaffold new ones)
- 💡 Borrow IMMEDIATELY:
  - **Add `argus_generate_poc` tool** that takes a finding + addresses + chain → produces a mainnet-fork Foundry test file
  - **Classification system** (frozen historical / forward-looking / both) — sentinel/scribe should classify findings into these buckets
  - **End-state assertion library** keyed by impact type (theft/DoS/freeze)
  - **RPC fallback chain** — robust against single-RPC outages

### 3. heavyw8t/The-Judge — FP filter (DIRECT THEMIS UPGRADE)

**One-line**: High-accuracy false-positive filter for AI-generated web3 security findings. Multi-stage adversarial validation pipeline.

**Critical novel patterns (DIRECTLY ACTIONABLE for our themis):**

The Judge's pipeline:
```
STEP 1 (sweep) — verify file/function/line exists, internal consistency. EARLY EXIT INVALID if location wrong.
STEP 2 (roles) — if attack reduces to "trusted role acts maliciously", cap severity at Low or early-exit INVALID.

WAVE 1 (parallel, one message):
  • Step 1.5 — external protocol research (WebSearch, cached per session)
  • Step 3A — selector picks 3 best generic invalidation reasons from a library
  • Step 4A — adversarial generator produces 3-5 issue-specific counter-arguments

filter — drop Step 4A reasons that overlap with Step 3A selections

WAVE 2 (parallel, up to 6 opus checkers, one message):
  • Step 3B — 3 checkers verify generic reasons against code (HOLDS/FAILS/UNCERTAIN with line evidence)
  • Step 4B — 3 checkers verify adversarial reasons against code

STEP 3C — if ≥2 Step 3B checkers HOLDS with solid evidence → EARLY EXIT INVALID (Step 4B discarded).

STEP 4C (judge) — only if any Step 4B checker HOLDS. Neutral opus judge reads invalidation + original finding + code → renders VALID / INVALID / DOWNGRADE.
```

**Key design principles:**
- **Adversarial duality** — every finding tested by BOTH generic checker (covering common FP patterns from a library) AND specific generator (reads actual code for issue-specific defenses).
- **Two-checker confirmation for early exit** — prevents isolated checker mistakes from killing real findings.
- **Anti-hallucination guard** — checker prompts FORBID claims from training data; Step 1.5 does live WebSearch verification, cached per session.
- **Neutral judge for conflicts** — separate impartial judge agent renders final call when checkers disagree.
- **CSV batch mode** — processes findings in waves of 5; per-issue traces in `validation_results/ISSUE-{id}.md`; observations accumulate (non-authoritative) in `validation_notes.md`.

**`invalidation-library.md`** — catalog of generic invalidation reasons. The selector picks the 3 best for any given finding.

**Wall-clock**: ~7 min per finding on the deepest path; ~25-35 min for 30 findings in CSV mode (vs ~3 hours sequential).

**Gap vs us**:
- ❌ Missing: multi-stage parallel FP-filtering pipeline, two-checker confirmation early-exit pattern, anti-hallucination WebSearch verification, neutral judge for conflicts
- 💡 Borrow IMMEDIATELY (this is **the single biggest themis upgrade**):
  - **Adopt Judge's pipeline verbatim** for themis: trust-check → parallel generic+specific checkers → two-checker early-exit → neutral judge tiebreak
  - **`invalidation-library.md`** — build a library of generic invalidation reasons (similar to hard-negatives in Archethect B1, but indexed by reason class rather than pattern)
  - **WebSearch verification + per-session cache** for external protocol claims
  - **CSV batch mode** for processing existing finding sets

### 4. J4X-Security/K.I.T — Known Issue Triager (UNIQUE WORKFLOW)

**One-line**: Builds and maintains a canonical `known-issues.json` register from audit reports. Cross-checks new findings against the register for duplicates.

**Critical novel patterns:**
- **Canonical `known-issues.json` register** — single source of truth for all known findings, deduplicated across multiple audit reports.
- **Source ingestion is generic and permissive**:
  - Local files / folders / repo directories
  - URLs (HTTP)
  - GitHub file URLs / folder URLs / whole repo URLs
  - PDFs (via pdfplumber + pypdf)
- **2 commands**:
  - **build** — construct register from sources (extend or rebuild)
  - **check** — compare new finding/report against the register
- **Python engine does NOT make model judgments** — only prepares source text and staged JSON contracts. The HOST MODEL does extraction/dedup/decisions per the `llm_contract`.
- **Semantic dedup** — by root cause + affected surface + exploit path + impact, NOT title similarity.
- **Parallel processing** — when multiple findings, one worker per finding, merge by `finding_index`.
- **Intentionally fails when staged model output is missing** — no heuristic fallback. Forces explicit human-in-loop or model-in-loop.
- Both Claude Code (`/kit`) and Codex (`$kit`) supported.

**Gap vs us**:
- ❌ Missing: cross-audit known-findings dedup workflow, PDF audit-report ingestion (we have `scripts/audit-pdf-extract.ts` but it's findings extraction, not a query register), staged JSON contract pattern (engine prepares, model decides)
- 💡 Borrow:
  - **Build `argus-kit` companion skill** that maintains `known-issues.json` for our users:
    - Ingests their past audits (PDF, MD)
    - On new audit, compares findings against register → labels them as duplicate / variant / novel
    - High-value for protocols with multi-audit history (e.g., Aave, Uniswap)
  - **Staged JSON contract pattern** — engine prepares staged input, model decides per a strict schema. We could apply this to our `argus_persist_deduped` (engine prepares dedup candidates → scribe decides).
  - **PDF ingestion via pdfplumber** — augment our existing audit-pdf-extract pipeline with K.I.T-style register output.

### 5. hackenproof-public/skills — Bug bounty triage marketplace (4 PLUGINS)

**One-line**: HackenProof's official triage skills for bug bounty platforms. Marketplace-distributed.

**4 plugins:**

| Plugin | What it does | Notable refs |
|---|---|---|
| **hackenproof-triage** | Verify commit/version in scope, verify submission scope, check duplicates, validate + decide state/severity/comment | `hackenproof-global-policy.md`, `severity-mapping.md`, `triage-comment-templates.md` |
| **hackenproof-bulk-triage** | Batch processing — automate triage of many reports | `setup-guide.md` |
| **hackenproof-fix-verifier** | Verify a fix is complete + regression-free + meets check criteria | `completeness-checklist.md`, `regression-checklist.md`, `smart-contract-fix-checks.md`, `verdict-template.md` |
| **hackenproof-handoff** | Handoff triaged finding to programs with bounty calculation | `handoff-template.md`, **`severity-to-bounty.md`** |
| **hackenproof-all-reports-export** | Bulk export reports |  |

**Novel patterns:**
- **Marketplace distribution via `.claude-plugin/marketplace.json`** — Claude Code native install.
- **Enterprise install pattern** — "Server-Managed Settings" in claude.ai → Admin Settings auto-distributes to org members.
- **`severity-to-bounty.md`** — actual mapping from severity tier to bounty $ amount. **This is GOLD** — we don't have a public bounty rubric.
- **`hackenproof-fix-verifier`** with both `completeness-checklist.md` AND `regression-checklist.md` — post-fix verification is a **separate workflow** from audit, with its own checklists.
- **`smart-contract-fix-checks.md`** — Solidity-specific fix verification rules.

**Gap vs us**:
- ❌ Missing: bug bounty triage workflow, fix verification skill (separate from audit), severity-to-bounty mapping, marketplace.json distribution
- 💡 Borrow:
  - **Build `argus-fix-verifier`** companion skill — verifies a proposed fix is complete + doesn't regress + meets quality bar. Triggered by `argus verify-fix <finding-id> <patch-or-pr>`.
  - **Add severity-to-bounty rubric** to our `severity-classification.md` skill — give protocol teams a default mapping for internal bounty programs.
  - **`.claude-plugin/marketplace.json` distribution** — enables `/plugin marketplace add Apegurus/solidity-argus` in Claude Code (echoes B1 finding).

### 6. shuvonsec/claude-bug-bounty — 2,124⭐ behemoth (mostly web2 focus)

**One-line**: AI-powered bug bounty hunting with 23 commands, 8 agents, 9 skill domains. Auth-aware, autonomous mode, web2 + web3 + meme-coin specific.

**Novel patterns (mostly web2-adjacent, less direct overlap with our scope):**
- **Memory system** with `pattern_db.py`, `audit_log.py`, `rotation.py` — persistent learning across engagements.
- **MCPs**: Burp Suite, Caido, HackerOne — covers full web2 toolchain.
- **Auth sessions / autopilot mode** — agent can authenticate and crawl.
- **23 commands** including: `/hunt`, `/recon`, `/triage`, `/validate`, `/report`, `/scope`, `/intel`, `/chain` (chain-builder), `/autopilot`, `/secrets-hunt`, `/scan-cves`, `/param-discover`, `/bypass-403`, `/takeover` (subdomain takeover), `/cloud-recon`, `/surface` (attack surface), `/memory-gc`, `/remember`, `/scope-aggregate`, `/token-scan`, `/web3-audit`.
- **9 skill domains**: bb-methodology, bug-bounty, **meme-coin-audit**, report-writing, security-arsenal (with METHODOLOGY_CHEATSHEET.md + REFERENCES.md), triage-validation, web2-recon, web2-vuln-classes, web3-audit.
- **180 passing tests** (`tests/test_*.py`) — mature project with test coverage we should emulate.

**Specific to web3:**
- `commands/web3-audit.md` + `skills/web3-audit/SKILL.md`
- `commands/token-scan.md` + `skills/meme-coin-audit/SKILL.md` (memecoin scam detection!)
- `commands/chain.md` (chain-builder)
- `docs/smart-contract-audit.md`

**Gap vs us**:
- ❌ Different use case (bug bounty hunting vs commissioned audit), but:
- 💡 Borrow:
  - **Memory system pattern** (`pattern_db.py`, `audit_log.py`) — persistent learning across audits
  - **Meme-coin audit skill** — niche but high-volume in 2026; cheap to add as a specialized SKILL.md (honeypot patterns, rug patterns, hidden mint, etc.)
  - **180-test discipline** — our test count should grow with this benchmark in mind
  - **`/scope-aggregate`** — aggregate scope across multiple sources (e.g., multi-repo audits)

### 7. marchev/claudit — Pure MCP server for Solodit

**One-line**: MCP server for searching Solodit's 20,000+ findings. Pure MCP, no skill bundling. Maintainer is a solo contributor.

**Novel patterns:**
- **MCP-only delivery** — `npx -y @marchev/claudit@latest` registered as Claude Code / Codex MCP. No skill file.
- **Rich filter API**:
  - Basic: `keywords`, `severity`, `firms`, `tags`, `language`, `protocol`, `reported` (30/60/90/alltime), `sort_by` (Recency/Quality/Rarity).
  - Advanced: `quality_score` (0-5), `rarity_score` (0-5), `user` (auditor handle), `min_finders`, `max_finders`, `reported_after`, `protocol_category`, `forked` (forked-from protocol list).
- **3 tools**: `search_findings`, `get_finding` (by ID/URL/slug), `get_filter_options` (lists valid filter values with counts).
- **One-liner install**: `curl -fsSL .../install.sh | sh` — detects Claude Code and/or Codex, prompts for API key, registers.
- **Companion skill** at `.claude/skills/solodit/SKILL.md` — guides the model in using the MCP effectively (otherwise model may not know what filters to use).
- **Demo screenshot** in README.

**Gap vs us**:
- ⚠️ Overlap: We have `argus_solodit_search` via `solodit-mcp`. Likely the SAME upstream.
- ❌ Missing: rich filter set (quality_score / rarity_score / forked / min_finders), companion skill that teaches model how to use the MCP
- 💡 Borrow:
  - **Compare our solodit-mcp filter API vs claudit's** — adopt anything we're missing (quality_score, rarity_score, forked-protocol filter, etc.)
  - **Companion skill that documents MCP usage** — our pythia prompt should have explicit examples of `argus_solodit_search` filter combinations

### 8. han-sec/trident-fuzz-skill — Solana invariant fuzzing

**One-line**: 5-phase Trident v0.12.0 fuzz harness skill for Solana/Anchor programs. **Invariant-driven stateful fuzzing**, not crash fuzzing.

**Novel patterns:**
- **4-stage progressive refinement methodology**:
  - Stage 1: **Foundation** — single-program accounting with random operations. Blind spot: cross-program corruption.
  - Stage 2: **Integration** — cross-program CPI with interleaved flows. Blind spot: CPI-consistent bugs (both sides record same wrong number).
  - Stage 3: **Scenario** — adversarial state transitions (liquidation, oracle crash). Blind spot: time-dependent bugs.
  - Stage 4: **Temporal** — time advancement + interest accrual. Blind spot: dynamic-PDA paths.
- **5 sequential phases** (each in its own SKILL.md):
  1. `trident-phase-1-setup` — map account dependencies, generate scaffolding
  2. `trident-phase-2-invariants` — derive testable invariants at multiple detection scopes
  3. `trident-phase-3-construction` — write modular flows + invariant assertions
  4. `trident-phase-4-validation` — compile, run short campaign, verify flows execute
  5. `trident-phase-5-analysis` — interpret output, assess coverage, decide next steps
- **Version-pinned API reference** — `trident-api-v0.12.md`. Only this file needs updating for new Trident releases.
- **Invariant table format** (consumable from prior audits): `| # | Invariant | Derived From | Fuzzable? | State Reads Needed | Detection Scope |`.

**Gap vs us**:
- ⚠️ Different chain (Solana/Anchor) but
- 💡 Borrow:
  - **4-stage progressive refinement** for EVM fuzzing (echidna/medusa/foundry-invariant):
    - Stage 1: Single-contract accounting with random ops
    - Stage 2: Cross-contract integration with interleaved external calls
    - Stage 3: Scenario fuzzing (oracle crash, flash-loan, liquidation under stress)
    - Stage 4: Temporal (block.timestamp progression, interest accrual)
  - **Invariant table format** with explicit "Derived From / Fuzzable? / State Reads Needed / Detection Scope" columns — better than freeform invariant listing
  - **Version-pinned API reference pattern** — keep our tool integrations versioned (slither version, forge version, etc.)

### 9. 33Audits/cca-audit-agent — Uniswap CCA-specific scanner

**One-line**: Scans Solidity contracts for **Uniswap Continuous Clearing Auction** (CCA) vulnerabilities. 15 known patterns + adversarial. Niche but well-structured.

**Novel patterns:**
- **Per-protocol vulnerability catalog** — 9 core CCA vectors (VC1-VC9) + 6 integration vectors (VI1-VI6). Each vector has: ID, name, severity, grep signatures, description, confirm-if criteria.
- **Notable compiler-bug pattern** — **VC9: TSTORE poison in solc 0.8.28–0.8.33 via-ir** ([Hexens research](https://hexens.io/research/solidity-compiler-bug-tstore-poison)). Cache key collision swaps sstore/tstore opcodes on delete.
- **Dual-agent**: Vector Scan (15 known patterns, fast triage) + Adversarial Reasoning (free-form, catches novel bugs).
- **Cross-platform** — single skill works in Claude Code, Cursor, Windsurf, GitHub Copilot.
- **Bundle-read optimization** — concatenates all source into one file; agents read it in parallel chunks on turn 1. Same pattern as pashov/skills.
- **FP Gate** (3 checks): concrete attack path / reachable / impact. Findings failing any check are dropped.

**Gap vs us**:
- ❌ Missing: per-protocol vulnerability catalogs (vs our generic protocol-pattern skills). Specifically: Uniswap V3/V4, Aave V3, Compound V3, Curve, Convex, Lido, EigenLayer, Pendle, Maker, etc. — top integrated protocols deserve their own catalog.
- 💡 Borrow:
  - **Per-protocol vulnerability catalog skill template** — vectors with ID/name/severity/grep/description/confirm-if. Build out for top 10 most-integrated DeFi protocols.
  - **TSTORE poison pattern** in our floating-pragma / compiler-version checks
  - **Hexens compiler bug research** as a reference

### 10. gdroz3r/drozer-lite — 205 checks across 14 profiles

**One-line**: Fast, deterministic Solidity pattern scanner. 205 checks across 14 profiles. **Every check traces to a real missed finding from a past audit benchmark.**

**Novel patterns:**
- **Empirical derivation discipline**: "Each check traces to a real missed finding from a past audit benchmark. The initial checklist was ported from the **ScaBench** curated dataset and the Drozer-v2 internal gap analysis pipeline. From there, each new benchmark audit (Code4rena, Sherlock, etc.) produces a post-mortem: missed findings are classified by root cause, and any gap that is generalizable into a pattern-level check gets added to the relevant profile. **Checks that only match a single codebase are rejected — only class-of-bug patterns that fire across protocols are kept.**"
- **14 profiles**:
  - `universal` (110 checks — always loaded)
  - `dex` (11), `vault` (6), `lending` (5), `stableswap` (5)
  - `signature` (4), `cross-chain` (13), `governance` (6), `reentrancy` (5)
  - `oracle` (3), `math` (6), `gaming` (3)
  - `icp` (16), `solana` (12) — non-Solidity profiles too
- **Auto profile detection** — `--profile auto` selects relevant profiles from codebase keywords.
- **Cross-cluster sweep** — clusters files by dependency, applies checklist per cluster, then runs cross-cluster sweep for multi-file bugs.
- **Forefy Benchmark link** in README — public benchmark transparency.

**Gap vs us**:
- ❌ Missing: 110-check universal profile (we have ~51 vuln patterns total — drozer-lite has 2x more)
- 💡 Borrow:
  - **Empirical-derivation discipline** — every pattern in our skills/ should cite a real missed finding (an audit report URL or exploit case study)
  - **Auto profile detection** — scan codebase keywords (`pool`, `vault`, `bridge`, etc.) → activate matching protocol skill files automatically
  - **Cross-cluster sweep** as explicit phase — find dependencies, cluster, then re-scan across clusters for inter-cluster bugs

---

## ⭐ trailofbits/skills — Cache freshness check (5,270⭐)

**Last commit**: 2026-05-16 · **Stars**: 5,270 (huge growth — our cache predates many of these).

### Plugins NOT in our cache (NEW additions worth syncing)

| Plugin | What it does | Relevance |
|---|---|---|
| **`agentic-actions-auditor`** | Audit GitHub Actions workflows for AI-agent security vulnerabilities (env-var intermediary, direct expression injection, CLI data fetch, PR target checkout, error log injection) | 🟡 Adjacent (workflow security, not Solidity) |
| **`c-review`** | Comprehensive C/C++ security review with clustered parallel workers and SARIF output | 🟢 Not directly applicable (no C in Solidity audit) |
| **`dimensional-analysis`** | Annotate codebases with dimensional analysis comments to detect unit mismatches and formula bugs | 🔴 **HIGH RELEVANCE** for DeFi math |
| **`fp-check`** | Systematic false positive verification for security bug analysis with **mandatory gate reviews** | 🔴 **CRITICAL** — direct themis upgrade |
| **`crypto-protocol-diagram`** | Diagram tooling for cryptographic protocols | 🟡 Useful for L1 / bridges |
| **`mermaid-to-proverif`** | Convert Mermaid diagrams to ProVerif formal verification | 🟡 Niche |
| **`supply-chain-risk-auditor`** | Audit supply-chain threat landscape of project dependencies | 🔴 **HIGH** — npm/pip supply chain attacks |
| **`trailmark`** | Code graph analysis, Mermaid diagrams, mutation testing triage, protocol verification | 🟠 High — overlaps with grimoire cartography |
| **`trailmark-structural`** | Structural analysis subset | 🟠 High |
| **`trailmark-summary`** | Summarization subset | 🟠 High |
| **`vector-forge`** | (likely vector / pattern forging) — needs investigation | 🟠 High |
| **`graph-evolution`** | Graph evolution tracking | 🟡 Medium |
| **`let-fate-decide`** | Tarot cards via cryptographic randomness for vague planning (fun) | 🟢 Low |
| **`skill-improver`** | Iterative skill refinement loop with automated fix-review cycles | 🟠 High — self-improvement loop |
| **`mutation-testing`** | Configure mewt/muton mutation testing campaigns | 🟠 High — fits our forge_coverage |
| **`zeroize-audit`** | Detect missing/eliminated zeroization of secrets in C/C++ and Rust | 🟢 Not Solidity-relevant |
| **`diagramming-code`** | Generic code diagramming | 🟡 Medium |
| **`audit-augmentation`** | Audit pipeline augmentation | 🟠 High — likely fits our workflow |
| **`designing-workflow-skills`** + **`workflow-skill-design`** | Skill-design patterns | 🟠 High — improves our skill authoring |
| **`genotoxic`** | (unknown — likely cryptographic) | 🟡 Medium |

### Recommendation

**Re-sync our cache.** Our companion-plugin sync is stale by months. Specifically prioritize:

1. **`fp-check`** — direct upgrade for themis (mandatory gate reviews)
2. **`dimensional-analysis`** — annotate Solidity contracts with unit comments (e.g., `// [USD * 1e6]`) to catch decimal-mismatch bugs
3. **`supply-chain-risk-auditor`** — covers npm dep / installed lib risk (under-covered in our existing skills)
4. **`skill-improver`** — self-improvement loop for our own skills
5. **`trailmark`** + variants — graph analysis we can integrate
6. **`mutation-testing`** — pairs nicely with our forge_coverage tool

`argus_sync_knowledge` should auto-trigger a TOB skills resync alongside the SCVD sync.

---

## Cross-cutting themes (B3)

### Theme A — Pre-audit hygiene as a SEPARATE workflow

**Seen in**: scoping-bee (10-phase threat-intel sandbox + 8-diagram visualizer), CDSec audit-prep (B1), pashov x-ray (B1), forefy infrastructure-audit (B2).

Universal consensus: pre-audit is a distinct workflow with its own outputs (scope report, threat model, diagrams, time estimate). **We have no equivalent.** Highest-leverage addition.

### Theme B — Adversarial FP filtering with parallel checkers

**Seen in**: The-Judge (6-step pipeline with WAVE 1 + WAVE 2 parallel), Archethect's Skeptic (B1), DarkNavy's adversarial-agent (B1), TOB's fp-check.

Our themis runs once linearly. **Multi-stage parallel-checker FP filtering would dramatically improve our precision.**

### Theme C — Known-findings dedup register

**Seen in**: K.I.T (canonical known-issues.json), hackenproof-triage (check duplicates before submit).

**We have zero cross-audit dedup.** Findings from previous audits should be persistently recognized when re-auditing the same protocol (or its forks).

### Theme D — Mainnet-fork PoC scaffolding

**Seen in**: cholakovvv/foundry-poc-mainnet-fork.

**We can run tests but can't scaffold mainnet-fork PoC files from a finding.** This blocks bug bounty submission workflows.

### Theme E — Per-protocol vulnerability catalogs

**Seen in**: 33Audits/cca-audit-agent (CCA-specific), Plamen (Aave/UniV4 in `dex-integration-security`), Maia (`CAT-INTEG.md`).

**Our `cyfrin-defi-integrations` is generic.** Top-10 most-integrated protocols (UniV3/V4, Aave V3, Curve, Compound V3, Lido, EigenLayer, Pendle, Maker, Balancer, GMX) deserve named catalog files.

### Theme F — Fix verification as a separate skill

**Seen in**: hackenproof-fix-verifier (4 reference files: completeness, regression, SC fix checks, verdict).

**We end audits at findings.** No formal post-fix verification. This is the next logical workflow (audit → fix → re-verify → close-loop).

### Theme G — Empirical pattern derivation

**Seen in**: drozer-lite ("each check traces to a real missed finding"), krait (B2 — `patterns/learned/archive/`), Plamen (B2 — OpenGrep rules from CVE patterns).

**Our 51 patterns are good but not all are sourced from real missed findings.** Quality check: every pattern should cite a public exploit, audit report, or CVE.

### Theme H — Bug bounty / meme-coin niche

**Seen in**: shuvonsec/claude-bug-bounty (meme-coin-audit skill), hackenproof-public/skills (bounty triage).

**Adjacent market.** Could add `meme-coin-audit` skill (honeypot detection, rug detection, hidden mint, blacklist owner functions, fee manipulation) as a cheap niche addition.

---

## Prioritized borrowing (B3)

### 🔴 Critical (workflow gaps that block real customer use cases)

1. **Build `argus-prep` pre-audit scoping skill** (scoping-bee + x-ray + CDSec audit-prep merged)
   - Multi-source input (URL/ZIP/explorer-address/dir)
   - Threat-intel sandbox-first workflow
   - 8 Mermaid diagrams
   - Complexity + nSLOC + time estimate
   - Scope report
2. **Adopt The-Judge's 6-step parallel FP-filter pipeline for themis** — bigger themis upgrade than the B1 Archethect Skeptic pattern alone
3. **Add `argus_generate_poc` tool** — mainnet-fork Foundry PoC scaffolder (cholakovvv)
4. **Resync TOB skills + integrate `fp-check`, `dimensional-analysis`, `supply-chain-risk-auditor`**

### 🟠 High

5. **Build `argus-kit` known-findings dedup skill** (K.I.T pattern adapted for our SCVD + Solodit + custom protocol audit-history corpus)
6. **Build `argus-fix-verifier` companion skill** (hackenproof-fix-verifier — completeness + regression + verdict)
7. **Build per-protocol vulnerability catalogs** for top 10 DeFi integrations (UniV3/V4, Aave V3, Curve, Compound V3, Lido, EigenLayer, Pendle, Maker, Balancer, GMX) — modeled on 33Audits CCA catalog
8. **Empirical-derivation review pass** — for each of our 51 patterns, verify it cites a real missed finding (audit URL or exploit case study). Patterns failing this check get tagged "needs-evidence" and don't fire until evidenced.
9. **`severity-to-bounty.md`** rubric in our `severity-classification` skill (hackenproof pattern)

### 🟡 Medium

10. **`meme-coin-audit` niche skill** (shuvonsec pattern) — honeypot/rug/mint/blacklist detection
11. **4-stage progressive fuzzing methodology** for EVM (trident pattern adapted) — feeds into our future Echidna/Medusa/Foundry-invariant integrations from B1
12. **TSTORE poison + compiler-bug patterns** (33Audits VC9, Hexens research) — add to outdated-compiler-version skill
13. **Auto-profile-detection** at scan start (drozer-lite) — activate relevant protocol-pattern skills based on codebase keywords
14. **Marketplace.json distribution** for Claude Code (hackenproof + many B1/B2 repos)

### 🟢 Low

15. **`/scope-aggregate`** equivalent — multi-repo monorepo support (shuvonsec)
16. **Pattern memory persistence** like shuvonsec's `pattern_db.py`

---

## Quick wins (1-day or less)

These are the lowest-effort, highest-value additions from B3:

1. **Empirical-derivation tag** — add a single `source_finding:` field to every SKILL.md frontmatter pointing at an audit/exploit URL. Audit our existing 51 + tag those without.
2. **TSTORE poison + Hexens compiler-bug pattern** — single new SKILL.md
3. **`meme-coin-audit` SKILL.md** — single new vulnerability-pattern skill
4. **`severity-to-bounty.md`** as new section in our severity-classification skill
5. **TOB skills cache resync** — single sync command (we already have `argus_sync_knowledge` infrastructure)

---

## Open questions

1. **Pre-audit skill packaging**: Should `argus-prep` be a separate skill in our package or a new mode flag on the existing argus orchestrator (`@argus scope` vs `@argus-prep`)? Lean toward **separate skill** to keep the audit skill focused.
2. **Fix verifier scope**: Should `argus-fix-verifier` validate the fix only, or also regenerate proof-of-no-exploit on the patched code? Adding the latter doubles its cost but increases verifier credibility.
3. **Known-findings register data sources**: For `argus-kit`, do we ingest from (a) user's private audit archive, (b) public Solodit, (c) public audit-firm repos (e.g., spearbit, openzeppelin, trail-of-bits, code4rena), or (d) all of the above? Public sources are easy; private archives require careful UX.
4. **Per-protocol catalog ownership**: Per-protocol catalogs (UniV3/V4 etc.) age quickly as protocols upgrade. Do we maintain these in-tree or pull from upstream sources at audit time? Hybrid: stub catalog in-tree, pull latest from CCA/Plamen/forefy at runtime.

---

## Repos NOT in this batch but worth a note

- **shuvonsec/claude-bug-bounty** is huge (2k+⭐) but mostly web2. Worth a single dedicated SKILL crib (memory pattern, meme-coin skill) — not a full integration.
- **`gdroz3r/drozer-lite`** is small but well-documented. Their 14-profile structure is worth modeling for our own protocol-patterns/.

---

Status: B3 ✅. All three batches complete. Next: consolidate cross-batch matrix + final prioritized action list.
