# Sprint 3 — Porting Bill of Materials (BOM)

> Companion to [04-next-sprint-plan.md](./04-next-sprint-plan.md#sprint-3-preview).
> Companion to [05-porting-bom-sprint1.md](./05-porting-bom-sprint1.md) — reuse license matrix + attribution conventions + `CREDITS.md` template.
> Generated: 2026-05-18 (**very preliminary** — Sprint 3 is 6+ weeks out; refresh required).

## ⚠️ Larger staleness risk than Sprint 2

Sprint 3 starts after Sprints 1 + 2 ship — currently 6-9 weeks out. Source repos will drift substantially:

1. **MANDATORY**: re-run source fetches with fresh commit hashes before Sprint 3 starts.
2. **MANDATORY**: re-verify licenses haven't changed.
3. **LIKELY**: Sprint 1+2 outcomes will reshape Sprint 3. Common reshapes:
   - If evals show themis is the bottleneck → escalate Sprint 3 H-9 (known-findings) to Sprint 2
   - If H-2 PoC scaffolder is great → H-11 fix-verifier gets a head start
   - If `argus_mode` bounty traction is strong → M-3 per-protocol catalogs gets prioritized
   - If competitive landscape shifts (new repos in pashov/ai-web3-security hub) → new Sprint 3 items
4. **POSSIBLE**: source repos may have published new versions, fixed bugs, or added skills we'd want to port.

**Use this BOM as a starting reference. Refresh fully before commitments.**

---

## Sprint 3 targets (from [04-next-sprint-plan.md](./04-next-sprint-plan.md#sprint-3-preview))

| ID | Target | Effort | Notes |
|---|---|---|---|
| **H-8** | Cartography skill — flow → file:line map cached in `.argus/cartography/` | M (~5-7 days) | Speeds up multi-file audits 30-50% per grimoire claim |
| **H-9** | `argus-kit` known-findings dedup skill (canonical `known-issues.json`) | M (~5 days) | Two-layer: public corpus + per-project private |
| **H-11** | `argus-fix-verifier` companion skill (completeness + regression first) | M (~5 days) | Closes audit loop. Defer proof-regeneration to Sprint 4+ |
| **M-3** | Per-protocol vulnerability catalogs (top 10 DeFi integrations) | M (~10-15 days) | Start UniV3 + Aave V3 + Curve as templates, then UniV4 / Morpho / Lido / EigenLayer / Pendle / GMX / Balancer |

---

## License compatibility — Sprint 3 sources

| Source | License | Sprint 3 task | Treatment |
|---|---|---|---|
| [`JoranHonig/grimoire`](https://github.com/JoranHonig/grimoire/tree/7e3943d34b1c588a60045e304ef8f8439d476e70) | **MIT** | H-8 | ✅ Verbatim port OK |
| [`scabench-org/hound`](https://github.com/scabench-org/hound/tree/c29890180b317b66b06342521c8e2d82117bb93b) | **Apache-2.0** (per README badge) | H-8 alt | ✅ Compatible with MIT package. Apache 2.0 requires NOTICE preservation (small extra step). |
| [`J4X-Security/K.I.T`](https://github.com/J4X-Security/K.I.T/tree/1e18ece9cf0e7e9b73f8579e1b706a084586f47e) | **MIT** | H-9 | ✅ Verbatim port OK |
| [`hackenproof-public/skills` (fix-verifier)](https://github.com/hackenproof-public/skills/tree/26200588b2e7424883a4497bfa23beb9accc06c3/plugins/hackenproof-fix-verifier) | **NONE** ⚠️ | H-11 | Methodology only — reimplement |
| [`33Audits/cca-audit-agent`](https://github.com/33Audits/cca-audit-agent/tree/4f83fb1936e1b8fb2f1456d97b7918fbd6dfe096) | **NONE** ⚠️ | M-3 (template) | Methodology only — reimplement |
| [`PlamenTSV/plamen` (DEX / Governance / Integration skills)](https://github.com/PlamenTSV/plamen/tree/7dc822104e1fc6655b0e8f30cd374c0d4c6939bd) | **MIT** | M-3 | ✅ Verbatim port OK |
| [`gdroz3r/drozer-lite` (checklists)](https://github.com/gdroz3r/drozer-lite/tree/fcc489d7eb14208bedcb6290b7b8ca5af6058539) | **MIT** | M-3 | ✅ Verbatim port OK |

---

## Per-target porting references

### H-8 — Cartography skill

#### Target

- New skill `skills/argus-cartography/SKILL.md` — flow → file:line mapping methodology
- Generator script `scripts/cartography-build.ts` — extracts flows from codebase via AST + LLM
- Persistent state `.argus/cartography/{project-hash}/` — per-project cached flow maps
- Convention: `flows/auth.md`, `flows/deposit.md`, `flows/withdraw.md`, `flows/swap.md` etc.

#### Primary source: grimoire cartography (MIT) — JoranHonig

| Source file | Permalink | Treatment |
|---|---|---|
| [`grimoire/skills/cartography/SKILL.md`](https://github.com/JoranHonig/grimoire/blob/7e3943d34b1c588a60045e304ef8f8439d476e70/skills/cartography/SKILL.md) | `7e3943d` | **PORT** methodology + invocation pattern. Attribute to JoranHonig (MIT). |
| [`grimoire/skills/cartography/references/cartography-format.md`](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/references/cartography-format.md) | `7e3943d` | **PORT** cartography file format (flow → entry points → state transitions → exit points). |
| [`grimoire/skills/cartography/examples/cartography-example.md`](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/examples/cartography-example.md) | `7e3943d` | **PORT** as example template. Replace their example with one from our own audit history. |
| [`grimoire/skills/cartography/scripts/index-cartography.sh`](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/scripts/index-cartography.sh) | `7e3943d` | **PORT** indexing script. |
| [`grimoire/grimoire/concepts/agent context.md`](https://github.com/JoranHonig/grimoire/blob/7e3943d/grimoire/concepts/agent%20context.md) | `7e3943d` | **CROSS-REFERENCE** — the philosophy ("agent context as substrate") informs our design choices. Cite, don't verbatim port. |

#### Secondary source: Hound knowledge graphs (Apache-2.0) — for advanced cartography

| Source | Permalink | Treatment |
|---|---|---|
| [Hound paper](https://arxiv.org/html/2510.09633v1) | external | **REFERENCE** — academic basis for KG-driven cartography. Cite. |
| [Hound `analysis/graph_builder.py`](https://github.com/scabench-org/hound/blob/c29890180b317b66b06342521c8e2d82117bb93b/analysis/graph_builder.py) | `c298901` | **REFERENCE** — graph construction patterns (Apache-2.0 OK with NOTICE preservation). |
| [Hound `analysis/agent_core.py`](https://github.com/scabench-org/hound/blob/c298901/analysis/agent_core.py) | `c298901` | **REFERENCE** — agent-graph interaction. |

#### Adaptation strategy (H-8)

- **Phase 1 (Sprint 3)**: grimoire's cartography format — text-based flow → file:line markdown files. Cheap to produce (LLM generates), cheap to consume (LLM reads).
- **Phase 2 (Sprint 4+)**: Optional KG upgrade following Hound's pattern if Phase 1 isn't enough. Use Hound's belief/hypothesis confidence system if we expand.
- **Persistence**: `.argus/cartography/{project-hash}/flows/*.md` — cached per project, invalidated when source changes (hash check on source file mtimes).
- **Invocation**: `argus_cartography_load(flow_name)` — loads a specific flow's file:line list for context.

#### Attribution
- `skills/argus-cartography/SKILL.md` header: "Methodology ported from [JoranHonig/grimoire skills/cartography](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/SKILL.md) (MIT). Future KG enhancements informed by [scabench-org/hound](https://arxiv.org/html/2510.09633v1) (Apache-2.0)."
- Hound NOTICE file (if we use their KG patterns in Phase 2)

---

### H-9 — `argus-kit` known-findings dedup

#### Target

- New skill `skills/argus-kit/SKILL.md` — workflow
- Engine `scripts/argus-kit/known-issues.ts` — TypeScript port of K.I.T's Python engine
- Canonical artifact: `.argus/known-issues.json`
- Two layers (per [04-next-sprint-plan.md](./04-next-sprint-plan.md) decision):
  - **Built-in public layer**: Solodit + 6 audit-firm public repos (spearbit, ToB, OZ, Code4rena, Sherlock, Cyfrin) — auto-synced via `argus_sync_knowledge`
  - **Per-project private layer**: user-specified `customKnownIssuesDir` — higher trust than public

#### Primary source: K.I.T (MIT) — J4X-Security

| Source file | Permalink | Treatment |
|---|---|---|
| [`K.I.T/claude-skill-kit/SKILL.md`](https://github.com/J4X-Security/K.I.T/blob/1e18ece9cf0e7e9b73f8579e1b706a084586f47e/claude-skill-kit/SKILL.md) | `1e18ece` | **PORT** skill orchestration. |
| [`K.I.T/claude-skill-kit/scripts/known_issues.py`](https://github.com/J4X-Security/K.I.T/blob/1e18ece/claude-skill-kit/scripts/known_issues.py) | `1e18ece` | **PORT** the staged JSON contract pattern (engine prepares input, model decides per `llm_contract`). Reimplement in TypeScript using Node.js fs + `pdf-parse` (npm) instead of Python `pdfplumber`. |

#### Adaptation strategy (H-9)

- **Keep**: K.I.T's "engine prepares, model decides" architecture. Engine never makes semantic judgments — it stages input, model reads `llm_contract` and emits structured output.
- **Keep**: semantic dedup (root cause + affected surface + exploit path + impact, NOT title similarity).
- **Keep**: 2 commands (`build`, `check`).
- **Change**: Python → TypeScript (our stack). pdfplumber → npm `pdf-parse` (we already use it in `scripts/audit-pdf-extract.ts`).
- **Add**: per-source trust scoring (Solodit = high, audit-firm public = high, user-private = highest).
- **Integrate**: with our existing `scripts/audit-pdf-extract.ts` pipeline — they're complementary (ours extracts findings into our format; argus-kit dedupes against a register).

#### Attribution
- `skills/argus-kit/SKILL.md` header: "Workflow ported from [J4X-Security/K.I.T](https://github.com/J4X-Security/K.I.T/blob/1e18ece/claude-skill-kit/SKILL.md) (MIT). TypeScript reimplementation of their Python engine."
- `CREDITS.md`: K.I.T entry (already in Sprint 1 template).

---

### H-11 — `argus-fix-verifier`

#### Target

- New skill `skills/argus-fix-verifier/SKILL.md`
- New tool `argus_verify_fix` — accepts finding ID + patch/PR, runs verification
- References:
  - `skills/argus-fix-verifier/references/completeness-checklist.md`
  - `skills/argus-fix-verifier/references/regression-checklist.md`
  - `skills/argus-fix-verifier/references/sc-fix-checks.md`
  - `skills/argus-fix-verifier/references/verdict-template.md`

#### Primary source: hackenproof fix-verifier (NO LICENSE — methodology only)

| Source file | Permalink | Treatment |
|---|---|---|
| [`hackenproof-fix-verifier/SKILL.md`](https://github.com/hackenproof-public/skills/blob/26200588b2e7424883a4497bfa23beb9accc06c3/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/SKILL.md) | `2620058` | **METHODOLOGY ONLY** — reimplement structure (4-section verifier). No verbatim copy. |
| [`completeness-checklist.md`](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/completeness-checklist.md) | `2620058` | **METHODOLOGY ONLY** — adopt the categories (does the fix address the root cause? does it cover all attack paths? does it preserve invariants?). Our wording. |
| [`regression-checklist.md`](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/regression-checklist.md) | `2620058` | **METHODOLOGY ONLY** — what regression checks to run. Our wording. |
| [`smart-contract-fix-checks.md`](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/smart-contract-fix-checks.md) | `2620058` | **METHODOLOGY ONLY** — Solidity-specific fix patterns (don't introduce reentrancy with a fix, use SafeERC20 correctly, etc.). |
| [`verdict-template.md`](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/verdict-template.md) | `2620058` | **METHODOLOGY ONLY** — verdict format (Complete / Incomplete / Regression). Our template. |

#### Adaptation strategy (H-11)

- **Scope (per [04-next-sprint-plan.md decision](./04-next-sprint-plan.md#bonus-4-design-questions-from-b2b3-that-need-answers))**: completeness + regression first; defer proof-of-no-exploit regeneration to Sprint 4+ (depends on Sprint 2 H-2 PoC scaffolder).
- **Pipeline**:
  1. Reload the original finding from `.argus/sessions/`
  2. Apply the patch (git apply on a worktree)
  3. Run completeness checklist: does the fix cover the cited code path? Are sibling code paths also fixed?
  4. Run regression checklist: re-run our `argus_check_patterns` against the patched code — did we introduce any new pattern hits? Re-run `argus_forge_test` — did existing tests pass?
  5. Emit verdict: `Complete` / `Incomplete` / `Regression-Detected`
- **Phase 2 (Sprint 4)**: re-run the original PoC (or the new H-2 generated PoC) against the patched code. If PoC fails to exploit → fix is `Proof-Verified`. If PoC still exploits → fix is `Incomplete-PoC-Still-Works` (CRITICAL).

#### Attribution
- `skills/argus-fix-verifier/SKILL.md` header: "Methodology inspired by [hackenproof-public/skills hackenproof-fix-verifier](https://github.com/hackenproof-public/skills/tree/2620058/plugins/hackenproof-fix-verifier) (no license — reimplemented from first principles)."

---

### M-3 — Per-protocol vulnerability catalogs

#### Target

10 new skills under `skills/protocol-catalogs/`:

| Skill | Top integration |
|---|---|
| `protocol-catalogs/uniswap-v3/SKILL.md` | Uniswap V3 fork families, AMM math, position management |
| `protocol-catalogs/uniswap-v4/SKILL.md` | Hooks, singleton, transient storage, custom AMM curves |
| `protocol-catalogs/aave-v3/SKILL.md` | Lending market integrations, liquidations, eMode |
| `protocol-catalogs/curve/SKILL.md` | Stableswap math, factory pools, gauges |
| `protocol-catalogs/morpho/SKILL.md` | P2P matching, modular lending |
| `protocol-catalogs/lido/SKILL.md` | stETH/wstETH integrations, rebasing accounting |
| `protocol-catalogs/eigenlayer/SKILL.md` | Restaking, slashing, AVS integrations |
| `protocol-catalogs/pendle/SKILL.md` | PT/YT mechanics, yield trading |
| `protocol-catalogs/gmx/SKILL.md` | Perp DEX vault accounting, GLP/GM tokens |
| `protocol-catalogs/balancer/SKILL.md` | Weighted/Stable/Composable pool math |

#### Template source: 33Audits/cca-audit-agent (NO LICENSE — concept template only)

| Source file | Permalink | Treatment |
|---|---|---|
| [`33Audits/cca-audit-agent/.claude/skills/scan-cca/SKILL.md`](https://github.com/33Audits/cca-audit-agent/blob/4f83fb1936e1b8fb2f1456d97b7918fbd6dfe096/.claude/skills/scan-cca/SKILL.md) | `4f83fb1` | **TEMPLATE STRUCTURE** — per-protocol vector catalog format (ID / name / severity / grep / description / confirm-if). Reimplement in our format. |
| [`33Audits/cca-audit-agent/.claude/skills/scan-cca/references/vectors.md`](https://github.com/33Audits/cca-audit-agent/blob/4f83fb1/.claude/skills/scan-cca/references/vectors.md) | `4f83fb1` | **TEMPLATE STRUCTURE** — 9 core + 6 integration vector layout. Use as schema reference, not content. |

#### Knowledge source: Plamen DeFi vectors (MIT) — verbatim portable

| Source file | Permalink | Treatment |
|---|---|---|
| [`plamen/agents/skills/injectable/dex-integration-security/SKILL.md`](https://github.com/PlamenTSV/plamen/blob/7dc822104e1fc6655b0e8f30cd374c0d4c6939bd/agents/skills/injectable/dex-integration-security/SKILL.md) | `7dc8221` | **PORT WITH ATTRIBUTION** — DEX integration vectors. Useful for UniV3/V4/Curve/Balancer/GMX catalogs. |
| [`plamen/agents/skills/injectable/governance-attack-vectors/SKILL.md`](https://github.com/PlamenTSV/plamen/blob/7dc8221/agents/skills/injectable/governance-attack-vectors/SKILL.md) | `7dc8221` | **PORT WITH ATTRIBUTION** — governance vectors. Some apply to Curve gauges, Morpho governance, EigenLayer slashing. |
| [`plamen/agents/skills/injectable/integration-hazard-research/SKILL.md`](https://github.com/PlamenTSV/plamen/blob/7dc8221/agents/skills/injectable/integration-hazard-research/SKILL.md) | `7dc8221` | **PORT WITH ATTRIBUTION** — integration-hazard methodology. Use as the meta-skill that drives per-protocol catalog work. |

#### Knowledge source: drozer-lite per-profile checklists (MIT)

| Source file | Permalink | Treatment |
|---|---|---|
| [`drozer-lite/checklists/vault.md`](https://github.com/gdroz3r/drozer-lite/blob/fcc489d7eb14208bedcb6290b7b8ca5af6058539/checklists/vault.md) | `fcc489d` | **PORT WITH ATTRIBUTION** — 6 vault checks. Goes into Pendle / GMX vault catalogs. |
| [`drozer-lite/checklists/lending.md`](https://github.com/gdroz3r/drozer-lite/blob/fcc489d/checklists/lending.md) | `fcc489d` | **PORT WITH ATTRIBUTION** — 5 lending checks. Goes into Aave V3 / Morpho catalogs. |
| [`drozer-lite/checklists/dex.md`](https://github.com/gdroz3r/drozer-lite/blob/fcc489d/checklists/dex.md) | `fcc489d` | **PORT WITH ATTRIBUTION** — 11 DEX checks. Goes into UniV3 / V4 / Curve / Balancer catalogs. |

#### Adaptation strategy (M-3)

For each of the 10 protocols, build a SKILL.md with structure:

```markdown
---
name: protocol-catalogs/<protocol>
pattern_category: <auto-routed>
applicable_to:
  - <protocol-name-or-fork-pattern>
source_findings:
  - audit: <URL>
  - audit: <URL>
---

## Overview
<1 paragraph — what this protocol is, what your contract is doing if it integrates>

## Integration Vectors
For each vector:
- ID (e.g., AAVE-V3-INT-1)
- Name
- Severity baseline
- Grep signatures
- Description
- Confirm-if criteria
- Example exploit (if known)

## Protocol Forks
<list of common forks and their delta vectors>

## Composition Caveats
<patterns that only emerge when this protocol is composed with another>
```

**Source content** for each protocol catalog:
- **Spearbit/ToB/OZ/C4rena audit reports** of integrations with that protocol (primary)
- **Plamen DEX/governance/integration-hazard skills** (port-friendly MIT)
- **drozer-lite per-profile checklists** (port-friendly MIT)
- **33Audits CCA pattern** as the structural template (no license — structure only)

**Sequence recommendation**: Build top 3 first (UniV3, Aave V3, Curve) as templates with full content. Then extrapolate format to the other 7 with the team's own audit history.

#### Attribution (M-3)
- Per-catalog SKILL.md header: cite source audits + Plamen + drozer-lite ports (where applicable) + 33Audits structural template
- `CREDITS.md`: drozer-lite + 33Audits entries (add — not in Sprint 1 template)

---

## Cached source files inventory (Sprint 3)

19 Sprint 3 files at `/tmp/argus-bom/s3_*`:

| Cached file | Source | License | Task |
|---|---|---|---|
| `s3_h8_grimoire_cart_skill.md` | [grimoire cartography SKILL.md @ `7e3943d`](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/SKILL.md) | MIT | H-8 |
| `s3_h8_grimoire_cart_format.md` | [grimoire cartography-format.md](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/references/cartography-format.md) | MIT | H-8 |
| `s3_h8_grimoire_cart_example.md` | [grimoire cartography-example.md](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/examples/cartography-example.md) | MIT | H-8 |
| `s3_h8_grimoire_cart_index.sh` | [grimoire index-cartography.sh](https://github.com/JoranHonig/grimoire/blob/7e3943d/skills/cartography/scripts/index-cartography.sh) | MIT | H-8 |
| `s3_h8_grimoire_concept_agent_ctx.md` | [grimoire agent context.md](https://github.com/JoranHonig/grimoire/blob/7e3943d/grimoire/concepts/agent%20context.md) | MIT | H-8 ref |
| `s3_h9_kit_skill.md` | [K.I.T claude-skill-kit/SKILL.md @ `1e18ece`](https://github.com/J4X-Security/K.I.T/blob/1e18ece/claude-skill-kit/SKILL.md) | MIT | H-9 |
| `s3_h9_kit_engine.py` | [K.I.T known_issues.py](https://github.com/J4X-Security/K.I.T/blob/1e18ece/claude-skill-kit/scripts/known_issues.py) | MIT | H-9 |
| `s3_h11_hp_skill.md` | [hackenproof fix-verifier SKILL.md @ `2620058`](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/SKILL.md) | NONE | H-11 |
| `s3_h11_hp_completeness.md` | [hackenproof completeness-checklist.md](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/completeness-checklist.md) | NONE | H-11 |
| `s3_h11_hp_regression.md` | [hackenproof regression-checklist.md](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/regression-checklist.md) | NONE | H-11 |
| `s3_h11_hp_sc_checks.md` | [hackenproof smart-contract-fix-checks.md](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/smart-contract-fix-checks.md) | NONE | H-11 |
| `s3_h11_hp_verdict.md` | [hackenproof verdict-template.md](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-fix-verifier/skills/hackenproof-fix-verifier/references/verdict-template.md) | NONE | H-11 |
| `s3_m3_cca_skill.md` | [33Audits scan-cca SKILL.md @ `4f83fb1`](https://github.com/33Audits/cca-audit-agent/blob/4f83fb1/.claude/skills/scan-cca/SKILL.md) | NONE | M-3 (template) |
| `s3_m3_cca_vectors.md` | [33Audits scan-cca vectors.md](https://github.com/33Audits/cca-audit-agent/blob/4f83fb1/.claude/skills/scan-cca/references/vectors.md) | NONE | M-3 (template) |
| `s3_m3_plamen_dex.md` | [plamen dex-integration-security SKILL.md @ `7dc8221`](https://github.com/PlamenTSV/plamen/blob/7dc8221/agents/skills/injectable/dex-integration-security/SKILL.md) | MIT | M-3 |
| `s3_m3_plamen_gov.md` | [plamen governance-attack-vectors SKILL.md](https://github.com/PlamenTSV/plamen/blob/7dc8221/agents/skills/injectable/governance-attack-vectors/SKILL.md) | MIT | M-3 |
| `s3_m3_plamen_integration.md` | [plamen integration-hazard-research SKILL.md](https://github.com/PlamenTSV/plamen/blob/7dc8221/agents/skills/injectable/integration-hazard-research/SKILL.md) | MIT | M-3 |
| `s3_m3_drozer_vault.md` | [drozer-lite checklists/vault.md @ `fcc489d`](https://github.com/gdroz3r/drozer-lite/blob/fcc489d/checklists/vault.md) | MIT | M-3 |
| `s3_m3_drozer_lending.md` | [drozer-lite checklists/lending.md](https://github.com/gdroz3r/drozer-lite/blob/fcc489d/checklists/lending.md) | MIT | M-3 |
| `s3_m3_drozer_dex.md` | [drozer-lite checklists/dex.md](https://github.com/gdroz3r/drozer-lite/blob/fcc489d/checklists/dex.md) | MIT | M-3 |

---

## Open questions for Sprint 3

1. **H-8 KG depth**: Sprint 3 starts with text-based cartography. Decision point: when (if ever) do we upgrade to Hound's full KG architecture? Recommendation: **only after** measuring impact of text-based cartography on audit time. KG is heavyweight.

2. **H-9 dedup data layer**: do we add user-submitted audit reports to the public corpus, or strictly per-project private? Privacy-sensitive — recommend **strictly per-project private** unless user explicitly opts in to public corpus contribution.

3. **H-11 proof-regeneration**: defer to Sprint 4 as decided. Reconfirm Sprint 3 ships completeness + regression only.

4. **M-3 catalog ownership**: who owns updates as protocols evolve (Aave V3 → V4, UniV3 → V4 → V5)? In-tree maintenance is heavyweight. Alternative: **hybrid** — in-tree minimal catalog (covers stable patterns), plus auto-pull from upstream sources (Plamen, drozer-lite) at audit time for protocol-specific freshness.

5. **Per-protocol vs per-category catalogs**: do we organize by protocol (Aave V3 / UniV3) or by *integration pattern* (lending integration / DEX integration / vault integration)? Recommendation: **both** — per-protocol catalogs reference per-pattern checklists. Avoid duplication.

6. **Outreach to Archethect, kadenzipfel, The-Judge, hackenproof**: by Sprint 3, have we asked them to add an explicit license? If yes and they did → upgrade their treatment from "methodology only" to "verbatim port OK". If no → keep methodology-only treatment.

---

Status: Sprint 3 BOM complete (preliminary). **Refresh fully before Sprint 3 kickoff.** Source data current as of 2026-05-18 fetch.
