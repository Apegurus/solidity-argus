# Next-Sprint Plan — Foundation + Visible Wins

> Generated: 2026-05-18 (post-decisions)
> Prerequisite: C-1 (specialized hunt agents) released — currently on staging.
> Sprint: 1 (foundation + visible knowledge updates). ~3 weeks.

---

## Decisions made (locked in)

| Question | Decision |
|---|---|
| **Phase ordering** | Stream A (validation) + Stream B (knowledge) in parallel |
| **Eval benchmarks** | EVMBench + Code4rena 5 recent + pashov's DODO/megapot/pooltogether |
| **Claude Code distribution** | Markdown-only `.claude-plugin/` package |
| **Bug-bounty mode** | Multi-audience with `argus_mode` flag (audit/bounty/dev) |
| **Self-improvement loop** | Yes, human-in-loop (LLM drafts SKILL.md → human reviews/merges) |
| **Per-protocol catalogs** | Final 10: UniV3, UniV4, Aave V3, Curve, Morpho, Lido, EigenLayer, Pendle, GMX, Balancer |

Other locked-in decisions from the walk-through (not asked but recommended + assumed accepted):
- **SolidityGuard license care**: Use their 104-pattern *taxonomy* as a checklist; recreate from primary sources (EIP specs, Hexens TSTORE research, Solodit, public audit reports). No code copy.
- **Credit upstream patterns**: Add `CREDITS.md` at repo root crediting pashov, Archethect, kadenzipfel, Trail of Bits skills.
- **`argus-prep` pre-audit**: Separate skill, not a flag on the audit skill.
- **Fix verifier**: Completeness + regression first; defer proof-of-no-exploit regeneration until H-2 ships.
- **Known-findings**: Two layers — public corpus (Solodit + 6 audit firms) + per-project `customKnownIssuesDir`.
- **MCP server packaging**: Defer to Phase 4.

If any of the above are wrong, flag now — they shape Sprint 1 scope.

---

## Sprint 1 goals (3 weeks)

Goal: ship two parallel streams that together prove C-1's value AND add visible knowledge surface area.

**Stream A — Validation Pressure Relief (foundation)**
- Build eval harness ([C-2])
- Upgrade themis to DA + Skeptic + Judge pattern ([C-3])
- Outcome: Can answer "did C-1 actually improve precision/recall?" with numbers.

**Stream B — Visible Knowledge Updates (surface area)**
- Add 2025+ vulnerability patterns ([C-5])
- Add hard-negatives catalogue + cheatsheet ([H-3])
- Outcome: Public-facing improvements that pair well with the C-1 release announcement.

**Side stream — Quick wins (1-day fillers, picked up whenever a primary task blocks)**
- TOB skills resync
- `.claude-plugin/marketplace.json` stub
- `CREDITS.md` at repo root
- 4-mindset prompt addition to specialist hunt agents
- `severity-to-bounty.md` rubric

---

## Week-by-week breakdown

### Week 1 — Scaffolding

**Stream A**:
- [ ] **`evals/` directory structure** — `evals/{runner,compare,benchmarks,results}/`
- [ ] **`evals/runner.ts`** — clones target repo, runs argus, captures `final-report.md` + raw findings. Model after [pashov's evals/runner.md](https://github.com/pashov/skills/blob/main/solidity-auditor/evals/runner.md).
- [ ] **`evals/compare.ts`** — semantic matching: parse ground truth, parse report Findings + Leads, classify FOUND / LEAD / MISSED. Model after [pashov's evals/compare.md](https://github.com/pashov/skills/blob/main/solidity-auditor/evals/compare.md).
- [ ] **First benchmark ingested**: pashov's DODO + megapot + pooltogether (smallest, easiest, validates harness end-to-end).
- [ ] **First baseline run** — current argus (with C-1) vs pashov's 3 protocols. Record numbers.

**Stream B**:
- [ ] **`skills/CHEATSHEET.md`** — single condensed file. For each of our 51 patterns: name + 1-paragraph + grep-able keywords + link to full file. Mechanical aggregation. (~1 day)
- [ ] **First 5 of the 2025+ patterns** — pick the highest-impact:
  1. `tstore-slot-collision` (EIP-1153)
  2. `tstore-reentrancy-bypass-low-gas` (EIP-1153)
  3. `eip7702-tx-origin-broken` (Pectra)
  4. `eip7702-malicious-delegation` (Pectra)
  5. `eip7702-cross-chain-auth-replay` (Pectra)
- [ ] **TSTORE poison reference** — port [Hexens TSTORE compiler bug](https://hexens.io/research/solidity-compiler-bug-tstore-poison) into our outdated-compiler-version skill.

**Quick wins (any blocker time)**:
- [ ] TOB skills resync (picks up `fp-check`, `dimensional-analysis`, `supply-chain-risk-auditor`).
- [ ] `CREDITS.md` at repo root.

**Week 1 deliverable**: Eval harness runs end-to-end. Baseline number recorded (probably ugly — that's fine, we now have ground truth).

---

### Week 2 — Validation upgrade + knowledge push

**Stream A**:
- [ ] **C-3 themis pipeline rewrite** — port The-Judge's 6-step pipeline or Archethect's DA+Skeptic+Judge (pick one — I lean Archethect because it's already in the codebase as inspiration, and pashov skills credit Plamen for DA).
  - Phase A: DA 6-dimension scoring on every finding ([Archethect/sc-auditor#attack.md](https://github.com/Archethect/sc-auditor/blob/main/skills/security-auditor/assets/prompts/attack.md))
  - Phase B: Skeptic with inversion mandate ([skeptic.md](https://github.com/Archethect/sc-auditor/blob/main/skills/security-auditor/assets/prompts/skeptic.md)) — fresh independent analysis, can RESURRECT invalidated findings or NEGATE sustained ones
  - Phase C: Judge with "prove it or lose it" ([judge.md](https://github.com/Archethect/sc-auditor/blob/main/skills/security-auditor/assets/prompts/judge.md))
- [ ] **Strict JSON output schemas** for Skeptic + Judge (enables CI assertion + scribe integration).
- [ ] **Run benchmark #2**: EVMBench setup — clone repos, capture ground truth.

**Stream B**:
- [ ] **Remaining 5 of the 2025+ patterns**:
  6. `eip7702-extcodesize-unreliable`
  7. `tstore-delegatecall-exposure`
  8. `tstore-type-safety-bypass`
  9. `erc4337-paymaster-validation-abuse`
  10. `erc4337-validation-phase-state-mutation`
- [ ] **`skills/hard-negatives/` directory** — port Archethect's 5 files, adapt to our format:
  - `approval-abuse-negatives.md`
  - `callback-grief-negatives.md`
  - `entitlement-drift-negatives.md`
  - `rounding-entitlement-negatives.md`
  - `semantic-drift-negatives.md`

**Quick wins**:
- [ ] **`.claude-plugin/marketplace.json` + `plugin.json`** — minimal manifest. Markdown-only, no tools yet. Lets us appear in pashov/ai-web3-security catalog as a Claude Code skill.
- [ ] **4-mindset addition to hunt agents** — append Attacker / Accountant / Spec Auditor / Edge Case Hunter to each specialist agent's prompt. Pure prompt engineering. [Source — krait](https://github.com/ZealynxSecurity/krait/blob/main/.claude/skills/krait/detector/instructions.md).

**Week 2 deliverable**: themis is adversarial. All 10 2025+ patterns landed. Hard-negatives folder in place. EVMBench setup ready.

---

### Week 3 — Measurement + integration + release

**Stream A**:
- [ ] **EVMBench full run** — measure post-C-3 argus against 120-vuln ground truth. Publishable number IF good (Claude Opus 4.6 baseline is 45.6%, SolidityGuard claims 100%).
- [ ] **Code4rena 5 recent contests** — pick 5 from last 6 months, run, measure precision + recall (krait's published numbers: 100% precision, 15.2% recall).
- [ ] **Eval results to `evals/results/`** with run metadata (date, commit, model, prompt version).
- [ ] **Compare pre-C-3 vs post-C-3** on the same pashov-3 baseline from Week 1 — prove the upgrade helped.

**Stream B**:
- [ ] **Integrate cheatsheet** — sentinel/specialist hunt agents load `CHEATSHEET.md` at session start (replacement for the older INVENTORY.md ambient awareness).
- [ ] **Integrate hard-negatives** — themis Skeptic + DA reference `skills/hard-negatives/` before flagging.
- [ ] **Pattern coverage check** — verify all 10 new 2025+ patterns are picked up by `argus_check_patterns` regex/AST scanner.

**Quick wins**:
- [ ] **`severity-to-bounty.md`** rubric in severity-classification skill.
- [ ] **Modifier whitelist JSON** for trusted modifiers (FP reduction).

**Release v2.5**: Specialized hunt agents (C-1, from prior release) + eval harness (C-2) + adversarial themis (C-3) + 10 2025+ patterns (C-5) + hard-negatives + cheatsheet (H-3) + 5 quick wins.

**Release announcement should claim**:
- N specialized hunt agents
- M% recall against EVMBench (TBD by run)
- 60+ vulnerability patterns including EIP-1153 / EIP-7702 / ERC-4337 coverage
- Self-eval against pashov + EVMBench + Code4rena benchmarks
- Available on OpenCode + Claude Code (markdown skills)

---

## Sprint 2 preview (3 weeks after Sprint 1)

If Sprint 1 lands, Sprint 2 focuses on **new capabilities**:

- **H-1** `argus-prep` pre-audit scoping skill (separate skill — scoping-bee + x-ray + CDSec audit-prep merged)
- **H-2** `argus_generate_poc` tool (mainnet-fork Foundry PoC scaffolder)
- **H-6** Aderyn integration (Slither companion)
- **H-7** Already done in Sprint 1 (`.claude-plugin/` stub) — Sprint 2 extends with scripts if demand exists
- **C-4** Proof-or-Demote (cleanly enforceable now that H-2 ships)
- **`argus_mode` flag (audit/bounty/dev)** — depends on H-2 for bounty mode usefulness

## Sprint 3 preview

- **H-8** Cartography skill (`.argus/cartography/`)
- **H-9** `argus-kit` known-findings dedup (with two-layer architecture: public + private)
- **H-11** `argus-fix-verifier` companion (completeness + regression first)
- **M-3** Per-protocol catalog skills — start with UniV3 + Aave V3 + Curve as templates, then UniV4 / Morpho / Lido / EigenLayer / Pendle / GMX / Balancer
- **H-6** Echidna + Medusa + Halmos (depends on stable H-2)

---

## Critical-path dependencies

```
C-1 [SHIPPED]
    │
    ├──> C-2 (evals harness)──┐
    │                          ├──> C-3 (themis DA+Skeptic) — measurable
    │                          └──> Release v2.5 measurement
    │
    └──> C-5 + H-3 (knowledge) ──> Release v2.5 surface area

Sprint 2:
H-2 (PoC scaffolder)──┬──> C-4 (Proof-or-Demote enforceable)
                       └──> `argus_mode = bounty` (PoC-driven)

H-1 (argus-prep) ── independent ── ship anytime

Sprint 3:
H-9 (known-findings) ──> Self-improvement loop (human-in-loop)
H-11 (fix-verifier) ──> requires H-2 for proof-regen step
```

---

## Risks

| Risk | Mitigation |
|---|---|
| **EVMBench result is poor on first run** | Don't publish until Sprint 2 — fix prompt + agent issues first. Internal-only measurement Sprint 1. |
| **C-3 themis rewrite breaks scribe pipeline** | Strict JSON schema validation + backward-compat shim during transition. Test on pashov-3 set BEFORE rolling to scribe. |
| **2025+ pattern false positives flood** | Hard-negatives folder added same sprint (Week 2) reduces this. Verify all 10 patterns against safe-pattern test corpus before release. |
| **Cheatsheet duplicates pattern files (drift)** | Auto-generate cheatsheet from pattern frontmatter via script — single source of truth. Ship the generator in Week 1. |
| **Claude Code skill distribution misfires (manifest format change)** | Test against actual Claude Code install before announcing. Use Trail of Bits skills as the reference (5,270⭐ proven). |
| **Stream A blocks Stream B (or vice versa)** | They're independent by design. The 4-mindset prompt addition is the only place they touch (Stream B knowledge → Stream A measurement). |

---

## Quick-wins menu (pull anytime when blocked)

Tagged with rough effort:

| Win | Effort | Source |
|---|---|---|
| TOB skills resync | 30 min | B3 |
| `CREDITS.md` at repo root | 30 min | B2 |
| `skills/CHEATSHEET.md` autogen script | 4 hours | kadenzipfel (B1) |
| `severity-to-bounty.md` rubric | 2 hours | hackenproof (B3) |
| `.claude-plugin/marketplace.json` stub | 1 hour | OZ + Archethect (B1) |
| 4-mindset prompt addition | 2 hours | krait (B2) |
| Modifier whitelist JSON | 4 hours | GPTScan (B2) |
| Empirical-derivation tag (`source_finding:` frontmatter) | 4 hours | drozer-lite (B3) |
| `meme-coin-audit` SKILL.md stub | 3 hours | shuvonsec (B3) |
| GitHub Actions workflow templates (3 variants) | 3 hours | weasel (B2) |

Total quick-wins: ~25 hours = ~3 days of fill-in work spread across the sprint.

---

## Success criteria (definition of done for Sprint 1)

- [ ] `bun evals/runner.ts pashov-3` runs end-to-end, produces `summary.md` with recall metric
- [ ] `bun evals/runner.ts evmbench` runs end-to-end on at least 5 of 40 audits
- [ ] themis emits structured JSON (DA + Skeptic + Judge schemas)
- [ ] Skeptic can RESURRECT an invalidated finding with code-cited proof (test case)
- [ ] All 10 new 2025+ pattern SKILL.md files exist + pass `argus_check_patterns`
- [ ] `skills/CHEATSHEET.md` auto-generates from pattern frontmatter
- [ ] `skills/hard-negatives/` contains 5 files + is referenced by themis prompt
- [ ] `.claude-plugin/marketplace.json` + `plugin.json` allow Claude Code install
- [ ] `CREDITS.md` published at repo root
- [ ] Pre-C-3 vs post-C-3 measurement on pashov-3 set shows improvement (or documents why it didn't)
- [ ] Release notes for v2.5 published

---

## Open follow-ups for later sprints

These weren't decided but will need to be when the work comes up:

1. **Sprint 2: `argus_mode` flag default** — likely `audit` to match current behavior. But if bug-bounty market traction is strong, might flip to opt-in `audit` mode (let `auto` detect).
2. **Sprint 3: Self-improvement workflow ergonomics** — what's the UX for "auditor reviews LLM-generated SKILL.md draft"? PR-based? In-CLI prompt? TUI review?
3. **Public benchmark publishing trigger** — at what point are our numbers good enough to publish in README? Suggest: when we beat Claude Opus baseline (45.6% on EVMBench) AND have at least 60% precision on Code4rena 5 contests. Pin the bar publicly.
4. **Per-project private known-issues UX** — for H-9, how does a user point us at their private audit archive? `argus init --knownIssuesDir <path>`? Per-session config? Sealed knowledge tier?

---

Status: Sprint 1 plan locked. Ready to execute on C-1 release.
