# Argus Plugin Agents

This file enables OpenCode agent discovery for the `solidity-argus` plugin.

## Architecture

Modular factory-based architecture: `create-tools.ts`, `create-hooks.ts`, `create-managers.ts`, `plugin-interface.ts`.
Multi-level config (user + project) with deep merge. Hook enable/disable via `disabled_hooks` config.
CLI: `argus doctor`, `argus init`, `argus install`.

## argus

**Role**: Primary security audit orchestrator
**Description**: Argus Panoptes, the All-Seeing Guardian. Coordinates full Solidity security audits by dispatching Sentinel (analysis), Pythia (research), and Scribe (reporting). Follows a rigorous 7-step methodology: Reconnaissance, Automated Scanning, Manual Review, Attack Surface Mapping, Vulnerability Research, Testing & Verification, and Reporting.
**Model**: anthropic/claude-opus-4-6
**Tools**: All 11 argus_* tools (argus_slither_analyze, argus_analyze_contract, argus_check_patterns, argus_proxy_detection, argus_solodit_search, argus_forge_test, argus_gas_analysis, argus_forge_fuzz, argus_forge_coverage, argus_generate_report, argus_sync_knowledge)

## sentinel

**Role**: Static analysis and testing specialist
**Description**: Finds vulnerabilities through Slither static analysis, Foundry testing, fuzzing, and pattern matching. The tactical executor — runs tools, writes PoC tests, and verifies findings. Dispatched by Argus during Automated Scanning and Testing & Verification phases.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_slither_analyze, argus_forge_test, argus_gas_analysis, argus_forge_fuzz, argus_forge_coverage, argus_analyze_contract, argus_check_patterns, argus_proxy_detection, skill

## pythia

**Role**: Vulnerability researcher
**Description**: Consults Solodit, SCVD, and the knowledge base to find historical precedents and known attack vectors. Searches 7,769+ real-world audit findings and 55 curated vulnerability pattern files. Dispatched by Argus during Vulnerability Research phase.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_solodit_search, argus_check_patterns, skill

## scribe

**Role**: Audit report writer
**Description**: Transforms raw findings into professional markdown audit reports. Produces structured output with severity classifications (Critical/High/Medium/Low/Informational), impact assessments, proof-of-concept steps, and actionable recommendations. Dispatched by Argus only after all analysis is complete.
**Model**: anthropic/claude-sonnet-4-6
**Tools**: argus_generate_report, skill
