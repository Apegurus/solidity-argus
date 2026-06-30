# Argus Plugin Agents

This file enables OpenCode agent discovery for the `solidity-argus` plugin.

## Architecture

Modular factory-based architecture: `create-tools.ts`, `create-hooks.ts`, `create-managers.ts`, `plugin-interface.ts`.
Multi-level config (user + project) with deep merge. Hook enable/disable via `disabled_hooks` config.
CLI: `argus doctor`, `argus init`, `argus install`.

## argus

**Role**: Primary security audit orchestrator
**Description**: Argus Panoptes, the All-Seeing Guardian. Coordinates full Solidity security audits by dispatching Sentinel (analysis), Pythia (research), Audit Specialist (deep/adversarial profiles), Scribe (reporting), and Themis (validation). Follows a rigorous 7-step methodology: Reconnaissance, Automated Scanning, Manual Review, Attack Surface Mapping, Vulnerability Research, Testing & Verification, and Reporting.
**Model**: anthropic/claude-opus-4-8
**Tools**: 17 core argus_* tools plus optional Solodit. Argus can use metadata-only discovery directly (`argus_list_skills`, `argus_recommend_skills`) and records final Themis disposition with `argus_themis_disposition`; heavyweight audit execution remains delegated. Core tools include argus_slither_analyze, argus_analyze_contract, argus_check_patterns, argus_proxy_detection, argus_forge_test, argus_gas_analysis, argus_forge_fuzz, argus_forge_coverage, argus_list_skills, argus_recommend_skills, argus_skill_load, argus_generate_report, argus_record_finding, argus_read_findings, argus_sync_knowledge, argus_themis_disposition. `argus_persist_deduped` is reserved for Scribe.

## sentinel

**Role**: Static analysis and testing specialist
**Description**: Finds vulnerabilities through Slither static analysis, Foundry testing, fuzzing, and pattern matching. The tactical executor — runs tools, writes PoC tests, and verifies findings. Dispatched by Argus during Automated Scanning and Testing & Verification phases.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_slither_analyze, argus_forge_test, argus_gas_analysis, argus_forge_fuzz, argus_forge_coverage, argus_analyze_contract, argus_check_patterns, argus_proxy_detection, argus_list_skills, argus_recommend_skills, argus_skill_load, argus_record_finding, skill

## pythia

**Role**: Vulnerability researcher
**Description**: Consults Solodit, SCVD, and the knowledge base to find historical precedents and known attack vectors. Searches 7,769+ real-world audit findings and 60 curated vulnerability pattern files. Dispatched by Argus during Vulnerability Research phase.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_solodit_search, argus_check_patterns, argus_list_skills, argus_recommend_skills, argus_skill_load, argus_record_finding, skill

## audit-specialist

**Role**: Profile-driven adversarial specialist auditor
**Description**: Runs focused deep/adversarial passes under profiles such as vector-scan, access-control, math-precision, invariant, economic-security, execution-trace, periphery, and first-principles. Combines Sentinel-style analysis and verification tools with Pythia-style historical research. Subject to the 4-gate refutation rubric: every candidate is persisted via `argus_record_finding` with a `rubric_verdict` (CONFIRMED → Findings tier; DEMOTED / REJECTED_DEMOTED → Leads tier). Textual `LEAD` blocks in the structured output are for Argus's planning/handoff and do not replace recording.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_skill_load, argus_list_skills, argus_recommend_skills, argus_check_patterns, argus_solodit_search, argus_analyze_contract, argus_slither_analyze, argus_proxy_detection, argus_forge_test, argus_forge_fuzz, argus_forge_coverage, argus_gas_analysis, argus_record_finding, skill

## scribe

**Role**: Audit report writer
**Description**: Transforms raw findings into professional markdown audit reports. Produces structured output with severity classifications (Critical/High/Medium/Low/Informational), impact assessments, proof-of-concept steps, and actionable recommendations. Dispatched by Argus only after all analysis is complete.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_read_findings, argus_persist_deduped, argus_generate_report, skill

## themis

**Role**: Audit quality gate
**Description**: Independent cross-validation agent running on GPT-5.5 (different LLM provider for reasoning diversity). Validates pipeline integrity: compares raw findings against Scribe's deduped output and the final report. Performs second-opinion research via Solodit and vulnerability skill checklists. Returns a structured verdict to Argus who makes the final decision. Dispatched by Argus after Scribe completes.
**Model**: openai/gpt-5.5
**Tools**: argus_read_findings, argus_solodit_search, argus_check_patterns, argus_list_skills, argus_recommend_skills, argus_skill_load, skill

## Maintenance Guardrails (Avoiding Overtuning)

Argus agents and skills are general-purpose. When a single audit, dogfood run, or test case teaches a lesson, encode the *general principle* in one place — never copy a fixture-shaped rule across prompts and skills. These guardrails are mandatory for changes to `src/agents/*-prompt.ts` and `skills/**`.

1. **Single source of truth for cross-agent rules.** A methodology rule that applies to multiple agents lives in exactly one skill (e.g. `skills/methodology/refutation-rubric/SKILL.md`). Agent prompts reference it by name; they do not re-paste it. The shared `src/agents/refutation-rubric-instructions.ts` block is the only place that summary is injected into Sentinel / Pythia / Audit-Specialist.

2. **Eval-as-guardrail, not prompt-as-guardrail.** To lock in behavior for a specific case (e.g. "this PoC is griefing, not theft"), add a fixture to `tests/eval/` with the expected finding. Do not hardcode the case's narration into general prompts or skills — the metric enforces the case; the prose carries only the general principle.

3. **Don't generalize from N=1.** Do not promote a lesson from one contract or fixture into a global rule until ≥2 independent real targets confirm it. Keep narrow exceptions narrow and explicitly scoped to their domain skill.

4. **De-fixture wording.** General guidance must not name a specific fixture's artifacts (contract names, `vm.deal`/harness specifics, "same-recipient", hardcoded balances, "green test output"). Describe the *class* of issue, not the incident that surfaced it.

5. **Detection rules belong in vulnerability-pattern skills.** Only `vulnerability-pattern` skills with a `pattern_category` are scanned by `argus_check_patterns`. Case studies and references stay narrative — no `detection_rules`. `argus lint-skills` warns on `detection_rules` without `pattern_category` (inert rules). A regex must match a vulnerability *class*, never an exploit's unique token (`MNGO`, `donateToReserves`, a project's router name, …).

6. **Derive, don't hardcode.** Do not bake skill counts or census figures into prompts; agents enumerate skills at runtime via `argus_list_skills` / `argus_recommend_skills`. `skills/INVENTORY.md` is the canonical inventory and is drift-guarded by `tests/unit/inventory-coverage.test.ts`.

7. **Document heuristic weights.** Hand-tuned scoring / similarity weights (`src/skills/argus-skill-catalog.ts`, `src/skills/analysis/similarity.ts`) must carry a rationale comment and be retuned against `tests/eval/` recall, not by feel.
