# Findings Rubric & Self-Update — Design Spec

**Date:** 2026-05-16
**Status:** Draft — awaiting user review
**Workstreams covered:** A (Findings quality & scoring) + D (Self-update check)
**Path selected:** Path 2 (Skill + prompt enforcement + soft numeric confidence)
**Bundled-but-deferred:** Items B (codebase hygiene — slim `create-hooks.ts`, drop dual config), C (fast mode), and the proposed "safe-patterns allowlist" (item #4 from the original recommendations).

---

## 1. Goal

Borrow Pashov Audit Group's [4-gate refutation rubric](https://github.com/pashov/skills/blob/main/solidity-auditor/references/judging.md) and add a soft numeric confidence score to argus's finding pipeline — without changing the agent topology, without breaking schema compatibility, and without expanding any agent's privilege surface. Also add a remote VERSION check to `argus doctor` so users find out when they're running stale.

The discipline-enforcing power of the rubric comes from the *reasoning trace it forces*, not from elaborate machinery. Path 2 captures ~80% of pashov's false-positive defense at ~7% of the blast radius of a full Themis-rejudge / cross-contract-echo / schema-migration design.

## 2. Non-goals

Explicit. These are NOT in this spec; they may become future specs.

- **No Themis role change.** Themis stays read-only, stays a pipeline-integrity validator. No `argus_record_finding` write privilege, no `argus_check_patterns` access.
- **No cross-contract echo detection.** Pashov's "same root cause confirmed in contract A → flag in contract B" requires either a new Themis capability or a new agent. Deferred. Will revisit if path-2 audits show recurring-pattern miss rate is material.
- **No schema version bump.** The only new field is `confidence?: number` — additive optional. `SCHEMA_VERSION` stays at `2.0.0`.
- **No rename of the existing `confidence` field.** Existing `"High" | "Medium" | "Low"` enum stays. Naming collision is acknowledged and lived with for now — the new numeric field uses a different name (see §5.3).
- **No verdict field on findings.** Verdict (CONFIRMED / DEMOTE / REJECTED) lives in the rubric trace inside `description`, not as a structured field. REJECTED findings are dropped by the source agent and never recorded.
- **No new tools.** Tool surface is unchanged (still 14 core + 1 optional Solodit).
- **No "safe-patterns" allowlist** (was item #4 in the original recs). Deferred behind a data-gathering step — run argus over a known-good corpus, tag false positives, cluster them, and only then decide whether suppression at the detection-rule level or at a downstream allowlist is the right shape. Pending until we have FP data.
- **No Leads collection in state.** Leads are a *rendering* concept (findings below the confidence threshold), not a *storage* concept. One `findings[]` array, split at render time.

## 3. Background

### What pashov has and we lack

Pashov's solidity-auditor skill is ~6 markdown files with zero runtime code. The discipline comes from three documents:

1. [`judging.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/references/judging.md) — 4-gate validation (Refutation → Reachability → Trigger → Impact) with explicit verdicts (CONFIRMED / DEMOTE / REJECTED) and confidence deductions (`-20` for partial path, `-15` for bounded impact, `-10` for state-dependent).
2. [`report-formatting.md`](https://github.com/pashov/skills/blob/main/solidity-auditor/references/report-formatting.md) — confidence-sorted findings, `## Leads` section for below-threshold trails, threshold default ~75-80.
3. The orchestrator [`SKILL.md`](https://github.com/pashov/skills/blob/master/solidity-auditor/SKILL.md) — fans out 4 parallel agents, each with the full codebase and one attack-vector lens.

We have the static-analysis / dynamic-testing / Solodit / SCVD / 5-agent / persistent-state machinery pashov lacks. What we *don't* have is the explicit refutation discipline at the finding-emission layer. Our agents are free to report a finding without quoting the guard that does or doesn't kill the attack. That's the gap this spec closes.

### Why Path 2 specifically

Five-path comparison was performed during brainstorming (see Decision Log §10). Path 2 was chosen because:

1. Most of the discipline value comes from the rubric *being applied during reasoning*, not from elaborate schema/tooling around it. A skill loaded into Sentinel/Pythia prompts achieves the application without restructuring.
2. The numeric confidence field is additive and reversible. If it proves unused or noisy after a few audit runs, removing it is a 3-file revert.
3. Path 2 is the largest step we can take while still keeping `SCHEMA_VERSION` at 2.0.0. Anything more requires migration tooling.
4. Path 2 does not touch the Themis privilege model or the agent pipeline topology, both of which deserve their own dedicated spec if/when changed.
5. Path 2 composes cleanly with future workstreams B (codebase hygiene) and C (fast mode) — no merge conflicts on shared surface.

## 4. Architecture (unchanged)

```
Sentinel/Pythia raise findings (NEW: with rubric trace + optional confidence)
  → Scribe.persist_deduped
  → Scribe.generate_report (NEW: sort by confidence when present, split Leads tier)
  → Themis pipeline-integrity check (unchanged)
```

No new pipeline stage. No new agent. No new tool. The only behavioral change is what flows *through* the existing pipes.

## 5. Design

### 5.1 The refutation rubric (new skill)

A new skill `skills/methodology/refutation-rubric/SKILL.md` ports Pashov's `judging.md` nearly verbatim. Adaptations:

- Section headings retitled to argus's style.
- References to "agents 1-4" replaced with references to "any source agent (Sentinel, Pythia)."
- The "Lead promotion" section (pashov's cross-contract echo, multi-agent convergence, partial-path completion) is **kept** but reframed as guidance for individual source agents rather than as a multi-agent merge step. Cross-contract echo specifically is reframed as: "if you find a pattern in one contract, scan the in-scope set for the same pattern in other contracts before moving on." It becomes an agent's discipline, not a pipeline phase.
- A new "Confidence Scoring" subsection makes explicit that confidence is an integer 0-100 to be passed to `argus_record_finding` as the optional `confidence` field, with the deduction rules from pashov.
- A "Rubric Trace Format" subsection documents the markdown prefix format (see §5.4).

The skill carries `category: methodology` and no `pattern_category` — it's a procedure, not a detector. It gets discovered by [`argus-skill-resolver.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/skills/argus-skill-resolver.ts) like every other bundled skill.

[`skills/methodology/audit-workflow/SKILL.md`](file:///Users/ignacioblitzer/.cache/opencode/packages/solidity-argus@latest/node_modules/solidity-argus/skills/methodology/audit-workflow/SKILL.md) is updated to cross-reference the rubric in its "Manual Review" and "Vulnerability Research" phase descriptions.

### 5.2 Agent prompt updates

[`src/agents/sentinel-prompt.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/agents/sentinel-prompt.ts) and [`src/agents/pythia-prompt.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/agents/pythia-prompt.ts) gain identical-shaped instructions (substance differs per agent's domain):

1. On audit start: `argus_skill_load("refutation-rubric")` to surface the rubric content in the agent's working context.
2. Before any `argus_record_finding` call:
   - Walk all 4 gates explicitly in reasoning.
   - If any gate returns REJECTED → do not call `record_finding`. Drop the candidate.
   - If gates return DEMOTE or CONFIRMED → record the finding with:
     - A rubric trace prefix in `description` (exact format in §5.4).
     - An integer `confidence` (0-100) computed per the rubric's deduction rules.
3. Severity bucket (existing `severity` field) continues to be set as today.
4. Existing `confidence` enum (`"High" | "Medium" | "Low"`) continues to be set as today — it represents evidence quality, not the new numeric confidence.

No changes to Scribe, Argus (orchestrator), or Themis prompts. Argus does not need to know the rubric exists; it's transparent at the orchestration layer.

### 5.3 Schema delta

A single new optional field on the `Finding` type. No version bump.

```ts
// src/state/types.ts — addition only
type Finding = {
  // ... all existing fields unchanged ...
  confidence?: number  // NEW. Optional. 0-100 integer. 0 = pure speculation, 100 = mathematically certain.
                       // Naming collision with existing string-enum `confidence` is acknowledged.
                       // The new field is on Finding; the existing string-enum field is also named
                       // `confidence` because that's what the current schema validates. We accept the
                       // collision because the new field is the numeric one auditors expect, and a
                       // rename has high blast radius (see Non-goals §2).
}
```

> **Schema collision note:** the existing `confidence` field in [`schemas.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/state/schemas.ts:226-236) is typed as `"High" | "Medium" | "Low"`. The new numeric field cannot share that name. The implementation plan must choose ONE of:
> - **(P1)** Name the new field `confidence_score: number`, leave existing `confidence` enum untouched. Verbose but zero-collision.
> - **(P2)** Name the new field `confidence: number`, rename the existing field to `evidence_quality` everywhere — but that's the rename we deferred above.
>
> **Recommendation for the plan:** P1 (`confidence_score`). It avoids any rename and matches our Non-goal §2.
>
> Throughout this spec, references to "the new numeric confidence field" should be read as `confidence_score: number` once the plan is written.

Validation in [`schemas.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/state/schemas.ts) `validateCanonicalFinding`:

```ts
if (raw.confidence_score != null) {
  if (
    typeof raw.confidence_score !== "number" ||
    !Number.isInteger(raw.confidence_score) ||
    raw.confidence_score < 0 ||
    raw.confidence_score > 100
  ) {
    errors.push({
      field: "confidence_score",
      code: "invalid",
      message: "confidence_score must be an integer 0-100 when provided",
    })
  }
}
```

`SCHEMA_VERSION` stays `"2.0.0"`. No migration. Old findings without the field continue to validate.

### 5.4 Rubric trace format

The rubric trace lives as a markdown prefix in the existing `description` field. Standard format:

```markdown
**Rubric Trace** · Confidence: 85

- Refutation: cleared — searched for guards on the call path; `nonReentrant` on parent does not extend to the internal `_distribute` call.
- Reachability: cleared — any unprivileged caller can reach the vulnerable state via `claim()`.
- Trigger: cleared — no access control on the entry point; profitable for the caller because gas < extracted value.
- Impact: confirmed — drains the entire reward pool to the attacker.

**Refutation quote:** `function claim() external nonReentrant { _accrue(msg.sender); _distribute(msg.sender); }` — the `nonReentrant` modifier is on `claim`, but `_distribute` re-enters via the reward token's callback.

---

<the actual finding description starts here, unchanged from today's free-form prose>
```

Rationale for putting it in `description`:

- No schema field needed. Zero migration cost.
- Renders naturally in the markdown report (`description` is already rendered as markdown).
- If an agent omits the trace, the finding still validates and still renders — graceful degradation.
- Auditors reading the report see the trace inline with the finding, not in an appendix.

Rationale against a structured `rubric: {...}` field:

- Forces a schema bump.
- Forces every consumer (renderer, archive viewer, future Themis re-judge) to update.
- Forces a tool input schema change.
- Doesn't actually improve UX — the rendered output is identical.

If we ever want to programmatically query "which findings cleared all 4 gates?", the trace can be parsed out of `description` with a simple regex on the heading. Cheaper than committing to schema today.

### 5.5 Renderer behavior — `report-generator-tool.ts`

Decision: **per-finding tier assignment** (Option (b) from brainstorming Q4 revisit).

Rules:

1. Findings with `confidence_score >= threshold` → render in `## Findings`.
2. Findings with `confidence_score < threshold` → render in `## Leads`.
3. Findings with **no** `confidence_score` (unscored) → render in `## Findings` (treated as opt-out of the new scoring discipline, NOT as low-confidence).
4. Default `threshold = 80`. Configurable via `reporting.confidenceThreshold` in [`config/schema.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/config/schema.ts).

Sort order within each section:

1. Primary: `confidence_score` desc (findings with scores ahead of unscored).
2. Secondary: `severity` desc (Critical → High → Medium → Low → Informational).
3. Tertiary: `file` asc, then `lines[0]` asc.

Finding header format (per finding, regardless of section):

```markdown
### [82] <Title> · `ContractName.functionName` · severity: High · evidence: Medium
```

Where `[82]` is `confidence_score` if present, omitted otherwise. The bracketed prefix matches pashov's convention.

Leads section gets a brief explanatory subheading:

```markdown
## Leads

_High-signal trails below the confidence threshold ({threshold}). Not finalized findings; suitable for manual review._
```

`Leads` findings render `description` (which includes their rubric trace) but the renderer omits any `Fix` block they may have. Practical effect: a Lead is "here's what we saw and why we couldn't fully prove it" without proposing a fix.

Empty sections (no findings above or below threshold) are omitted entirely — no `## Leads` heading if there are no leads.

### 5.6 Workstream D — VERSION self-update check

Added to [`src/cli/commands/doctor.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/cli/commands/doctor.ts) as a new check, alongside the existing Slither/Foundry/SCVD checks.

**Behavior:**

1. Read installed version from `package.json` (already loaded by the plugin).
2. `fetch("https://registry.npmjs.org/solidity-argus/latest")` with a 3-second timeout.
3. Parse JSON, extract `.version` field.
4. Compare to installed version using a simple semver-string comparison (or `Bun.semver` if available — implementation detail for the plan).
5. **If equal or installed is newer:** print `✓ argus is up to date (v{x})`.
6. **If installed is older:** print `⚠️ argus v{installed} installed — latest is v{remote}. Upgrade: \`bun add solidity-argus@latest\``.
7. **On any error (offline, timeout, non-2xx, JSON parse fail):** print `· version check skipped (network unavailable)` — informational, not a failure of the doctor check. Doctor's overall exit code is not affected.

**No caching for v1.** Doctor is manual, run rarely, and the npm registry is fast. If users complain about doctor being slow, add a 24h cache file later.

**No check on session start.** Adds latency to first agent invocation, requires a network call from inside the plugin's hook system, and is the kind of phone-home behavior users dislike. Manual-only is the right default.

## 6. Files touched

| File | Type | Change summary |
|---|---|---|
| `skills/methodology/refutation-rubric/SKILL.md` | new | Ported from pashov's judging.md, adapted for argus. |
| [`skills/methodology/audit-workflow/SKILL.md`](file:///Users/ignacioblitzer/.cache/opencode/packages/solidity-argus@latest/node_modules/solidity-argus/skills/methodology/audit-workflow/SKILL.md) | edit | Cross-reference the new rubric in Manual Review and Vulnerability Research phases. |
| [`src/agents/sentinel-prompt.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/agents/sentinel-prompt.ts) | edit | Instruct rubric load + 4-gate walk + trace prefix + `confidence_score` population. |
| [`src/agents/pythia-prompt.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/agents/pythia-prompt.ts) | edit | Same as Sentinel, adapted to research-driven finding flow. |
| [`src/state/types.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/state/types.ts) | edit | Add `confidence_score?: number` to `Finding`. |
| [`src/state/schemas.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/state/schemas.ts) | edit | Add optional integer-0-100 validation for `confidence_score`. `SCHEMA_VERSION` unchanged. |
| [`src/tools/record-finding-tool.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/tools/record-finding-tool.ts) | edit | Input schema accepts optional `confidence_score`. |
| [`src/tools/report-generator-tool.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/tools/report-generator-tool.ts) | edit | Per-finding tier split, new sort order, new header format, Leads section. |
| [`src/cli/commands/doctor.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/cli/commands/doctor.ts) | edit | Add VERSION self-update check. |
| [`src/config/schema.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/config/schema.ts) | edit | Add optional `reporting.confidenceThreshold: number` (default 80). |
| [`src/constants/defaults.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/constants/defaults.ts) | edit | Default `reporting.confidenceThreshold = 80`. |

**Untouched (deliberately):** `finding-fingerprint.ts`, `finding-store.ts`, `finding-aggregation.ts`, `validation-constants.ts`, `themis-prompt.ts`, `scribe-prompt.ts`, `argus-prompt.ts`, `AGENTS.md`, `persist-deduped-tool.ts`, all `create-*` factories, all other tool implementations.

Total: **8 edits + 1 new file**. Most edits are <50 LOC each. The substantial change is [`report-generator-tool.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/tools/report-generator-tool.ts) (renderer rewrite for sectioning + sorting) — likely 100-200 LOC delta.

## 7. Testing approach

### Skill content
- The new `refutation-rubric` skill is markdown; tested via `argus lint-skills` (existing CLI command) for frontmatter validity.
- Manual review by user that the port matches pashov's judging.md intent.

### Schema
- Unit tests for `validateCanonicalFinding` with `confidence_score`:
  - Valid: omitted (backward compat), `0`, `50`, `100`.
  - Invalid: `-1`, `101`, `50.5`, `"50"`, `null`.
- Fixture: a v2.0.0 finding without `confidence_score` validates successfully (backward compat).

### Renderer
- Golden-file tests for `report-generator-tool.ts`:
  - All findings scored, mix of above/below threshold → produces `## Findings` and `## Leads`.
  - All findings unscored → produces only `## Findings`, no Leads section.
  - Mix scored/unscored → unscored renders in `## Findings`, scored splits by threshold.
  - Threshold configured to 50 vs 80 → boundary findings move between sections.
  - Sort verification: confidence-desc primary, severity-desc secondary, file-asc tertiary.

### VERSION check
- Mock fetch returning newer version → warning printed.
- Mock fetch returning equal version → success printed.
- Mock fetch timing out → silent skip printed (no error, no non-zero exit).
- Mock fetch returning malformed JSON → silent skip.

### Integration
- One end-to-end audit run on `tests/fixtures/vulnerable-vault/` (existing fixture) verifying:
  - Findings emit with rubric traces in their description.
  - At least one finding has `confidence_score` populated.
  - Report renders with both sections if any finding scores below threshold.
  - `argus doctor` reports `argus is up to date` (matching installed version against a mocked registry response).

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Agents ignore the rubric load instruction (don't actually use it during reasoning). | Medium | Prompt explicitly says "include the rubric trace prefix in description — without it the finding will be considered un-validated." Renderer can show a `⚠️ no rubric trace` annotation on findings missing the prefix (parsed from description) — turns silent skip into visible drift. |
| Agents fabricate rubric traces (cargo-cult template fills without actually walking gates). | High (always a risk with LLM-driven discipline) | Refutation quote requirement is the anti-fabrication anchor — must quote actual code from the file. If the quote is fabricated, the finding is wrong on a check the report renders. Auditors catch this on review. |
| `confidence_score` distributions are bimodal at 75/95 (LLMs gravitate to round numbers). | High | Acceptable for v1. If problematic, future iteration could mandate the deduction calculation be shown in the trace ("100 - 20 partial path - 15 bounded impact = 65"). |
| Renderer rewrite breaks existing report consumers (CI scripts, downstream tooling). | Low (no known consumers outside the plugin itself) | Verify no internal callers depend on the current section structure. Existing report assertion files (e.g. `opus-h-production-readiness-assessment.md` etc.) are output samples, not input contracts. |
| VERSION check causes doctor to fail or hang on restricted networks. | Medium | 3-second timeout. Silent skip on any error. Doctor exit code unaffected by the check. |
| Naming collision (`confidence` enum vs `confidence_score` number) confuses contributors. | Medium | Document in [`types.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/state/types.ts) inline. Update [`README.md`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/README.md) finding-schema description. Plan for eventual rename in a future spec once the new field is the canonical one. |

## 9. Open questions for the implementation plan

These are deferred to the plan-writing phase but called out so they're not forgotten:

1. **Exact rubric SKILL.md frontmatter `description` text:** must reliably trigger skill discovery (i.e. Sentinel/Pythia must actually find it when scanning available skills at audit start). Wording to be drafted in the plan and validated against the resolver. Other frontmatter is settled in §5.1 (`category: methodology`, no `pattern_category`).
2. **Pythia's rubric vs Sentinel's rubric:** are the gate prompts identical or domain-adapted? Sentinel reasons over Slither/Foundry output; Pythia reasons over Solodit/SCVD matches. Reachability/Trigger gates may need slightly different framing.
3. **Exact CLI output strings for the version check** — UX polish.
4. **Whether the report should include a small footer line like `Rubric: N/M findings include 4-gate trace`** to surface adoption rate visibly.
5. **Backward-compat behavior of [`argus_persist_deduped`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/tools/persist-deduped-tool.ts)** when receiving a mix of pre-spec and post-spec findings — does it pass `confidence_score` through unchanged (yes, expected) or do anything with it (no, it shouldn't).

## 10. Decision log

Decisions made during brainstorming (so reviewers can audit the reasoning chain):

| ID | Decision | Rationale |
|---|---|---|
| Scope | Cover Spec A (findings quality) + Spec D (VERSION check) in one spec. B and C are independent future workstreams. | A and D are small enough that bundling them avoids one extra round-trip without creating review complexity. |
| Location | `docs/superpowers/specs/` (option (i)). | Matches brainstorming skill default. Doesn't clash with existing `.sisyphus/plans/` (which is for plans, not specs). |
| Q1 | Hybrid scoring: keep severity bucket, add numeric confidence. | Backward-compat. Industry usage. Lets cross-LLM convergence rules express numerically. |
| Q2 | (Voided by Path 2.) Originally: source + Themis re-judge. | Path 2 removed Themis re-judge from scope. Source agents self-judge only. |
| Q3 | (Voided by Path 2.) Originally: conservative conflict resolution. | No conflict because no Themis re-judge. |
| Q4 | Single findings collection, renderer splits by threshold. | Simpler schema, simpler tools, simpler dedup. Leads are a rendering concept. |
| Path | Path 2 (Skill + prompt enforcement + soft numeric confidence). | After cost/value analysis: 60-70% of the discipline value at <10% of the blast radius vs Path 4. Defers schema/Themis/echo decisions until empirical evidence justifies them. |
| Renderer | Per-finding tier assignment. Unscored findings render in `## Findings` (opt-out of new discipline, not low-confidence). | Backward compatible. Expressive when agents opt in. Matches pashov's output shape when confidence is set. |
| Rubric trace | Markdown prefix in `description`. Not a structured field. | Zero schema cost. Graceful degradation. Visible inline in the rendered report. |
| Self-update check | Doctor-only, not session-start. | Avoids phone-home behavior. Avoids latency on first agent invocation. Doctor is the natural opt-in. |
| Field naming | New numeric field is `confidence_score` (per §5.3 P1). Existing string-enum `confidence` is unchanged. | Avoids rename. Lives with the verbose name to preserve backward compat. |

## 11. Future work (out of scope here, for visibility)

- **Spec B: Codebase hygiene** — split [`create-hooks.ts`](file:///Users/ignacioblitzer/Develop/defizoo/solidity-auditor/src/create-hooks.ts) (1144 LOC), drop the dual `.argus/` + `.opencode/` config fallback.
- **Spec C: Fast mode** — separate skill/entry point that bypasses Slither/Foundry for <5min triage flow, modeled on pashov's design.
- **Future iteration on this spec:** if `confidence_score` adoption is high and Themis-quality concerns surface in real audits, revisit a scoped Themis re-judge spec (Path 3).
- **Safe-patterns allowlist:** revisit after FP data is collected from path-2 audits, deciding between detection-rule tightening vs allowlist suppression.
- **Eventual `confidence` rename:** once `confidence_score` is the canonical field across the codebase, plan a major-version rename (`confidence` enum → `evidence_quality`, `confidence_score` → `confidence`) with proper migration.
