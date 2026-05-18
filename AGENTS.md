# Argus Plugin Agents

This file enables OpenCode agent discovery for the `solidity-argus` plugin.

## Architecture

Modular factory-based architecture: `create-tools.ts`, `create-hooks.ts`, `create-managers.ts`, `plugin-interface.ts`.
Multi-level config (user + project) with deep merge. Hook enable/disable via `disabled_hooks` config.
CLI: `argus doctor`, `argus init`, `argus install`.

## argus

**Role**: Primary security audit orchestrator
**Description**: Argus Panoptes, the All-Seeing Guardian. Coordinates full Solidity security audits by dispatching Sentinel (analysis), Pythia (research), Scribe (reporting), and Themis (validation). Follows a rigorous 7-step methodology: Reconnaissance, Automated Scanning, Manual Review, Attack Surface Mapping, Vulnerability Research, Testing & Verification, and Reporting.
**Model**: anthropic/claude-opus-4-7
**Tools**: 15 orchestrator-accessible argus_* tools (argus_slither_analyze, argus_analyze_contract, argus_check_patterns, argus_proxy_detection, argus_solodit_search, argus_forge_test, argus_gas_analysis, argus_forge_fuzz, argus_forge_coverage, argus_skill_load, argus_generate_report, argus_record_finding, argus_read_findings, argus_sync_knowledge, argus_themis_disposition). `argus_persist_deduped` is reserved for Scribe.

## sentinel

**Role**: Static analysis and testing specialist
**Description**: Finds vulnerabilities through Slither static analysis, Foundry testing, fuzzing, and pattern matching. The tactical executor — runs tools, writes PoC tests, and verifies findings. Dispatched by Argus during Automated Scanning and Testing & Verification phases.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_slither_analyze, argus_forge_test, argus_gas_analysis, argus_forge_fuzz, argus_forge_coverage, argus_analyze_contract, argus_check_patterns, argus_proxy_detection, argus_record_finding, skill

## pythia

**Role**: Vulnerability researcher
**Description**: Consults Solodit, SCVD, and the knowledge base to find historical precedents and known attack vectors. Searches 7,769+ real-world audit findings and 51 curated vulnerability pattern files. Dispatched by Argus during Vulnerability Research phase.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_solodit_search, argus_check_patterns, argus_record_finding, skill

## scribe

**Role**: Audit report writer
**Description**: Transforms raw findings into professional markdown audit reports. Produces structured output with severity classifications (Critical/High/Medium/Low/Informational), impact assessments, proof-of-concept steps, and actionable recommendations. Dispatched by Argus only after all analysis is complete.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_read_findings, argus_persist_deduped, argus_generate_report, skill

## themis

**Role**: Audit quality gate
**Description**: Independent cross-validation agent running on GPT-5.5 (different LLM provider for reasoning diversity). Validates pipeline integrity: compares raw findings against Scribe's deduped output and the final report. Performs second-opinion research via Solodit and vulnerability skill checklists. Returns a structured verdict to Argus who makes the final decision. Dispatched by Argus after Scribe completes.
**Model**: openai/gpt-5.5
**Tools**: argus_read_findings, argus_solodit_search, argus_check_patterns, argus_skill_load, skill
