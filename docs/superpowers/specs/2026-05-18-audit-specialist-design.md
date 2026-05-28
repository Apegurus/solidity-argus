# Audit Specialist Agent & Attack-Vector Deck — Design Spec

**Date:** 2026-05-18
**Status:** Draft — awaiting user review
**Workstreams covered:** Attack-vector deck + specialist audit modes
**Path selected:** One profile-driven `audit-specialist` agent, explicit deep/adversarial mode first

---

## 1. Goal

Add an adversarial specialist review layer to Argus without creating a fleet of one-off agents. The new layer should combine Pythia's knowledge/research reach with Sentinel's code-analysis and verification tools, then run the same agent multiple times under different specialist profiles.

The design has two deliverables:

1. A bundled **attack-vector deck**: a compact, Pashov-style catalogue of concrete vulnerability vectors with detection cues and false-positive guards.
2. A new **`audit-specialist` subagent**: a broad-tooling auditor that Argus can dispatch with profiles such as `math-precision`, `invariant`, `access-control`, `economic-security`, `execution-trace`, `periphery`, `first-principles`, and `vector-scan`.

The intended outcome is higher manual-review coverage and fewer missed logic bugs, especially in code where neither pure static analysis nor pure vulnerability research is enough.

## 2. Non-goals

- **No seven-agent fleet.** We will not create separate registered agents for every specialist profile in the first version.
- **No prompt/permission templating framework.** The `audit-specialist` prompt can accept a profile block in the task prompt; we do not need dynamic OpenCode agent definitions.
- **No report schema migration.** Specialist findings use the existing finding pipeline and `argus_record_finding` shape.
- **No new security tools.** The first version reuses existing Argus tools.
- **No replacement of Sentinel or Pythia.** Sentinel remains the tactical executor for normal scanning/testing. Pythia remains the historical-research specialist. `audit-specialist` is an adversarial manual-review multiplier.
- **No always-on cost increase by default.** Specialist passes start behind explicit deep/adversarial mode or explicit Argus judgment, not every lightweight audit.

## 3. Background

Pashov's `solidity-auditor` skill is narrow but strong in two ways Argus can borrow:

1. It uses a dense attack-vector deck with `D:` detection cues and `FP:` false-positive rules.
2. It decomposes review by adversarial mindset: access control, economics, execution tracing, invariants, math precision, periphery, first principles, and vector scanning.

Argus already has the stronger runtime: Slither, Foundry, fuzzing, SCVD/Solodit, persistent findings, Scribe, and Themis. The missing piece is a clean way to run multiple specialist lenses over the same scope without overloading Sentinel or Pythia.

Earlier options considered:

- **Use Sentinel profiles only:** lowest implementation risk, but semantically overloaded; Sentinel is already responsible for tool execution and PoCs.
- **Use Pythia profiles only:** good for vector selection and research, but Pythia lacks the full verification/tooling surface.
- **Create many Pashov-style specialist agents:** clean but high maintenance and configuration surface.
- **Create one broad `audit-specialist` agent:** best balance of conceptual clarity and manageable integration cost.

## 4. Architecture

```text
Argus
  -> Sentinel: baseline static analysis, Forge tests, fuzzing, targeted PoCs
  -> Pythia: Solodit/SCVD/history and protocol precedent research
  -> Audit Specialist: profile-driven adversarial review passes
       - vector-scan
       - access-control
       - math-precision
       - invariant
       - economic-security
       - execution-trace
       - periphery
       - first-principles
  -> Scribe: dedupe and report
  -> Themis: independent validation
```

`audit-specialist` is a normal Argus-family subagent. It receives dynamic audit context like Sentinel/Pythia/Scribe/Themis, but its task prompt determines the active profile.

Example Argus delegation:

```text
Task(subagent_type="audit-specialist", prompt="Run specialist profile: math-precision. Scope: src/Vault.sol, src/Strategy.sol. Load relevant bundled skills. Return FINDING/LEAD blocks. Record only confirmed findings.")
```

## 5. Agent Design

### 5.1 Agent identity

New prompt file:

```text
src/agents/audit-specialist-prompt.ts
```

The prompt defines the agent as a profile-driven adversarial reviewer. It is not a reporter and not the final quality gate.

Responsibilities:

- Load relevant skills and attack-vector material.
- Inspect scoped Solidity code through the active profile.
- Use tools to verify concrete hypotheses where possible.
- Return structured `FINDING` and `LEAD` blocks.
- Call `argus_record_finding` only for confirmed findings.
- Leave unverified but plausible trails as `LEAD` text in its response, not persisted findings.

### 5.2 Tool permissions

`audit-specialist` needs a combined subset of Sentinel and Pythia permissions:

```text
argus_skill_load
argus_check_patterns
argus_solodit_search
argus_analyze_contract
argus_slither_analyze
argus_proxy_detection
argus_forge_test
argus_forge_fuzz
argus_forge_coverage
argus_gas_analysis
argus_record_finding
skill
```

It should not receive Scribe/Themis/reporting tools:

```text
argus_read_findings
argus_persist_deduped
argus_generate_report
argus_themis_disposition
argus_sync_knowledge
```

Rationale: the agent needs enough power to turn research into verified findings, but it must not write reports, validate its own output, or manage global knowledge sync.

### 5.3 Registration touchpoints

Expected implementation files:

- `src/agents/audit-specialist-prompt.ts` — new prompt.
- `src/hooks/config-handler.ts` — register `audit-specialist` as `mode: "subagent"`, add permissions, allow Argus to dispatch it.
- `src/config/schema.ts` — add optional `agents.auditSpecialist` or `agents["audit-specialist"]` config.
- `src/config/types.ts` — align inferred/declared config type if needed.
- `src/shared/agent-names.ts` — add to `ARGUS_SUBAGENTS` / `ARGUS_FAMILY`.
- `src/state/types.ts` and validation helpers — decide whether `reported_by_agent` remains the existing enum or expands to include `audit-specialist`.
- `AGENTS.md` and `README.md` — document the new agent.

Preferred config key: `auditSpecialist` in TypeScript config shape, mapped to OpenCode agent name `audit-specialist`. This avoids awkward quoted object keys in user config while preserving kebab-case agent naming.

## 6. Specialist Profiles

Profiles should be data/prompt content, not registered agents.

Recommended location:

```text
skills/specialist-profiles/<profile-name>/SKILL.md
```

Initial profiles:

| Profile | Purpose |
|---|---|
| `vector-scan` | Apply the attack-vector deck mechanically; classify vectors as skip/drop/investigate. |
| `access-control` | Map roles, modifiers, initialization, upgrade authority, and guard inconsistencies. |
| `math-precision` | Hunt rounding, scale mismatch, downcast, decimal, and arithmetic edge cases. |
| `invariant` | Extract conservation laws and state couplings, then find paths that violate them. |
| `economic-security` | Attack external dependencies, token behavior, incentives, oracle assumptions, and value flows. |
| `execution-trace` | Trace parameter divergence, stale reads, branch ordering, callbacks, and cross-transaction interleavings. |
| `periphery` | Focus on libraries, helpers, base contracts, adapters, encoders, and wrappers. |
| `first-principles` | Ignore named bug classes; extract assumptions line-by-line and violate them. |

Each profile skill should include:

- Objective.
- Attack surfaces.
- Required reading pattern.
- Recommended bundled skills to load.
- FINDING-specific proof fields.
- LEAD criteria.
- False-positive cautions.

The `audit-specialist` prompt should instruct the agent to load the relevant profile skill at task start.

## 7. Attack-Vector Deck

Recommended location:

```text
skills/references/attack-vector-deck/SKILL.md
```

Format:

```markdown
**1. Cross-Chain Message Spoofing**

- **D:** Receiver accepts cross-chain messages without verifying endpoint and registered peer.
- **FP:** Standard receiver validates both endpoint and origin peer; replay protection is present.

**2. Reward Rate Changed Without Settling Accumulator**

- **D:** Admin updates emission rate without settling accrued rewards first.
- **FP:** Rate-change path calls checkpoint/update before storing the new rate.
```

The deck is a reference skill, not a detection-rule source in v1. It should not automatically create regex findings. The specialist uses it as review input and must still prove reachability, missing guard, and impact before recording a finding.

Future extension: once vectors prove stable, selected entries may gain structured `detection_rules` or a purpose-built vector schema. That is intentionally deferred.

## 8. Output Contract

`audit-specialist` responses must separate confirmed findings from leads.

```text
FINDING | contract: Name | function: func | bug_class: kebab-tag | profile: math-precision | group_key: Name | func | bug-class
path: caller -> function -> state change -> impact
proof: concrete values, trace, or state sequence from the actual code
description: one sentence
fix: one-sentence suggestion

LEAD | contract: Name | function: func | bug_class: kebab-tag | profile: math-precision | group_key: Name | func | bug-class
code_smells: what looked suspicious
missing_proof: what still needs verification
description: one sentence explaining the trail
```

Rules:

- A `FINDING` must have a concrete proof.
- No proof means `LEAD`, not a persisted finding.
- Same root cause uses the same `group_key`.
- Different fixes require separate items.
- Confirmed `FINDING`s are recorded with `argus_record_finding`.
- `LEAD`s are returned to Argus but not persisted in v1.

## 9. Orchestration Behavior

### 9.1 Activation

Specialist passes should run only when:

- the user explicitly asks for deep/adversarial review;
- Argus detects a complex DeFi/proxy/cross-chain/governance scope;
- Themis reports likely missed findings and Argus chooses remediation;
- or a future config flag enables them for all full audits.

Default v1 behavior: explicit deep/adversarial mode first.

### 9.2 Profile selection

Argus should choose profiles by protocol shape:

- Any privileged roles/proxies/initializers: `access-control`.
- Asset/share vaults, staking, lending, rewards: `math-precision`, `invariant`, `economic-security`.
- Bridges, callbacks, queues, routers: `execution-trace`, `economic-security`.
- Heavy libraries/adapters/helpers: `periphery`.
- High-value or unfamiliar protocols: `first-principles` plus `vector-scan`.

Argus should not always run all profiles. A focused 2-4 profile set is the intended default for deep mode.

### 9.3 Parallelism

Profiles are independent and can run in parallel up to the configured `background.max_concurrent` limit. If profile tasks write findings through `argus_record_finding`, existing dedupe/fingerprint logic remains responsible for merging overlaps.

## 10. Reporting and Validation

No new report section is required in v1.

Scribe should naturally aggregate confirmed findings recorded by `audit-specialist`. Deduped findings should preserve `reported_by_agents` including `audit-specialist` when available.

Themis should be updated to know that `audit-specialist` findings are normal raw findings and should be included in raw -> deduped -> report parity checks.

Optional later reporting improvement: include a short methodology bullet such as:

```text
- Specialist adversarial passes: math-precision, invariant, economic-security
```

## 11. Testing Strategy

Unit tests:

- Config schema accepts the new agent config.
- Config handler registers `audit-specialist` with expected permissions.
- `ARGUS_FAMILY` includes `audit-specialist`.
- Dynamic context injection applies to `audit-specialist` sessions.
- Tool tracking accepts `reported_by_agent: "audit-specialist"` if the enum expands.
- Skill linting accepts `skills/references/attack-vector-deck` and `skills/specialist-profiles/*`.

Behavioral/manual tests:

- Run an `audit-specialist` task against `tests/fixtures/vulnerable-vault` with `math-precision` or `access-control` profile.
- Confirm it can load the profile skill and attack-vector deck.
- Confirm it can record a finding through `argus_record_finding`.
- Confirm report generation includes the finding and Themis parity validation does not drop it.

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Broad tool permissions make the agent too powerful. | Exclude report/finalization/sync tools; keep it a subagent only. |
| Cost increases if every audit runs every profile. | Start behind explicit deep/adversarial activation; run selected profiles only. |
| Duplicate findings from multiple profiles. | Use existing finding fingerprints and Scribe dedupe lineage. Require `group_key` in profile output. |
| Leads get lost because they are not persisted. | Accept in v1; Argus can use returned leads for follow-up. Persisted leads can be a later schema-backed feature. |
| Attack-vector deck becomes stale. | Track source metadata and update via normal skill inventory processes. |
| Agent attribution types reject `audit-specialist`. | Expand `ArgusAgentName` / validators intentionally as part of implementation. |

## 13. Decision Log

- **Decision:** one new `audit-specialist` agent, not many specialist agents.
  - **Reason:** keeps conceptual clarity while limiting config and permission sprawl.
- **Decision:** profiles live as skills or markdown reference files.
  - **Reason:** adding/removing profiles should not require OpenCode agent registration changes.
- **Decision:** attack-vector deck is reference-only in v1.
  - **Reason:** vectors require context and false-positive gates; automatic regex conversion would create noise.
- **Decision:** explicit deep/adversarial mode first.
  - **Reason:** avoids surprising users with higher cost/latency in routine audits.
- **Decision:** no separate lead persistence in v1.
  - **Reason:** keeps state/report schema stable while preserving leads in the task response.

## 14. Open Questions

1. Should the user-facing activation phrase be `deep`, `adversarial`, or both?
2. Should `audit-specialist` use the same default model as Sentinel/Pythia or a stronger model by default?
3. Should `argus_solodit_search` be allowed for all profiles, or only research-heavy profiles such as `economic-security` and `vector-scan`?
4. Should leads remain response-only indefinitely, or should a later `argus_record_lead` tool be considered?

## 15. Implementation Sequence Preview

1. Add profile and attack-vector skills.
2. Add `audit-specialist` prompt.
3. Register the agent and config schema.
4. Update Argus orchestration instructions for deep/adversarial mode.
5. Update attribution/dynamic-context tests.
6. Run skill lint, unit tests, and a fixture-based manual audit-specialist pass.
