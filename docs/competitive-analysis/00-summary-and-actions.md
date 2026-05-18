# Competitive Analysis — Summary & Prioritized Action List

> Source: https://github.com/pashov/ai-web3-security
> Generated: 2026-05-18
> Scope: 29 free/open-source AI web3 security tools across 3 batches + Trail of Bits skills cache freshness check.
> Detailed per-batch reports: [B1 Flagship Solidity](./01-flagship-solidity-skills.md) · [B2 Auditor Agents](./02-auditor-agents.md) · [B3 Specialized Workflows](./03-specialized-workflows.md)

---

## TL;DR — the 7 biggest gaps

We benchmarked solidity-argus against 29 active competitors. The 7 highest-leverage gaps:

| # | Gap | Found in | Effort | Impact |
|---|-----|----------|--------|--------|
| 1 | **No specialized hunt agents by vulnerability class** — we have 1 generic `sentinel`; leaders run 6-9 specialist agents per audit | pashov (8), Archethect (6), SolidityGuard (9), DarkNavy (3), CDSec (3), nemesis (2 alternating) | L | 🔴 Critical |
| 2 | **No eval / benchmark harness** — we can't measure if changes regress detection | pashov (DODO/megapot/pooltogether), SolidityGuard (EVMBench 100%), krait (Code4rena 100% precision), Hound, GPTScan (Web3Bugs/DefiHacks/Top200) | M | 🔴 Critical |
| 3 | **No Devil's-Advocate + Skeptic-with-inversion-mandate** in themis | Archethect (DA + Skeptic + Judge), DarkNavy (6-check), The-Judge (Wave 1 + Wave 2 parallel), pashov (4-gate refutation), TOB fp-check | M | 🔴 Critical |
| 4 | **No 2025+ vulnerability patterns** (EIP-1153 TSTORE / EIP-7702 Pectra / ERC-4337) | SolidityGuard (13+ patterns) | S | 🔴 Critical |
| 5 | **No pre-audit scoping skill** — multi-source input, threat-intel sandbox, Mermaid diagrams, time estimates | scoping-bee, pashov x-ray, CDSec audit-prep | M | 🟠 High |
| 6 | **No mainnet-fork PoC scaffolder** — we run tests, don't generate them | cholakovvv/foundry-poc-mainnet-fork, Archethect (generate-foundry-poc MCP tool) | S | 🟠 High |
| 7 | **No hard-negatives catalogue + cheatsheet pattern** | Archethect (5 hard-negatives), kadenzipfel (CHEATSHEET.md), pashov (Safe patterns list) | S | 🟠 High |

Effort: S = ≤2 days · M = ≤2 weeks · L = ≥3 weeks.

---

## Consolidated gap matrix

✅ have · 🟡 partial · ❌ missing

| Capability | Us | pashov | DarkNavy | Archethect | SolidityGuard | Hound | Krait | Plamen | Nemesis | scoping-bee | The-Judge | K.I.T | Maia |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multi-agent orchestrator | ✅ 5 | ✅ 8 | ✅ 3 | ✅ 6 | ✅ 9 | ✅ 2-tier | — | ✅ 18-100 | ✅ 2 alt | — | ✅ 6-step | — | ✅ 8-phase |
| Specialized hunt agents by vuln class | ❌ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — | — | — | — | ✅ |
| DA + Skeptic + Judge (inversion mandate) | 🟡 themis | 🟡 | ✅ 6-check | ✅ DA+Skeptic+Judge | 🟡 | — | ✅ 8 gates + review | 🟡 (Krait credits Plamen) | — | — | ✅ Wave 1+2 | — | ✅ 07_adv_verifier |
| Proof-or-Demote | ❌ | ✅ proof: field | ✅ Critical/High PoC | ✅ benchmark_mode | 🟡 | — | ✅ kill gate D | — | — | — | ✅ requires evidence | — | — |
| Hard-negatives / Safe patterns | ❌ | ✅ judging.md list | ✅ Filter 0 | ✅ 5 files | — | — | ✅ 10 FP patterns | — | — | — | ✅ invalidation-library | — | — |
| Eval / benchmark infrastructure | ❌ | ✅ 3 protocols | — | ✅ benchmark_mode | ✅ CTF + EVMBench | ✅ scabench parent | ✅ Code4rena 100% prec | ✅ RAG vuln DB | — | — | — | — | ✅ regression_cases |
| Cheatsheet (single-file all-patterns ref) | ❌ INVENTORY only | 🟡 attack-vectors 110KB | 🟡 checklist | — | ✅ 104-pattern table | — | ✅ CHEATSHEET | — | — | — | ✅ invalidation-library | — | ✅ rulepack |
| Pre-audit recon/scoping skill | ❌ | ✅ x-ray | — | — | — | — | — | — | — | ✅ 10-phase | — | — | — |
| Mainnet-fork PoC scaffolder | ❌ | — | ✅ exploit-investigator | ✅ generate-foundry-poc MCP | ✅ exploit_verifier | — | — | — | — | — | — | — | — |
| Known-findings dedup register | ❌ | — | — | — | — | — | — | — | — | — | — | ✅ known-issues.json | — |
| Fix verification (post-audit) | ❌ | — | — | — | — | — | — | — | — | — | — | — | — (hackenproof) |
| Knowledge graph audit substrate | ❌ | — | ✅ context-and-analysis | — | — | ✅ KG-driven | — | — | — | — | — | — | — |
| Senior/junior model tiering | ❌ | — | — | — | — | ✅ | — | — | — | — | — | — | — |
| MCP server packaging | 🟡 via OpenCode tools | — | — | ✅ 8 MCP tools | — | — | ✅ optional MCP | ✅ custom slither-mcp | — | — | — | — | — |
| Native Claude Code plugin manifest | ❌ | — | — | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Aderyn / Echidna / Medusa / Halmos | ❌ | — | — | ✅ 4 tools | ✅ 6 tools | — | — | ✅ multi | — | — | — | — | — |
| 2025+ patterns (TSTORE / Pectra / 4337) | ❌ | — | — | — | ✅ 13+ | — | ✅ EIP7702 mod | — | — | — | — | — | — |
| Pre-audit scoping diagrams (Mermaid) | ❌ | ✅ SVG | — | — | — | — | — | — | — | ✅ 8 types | — | — | — |
| Cartography (flow → file:line map) | ❌ | — | ✅ context map | — | — | ✅ KG | — | — | — | — | — | — | — |
| Per-protocol vuln catalogs (Uni/Aave/etc) | 🟡 generic | — | — | — | — | — | ✅ 7 primers | ✅ skills | — | — | — | — | ✅ INTEG |
| 4-mindset prompt structure | ❌ | — | — | — | — | — | ✅ Attacker/Accountant/Spec/EdgeCase | — | — | — | — | — | — |
| `--diff <ref>` PR/incremental | ❌ | — | — | — | — | — | — | — | — | — | — | — | (CDSec has it) |
| HTML report output | ❌ | — | — | — | — | — | — | — | — | — | — | — | ✅ |
| Self-improving (pattern accumulation) | ❌ | ✅ via attack-vectors edits | — | — | — | — | ✅ learned patterns | ✅ RAG | — | — | — | — | — |
| GitHub Actions workflow templates | ❌ | — | — | — | — | — | — | — | — | — | — | — | — (weasel has it) |
| State-coupling-pair phase | ❌ | 🟡 invariant-agent | — | — | — | — | — | — | ✅ State Inconsistency | — | — | — | — |
| Empirical-derivation discipline | 🟡 partial | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | — | — | — | — (drozer-lite has it) |

---

## Master prioritized action list

Each item: **[Tier]** Name — what / where it comes from / effort / impact

### 🔴 Critical — do these first

These are foundational. The other 15-20 items build on top.

1. **[C-1]** **Specialized hunt agents by vulnerability class**
   - **What**: Decompose `sentinel` into 6-8 vulnerability-class agents: access-control / math-precision / economic-security / invariant / execution-trace / periphery / first-principles / vector-scan.
   - **Source**: pashov hacking-agents pattern (B1), Archethect 6 hunt lanes (B1), nemesis Feynman + State (B2).
   - **Effort**: L (~1-2 weeks). Touches `src/agents/` architecture, hook injection, tool registry.
   - **Impact**: Foundational. All downstream improvements (themis, eval) become more valuable.

2. **[C-2]** **Eval/benchmark harness**
   - **What**: Build `evals/{benchmarks,runner,compare,results}/`. Start with 3-5 ground-truth benchmark files. Add `compare` step (semantic FOUND/LEAD/MISSED matching). Run on every prompt change.
   - **Source**: pashov evals/ (B1), SolidityGuard EVMBench (B1), krait Code4rena (B2), GPTScan Web3Bugs/DefiHacks/Top200 (B2), drozer-lite forefy benchmark (B3).
   - **Effort**: M (~3-5 days harness + 1-2 days per benchmark).
   - **Impact**: Unblocks every other improvement — we can't ship a change without proving it doesn't regress.

3. **[C-3]** **Themis upgrade: 2-stage DA + Skeptic + Judge with inversion mandate** (or The-Judge 6-step pipeline — pick one)
   - **What**: Reshape `themis` from single-pass validation to 2-stage adversarial pipeline. Strict JSON output schemas. "Prove it or lose it" on conflicts.
   - **Source**: Archethect (B1 — best documented), DarkNavy 6-check (B1), The-Judge 6-step Wave 1+Wave 2 (B3), TOB fp-check (B3).
   - **Effort**: M (~3-5 days, prompt + schema work, no architecture change).
   - **Impact**: Significant precision boost — Krait reports v6→v7 false positive rate dropped from 4.2/contest to 0.0/contest using similar gating.

4. **[C-4]** **Proof-or-Demote for Critical/High findings**
   - **What**: Critical/High findings without a runnable Foundry PoC / Echidna invariant / Medusa scenario get auto-demoted in a `benchmark_mode`. Add mandatory `proof:` field with `concrete values`/`trace` for every Critical/High in `argus_record_finding` schema.
   - **Source**: Archethect (B1), pashov (B1 — "every FINDING must have proof"), DarkNavy (B1 — Critical/High requires PoC).
   - **Effort**: S (~1-2 days, schema + sentinel prompt).
   - **Impact**: Eliminates a class of speculative findings.

5. **[C-5]** **2025+ vulnerability patterns library** (EIP-1153 / EIP-7702 / ERC-4337 / Hexens TSTORE bug)
   - **What**: 13-15 new SKILL.md files in `skills/vulnerability-patterns/`. Source from SolidityGuard's public taxonomy (B1) + Hexens TSTORE poison research (B3) + EIP specs + public exploit analyses.
   - **Source**: SolidityGuard 104 patterns (B1), 33Audits VC9 (B3).
   - **Effort**: S (~3 days).
   - **Impact**: Positions us as 2026-current. Pectra is live on mainnet — these are real risks NOW.

### 🟠 High — major adds beyond foundation

6. **[H-1]** **`argus-prep` pre-audit scoping skill**
   - **What**: Multi-source input (URL/ZIP/explorer-address/dir) → threat-intel sandbox scan → 8 Mermaid diagrams → complexity heatmap → nSLOC + pace-based time estimate → scope report.
   - **Source**: scoping-bee 10-phase + 8-diagram (B3), pashov x-ray scripts (B1), CDSec audit-prep 8 phases (B1).
   - **Effort**: M (~5-7 days).
   - **Impact**: Fills a gap every leader has but we don't.

7. **[H-2]** **`argus_generate_poc` tool** (mainnet-fork Foundry PoC scaffolder)
   - **What**: New argus tool. Takes finding + addresses + chain → produces submission-ready Foundry test file. Classification (frozen historical / forward-looking / both). End-state assertions by impact type (theft/DoS/freeze). RPC fallback chain.
   - **Source**: cholakovvv/foundry-poc-mainnet-fork (B3), Archethect MCP tool `generate-foundry-poc` (B1).
   - **Effort**: S-M (~3-5 days).
   - **Impact**: Unblocks bug bounty submission workflow + makes Proof-or-Demote actually enforceable.

8. **[H-3]** **Hard-negatives catalogue + Cheatsheet pattern**
   - **What**: Two parallel additions:
     - **`skills/hard-negatives/`** — 5+ "looks dangerous but is safe" pattern docs (port Archethect's 5: approval-abuse, callback-grief, entitlement-drift, rounding-entitlement, semantic-drift)
     - **`skills/CHEATSHEET.md`** — single condensed file with all 51 (and growing) patterns: 1-paragraph + grep keywords + reference to full file
   - **Source**: Archethect hard-negatives (B1), kadenzipfel CHEATSHEET (B1), Krait 10 FP patterns (B2), The-Judge invalidation-library (B3).
   - **Effort**: S (~2-3 days).
   - **Impact**: Direct false-positive reduction. The cheatsheet also speeds up sentinel session startup.

9. **[H-4]** **4-mindset prompt structure for sentinel hunt agents**
   - **What**: Each hunt agent runs through 4 mindsets in sequence: Attacker / Accountant / Spec Auditor / Edge Case Hunter. Findings flagged by 2+ mindsets get confidence boost; single-mindset findings get extra scrutiny.
   - **Source**: Krait (B2).
   - **Effort**: S (~1 day — pure prompt engineering).
   - **Impact**: Cheap quality boost. Combines well with C-1 specialized hunt agents.

10. **[H-5]** **State-coupling-pair audit phase**
    - **What**: Explicit early phase: enumerate `(state_a, state_b)` invariant pairs (e.g., `balance ↔ checkpoint`, `stake ↔ rewardDebt`, `totalSupply ↔ sum(balances)`). Check every mutation path updates BOTH sides.
    - **Source**: nemesis State Inconsistency Auditor (B2).
    - **Effort**: S (~2 days as a sentinel sub-agent prompt + integration).
    - **Impact**: Catches an entire bug class our current pipeline misses.

11. **[H-6]** **Aderyn integration** + **Echidna / Medusa / Halmos**
    - **What**: New argus tools: `argus_aderyn_analyze`, `argus_echidna`, `argus_medusa`, `argus_halmos`. Aderyn is high-priority (modern Cyfrin static analyzer; companion to Slither). Echidna/Medusa for invariant testing. Halmos for symbolic.
    - **Source**: Archethect (B1), SolidityGuard (B1).
    - **Effort**: M (~2-3 days each, ~8-12 days total).
    - **Impact**: Unblocks Proof-or-Demote workflows (C-4). Also enables advanced findings (e.g., symbolic-proven invariant violations).

12. **[H-7]** **`.claude-plugin/marketplace.json` + `plugin.json`** for parallel Claude Code distribution
    - **What**: Parallel Claude Code packaging alongside OpenCode plugin. Enables `/plugin marketplace add Apegurus/solidity-argus` in Claude Code.
    - **Source**: Archethect, OZ, CDSec, Cyfrin, SolidityGuard, DarkNavy (B1); hackenproof, TOB skills (B3).
    - **Effort**: S (~1 day, but requires runtime feasibility check — our TS/Bun tools may not run natively under Claude Code).
    - **Impact**: Doubles distribution surface — the hub's audience is overwhelmingly Claude Code users.

13. **[H-8]** **Cartography skill** — flow → file:line map cached in `.argus/cartography/`
    - **What**: New skill that builds and persists a project-wide flow map (auth flow, deposit flow, withdraw flow, swap flow). Subsequent sentinel runs load the relevant flow's file:line list instead of re-discovering.
    - **Source**: grimoire cartography (B2), Hound knowledge graphs (B2), DarkNavy context map (B1).
    - **Effort**: M (~5-7 days).
    - **Impact**: 30-50% speedup on multi-file audits. Enables natural-language context loading ("audit the auth flow").

14. **[H-9]** **`argus-kit` known-findings dedup skill**
    - **What**: Maintains canonical `known-issues.json` for a protocol/auditee. On new audit, classifies findings as duplicate / variant / novel against the register.
    - **Source**: K.I.T (B3).
    - **Effort**: M (~5 days, much of the engine logic is already in our scripts/audit-pdf-extract.ts pipeline).
    - **Impact**: High-leverage for protocols with multi-audit history (Aave, Uniswap, etc.).

15. **[H-10]** **Public benchmark transparency**
    - **What**: Publish our recall/precision on a stable benchmark set (EVMBench, Code4rena, our own DODO/megapot/pooltogether replica). Update on every release.
    - **Source**: krait v1-v8 table (B2), SolidityGuard EVMBench claims (B1), drozer-lite forefy benchmark (B3), Hound paper (B2).
    - **Effort**: S (depends on C-2). Once C-2 is done, publishing is mostly a docs/README change.
    - **Impact**: Trust signal + marketing differentiator + accountability.

16. **[H-11]** **`argus-fix-verifier` skill** (post-audit fix verification)
    - **What**: Verifies a proposed fix (patch or PR) for a finding is complete + non-regressing. Re-runs the relevant detection patterns + fuzz tests against the patched code.
    - **Source**: hackenproof-fix-verifier (B3 — completeness + regression + SC fix checks + verdict template).
    - **Effort**: M (~5 days, builds on C-1 + H-2).
    - **Impact**: Closes the audit loop. Enables "audit → fix → re-verify → close" workflow.

17. **[H-12]** **TOB skills cache resync** — pull `fp-check`, `dimensional-analysis`, `supply-chain-risk-auditor`, `skill-improver`, `mutation-testing`, `trailmark` family
    - **What**: Re-run `argus_sync_knowledge` against current trailofbits/skills (5,270⭐, many new plugins).
    - **Source**: B3 trailofbits/skills freshness check.
    - **Effort**: S (we have the sync infrastructure already).
    - **Impact**: `fp-check` alone is a major themis upgrade. `dimensional-analysis` is brilliant for DeFi unit-mismatch bugs.

### 🟡 Medium — quality of life and parity

18. **[M-1]** **5-tier severity with scaled validation rigor** + **Design Advisory severity tier**
    - **What**: Critical/High → full protocol. Medium → Gates 1-3. Low → Gate 1 only. Design Advisory → specific code + documented intent + non-obvious consequence. Informational → specific location + valid observation.
    - **Source**: DarkNavy finding-protocol (B1).
    - **Effort**: S (~2 days, mostly prompt + scribe schema).

19. **[M-2]** **Prerequisite Tier Table** (caps max severity based on attack prerequisites)
    - **What**: Tier 0 (public EOA) → Critical · Tier 1 (victim signs) → High · Tier 2 (market cond) → High · Tier 3 (non-std token) → Medium · Tier 4 (role) → Low · Tier 5 (admin compromise) → Low only with mechanism.
    - **Source**: DarkNavy + Archethect (B1).
    - **Effort**: S (~1 day).

20. **[M-3]** **Per-protocol vulnerability catalogs** for top 10 DeFi integrations
    - **What**: Catalog files for UniV3, UniV4, Aave V3, Curve, Compound V3, Lido, EigenLayer, Pendle, Maker, Balancer (and GMX). Each: 8-15 known vectors with grep signatures + confirm-if criteria.
    - **Source**: 33Audits CCA (B3), Plamen dex-integration-security (B2), Maia CAT-INTEG (B2).
    - **Effort**: M (~1-2 days each, ~10-15 days total).

21. **[M-4]** **HTML report output** (in addition to markdown)
    - **Source**: Maia (B2), drozer-lite (B3 indirectly via Forefy).
    - **Effort**: S (~1-2 days, just a formatter).

22. **[M-5]** **`--diff <ref>`** PR/incremental scoping
    - **What**: Scope analysis to files changed since git ref.
    - **Source**: CDSec audit-prep (B1).
    - **Effort**: S (~1 day).

23. **[M-6]** **`--ci`** JSON output + score threshold + exit-code-driven
    - **Source**: CDSec audit-prep (B1).
    - **Effort**: S (~1 day).

24. **[M-7]** **Composite chain detection** at dedup stage
    - **What**: If finding A's output feeds into finding B's precondition AND combined impact is strictly worse than either alone, add "Chain: A + B" finding.
    - **Source**: pashov composite chains (B1), DarkNavy composability pass (B1).
    - **Effort**: S (~1-2 days, sits in scribe dedup logic).

25. **[M-8]** **Confidence numeric scoring** (0-100 with deduction rules)
    - **What**: Start 100. -20 partial path · -15 bounded impact · -10 requires specific state. ≥80 = description + fix · <80 = description only.
    - **Source**: pashov judging.md (B1).
    - **Effort**: S (~1-2 days, sits in themis output schema).

26. **[M-9]** **Empirical-derivation discipline review** of our 51 vuln patterns
    - **What**: For each pattern in `skills/vulnerability-patterns/`, verify it cites a real missed finding (audit URL or exploit case study). Tag patterns without evidence as `needs-evidence`.
    - **Source**: drozer-lite (B3 — every check traces to a real missed finding).
    - **Effort**: S (~2-3 days review pass).

27. **[M-10]** **Modifier whitelist JSON** — explicit trusted modifier list for FP reduction
    - **Source**: GPTScan `modifier_whitelist.json` (B2).
    - **Effort**: S (~1 day).

28. **[M-11]** **4-stage progressive fuzzing methodology** for EVM
    - **What**: Foundation → Integration → Scenario → Temporal. Each stage's blind spots inform next.
    - **Source**: trident-fuzz-skill (B3).
    - **Effort**: M (~3 days, depends on H-6 Echidna/Medusa integration).

29. **[M-12]** **`meme-coin-audit` niche skill** — honeypot/rug/mint/blacklist detection
    - **Source**: shuvonsec (B3).
    - **Effort**: S (~1-2 days).

30. **[M-13]** **`severity-to-bounty.md` rubric** in severity-classification skill
    - **Source**: hackenproof-handoff (B3).
    - **Effort**: S (~half a day).

31. **[M-14]** **Auto-profile-detection** at scan start (activate relevant protocol skill files based on codebase keywords)
    - **Source**: drozer-lite (B3), 33Audits (B3).
    - **Effort**: S (~1 day).

32. **[M-15]** **`fork-ancestry` tracking** — for forked-from-X protocols, inherit ancestor's known-bugs
    - **Source**: Plamen (B2).
    - **Effort**: S (~1-2 days, builds on H-9 K.I.T register).

33. **[M-16]** **GitHub Actions workflow templates**
    - **What**: Ship 5-7 ready-to-use workflow templates (`.github/workflows/argus-*.yml`) — basic + claude/gemini/openai variants + diff variants.
    - **Source**: weasel (B2 — has 7 templates).
    - **Effort**: S (~1-2 days).

34. **[M-17]** **Senior/junior model tiering** (scout for recon, strategist for deep)
    - **Source**: Hound (B2).
    - **Effort**: S-M (~3 days — touches agent config).

35. **[M-18]** **MCP server packaging** — `argus mcp serve`
    - **What**: Expose argus tools as MCP server for use in Claude Code / Cursor / Codex / Gemini CLI.
    - **Source**: weasel (B2), claudit (B3), Archethect (B1).
    - **Effort**: M (~5 days, builds new MCP server entry point).

### 🟢 Low — nice-to-haves

36. **[L-1]** SVG architecture diagram generation (pashov x-ray)
37. **[L-2]** Git-history security analysis script (pashov x-ray `analyze_git_security.py`)
38. **[L-3]** Post-exploit forensics (DarkNavy exploit-investigator)
39. **[L-4]** Knowledge-graph audit substrate (Hound) — big architecture change
40. **[L-5]** PostgreSQL persistence backend (finite-monkey) — overkill for our scale
41. **[L-6]** Live chatbot steering UI (Hound)
42. **[L-7]** Google Docs report output (forefy gdocs)
43. **[L-8]** Multi-chain expansion (Move/Solana/Rust/etc.) — defer until customer demand
44. **[L-9]** `auditor-quiz` training mode (forefy)
45. **[L-10]** Memory system with pattern_db (shuvonsec)

---

## Suggested execution roadmap

### Phase 1 — Foundation (1 sprint, ~3 weeks)

**Goal**: Lock in measurement + specialized agents + 2025 patterns.

- C-2 (eval harness) — week 1
- C-5 (2025+ patterns) — week 1 (parallel)
- H-3 (hard-negatives + cheatsheet) — week 1 (parallel — small)
- C-1 (specialized hunt agents) — weeks 2-3
- H-4 (4-mindset prompts) — week 2-3 (parallel, plays into C-1)
- M-9 (empirical-derivation review) — week 2-3 (parallel)
- C-4 (Proof-or-Demote) — week 3
- H-12 (TOB skills resync) — week 3

**Deliverable**: argus v2 with 8 specialized hunt agents, evals running, ~70 vuln patterns, hard-negatives in place.

### Phase 2 — Validation upgrade (1 sprint, ~2 weeks)

**Goal**: Make themis adversarial and precise.

- C-3 (DA + Skeptic + Judge for themis) — weeks 4-5
- M-1 (5-tier severity with scaled rigor) — week 4 (parallel)
- M-2 (Prerequisite Tier Table) — week 4 (parallel)
- M-8 (Confidence numeric scoring) — week 5
- M-10 (Modifier whitelist) — week 5 (parallel)

**Deliverable**: argus v2.5 with full adversarial validation pipeline.

### Phase 3 — Surface expansion (1 sprint, ~2-3 weeks)

**Goal**: New skills + workflows.

- H-1 (`argus-prep` pre-audit scoping) — week 6-7
- H-2 (`argus_generate_poc`) — week 6 (parallel)
- H-7 (`.claude-plugin/` marketplace) — week 6 (parallel — small)
- H-8 (cartography) — week 7
- H-9 (`argus-kit` known-findings) — week 8
- H-11 (`argus-fix-verifier`) — week 8

**Deliverable**: argus v3 with full lifecycle (scope → audit → fix-verify) + multi-platform distribution.

### Phase 4 — Tooling & integrations (1 sprint, ~2 weeks)

**Goal**: Tool stack parity with leaders.

- H-6 (Aderyn + Echidna + Medusa + Halmos) — weeks 9-10
- M-11 (4-stage progressive fuzzing) — week 10
- M-3 (per-protocol catalogs — top 5) — week 9-10 (parallel)
- M-18 (MCP server packaging) — week 10

**Deliverable**: argus v3.5 with full Solidity tool stack.

### Phase 5 — Benchmarks public (1 sprint, ~1 week)

- H-10 (public benchmark transparency) — week 11
- Update README with comparison table

**Deliverable**: argus v3.6 with credible public benchmarks.

### Phase 6 — Polish (ongoing)

Medium items 4, 5, 6, 7, 12, 13, 14, 15, 16, 17 + remaining low items as bandwidth allows.

---

## Quick-wins menu (each ≤1 day)

If we want to ship 1-day visible improvements before/while bigger work happens:

1. **TOB skills resync** — single sync command, picks up `fp-check` + `dimensional-analysis` etc. (H-12 / one tool call essentially)
2. **`skills/CHEATSHEET.md`** — mechanically aggregate the 1-paragraph + grep keywords from each of our 51 patterns into one file (H-3 partial)
3. **`severity-to-bounty.md`** — single new doc in severity-classification skill (M-13)
4. **`meme-coin-audit` SKILL.md** — single new vuln pattern (M-12)
5. **TSTORE poison + Pectra patterns** — start C-5 with just 2-3 specific patterns
6. **Modifier whitelist JSON** stub (M-10)
7. **4-mindset prompt addition** to current sentinel prompt (H-4)
8. **Empirical-derivation tag** — add `source_finding:` frontmatter field across all 51 patterns (M-9 partial — discover which patterns need backfilling)
9. **`severity_policy.md`** per chain (we're single-chain, but doc the EVM severity rationale)
10. **`.claude-plugin/marketplace.json`** stub (H-7 partial — even if functionality requires more work, the manifest is single-file)

These are the "before lunch on Monday" wins.

---

## What we already do well

For balance — we DO lead the field on:
- **SCVD + Solodit integration** (7,769+ findings — no other tool ships pre-indexed)
- **OpenCode-native plugin** with proper plugin manifest, hooks, multi-level config (most competitors are Claude Code skills or bare scripts)
- **3-channel context delivery** (prompt / hook / skill-load) — fairly sophisticated context management
- **Trust tiers + freshness policy + provenance metadata** — knowledge ingestion contract is well-specified
- **Persistent audit state** under `.argus/sessions/state-{sessionId}.json` + archive — competitors that match this are: Archethect (`.sc-auditor-work/checkpoints/`), DarkNavy (`{temp_dir}/`), nemesis (`.audit/findings/`). We're on par.
- **15 dedicated tools** — most competitors have 0-9. Slither + forge_test + forge_fuzz + forge_coverage + gas + check_patterns + proxy_detection are a strong base.
- **Audit PDF extraction pipeline** (`scripts/audit-pdf-extract.ts`) — unique. We're already ingesting audit firm corpora.
- **Skill versioning + custom skills dir + skillPrecedence** — extensibility we have, competitors mostly don't.

---

## Open questions for user

1. **Phase ordering**: Roadmap above is "foundation → validation → surface → tools → benchmarks → polish". Do you want to reorder (e.g., quick-wins-first to demonstrate momentum, or skills-first if you want pre-audit scoping ASAP)?

2. **`pashov/skills` direct adoption**: pashov is MIT-licensed and his hacking-agents pattern is the clearest model. Are we OK essentially porting his 8-agent structure (with our own prompts + integrations) as the basis for C-1? It's the fastest path; we keep attribution.

3. **License-sensitive borrowing**: SolidityGuard is **proprietary** — we use their public taxonomy only (pattern names + descriptions in their `VULNERABILITY_PATTERNS.md`). Confirm we don't copy any of their detection scripts/code.

4. **Claude Code parallel distribution**: H-7 (`.claude-plugin/marketplace.json`) requires our tools to be invokable from plain Claude Code. Our Bun/TS code may not run natively under Claude Code's skill runtime. Options:
   - (a) Ship a markdown-only Claude Code package (no tools, just prompts) — narrower but compatible
   - (b) Ship a script-based Claude Code package (Python/Shell) — more work
   - (c) Skip Claude Code distribution, stay OpenCode-native — simpler

5. **Eval-benchmark choice**: For C-2, the candidates are:
   - **EVMBench** (OpenAI's 40-audit 120-vuln set — SolidityGuard claims 100%)
   - **Code4rena recent contests** (krait uses this — easy ground truth)
   - **GPTScan datasets** (Web3Bugs / DefiHacks / Top200)
   - **pashov's benchmarks** (DODO / megapot / pooltogether — small but clean)
   - **scabench** (Hound's parent benchmark)
   - **Custom**: pick 3-5 protocols from public audit reports
   
   Recommend EVMBench + Code4rena (industry-recognized). Need your call.

6. **Per-protocol catalogs (M-3)**: Top 10 list might shift. Confirm: UniV3, UniV4, Aave V3, Curve, Compound V3, Lido, EigenLayer, Pendle, Maker, Balancer. Add/swap?

7. **Bug bounty mode**: Several B3 tools (claude-bug-bounty, hackenproof, K.I.T) suggest argus could serve bug-bounty hunters, not just commissioned auditors. Are we positioning as multi-audience (audit firm + hunter + protocol team), or staying focused on commissioned audit?

---

## File map

```
docs/competitive-analysis/
├── 00-summary-and-actions.md         ← this file
├── 01-flagship-solidity-skills.md    ← 8 repos (pashov, Cyfrin, OZ, CDSec, kadenzipfel, DarkNavy, Archethect, SolidityGuard)
├── 02-auditor-agents.md              ← 11 repos (Hound, finite-monkey, plamen, nemesis, GPTScan, forefy, grimoire, weasel, krait, maia, konstantinvelev)
└── 03-specialized-workflows.md       ← 10 repos + TOB freshness check (claude-bug-bounty, claudit, foundry-poc, hackenproof, K.I.T, cca-audit, The-Judge, drozer-lite, scoping-bee, trident-fuzz)
```

Total: **29 free/open-source web3 security tools analyzed** + **TOB skills cache freshness check** = **30 distinct sources of competitive intelligence**.

Status: **ALL BATCHES COMPLETE**. Ready for prioritization and execution.
