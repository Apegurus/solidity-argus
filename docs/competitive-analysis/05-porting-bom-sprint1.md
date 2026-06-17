# Sprint 1 — Porting Bill of Materials (BOM)

> Companion to [04-next-sprint-plan.md](./04-next-sprint-plan.md).
> Purpose: concrete, commit-pinned, license-aware references for every Sprint 1 porting task.
> Generated: 2026-05-18.

This doc answers: **For each item we're porting in Sprint 1, what is the exact source, what license governs it, what can we copy verbatim, what must we reimplement, and what attribution is required?**

---

## License compatibility matrix

| Source repo | License | Treatment in our MIT package | Action policy |
|---|---|---|---|
| [pashov/skills](https://github.com/pashov/skills/tree/749903d4a068477344739f9bb3346ca35a06be60) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. Mark in `CREDITS.md` + per-file header. |
| [DarkNavySecurity/web3-skills](https://github.com/DarkNavySecurity/web3-skills/tree/c4036f239c11a0c0f57983ca3b7d89429ba18472) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [ZealynxSecurity/krait](https://github.com/ZealynxSecurity/krait/tree/2e98bb3b368c44e9332167defbb7343caa8d172b) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [0xiehnnkta/nemesis-auditor](https://github.com/0xiehnnkta/nemesis-auditor/tree/75cecc6dbd798f82ed8928d1a906078be9c575de) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [PlamenTSV/plamen](https://github.com/PlamenTSV/plamen/tree/7dc822104e1fc6655b0e8f30cd374c0d4c6939bd) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [J4X-Security/K.I.T](https://github.com/J4X-Security/K.I.T/tree/1e18ece9cf0e7e9b73f8579e1b706a084586f47e) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [cholakovvv/foundry-poc-mainnet-fork](https://github.com/cholakovvv/foundry-poc-mainnet-fork/tree/e02ebcb75d41575eb69127039da3de85a7b72da5) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [0xRayaa/scoping-bee](https://github.com/0xRayaa/scoping-bee/tree/138222e148fd6f0d5b7b92b1fee304bbc09417b7) | **MIT** | ✅ Compatible | Verbatim port OK with attribution. |
| [Archethect/sc-auditor](https://github.com/Archethect/sc-auditor/tree/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8) | **NO LICENSE** | ⚠️ All-rights-reserved by default | **Methodology-only**. Read for inspiration. Do NOT copy text verbatim. Reimplement protocols + prompts in our own words. Acknowledge inspiration in `CREDITS.md`. *Optional*: open an issue/PR on their repo asking them to add an explicit license. |
| [kadenzipfel/scv-scan](https://github.com/kadenzipfel/scv-scan/tree/114985581450cfed35c277831a065c6478e2c328) | **NO LICENSE** | ⚠️ All-rights-reserved by default | **Format reference only**. Implement our own cheatsheet using our existing pattern content. Don't copy their entries. |
| [heavyw8t/The-Judge](https://github.com/heavyw8t/The-Judge/tree/20703caee08ffdb2736866e7d21d1df2b3e21968) | **NO LICENSE** | ⚠️ All-rights-reserved by default | **Methodology-only**. The 6-step pipeline + invalidation-library *concept* is fine to implement; prompt text must be ours. |
| [hackenproof-public/skills](https://github.com/hackenproof-public/skills/tree/26200588b2e7424883a4497bfa23beb9accc06c3) | **NO LICENSE** | ⚠️ All-rights-reserved by default | **Methodology-only**. Their severity-to-bounty *concept* is OK; specific numeric ranges + prose must be ours. |
| [GPTScan/GPTScan](https://github.com/GPTScan/GPTScan/tree/29a174773bd526c32ab7d6a8c78a63870330ccc7) | **AGPL-3.0** | ❌ Incompatible with MIT for code copy | Concept reference only. Modifier whitelist is short and trivially recreatable as our own file. Do NOT copy their YAML rules verbatim. |
| [trailofbits/skills](https://github.com/trailofbits/skills/tree/a56045e9ae00b3506cacefea0f672aab0a1a6e3c) | **CC-BY-SA-4.0** | ⚠️ Share-alike — verbatim copy into our MIT package creates dual-license conflict | **Companion plugin pattern** (our existing approach): keep TOB skills as a *separately installed* CC-BY-SA package, referenced via `argus_skill_load` but never bundled. Already how we handle it. |
| [alt-research/SolidityGuard](https://github.com/alt-research/SolidityGuard/tree/acae829c81071c156a64a0634adab04d8b82d186) | **Proprietary** (badged) | ❌ No code copy permitted | **Taxonomy reference only**. Pattern names + SWC IDs + severity classifications are facts (not copyrightable). Recreate every detection rule from primary sources (EIPs, audit reports, exploit analyses). Never read their detection scripts. |
| [scabench-org/hound](https://github.com/scabench-org/hound/tree/c29890180b317b66b06342521c8e2d82117bb93b) | **Apache-2.0** (per README badge) | ✅ Compatible (Apache 2.0 → MIT package OK with attribution + NOTICE) | Apache 2.0 requires NOTICE preservation. Reimplement methodology, attribute clearly. Not in Sprint 1 scope but flagged for Sprint 2 cartography work. |
| [OpenZeppelin/openzeppelin-skills](https://github.com/OpenZeppelin/openzeppelin-skills) | **AGPL-3.0-only** | ❌ Incompatible with MIT for code copy | Manifest format reference only — `.claude-plugin/marketplace.json` + `plugin.json` schemas are functional (not expressive). Recreate our own with our metadata. |

**Default rule when in doubt**: reimplement methodology, write our own prompts/code, never paste source text. Verbatim portability is only safe for explicitly-licensed-compatible content (MIT / Apache-2.0). Always attribute the *inspiration*.

---

## Attribution conventions

### Repo-root `CREDITS.md`

Add a single file at the repo root crediting all inspirations. Template:

```markdown
# Credits

solidity-argus draws methodology, patterns, and architecture inspiration from several open-source projects in the AI web3 security ecosystem. We thank the authors and maintainers.

## Direct attribution (MIT-licensed sources)

### Architecture & methodology
- **[pashov/skills](https://github.com/pashov/skills)** — Hacking-agents pattern (8 specialized hunt agents) + eval harness pattern. License: MIT.
- **[DarkNavySecurity/web3-skills](https://github.com/DarkNavySecurity/web3-skills)** — 6-check falsifier methodology + 5-tier severity protocol + prerequisite tier table. License: MIT.
- **[ZealynxSecurity/krait](https://github.com/ZealynxSecurity/krait)** — 4-mindset detection prompt structure + 8 kill gates concept. License: MIT.
- **[0xiehnnkta/nemesis-auditor](https://github.com/0xiehnnkta/nemesis-auditor)** — Feynman + State Inconsistency dual-agent loop. License: MIT.
- **[PlamenTSV/plamen](https://github.com/PlamenTSV/plamen)** — Per-chain skill organization + fork-ancestry concept + integration-hazard separation. License: MIT.

### Workflows we plan to model on
- **[0xRayaa/scoping-bee](https://github.com/0xRayaa/scoping-bee)** — Pre-audit scoping methodology + 10-phase threat-intel scan + Mermaid visualizer set. License: MIT.
- **[cholakovvv/foundry-poc-mainnet-fork](https://github.com/cholakovvv/foundry-poc-mainnet-fork)** — Mainnet-fork PoC classification system + end-state assertion patterns. License: MIT.
- **[J4X-Security/K.I.T](https://github.com/J4X-Security/K.I.T)** — Known-issue triager workflow + staged JSON contract pattern. License: MIT.

## Methodology-inspired (no-license / different-license sources)

The following projects influenced our methodology but we did not copy their text. We acknowledge the conceptual inspiration:

- **[Archethect/sc-auditor](https://github.com/Archethect/sc-auditor)** — Devil's Advocate + Skeptic + Judge architecture (concept only — prompts reimplemented).
- **[heavyw8t/The-Judge](https://github.com/heavyw8t/The-Judge)** — Multi-stage adversarial FP filter with parallel checker waves (concept only).
- **[kadenzipfel/scv-scan](https://github.com/kadenzipfel/scv-scan)** — Cheatsheet format pattern for vulnerability quick-reference (format only).
- **[hackenproof-public/skills](https://github.com/hackenproof-public/skills)** — Bug bounty triage workflow + severity-to-bounty handoff (concept only).

## Taxonomy / fact references

Pattern names, EIP coverage, and vulnerability classifications drawn from:

- **EIP specifications** ([eip-1153](https://eips.ethereum.org/EIPS/eip-1153), [eip-7702](https://eips.ethereum.org/EIPS/eip-7702), [eip-4337](https://eips.ethereum.org/EIPS/eip-4337)) — public domain technical specs.
- **[Hexens TSTORE poison research](https://hexens.io/research/solidity-compiler-bug-tstore-poison)** — public security research.
- **alt-research/SolidityGuard** vulnerability taxonomy — pattern names + SWC mappings only. Detection logic recreated from primary sources.
- **SCVD database** ([api.scvd.dev](https://api.scvd.dev)) — primary integration.
- **Solodit** — primary integration.

## Knowledge corpus (separate trust tier)

Skills loaded via companion plugin, not bundled. Original licenses preserved:

- **[trailofbits/skills](https://github.com/trailofbits/skills)** — CC-BY-SA-4.0. Loaded via companion plugin under `~/.cache/solidity-argus/trailofbits-skills/`. Trust tier: `companion`.
```

### Per-file attribution header

For files where we ported a non-trivial pattern from an MIT source, add a header comment:

```typescript
// Inspired by pashov/skills evals/runner.md
// https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/evals/runner.md
// Original license: MIT (Pashov Audit Group, contributors)
// Adapted for solidity-argus by replacing claude CLI with our bun runtime + adding metadata tracking.
```

For SKILL.md frontmatter:

```yaml
---
name: my-skill
description: ...
source_finding:
  audit: https://code4rena.com/reports/2024-03-pooltogether#H-1
  url: https://...
inspired_by:
  - source: pashov/skills
    url: https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/references/hacking-agents/access-control-agent.md
    license: MIT
    notes: Hunt-agent prompt structure pattern; reimplemented for our 5-agent architecture.
---
```

---

## Per-target porting references

### C-2 — Eval Harness ([sprint plan]({./04-next-sprint-plan.md}#week-1-—-scaffolding))

#### Target files we will create
- [`evals/runner.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/evals/runner.ts) — clones target repo, runs argus, captures `final-report.md` + raw findings + metadata
- [`evals/compare.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/evals/compare.ts) — semantic FOUND / LEAD / MISSED matching against ground truth
- [`evals/benchmarks/*.md`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/evals/benchmarks) — ground-truth frontmatter + findings list per protocol
- [`evals/results/{benchmark}/{timestamp}-{commit}/summary.md`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/evals/results) — per-run output

#### Sources (commit-pinned)

| Source file | Commit | License | Treatment |
|---|---|---|---|
| [`pashov/skills/solidity-auditor/evals/runner.md`](https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/evals/runner.md) | `749903d` | **MIT** | **PORT** — adapt the 3-phase structure (Setup → Run → Summarize) to TypeScript. Replace `claude --print --plugin-dir` invocation with `bun argus audit`. |
| [`pashov/skills/solidity-auditor/evals/compare.md`](https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/evals/compare.md) | `749903d` | **MIT** | **PORT** — keep the FOUND / LEAD / MISSED semantic-matching rules verbatim (with attribution). Translate the summary table format to TypeScript Mustache template. |
| [`pashov/skills/solidity-auditor/evals/benchmarks/dodo.md`](https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/evals/benchmarks/dodo.md) | `749903d` | **MIT** | **PORT** — use the exact frontmatter + findings format. Their DODO ground truth has 5 H + 11 M = 16 findings. We use this as `evals/benchmarks/pashov-dodo.md`. |
| [`pashov/skills/solidity-auditor/evals/benchmarks/megapot.md`](https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/evals/benchmarks/megapot.md) | `749903d` | **MIT** | **PORT** — same as DODO. |
| [`pashov/skills/solidity-auditor/evals/benchmarks/pooltogether.md`](https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/solidity-auditor/evals/benchmarks/pooltogether.md) | `749903d` | **MIT** | **PORT** — 1 H + 8 M = 9 findings against PT V5 PrizeVault. Solid template. |
| [EVMBench (OpenAI frontier-evals)](https://github.com/openai/frontier-evals/tree/main/project/evmbench) | (latest main) | Apache-2.0 (OpenAI standard) | **CONSUME** — 40 audits × 120 vulns × 3 modes. Ingest their ground-truth JSON, convert to our `evals/benchmarks/evmbench-*.md` format. Need their public ground-truth dataset. |
| [Code4rena recent contests reports](https://code4rena.com/reports) | per-contest | Public reports | **CONSUME** — pick 5 from last 6 months matching different protocol types. Convert each to our benchmark format manually. |

#### Adaptation strategy

- **Keep**: pashov's 3-phase orchestration, FOUND/LEAD/MISSED semantic matching, frontmatter schema (`repo_url`, `repo_ref`, `contracts_dir`), per-finding format (`FINDING | id: X | severity: Y | contract: Z | function: W | bug_class: ...`).
- **Change**: shell loop → TypeScript runner. `/tmp/eval-{name}` → `/tmp/argus-eval-{name}` (avoid collision). Add metadata: model used, prompt version, commit hash, timestamp, total tokens, wall-clock. Save raw report alongside `summary.md`.
- **Drop**: their `--plugin-dir /tmp/audit-plugin` symlink trick (specific to claude CLI). We use `bun argus audit <dir>`.

#### Attribution
- `CREDITS.md`: pashov/skills entry (already in template above)
- `evals/runner.ts` header: link to runner.md, MIT license note
- `evals/benchmarks/pashov-*.md` files: header note "Ground truth from pashov/skills evals/benchmarks/ — MIT licensed"

---

### C-3 — Themis DA + Skeptic + Judge ([sprint plan]({./04-next-sprint-plan.md}#week-2-—-validation-upgrade--knowledge-push))

#### Target files we will create
- [`src/agents/themis-prompt.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/agents/themis-prompt.ts) — orchestrator: dispatch DA → Skeptic → Judge sub-passes
- `skills/methodology/da-protocol.md` — canonical 6-dimension DA protocol (our wording)
- `skills/methodology/skeptic-protocol.md` — inversion-mandate skeptic
- `skills/methodology/judge-protocol.md` — conflict resolution with "prove it or lose it"
- `skills/methodology/invalidation-library.md` — generic invalidation reasons catalog
- New JSON schemas in `src/state/finding-schema.ts`: `DaResult`, `SkepticResult`, `JudgeResult`

#### Primary source: Archethect (NO LICENSE — methodology only)

| Source file | Commit | License | Treatment |
|---|---|---|---|
| [`Archethect/sc-auditor/skills/security-auditor/SKILL.md`](https://github.com/Archethect/sc-auditor/blob/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/skills/security-auditor/SKILL.md) | `942cc13` | **NONE** ⚠️ | **REFERENCE** — study the Map→Hunt→Attack→Verify→Conflict-Resolution→Report state machine. **Do NOT copy text.** Reimplement orchestration in our own prose. |
| [`Archethect/sc-auditor/skills/security-auditor/assets/prompts/da-protocol.md`](https://github.com/Archethect/sc-auditor/blob/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/skills/security-auditor/assets/prompts/da-protocol.md) | `942cc13` | **NONE** ⚠️ | **REIMPLEMENT** — 6 dimensions (Guards / Reentrancy / Access control / By-design / Economic feasibility / Dry run), -3 to +1 scoring, mechanical sum verdict (≤-6 INVALIDATED, -5 to -3 DEGRADED, -2 to +2 SUSTAINED, ≥+3 ESCALATED). The numerical scheme is functional (not copyrightable). Our prompts use our own dimension descriptions. |
| [`Archethect/sc-auditor/skills/security-auditor/assets/prompts/attack.md`](https://github.com/Archethect/sc-auditor/blob/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/skills/security-auditor/assets/prompts/attack.md) | `942cc13` | **NONE** ⚠️ | **REIMPLEMENT** — the ATTACK phase runs DA on hotspot candidates. We adapt this: our specialist hunt agents (C-1) produce findings → themis runs DA on each. Don't copy prompt text. |
| [`Archethect/sc-auditor/skills/security-auditor/assets/prompts/skeptic.md`](https://github.com/Archethect/sc-auditor/blob/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/skills/security-auditor/assets/prompts/skeptic.md) | `942cc13` | **NONE** ⚠️ | **REIMPLEMENT** — the **inversion mandate**: if ATTACK invalidated → Skeptic tries to RESURRECT; if ATTACK sustained → Skeptic tries to NEGATE. Fresh independent DA analysis. The concept is the gold. Write our own prompt. |
| [`Archethect/sc-auditor/skills/security-auditor/assets/prompts/judge.md`](https://github.com/Archethect/sc-auditor/blob/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/skills/security-auditor/assets/prompts/judge.md) | `942cc13` | **NONE** ⚠️ | **REIMPLEMENT** — Standard Matrix (no conflict) vs Conflict Resolution ("prove it or lose it"). The state-machine logic is functional. Our wording. |

#### Alternative primary source: DarkNavy (MIT — can port verbatim with attribution)

| Source file | Commit | License | Treatment |
|---|---|---|---|
| [`DarkNavySecurity/web3-skills/contract-auditor/references/agents/adversarial-agent.md`](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f239c11a0c0f57983ca3b7d89429ba18472/contract-auditor/references/agents/adversarial-agent.md) | `c4036f2` | **MIT** | **PORT WITH ATTRIBUTION** — their 6-check falsification (Design Intent / Prereq + Tier / Guards / Economic / Trust / Dry Run) is an excellent alternative to Archethect's 6-dimension DA. We could even use BOTH (DA = 6D, then 6-check falsifier as second pass). Both are valid; pick one for Sprint 1 to keep complexity bounded. |
| [`DarkNavySecurity/web3-skills/contract-auditor/references/validation/finding-protocol.md`](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f239c11a0c0f57983ca3b7d89429ba18472/contract-auditor/references/validation/finding-protocol.md) | `c4036f2` | **MIT** | **PORT WITH ATTRIBUTION** — 5-tier severity (Critical/High/Medium/Low/Design Advisory/Informational) with scaled validation rigor + 6D Scoring + Prerequisite Tier Table. **This is the cleanest version of the severity system across all 29 repos.** Recommend porting this verbatim with attribution + our own examples. |

#### Alternative primary source: The-Judge (NO LICENSE — methodology only)

| Source file | Commit | License | Treatment |
|---|---|---|---|
| [`heavyw8t/The-Judge/skill/judge/SKILL.md`](https://github.com/heavyw8t/The-Judge/blob/20703caee08ffdb2736866e7d21d1df2b3e21968/skill/judge/SKILL.md) | `20703ca` | **NONE** ⚠️ | **REFERENCE** — the multi-stage Wave 1 + Wave 2 + two-checker confirmation pattern. Useful alternative architecture if Archethect's DA+Skeptic+Judge feels too heavy. Don't copy text. |
| [`heavyw8t/The-Judge/skill/judge/references/invalidation-library.md`](https://github.com/heavyw8t/The-Judge/blob/20703caee08ffdb2736866e7d21d1df2b3e21968/skill/judge/references/invalidation-library.md) | `20703ca` | **NONE** ⚠️ | **REFERENCE for structure** — 6 categories (UNREALISTIC_PRECONDITIONS / COST_EXCEEDS_PROFIT / DESIGN_TRADEOFF / EXISTING_GUARD / UNREACHABLE_STATE / SELF_HARM_ONLY) × 4-5 reasons each = ~25 generic invalidation reasons. **Reimplement** our own library with the same category structure but our own reason descriptions. The category set is functional, the descriptions are expressive. |

#### Adaptation strategy

**Pick ONE primary architecture:**
- **Option A (Recommended)**: Archethect DA + Skeptic + Judge — cleanest 2-stage adversarial with inversion mandate. Concept only (no license). Our prompts.
- **Option B**: DarkNavy 6-check falsifier — single-stage adversarial. MIT licensed. Can verbatim-port with attribution. Simpler than Option A.

**Recommend Option A** because:
- 2-stage (ATTACK then VERIFY) is empirically better than single-stage (per Archethect's design)
- The inversion mandate is unique IP — Skeptic actively tries to break the ATTACK verdict
- Plays well with our existing themis disposition flow (`approved | remediated | overridden`)
- Even though Archethect has no license, methodology is not copyrightable — we just write the prompts ourselves

**Borrow from all three:**
- **Archethect**: 6-dimension DA scoring scheme + Skeptic inversion mandate + Judge "prove it or lose it" matrix
- **DarkNavy (MIT)**: 5-tier severity with scaled validation rigor + Prerequisite Tier Table — verbatim port these tables to `skills/methodology/severity-classification.md` (already exists, extend it)
- **The-Judge**: invalidation-library 6-category structure

#### Output schemas (JSON, our design — functional schemas not copyrightable)

```typescript
// src/state/finding-schema.ts (extend existing)
interface DaResult {
  da_phase: 'attack' | 'verify';
  da_verdict: 'invalidated' | 'degraded' | 'sustained' | 'escalated';
  da_total_score: number;
  da_dimensions: DaDimension[];
  da_reasoning: string;
}
interface DaDimension {
  dimension: 'guards' | 'reentrancy_protection' | 'access_control' | 'by_design' | 'economic_feasibility' | 'dry_run';
  score: -3 | -2 | -1 | 0 | 1;
  evidence: string;
  code_references: string[];
  attack_da_disagreement?: string;  // VERIFY phase only
}
interface SkepticResult {
  skeptic_verdict: 'refuted' | 'plausible' | 'confirmed';
  da_verify: DaResult;
  da_chain_summary: {
    attack_da_verdict: string;
    verify_da_verdict: string;
    conflict: boolean;
    resolution: string;
  };
  refutation_attempts: Array<{ claim: string; evidence: string; result: 'refuted' | 'survived' }>;
  confidence: number;
  summary: string;
}
interface JudgeResult {
  judge_verdict: 'verified' | 'candidate' | 'judge_confirmed' | 'discarded';
  benchmark_mode_visible: boolean;
  needs_reattack: boolean;
  da_chain: { /* ... */ };
  reasoning: string;
  confidence: number;
}
```

#### Attribution
- `CREDITS.md`: Archethect + DarkNavy + The-Judge entries
- `skills/methodology/da-protocol.md` header: "Methodology inspired by [Archethect's DA protocol](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/prompts/da-protocol.md) (no license on source). Severity tiers and Prerequisite Tier Table verbatim ported with attribution from [DarkNavy/web3-skills finding-protocol.md](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/contract-auditor/references/validation/finding-protocol.md) (MIT)."

---

### C-5 — 2025+ Vulnerability Patterns ([sprint plan]({./04-next-sprint-plan.md}))

#### Target files we will create

10 new SKILL.md files under `skills/vulnerability-patterns/`:

| # | File | Source EIP / research |
|---|---|---|
| 1 | `tstore-slot-collision/SKILL.md` | EIP-1153 |
| 2 | `tstore-reentrancy-bypass-low-gas/SKILL.md` | EIP-1153 + community research |
| 3 | `tstore-delegatecall-exposure/SKILL.md` | EIP-1153 |
| 4 | `tstore-type-safety-bypass/SKILL.md` | EIP-1153 |
| 5 | `tstore-compiler-poison/SKILL.md` | [Hexens TSTORE poison](https://hexens.io/research/solidity-compiler-bug-tstore-poison) (solc 0.8.28–0.8.33 via-ir) |
| 6 | `eip7702-tx-origin-broken/SKILL.md` | EIP-7702 |
| 7 | `eip7702-malicious-delegation/SKILL.md` | EIP-7702 |
| 8 | `eip7702-cross-chain-auth-replay/SKILL.md` | EIP-7702 |
| 9 | `eip7702-extcodesize-unreliable/SKILL.md` | EIP-7702 |
| 10 | `erc4337-paymaster-validation-abuse/SKILL.md` | ERC-4337 |

#### Primary sources (public domain / fact references)

| Source | URL | License | Treatment |
|---|---|---|---|
| EIP-1153 (Transient Storage) | https://eips.ethereum.org/EIPS/eip-1153 | Public domain (Ethereum.org standard) | **CITE & QUOTE freely** — EIPs are CC0/public. Use as canonical reference. |
| EIP-7702 (Set EOA Account Code) | https://eips.ethereum.org/EIPS/eip-7702 | Public domain | **CITE & QUOTE freely** |
| ERC-4337 (Account Abstraction) | https://eips.ethereum.org/EIPS/eip-4337 | Public domain | **CITE & QUOTE freely** |
| Hexens TSTORE poison | https://hexens.io/research/solidity-compiler-bug-tstore-poison | Public research (cite required) | **CITE** as canonical bug analysis. Attribute Hexens. |

#### Taxonomy reference (proprietary — names + classifications only)

| Source | URL | License | Treatment |
|---|---|---|---|
| SolidityGuard VULNERABILITY_PATTERNS.md | [link](https://github.com/alt-research/SolidityGuard/blob/acae829c81071c156a64a0634adab04d8b82d186/.claude/skills/solidity-guard/skills/vulnerability-scanner/resources/VULNERABILITY_PATTERNS.md) | **Proprietary** ❌ | **TAXONOMY ONLY** — they catalog ETH-081 to ETH-093 covering our 10 patterns. Use the *list of patterns to cover* as a checklist. **Do NOT copy any text** from their file. Recreate every detection rule from primary sources (EIPs + Hexens + Solodit + Code4rena reports). |

#### Adaptation strategy

For each of the 10 SKILL.md files:

1. **Pattern name + 1-line description**: derived from EIP terminology (e.g., `tstore-slot-collision`, not SolidityGuard's `ETH-081 Transient Storage Slot Collision`).
2. **Preconditions section**: from EIP behavioral spec.
3. **Vulnerable pattern (annotated Solidity)**: write fresh based on EIP semantics.
4. **Detection heuristics**: regex/AST patterns based on Solidity syntax for TSTORE/TLOAD, delegations, etc.
5. **False positives section**: rare patterns where the trigger appears but is safe (mandatory section per our [01-flagship-solidity-skills.md](./01-flagship-solidity-skills.md) kadenzipfel pattern).
6. **Remediation**: from EIP best practices + audit-report-derived remediations.
7. **Frontmatter**:
   ```yaml
   ---
   name: tstore-slot-collision
   pattern_category: storage
   source_finding:
     spec: https://eips.ethereum.org/EIPS/eip-1153
     audit_examples: []  # backfill when we find real audit examples
   ---
   ```

#### Attribution
- Each SKILL.md frontmatter cites the EIP + (when available) the public audit/exploit case.
- `CREDITS.md`: EIPs + Hexens entries.
- No SolidityGuard attribution (we used their taxonomy as a checklist, not their content).

---

### H-3a — CHEATSHEET.md ([sprint plan]({./04-next-sprint-plan.md}#week-1-—-scaffolding))

#### Target file we will create
- [`skills/CHEATSHEET.md`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/skills/CHEATSHEET.md) — single condensed reference for all (51 + 10 new = 61) patterns.
- [`scripts/gen-cheatsheet.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/scripts/gen-cheatsheet.ts) — generator script: reads pattern frontmatter, outputs cheatsheet.

#### Source (NO LICENSE — format reference only)

| Source | URL | License | Treatment |
|---|---|---|---|
| kadenzipfel/scv-scan CHEATSHEET.md | [link](https://github.com/kadenzipfel/scv-scan/blob/114985581450cfed35c277831a065c6478e2c328/references/CHEATSHEET.md) | **NONE** ⚠️ | **FORMAT REFERENCE ONLY**. The format is functional (per-pattern: name + paragraph + grep keywords + reference link). Implement our own with our 61 patterns. Do NOT copy any of their pattern text. |

#### Adaptation strategy

- **Keep format**: per-pattern entry has `## Name`, 1-paragraph description, optional code snippet (3-5 lines), `### Grep-able keywords`, link to full reference.
- **Source content**: aggregate from our own pattern files' frontmatter + first paragraph. Build a generator script so the cheatsheet auto-stays-in-sync.
- **Add**: section grouping by `pattern_category` (we have 14 categories; group entries accordingly).

#### Attribution
- `skills/CHEATSHEET.md` header: "Format inspired by [kadenzipfel/scv-scan CHEATSHEET.md](https://github.com/kadenzipfel/scv-scan/blob/1149855/references/CHEATSHEET.md)."
- `CREDITS.md`: kadenzipfel entry (already in template).

---

### H-3b — `skills/hard-negatives/` ([sprint plan]({./04-next-sprint-plan.md}))

#### Target files we will create

5+ new files under `skills/hard-negatives/`:

| File | Topic |
|---|---|
| `approval-abuse-negatives.md` | Patterns that look like approval abuse but are safe (immutable router, atomic approve-transfer-revoke, etc.) |
| `callback-grief-negatives.md` | Callbacks that look exploitable but have guards |
| `entitlement-drift-negatives.md` | Share/balance drift patterns that are intentional |
| `rounding-entitlement-negatives.md` | Protocol-favoring rounding patterns |
| `semantic-drift-negatives.md` | Naming/semantic patterns that look broken but are correct |

#### Source (NO LICENSE — methodology + sub-pattern names only)

| Source files | Commit | License | Treatment |
|---|---|---|---|
| [Archethect/sc-auditor `assets/hard-negatives/*-negatives.md`](https://github.com/Archethect/sc-auditor/tree/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/skills/security-auditor/assets/hard-negatives) (5 files) | `942cc13` | **NONE** ⚠️ | **REFERENCE STRUCTURE** — each file has: Pattern Name / Why It Looks Bad / Why It's Safe / Key Indicators. We adopt this structure for our own files. Their specific patterns (Unlimited Approval to Immutable Router, Approve-Transfer-Revoke in Single Tx, SafeERC20 forceApprove, Permit2 with Signature, Timelock-Protected Upgradeable) are well-known DeFi conventions — we describe them in our own words referencing the standard implementations (Uniswap V2/V3 router immutability, OZ SafeERC20.forceApprove, Permit2 = `0x000000000022D473030F116dDEE9F6B43aC78BA3`, OZ TimelockController). |

#### Adaptation strategy

- **Keep structure**: 4-section format per pattern (Why It Looks Bad / Why It's Safe / Key Indicators / optional Code Example).
- **Source content**: write descriptions from first principles + OZ/Uniswap docs. We're not paraphrasing Archethect; we're re-describing standard DeFi patterns we both observe.
- **Add**: per-pattern `detection_signal` field — what specifically should sentinel DA *score down* for when it sees this pattern.

#### Attribution
- Per-file header: "Hard-negative catalogue inspired by [Archethect's hard-negatives/](https://github.com/Archethect/sc-auditor/tree/942cc13/skills/security-auditor/assets/hard-negatives). Pattern descriptions written from first principles."
- `CREDITS.md`: Archethect entry.

---

### Quick wins — concrete porting references

#### QW-1: TOB skills resync (companion plugin)

- **Action**: run `argus_sync_knowledge` to pull fresh TOB skills cache.
- **New plugins to verify in cache**: `fp-check`, `dimensional-analysis`, `supply-chain-risk-auditor`, `skill-improver`, `trailmark`, `mutation-testing`, `agentic-actions-auditor`.
- **License**: CC-BY-SA-4.0 — preserved via companion plugin pattern. No code copy into our MIT package.
- **Source**: [trailofbits/skills/plugins](https://github.com/trailofbits/skills/tree/a56045e9ae00b3506cacefea0f672aab0a1a6e3c/plugins). 38 plugins total.

#### QW-2: `CREDITS.md` at repo root

- **Action**: create file using template above.
- **Effort**: 30 min.

#### QW-3: `skills/CHEATSHEET.md` autogen script

- See **H-3a** above.

#### QW-4: 4-mindset prompt addition to specialist hunt agents

- **Target**: each `src/agents/sentinel-*-prompt.ts` (or wherever C-1 placed them).
- **Source (MIT)**: [`krait/detector/instructions.md`](https://github.com/ZealynxSecurity/krait/blob/2e98bb3b368c44e9332167defbb7343caa8d172b/.claude/skills/krait/detector/instructions.md) — search for the "4 Mindsets" section.

Content to port (paraphrased, our own wording but the structure is functional):

```
For every function in your specialty area, analyze through 4 mindsets:

1. ATTACKER: "How would I exploit this to drain funds or escalate privilege?"
2. ACCOUNTANT: "Trace every wei — do the numbers add up?"
3. SPEC AUDITOR: "Does the code match what docs, comments, and EIPs say it should do?"
4. EDGE CASE HUNTER: "What breaks at zero, max, empty, self-referential, or reentrant?"

Findings flagged by 2+ mindsets get a +confidence boost. Findings flagged by only 1 mindset get extra scrutiny in the next phase.
```

- **License**: MIT — can verbatim port the mindset prompts with attribution.
- **Effort**: 2 hours (write into each specialist prompt + add aggregation logic).

#### QW-5: `severity-to-bounty.md` rubric

- **Target**: extend `skills/methodology/severity-classification/SKILL.md` with a new section.
- **Source (NO LICENSE)**: [hackenproof severity-to-bounty.md](https://github.com/hackenproof-public/skills/blob/26200588b2e7424883a4497bfa23beb9accc06c3/plugins/hackenproof-handoff/skills/hackenproof-report-handoff/references/severity-to-bounty.md) — only 17 lines, and it just says "pull from `get_program_info`, never assume".
- **Adaptation**: instead of "pull from program API", we provide *suggested default ranges* for protocols that don't have a published bounty program. Suggested ranges (our authorship based on common industry practice):
  - Critical: $50k–$1M (or 10% TVL up to cap)
  - High: $10k–$100k
  - Medium: $2k–$25k
  - Low: $500–$5k
  - Informational: $0–$500
- **Effort**: 30 min.

#### QW-6: Modifier whitelist JSON

- **Target**: `skills/methodology/modifier-whitelist.json`.
- **Source (AGPL-3.0)**: [GPTScan modifier_whitelist.json](https://github.com/GPTScan/GPTScan/blob/29a174773bd526c32ab7d6a8c78a63870330ccc7/src/modifier_whitelist.json) — only 5 entries (`onlyOwner`, `onlyRouter`, `onlyKeeper`, `onlyVault`, `onlyDeployer`).
- **License**: AGPL — but a 5-entry list of standard Solidity modifier names is not copyrightable (facts). Recreate with extended list:

```json
{
  "trusted_modifiers": [
    "onlyOwner", "onlyAdmin", "onlyRole", "onlyGovernance", "onlyTimelock",
    "onlyRouter", "onlyKeeper", "onlyVault", "onlyDeployer", "onlyFactory",
    "onlyOperator", "onlyMinter", "onlyBurner", "onlyPauser", "onlyGuardian",
    "onlyHook", "onlyManager", "onlyController", "whenNotPaused", "nonReentrant"
  ],
  "trust_tier_caps": {
    "onlyOwner": "low",
    "onlyAdmin": "low",
    "onlyGovernance": "medium",
    "onlyTimelock": "high",
    "onlyRole": "medium-context-dependent"
  }
}
```

- **Effort**: 1 hour.

#### QW-7: `.claude-plugin/marketplace.json` + `plugin.json` stub

- **Target**: `.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json` at repo root.
- **Source (AGPL/CC-BY-SA — manifest schemas are functional, not copyrightable)**:
  - [OpenZeppelin marketplace.json](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/.claude-plugin/marketplace.json) (15 lines)
  - [OpenZeppelin plugin.json](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/.claude-plugin/plugin.json) (12 lines)
  - [TOB marketplace.json](https://github.com/trailofbits/skills/blob/a56045e9ae00b3506cacefea0f672aab0a1a6e3c/.claude-plugin/marketplace.json) (16KB — full multi-plugin)
- **Treatment**: schemas are functional. Write our own with our metadata. Markdown-only (no tools) for now per [04-next-sprint-plan.md decision](./04-next-sprint-plan.md#sprint-1-goals-3-weeks).
- **Effort**: 1 hour.

Example output:

```json
// .claude-plugin/marketplace.json
{
  "name": "solidity-argus",
  "owner": { "name": "Apegurus" },
  "metadata": {
    "description": "Solidity security audit orchestrator with 5 specialized agents, SCVD+Solodit integration, and 70+ curated vulnerability patterns."
  },
  "plugins": [{ "name": "solidity-argus", "source": "./" }]
}
```

```json
// .claude-plugin/plugin.json
{
  "name": "solidity-argus",
  "version": "0.6.0",
  "description": "...",
  "author": { "name": "Apegurus", "url": "https://github.com/Apegurus" },
  "homepage": "https://github.com/Apegurus/solidity-argus",
  "repository": "https://github.com/Apegurus/solidity-argus",
  "license": "MIT"
}
```

#### QW-8: Empirical-derivation tag (`source_finding:` frontmatter)

- **Target**: every existing SKILL.md in `skills/vulnerability-patterns/` (51 files).
- **Source pattern (MIT)**: [drozer-lite README](https://github.com/gdroz3r/drozer-lite/blob/main/README.md) — empirical-derivation discipline.
- **Action**: add `source_finding:` field. For each pattern, find at least one real audit/exploit citation:
  - Solodit search for the pattern name
  - SunWeb3Sec/DeFiHackLabs for historical exploits
  - Code4rena/Spearbit/OZ reports
- **Patterns without evidence**: tag with `source_finding: needs-research` so we don't ship without provenance.
- **Effort**: 4 hours across 51 files. Can batch.

---

## Source files cache — inventory

For implementation work, the source files we'll port from are cached under `/tmp/argus-bom/` (throwaway, do not commit):

| Cached file | Source (commit-pinned permalink) | License | Sprint 1 task |
|---|---|---|---|
| `s1_c2_pashov_runner.md` | [pashov/skills/.../evals/runner.md](https://github.com/pashov/skills/blob/749903d/solidity-auditor/evals/runner.md) | MIT | C-2 |
| `s1_c2_pashov_compare.md` | [pashov/skills/.../evals/compare.md](https://github.com/pashov/skills/blob/749903d/solidity-auditor/evals/compare.md) | MIT | C-2 |
| `s1_c2_pashov_bench_dodo.md` | [.../benchmarks/dodo.md](https://github.com/pashov/skills/blob/749903d/solidity-auditor/evals/benchmarks/dodo.md) | MIT | C-2 |
| `s1_c2_pashov_bench_megapot.md` | [.../benchmarks/megapot.md](https://github.com/pashov/skills/blob/749903d/solidity-auditor/evals/benchmarks/megapot.md) | MIT | C-2 |
| `s1_c2_pashov_bench_pooltogether.md` | [.../benchmarks/pooltogether.md](https://github.com/pashov/skills/blob/749903d/solidity-auditor/evals/benchmarks/pooltogether.md) | MIT | C-2 |
| `s1_c3_arch_da_protocol.md` | [Archethect/.../da-protocol.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/prompts/da-protocol.md) | NONE | C-3 (methodology) |
| `s1_c3_arch_attack.md` | [.../attack.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/prompts/attack.md) | NONE | C-3 (methodology) |
| `s1_c3_arch_skeptic.md` | [.../skeptic.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/prompts/skeptic.md) | NONE | C-3 (methodology) |
| `s1_c3_arch_judge.md` | [.../judge.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/prompts/judge.md) | NONE | C-3 (methodology) |
| `s1_c3_arch_skill.md` | [.../security-auditor/SKILL.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/SKILL.md) | NONE | C-3 (orchestration ref) |
| `s1_c3_dn_adversarial.md` | [DarkNavy/.../adversarial-agent.md](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/contract-auditor/references/agents/adversarial-agent.md) | MIT | C-3 (port-OK) |
| `s1_c3_dn_finding_protocol.md` | [DarkNavy/.../finding-protocol.md](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/contract-auditor/references/validation/finding-protocol.md) | MIT | C-3 (port-OK) |
| `s1_c3_judge_skill.md` | [The-Judge SKILL.md](https://github.com/heavyw8t/The-Judge/blob/20703ca/skill/judge/SKILL.md) | NONE | C-3 (methodology) |
| `s1_c3_judge_invalidation.md` | [The-Judge invalidation-library.md](https://github.com/heavyw8t/The-Judge/blob/20703ca/skill/judge/references/invalidation-library.md) | NONE | C-3 (structure ref) |
| `s1_c5_sg_taxonomy.md` | [SolidityGuard VULNERABILITY_PATTERNS.md](https://github.com/alt-research/SolidityGuard/blob/acae829/.claude/skills/solidity-guard/skills/vulnerability-scanner/resources/VULNERABILITY_PATTERNS.md) | PROPRIETARY | C-5 (taxonomy checklist) |
| `s1_c5_eip_1153.html` | [eip-1153](https://eips.ethereum.org/EIPS/eip-1153) | Public domain | C-5 (canonical spec) |
| `s1_c5_eip_7702.html` | [eip-7702](https://eips.ethereum.org/EIPS/eip-7702) | Public domain | C-5 (canonical spec) |
| `s1_c5_eip_4337.html` | [eip-4337](https://eips.ethereum.org/EIPS/eip-4337) | Public domain | C-5 (canonical spec) |
| `s1_c5_hexens_tstore_poison.html` | [Hexens TSTORE poison](https://hexens.io/research/solidity-compiler-bug-tstore-poison) | Public research (cite required) | C-5 (canonical bug analysis) |
| `s1_h3_arch_hn_approval.md` | [.../hard-negatives/approval-abuse-negatives.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/hard-negatives/approval-abuse-negatives.md) | NONE | H-3 (structure ref) |
| `s1_h3_arch_hn_callback.md` | [.../callback-grief-negatives.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/hard-negatives/callback-grief-negatives.md) | NONE | H-3 (structure ref) |
| `s1_h3_arch_hn_entitlement.md` | [.../entitlement-drift-negatives.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/hard-negatives/entitlement-drift-negatives.md) | NONE | H-3 (structure ref) |
| `s1_h3_arch_hn_rounding.md` | [.../rounding-entitlement-negatives.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/hard-negatives/rounding-entitlement-negatives.md) | NONE | H-3 (structure ref) |
| `s1_h3_arch_hn_semantic.md` | [.../semantic-drift-negatives.md](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/assets/hard-negatives/semantic-drift-negatives.md) | NONE | H-3 (structure ref) |
| `s1_h3_kz_cheatsheet.md` | [kadenzipfel CHEATSHEET.md](https://github.com/kadenzipfel/scv-scan/blob/1149855/references/CHEATSHEET.md) | NONE | H-3 (format ref) |
| `s1_h3_pashov_attack_vectors.md` | [pashov attack-vectors.md (110KB)](https://github.com/pashov/skills/blob/749903d/solidity-auditor/references/attack-vectors/attack-vectors.md) | MIT | H-3 (cross-ref knowledge) |
| `s1_qw_krait_detector.md` | [krait detector/instructions.md](https://github.com/ZealynxSecurity/krait/blob/2e98bb3/.claude/skills/krait/detector/instructions.md) | MIT | QW-4 (4-mindset) |
| `s1_qw_krait_methodology.md` | [krait METHODOLOGY.md](https://github.com/ZealynxSecurity/krait/blob/2e98bb3/METHODOLOGY.md) | MIT | QW-4 (methodology ref) |
| `s1_qw_hp_severity_bounty.md` | [hackenproof severity-to-bounty.md](https://github.com/hackenproof-public/skills/blob/2620058/plugins/hackenproof-handoff/skills/hackenproof-report-handoff/references/severity-to-bounty.md) | NONE | QW-5 |
| `s1_qw_gptscan_modifier_whitelist.json` | [GPTScan modifier_whitelist.json](https://github.com/GPTScan/GPTScan/blob/29a1747/src/modifier_whitelist.json) | AGPL-3.0 | QW-6 (fact reference) |
| `s1_qw_oz_marketplace.json` | [OZ marketplace.json](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/.claude-plugin/marketplace.json) | AGPL-3.0 (schema is functional) | QW-7 |
| `s1_qw_oz_plugin.json` | [OZ plugin.json](https://github.com/OpenZeppelin/openzeppelin-skills/blob/main/.claude-plugin/plugin.json) | AGPL-3.0 (schema is functional) | QW-7 |
| `s1_qw_tob_marketplace.json` | [TOB marketplace.json](https://github.com/trailofbits/skills/blob/a56045e/.claude-plugin/marketplace.json) | CC-BY-SA-4.0 (schema is functional) | QW-7 |

**Cleanup**: After Sprint 1 completes, delete `/tmp/argus-bom/`. Permalinks above are the durable references.

---

## Sprint 2 / 3 — to be detailed when those sprints begin

When Sprint 2 starts, build `06-porting-bom-sprint2.md` with the same structure for:
- **H-1** argus-prep (scoping-bee MIT, x-ray MIT, CDSec MIT — all freely portable)
- **H-2** argus_generate_poc (cholakovvv MIT — freely portable)
- **H-6** Aderyn integration (Aderyn is Apache-2.0 — compatible)
- **C-4** Proof-or-Demote (no external port — built on H-2)

Sprint 3 BOM later for:
- **H-8** cartography (grimoire MIT, Hound Apache-2.0 — compatible)
- **H-9** argus-kit (K.I.T MIT — freely portable)
- **H-11** argus-fix-verifier (hackenproof NO LICENSE — methodology-only)
- **M-3** per-protocol catalogs (33Audits NO LICENSE for CCA, Plamen MIT for general DeFi vectors)

---

## Open legal questions

1. **Should we open issues on the NO-LICENSE repos** (Archethect, kadenzipfel, The-Judge, hackenproof) asking them to add an explicit license? It would help us port more verbatim. Low-effort outreach.
2. **Are we OK with Apache-2.0 NOTICE-bundle requirement** if we incorporate Hound's KG patterns in Sprint 3? Apache 2.0 requires shipping their NOTICE file in distributions.
3. **CC-BY-SA TOB skills as companion plugin** — confirm our current architecture (separate cache dir, separate sync command, distinct trust tier) is the correct legal model. I believe it is — we never bundle CC-BY-SA into our MIT package — but worth a final check with whoever owns the legal posture.
4. **Attribution language**: "Inspired by X (NO LICENSE — methodology only)" — is that the right phrasing to avoid implying derivation? Suggested alternative: "Conceptually similar to X."

---

## Implementation gate

Before any Sprint 1 porting work starts:
- [ ] `CREDITS.md` published (uses template above; commit it FIRST)
- [ ] Decision logged on Option A vs B for C-3 (recommend Option A — Archethect DA+Skeptic+Judge methodology)
- [ ] Legal questions (above) answered or explicitly deferred
- [ ] This BOM doc is the authoritative reference for the sprint

Status: BOM complete. Ready to start C-2 + C-3 + C-5 + H-3 implementation with proper attribution + license-safe references.
