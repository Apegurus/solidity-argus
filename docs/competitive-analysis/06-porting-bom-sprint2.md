# Sprint 2 — Porting Bill of Materials (BOM)

> Companion to [04-next-sprint-plan.md](./04-next-sprint-plan.md#sprint-2-preview-3-weeks-after-sprint-1).
> Companion to [05-porting-bom-sprint1.md](./05-porting-bom-sprint1.md) — reuse its license matrix, attribution conventions, `CREDITS.md` template.
> Generated: 2026-05-18 (preliminary — refresh before Sprint 2 starts).

## ⚠️ Refresh-before-use notice

Sprint 2 starts AFTER Sprint 1 ships (currently 3-4 weeks out). Source repos may drift in that window. **Before starting Sprint 2 implementation work:**

1. Re-run [the BOM source-fetch script](./05-porting-bom-sprint1.md#source-files-cache--inventory) for Sprint 2 sources to capture **fresh commit hashes**.
2. Re-verify licenses haven't changed (especially Archethect, kadenzipfel, The-Judge, hackenproof — they remain NO-LICENSE pending our optional outreach).
3. Re-check Aderyn (GPL-3.0) is still the recommended Slither companion.
4. Update permalinks below if commit hashes have drifted.

**Sprint 1 lessons may also re-prioritize**: if C-2 evals reveal C-3 themis upgrade dramatically improved precision, Sprint 2 might pull `C-4 Proof-or-Demote` forward. If evals show specialized agents underperform on a category, Sprint 2 might add an emergency C-1 prompt-fix slot.

---

## Sprint 2 targets (from [04-next-sprint-plan.md](./04-next-sprint-plan.md#sprint-2-preview-3-weeks-after-sprint-1))

| ID | Target | Effort | Depends on |
|---|---|---|---|
| **H-1** | `argus-prep` pre-audit scoping skill (separate skill, sibling to argus) | M (~5-7 days) | Sprint 1 stable |
| **H-2** | `argus_generate_poc` tool (mainnet-fork Foundry PoC scaffolder) | S-M (~3-5 days) | Sprint 1 stable |
| **H-6** | Aderyn + Echidna + Medusa + Halmos integration (~2-3 days each) | M (~8-12 days) | Sprint 1 stable |
| **C-4** | Proof-or-Demote enforcement (requires H-2 for PoC scaffolding) | S (~1-2 days) | H-2 |
| **argus_mode** | `audit | bounty | dev` config flag (mostly prompt gating) | S (~2 days) | H-2 (bounty mode usefulness) |

---

## License compatibility — Sprint 2 sources

Reusing the [Sprint 1 matrix](./05-porting-bom-sprint1.md#license-compatibility-matrix). Sprint 2-specific additions / clarifications:

| Source | License | Sprint 2 task | Treatment |
|---|---|---|---|
| [`0xRayaa/scoping-bee`](https://github.com/0xRayaa/scoping-bee/tree/138222e148fd6f0d5b7b92b1fee304bbc09417b7) | **MIT** | H-1 | ✅ Verbatim port OK with attribution |
| [`pashov/skills` (x-ray)](https://github.com/pashov/skills/tree/749903d4a068477344739f9bb3346ca35a06be60/x-ray) | **MIT** | H-1 | ✅ Verbatim port OK with attribution |
| [`CDSecurity/cdsecurity-skills` (audit-prep)](https://github.com/CDSecurity/cdsecurity-skills/tree/930cc41bf0baa36d46e7d49f7e9db20226869ddf/audit-prep) | **MIT** | H-1 | ✅ Verbatim port OK with attribution |
| [`cholakovvv/foundry-poc-mainnet-fork`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/tree/e02ebcb75d41575eb69127039da3de85a7b72da5) | **MIT** | H-2 | ✅ Verbatim port OK with attribution |
| [`DarkNavySecurity/web3-skills` (exploit-investigator)](https://github.com/DarkNavySecurity/web3-skills/tree/c4036f239c11a0c0f57983ca3b7d89429ba18472/exploit-investigator) | **MIT** | H-2 alt | ✅ Verbatim port OK with attribution |
| [`Archethect/sc-auditor` (generate-foundry-poc MCP tool)](https://github.com/Archethect/sc-auditor/tree/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/src/mcp/tools) | **NONE** ⚠️ | H-2 concept ref | Methodology only — reimplement |
| [`Cyfrin/aderyn`](https://github.com/Cyfrin/aderyn/tree/de6a0904a07ec20966b2b8f2ece4e89f0ada7bdb) | **GPL-3.0** ⚠️ | H-6 | **External binary only** (same model as Slither AGPL-3.0). Never bundle. Subprocess invocation + JSON output parsing only. |
| [`crytic/echidna`](https://github.com/crytic/echidna) | **AGPL-3.0** | H-6 | **External binary only** (same as Slither). |
| [`crytic/medusa`](https://github.com/crytic/medusa) | **AGPL-3.0** | H-6 | **External binary only**. |
| [`a16z/halmos`](https://github.com/a16z/halmos) | **AGPL-3.0** | H-6 | **External binary only**. |

**Key rule for H-6**: All four tools (Aderyn / Echidna / Medusa / Halmos) are **(A)GPL** — same legal model as our existing Slither integration. We invoke them via subprocess + parse their output. We never bundle/link/import their code. This is identical to how `argus_slither_analyze` already works.

---

## Per-target porting references

### H-1 — `argus-prep` pre-audit scoping skill

#### Target files

New skill `skills/argus-prep/` (sibling to `argus`):

- `skills/argus-prep/SKILL.md` — orchestrator
- `skills/argus-prep/THREAT_INTEL_SKILL.md` — threat-intel sandbox subskill
- `skills/argus-prep/references/attack-surfaces.md` — 24 EVM + 18 Solana checks (we'll do EVM only initially)
- `skills/argus-prep/references/complexity-rubric.md`
- `skills/argus-prep/references/scope-report-template.md`
- `skills/argus-prep/references/threats.md` — threat-model patterns (from pashov x-ray)
- `skills/argus-prep/scripts/source_fetcher.sh` — multi-source input (GitHub URL / ZIP / explorer address / dir)
- `skills/argus-prep/scripts/sloc_counter.sh` — nSLOC + pace-based time estimate
- `skills/argus-prep/scripts/threat_intel_scan.sh` — 10-phase sandbox scan
- `skills/argus-prep/scripts/codebase_visualizer.sh` — 8 Mermaid diagrams
- `skills/argus-prep/scripts/analyze_git_security.py` — git history security analysis (port from pashov x-ray)
- `skills/argus-prep/scripts/generate_svg.py` — SVG architecture diagrams (port from pashov x-ray)
- New tool: `argus_prep_scan` (orchestrator entrypoint)

#### Primary source: scoping-bee (MIT) — main orchestration

| Source file | Permalink | Treatment |
|---|---|---|
| [`scoping-bee/SKILL.md`](https://github.com/0xRayaa/scoping-bee/blob/138222e148fd6f0d5b7b92b1fee304bbc09417b7/SKILL.md) | `138222e` | **PORT** orchestration flow. Attribute. |
| [`scoping-bee/THREAT_INTEL_SKILL.md`](https://github.com/0xRayaa/scoping-bee/blob/138222e/THREAT_INTEL_SKILL.md) | `138222e` | **PORT** 10-phase threat-intel scan structure. |
| [`scoping-bee/references/attack-surfaces.md`](https://github.com/0xRayaa/scoping-bee/blob/138222e/references/attack-surfaces.md) | `138222e` | **PORT** 24 EVM attack-surface checks. (Skip 18 Solana checks for now.) |
| [`scoping-bee/references/complexity-rubric.md`](https://github.com/0xRayaa/scoping-bee/blob/138222e/references/complexity-rubric.md) | `138222e` | **PORT** complexity scoring rubric. |
| [`scoping-bee/references/scope-report-template.md`](https://github.com/0xRayaa/scoping-bee/blob/138222e/references/scope-report-template.md) | `138222e` | **PORT** scope report template. |
| [`scoping-bee/scripts/codebase_visualizer.sh`](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/codebase_visualizer.sh) | `138222e` | **PORT** 8 Mermaid diagrams (inheritance, call graph, state variable map, access control flow, dependency graph, function flow, complexity heatmap, value flow). |
| [`scoping-bee/scripts/sloc_counter.sh`](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/sloc_counter.sh) | `138222e` | **PORT** nSLOC counter (strips pragma/imports/SPDX for Solidity). |
| [`scoping-bee/scripts/source_fetcher.sh`](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/source_fetcher.sh) | `138222e` | **PORT** multi-source input handler (GitHub URL, ZIP, contract address on Etherscan/BSCScan/Polygonscan/Arbiscan/Optimism/Fantom/Avalanche/Base + testnets). |
| [`scoping-bee/scripts/threat_intel_scan.sh`](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/threat_intel_scan.sh) | `138222e` | **PORT** 10-phase threat-intel sandbox scan. **Recommend keeping the sandbox-first workflow** (run in VM/Docker before local). |

#### Secondary source: pashov x-ray (MIT) — git security + visual diagrams

| Source file | Permalink | Treatment |
|---|---|---|
| [`pashov/skills/x-ray/SKILL.md`](https://github.com/pashov/skills/blob/749903d4a068477344739f9bb3346ca35a06be60/x-ray/SKILL.md) | `749903d` | **CROSS-REFERENCE** orchestration. Use as alternative to scoping-bee's SKILL.md if their format is cleaner for our use case. |
| [`pashov/skills/x-ray/references/threats.md`](https://github.com/pashov/skills/blob/749903d/x-ray/references/threats.md) | `749903d` | **PORT** threat-model patterns (48 KB knowledge base). Complements scoping-bee's attack-surfaces.md. |
| [`pashov/skills/x-ray/references/templates.md`](https://github.com/pashov/skills/blob/749903d/x-ray/references/templates.md) | `749903d` | **PORT** scope report template (46 KB — much more detailed than scoping-bee's). |
| [`pashov/skills/x-ray/scripts/analyze_git_security.py`](https://github.com/pashov/skills/blob/749903d/x-ray/scripts/analyze_git_security.py) | `749903d` | **PORT** git-history security analysis (uniquely pashov — neither scoping-bee nor CDSec have this). |
| [`pashov/skills/x-ray/scripts/generate_svg.py`](https://github.com/pashov/skills/blob/749903d/x-ray/scripts/generate_svg.py) | `749903d` | **PORT** SVG architecture diagrams (alternative to scoping-bee's Mermaid). Maybe support both formats. |
| [`pashov/skills/x-ray/scripts/enumerate.sh`](https://github.com/pashov/skills/blob/749903d/x-ray/scripts/enumerate.sh) | `749903d` | **PORT** codebase enumeration helper. |

#### Tertiary source: CDSecurity audit-prep (MIT) — readiness scoring

| Source file | Permalink | Treatment |
|---|---|---|
| [`CDSecurity/cdsecurity-skills/audit-prep/SKILL.md`](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41bf0baa36d46e7d49f7e9db20226869ddf/audit-prep/SKILL.md) | `930cc41` | **CROSS-REFERENCE** — they organize as 8 phases + 3 parallel sub-agents (Testing / Source Analysis / Infrastructure). Consider whether we want their 8-phase scoring model alongside scoping-bee's scope report. |
| [`audit-prep/references/shared-rules.md`](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/shared-rules.md) | `930cc41` | **PORT** shared-rules pattern (similar to pashov's hacking-agents/shared-rules.md). |
| [`audit-prep/references/agents/infrastructure-agent.md`](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/agents/infrastructure-agent.md) | `930cc41` | **PORT** infrastructure readiness checks (deps, deployment scripts, CI). |
| [`audit-prep/references/agents/source-analysis-agent.md`](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/agents/source-analysis-agent.md) | `930cc41` | **PORT** source-hygiene checks (NatSpec, dead code, console removal). |
| [`audit-prep/references/agents/testing-agent.md`](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/agents/testing-agent.md) | `930cc41` | **PORT** test coverage + quality checks. |

#### Adaptation strategy (H-1)

**Layering** (merge the three sources into one skill):

1. **Scoping-bee provides the orchestration backbone** — multi-source input → sandbox scan → analysis → scope report. Use their SKILL.md flow.
2. **pashov x-ray augments with**:
   - Git-history security analysis (`analyze_git_security.py`) — uniquely useful
   - SVG diagram generation alongside scoping-bee's Mermaid
   - More detailed scope report templates (templates.md is 46 KB vs scoping-bee's smaller version)
   - Threat-pattern reference (threats.md is 48 KB knowledge base)
3. **CDSec audit-prep contributes**:
   - 8-phase readiness scoring (separate optional output alongside scope report)
   - 3 parallel sub-agents structure (Testing / Source / Infrastructure)
   - `--diff <ref>` PR-incremental mode (their CLI flag pattern)
   - `--ci` JSON output + exit-code threshold (CI integration)
   - `--fix` auto-apply mechanical fixes (NatSpec stubs, console removal, etc.)

**Modes** for `argus-prep`:
- `--scope` (default) — full pipeline
- `--readiness` — CDSec-style 0-100 readiness score
- `--diff <ref>` — incremental on changed files since ref
- `--ci` — JSON output, exit-code-driven
- `--no-sandbox` — skip threat-intel sandbox (use only on trusted code)
- `--threat-intel-only` — just run the 10-phase sandbox scan
- `--visualize-only` — just generate Mermaid + SVG diagrams

#### Attribution (H-1)

- `CREDITS.md`: scoping-bee + pashov + CDSec entries (already in [Sprint 1 BOM template](./05-porting-bom-sprint1.md#attribution-conventions))
- `skills/argus-prep/SKILL.md` header:
  ```
  Orchestration flow inspired by 0xRayaa/scoping-bee (MIT).
  Threat-model knowledge + git-history analysis ported from pashov/skills/x-ray (MIT).
  8-phase readiness scoring inspired by CDSecurity/cdsecurity-skills/audit-prep (MIT).
  ```

---

### H-2 — `argus_generate_poc` tool

#### Target files

- New tool `argus_generate_poc` in `src/tools/generate-poc.ts`
- New skill `skills/methodology/poc-scaffolding/SKILL.md`
- `skills/methodology/poc-scaffolding/templates/foundry-base.t.sol` — base PoC template
- `skills/methodology/poc-scaffolding/examples/{freeze,routing-dos,pool-drain,exploit}.t.sol` — pattern templates

#### Primary source: cholakovvv (MIT) — Foundry mainnet-fork PoC

| Source file | Permalink | Treatment |
|---|---|---|
| [`cholakovvv/foundry-poc-mainnet-fork/SKILL.md`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb75d41575eb69127039da3de85a7b72da5/SKILL.md) | `e02ebcb` | **PORT** classification system (frozen historical / forward-looking / both) + causal-chain construction + RPC fallback list (drpc.org, mevblocker.io, eth-pokt.nodies.app). |
| [`cholakovvv/foundry-poc-mainnet-fork/examples/README.md`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb/examples/README.md) | `e02ebcb` | **PORT** the 3-example structure + classification description. |
| [`cholakovvv/foundry-poc-mainnet-fork/examples/Example_FreezeHistorical.t.sol`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb/examples/%20Example_Freeze_historical.t.sol) | `e02ebcb` | **PORT** freeze pattern template. |
| [`cholakovvv/foundry-poc-mainnet-fork/examples/Example_RoutingDoS.t.sol`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb/examples/Example_Routing_dos.t.sol) | `e02ebcb` | **PORT** DoS pattern template. |
| [`cholakovvv/foundry-poc-mainnet-fork/examples/Example_PoolDrainTheft.t.sol`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb/examples/Example_PoolDrainTheft.t.sol) | `e02ebcb` | **PORT** theft pattern template. |

#### Secondary source: DarkNavy exploit-investigator (MIT) — broader exploit reproduction

| Source file | Permalink | Treatment |
|---|---|---|
| [`DarkNavySecurity/web3-skills/exploit-investigator/SKILL.md`](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f239c11a0c0f57983ca3b7d89429ba18472/exploit-investigator/SKILL.md) | `c4036f2` | **REFERENCE** orchestration of analyst → data_collector → decompiler → planner → poc_generator → validator pipeline. Optional Sprint 2.5 — primary scope is cholakovvv's lighter-weight scaffolder. |
| [`DarkNavySecurity/web3-skills/exploit-investigator/foundry_template/test/BaseExploit.t.sol`](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/foundry_template/test/BaseExploit.t.sol) | `c4036f2` | **PORT** `BaseExploit.t.sol` — reusable Foundry base class with common setup. |
| [`exploit-investigator/references/pipeline.md`](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/references/pipeline.md) | `c4036f2` | **CROSS-REFERENCE** for Sprint 3 forensics workflow. |
| [`exploit-investigator/references/prompts/poc_generator.md`](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/references/prompts/poc_generator.md) | `c4036f2` | **PORT** PoC generation prompt — extends cholakovvv's scaffolder with finding-classification logic. |

#### Concept reference: Archethect generate-foundry-poc MCP tool (NO LICENSE)

| Source file | Permalink | Treatment |
|---|---|---|
| [`Archethect/sc-auditor/src/mcp/tools/generate-foundry-poc.ts`](https://github.com/Archethect/sc-auditor/blob/942cc13111cf5b0617d9de8fa4fe9bc20f1d8cc8/src/mcp/tools/generate-foundry-poc.ts) | `942cc13` | **REFERENCE TS API SHAPE** only — they have a TypeScript MCP tool wrapper. Useful as architecture reference (our stack is also TS/Bun). **Do NOT copy code.** Implement our own with our own API contract. |

#### Adaptation strategy (H-2)

- **Keep**: cholakovvv's classification (frozen historical / forward-looking / both), real-address binding as `address constant`, block-pinning, end-state assertions keyed by impact type (theft → `assertGt`, DoS → `vm.expectRevert`, freeze → quantified stranding), RPC fallback chain.
- **Add**: DarkNavy's `BaseExploit.t.sol` as our reusable base + their classification-aware generation prompt.
- **Tool signature**:
  ```typescript
  argus_generate_poc({
    finding_id: string,         // links to our finding record
    chain: 'ethereum' | 'arbitrum' | 'base' | 'optimism' | 'polygon' | 'bsc',
    fork_block: 'latest' | number,
    addresses: { [role: string]: `0x${string}` },
    classification?: 'frozen_historical' | 'forward_looking' | 'both', // auto-classified if absent
  })
  // → returns: { test_file_path, forge_command, classification, expected_assertions }
  ```
- **Won't do** (cholakovvv's explicit scope rules — adopt verbatim):
  - Non-EVM chains
  - Hardhat (Foundry only)
  - Local-state unit tests
  - Fuzz/invariant harnesses (different genre — Sprint 2 H-6 handles those)
  - Guess addresses (flag blocker if address not deployed)
  - `vm.store` shortcuts that bypass protocol pipelines

#### Attribution (H-2)

- `src/tools/generate-poc.ts` header: link to cholakovvv SKILL.md, MIT note, DarkNavy BaseExploit.t.sol port note
- `skills/methodology/poc-scaffolding/SKILL.md`: classification system attribution to cholakovvv (MIT)
- `CREDITS.md`: cholakovvv + DarkNavy entries (already in template)

---

### H-6 — Aderyn + Echidna + Medusa + Halmos integration

#### Target files

4 new tools in `src/tools/`:
- `argus_aderyn_analyze` (Cyfrin's Rust static analyzer)
- `argus_echidna` (Crytic property-based fuzzer)
- `argus_medusa` (Crytic invariant fuzzer — modern Go-based)
- `argus_halmos` (a16z symbolic execution)

#### License model (CRITICAL)

ALL four tools are **(A)GPL / GPL-3.0** — incompatible with bundling into our MIT package. **Identical to how we already integrate Slither (AGPL-3.0):**

- Invoke as external binary via subprocess (e.g., `aderyn /path/to/contracts --output report.json`)
- Parse their JSON/SARIF output
- Never `import` their code, never embed their source, never link as a library
- User installs them separately (we provide install instructions, optional via `argus doctor`)

| Tool | License | Repo (commit-pinned) | Invocation |
|---|---|---|---|
| Aderyn | **GPL-3.0** | [Cyfrin/aderyn @ `de6a090`](https://github.com/Cyfrin/aderyn/tree/de6a0904a07ec20966b2b8f2ece4e89f0ada7bdb) | `aderyn <path> --output report.json` |
| Echidna | AGPL-3.0 | [crytic/echidna](https://github.com/crytic/echidna) | `echidna <contract> --config config.yaml --format json` |
| Medusa | AGPL-3.0 | [crytic/medusa](https://github.com/crytic/medusa) | `medusa fuzz --config medusa.json` |
| Halmos | AGPL-3.0 | [a16z/halmos](https://github.com/a16z/halmos) | `halmos --contract <Contract> --json-output` |

#### Adaptation strategy (H-6)

For each of the 4 tools, follow the existing `argus_slither_analyze` pattern:

1. **Tool definition** in `src/tools/`:
   - Take target path + optional config
   - Spawn subprocess with timeout
   - Parse JSON output → normalized finding format
   - Return findings + metadata (tool version, duration, exit code)

2. **Sentinel prompt update**: specialist hunt agents (C-1) gain access to these tools. Each specialist uses tools matching its category:
   - `sentinel-math-precision` → halmos symbolic for arithmetic invariants
   - `sentinel-access-control` → aderyn (good at access-control patterns)
   - `sentinel-economic-security` → echidna + medusa property fuzzing
   - `sentinel-invariant` → halmos + medusa

3. **`argus doctor`** checks for each binary:
   ```
   ✅ slither 0.10.x
   ✅ forge 1.0.x
   ⚠️  aderyn — not installed. Install: cargo install aderyn
   ⚠️  echidna — not installed. Install: cargo install echidna-cli
   ⚠️  medusa — not installed. Install: go install github.com/crytic/medusa@latest
   ⚠️  halmos — not installed. Install: pip install halmos
   ```

4. **Optional binaries** — graceful fallback when not installed (same as our Slither handling).

#### Attribution (H-6)

- Each tool wrapper in `src/tools/` has a header noting the external tool + its license:
  ```typescript
  // argus_aderyn_analyze
  // External tool: Cyfrin/aderyn (GPL-3.0) — https://github.com/Cyfrin/aderyn
  // We invoke aderyn as a subprocess. No code or library is bundled, embedded, or linked.
  // The (A)GPL licenses of these tools do NOT propagate to our wrapper code.
  ```

- `CREDITS.md` extension:
  ```
  ## External tools (invoked as binaries — not bundled)
  - Slither (AGPL-3.0) — Crytic
  - Aderyn (GPL-3.0) — Cyfrin
  - Echidna (AGPL-3.0) — Crytic
  - Medusa (AGPL-3.0) — Crytic
  - Halmos (AGPL-3.0) — a16z
  ```

---

### C-4 — Proof-or-Demote

#### Target files

- Update `argus_record_finding` schema in `src/state/finding-schema.ts`: `proof` field becomes **required** for severity `Critical` and `High`
- Update scribe prompt in `src/agents/scribe-prompt.ts`: rejects unproven Critical/High at persistence time
- Update themis prompt in `src/agents/themis-prompt.ts`: emits `benchmark_mode_visible: false` for unproven HIGH/MEDIUM in benchmark mode
- New config flag: `reporting.benchmark_mode: boolean`

#### Sources

**No external port required.** This is internal logic gating + schema change, built on the foundation of Sprint 1 C-3 (themis JSON schemas) + Sprint 2 H-2 (PoC scaffolder makes `proof` actually producible).

Conceptual inspiration (reuse Sprint 1 BOM attribution):
- [Archethect benchmark_mode_visible](https://github.com/Archethect/sc-auditor/blob/942cc13/skills/security-auditor/SKILL.md) (no license — concept)
- [pashov "every FINDING must have proof"](https://github.com/pashov/skills/blob/749903d/solidity-auditor/references/hacking-agents/shared-rules.md) (MIT — already attributed in Sprint 1)
- [DarkNavy Critical/High requires PoC Quantification](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/contract-auditor/references/validation/finding-protocol.md) (MIT — already attributed in Sprint 1)

#### Adaptation strategy (C-4)

```typescript
// src/state/finding-schema.ts (extend)
interface Finding {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Design Advisory' | 'Informational';
  // ... existing fields
  proof?: {
    type: 'foundry_poc' | 'echidna_invariant' | 'medusa_scenario' | 'halmos_proof' | 'trace';
    artifact_path: string;  // path to the test file or trace
    runs_passing: boolean;  // verified by argus
  };
}
```

Gate at scribe-persistence time:
```typescript
if (
  (finding.severity === 'Critical' || finding.severity === 'High') &&
  !finding.proof &&
  reporting.benchmark_mode
) {
  // Demote to next-lower severity OR set benchmark_mode_visible = false
  finding.benchmark_mode_visible = false;
  finding.demotion_reason = 'unproven_high_severity_in_benchmark_mode';
}
```

---

### `argus_mode` flag (audit / bounty / dev)

#### Target files

- Config schema extension in `src/config/types.ts`: add `argus_mode: 'audit' | 'bounty' | 'dev'` (default `'audit'`)
- Agent prompt gating: each agent prompt has mode-specific sections
- `argus init` interactive prompt asking for default mode

#### Sources

**No external port required.** This is config flag + prompt gating.

Conceptual inspiration:
- `bounty` mode driven by [shuvonsec/claude-bug-bounty](https://github.com/shuvonsec/claude-bug-bounty) (MIT, B3 batch) + [hackenproof triage](https://github.com/hackenproof-public/skills) (NO LICENSE, methodology)
- `dev` mode driven by [pashov/skills solidity-auditor "<5 min security feedback"](https://github.com/pashov/skills/blob/749903d/solidity-auditor/SKILL.md) positioning (MIT, Sprint 1 attributed)

#### Mode definitions

| Mode | Behavior |
|---|---|
| `audit` (default) | Current behavior — full 7-phase methodology, all agents, deep analysis, complete report |
| `bounty` | Enable: H-2 PoC scaffolding (mandatory), H-9 known-findings dedup (mandatory), severity-to-bounty rubric, aggressive Proof-or-Demote. Skip: Design Advisory severity (not a bug class for bounty submissions). |
| `dev` | Pashov-style <5min — trim to specialist hunt agents only (C-1), no themis adversarial pass, no exhaustive coverage check. Just fast feedback on the changeset. |

---

## Cached source files inventory (Sprint 2)

37 Sprint 1 files at `/tmp/argus-bom/s1_*` plus these 28 Sprint 2 files:

| Cached file | Source | License | Task |
|---|---|---|---|
| `s2_h1_scopingbee_skill.md` | [scoping-bee SKILL.md @ `138222e`](https://github.com/0xRayaa/scoping-bee/blob/138222e/SKILL.md) | MIT | H-1 |
| `s2_h1_scopingbee_threat_intel.md` | [scoping-bee THREAT_INTEL_SKILL.md](https://github.com/0xRayaa/scoping-bee/blob/138222e/THREAT_INTEL_SKILL.md) | MIT | H-1 |
| `s2_h1_scopingbee_attack_surfaces.md` | [scoping-bee references/attack-surfaces.md](https://github.com/0xRayaa/scoping-bee/blob/138222e/references/attack-surfaces.md) | MIT | H-1 |
| `s2_h1_scopingbee_complexity.md` | [scoping-bee references/complexity-rubric.md](https://github.com/0xRayaa/scoping-bee/blob/138222e/references/complexity-rubric.md) | MIT | H-1 |
| `s2_h1_scopingbee_report_template.md` | [scoping-bee references/scope-report-template.md](https://github.com/0xRayaa/scoping-bee/blob/138222e/references/scope-report-template.md) | MIT | H-1 |
| `s2_h1_scopingbee_visualizer.sh` | [scoping-bee scripts/codebase_visualizer.sh](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/codebase_visualizer.sh) | MIT | H-1 |
| `s2_h1_scopingbee_threatscan.sh` | [scoping-bee scripts/threat_intel_scan.sh](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/threat_intel_scan.sh) | MIT | H-1 |
| `s2_h1_scopingbee_sloc.sh` | [scoping-bee scripts/sloc_counter.sh](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/sloc_counter.sh) | MIT | H-1 |
| `s2_h1_scopingbee_fetcher.sh` | [scoping-bee scripts/source_fetcher.sh](https://github.com/0xRayaa/scoping-bee/blob/138222e/scripts/source_fetcher.sh) | MIT | H-1 |
| `s2_h1_pashov_xray_skill.md` | [pashov x-ray SKILL.md](https://github.com/pashov/skills/blob/749903d/x-ray/SKILL.md) | MIT | H-1 |
| `s2_h1_pashov_xray_threats.md` | [pashov x-ray references/threats.md](https://github.com/pashov/skills/blob/749903d/x-ray/references/threats.md) | MIT | H-1 |
| `s2_h1_pashov_xray_templates.md` | [pashov x-ray references/templates.md](https://github.com/pashov/skills/blob/749903d/x-ray/references/templates.md) | MIT | H-1 |
| `s2_h1_pashov_xray_git_sec.py` | [pashov x-ray scripts/analyze_git_security.py](https://github.com/pashov/skills/blob/749903d/x-ray/scripts/analyze_git_security.py) | MIT | H-1 |
| `s2_h1_pashov_xray_enumerate.sh` | [pashov x-ray scripts/enumerate.sh](https://github.com/pashov/skills/blob/749903d/x-ray/scripts/enumerate.sh) | MIT | H-1 |
| `s2_h1_pashov_xray_svg.py` | [pashov x-ray scripts/generate_svg.py](https://github.com/pashov/skills/blob/749903d/x-ray/scripts/generate_svg.py) | MIT | H-1 |
| `s2_h1_cdsec_skill.md` | [CDSec audit-prep/SKILL.md @ `930cc41`](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/SKILL.md) | MIT | H-1 |
| `s2_h1_cdsec_shared_rules.md` | [CDSec audit-prep/references/shared-rules.md](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/shared-rules.md) | MIT | H-1 |
| `s2_h1_cdsec_infra.md` | [CDSec audit-prep/references/agents/infrastructure-agent.md](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/agents/infrastructure-agent.md) | MIT | H-1 |
| `s2_h1_cdsec_source.md` | [CDSec audit-prep/references/agents/source-analysis-agent.md](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/agents/source-analysis-agent.md) | MIT | H-1 |
| `s2_h1_cdsec_testing.md` | [CDSec audit-prep/references/agents/testing-agent.md](https://github.com/CDSecurity/cdsecurity-skills/blob/930cc41/audit-prep/references/agents/testing-agent.md) | MIT | H-1 |
| `s2_h2_cholakov_skill.md` | [cholakovvv SKILL.md @ `e02ebcb`](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb/SKILL.md) | MIT | H-2 |
| `s2_h2_cholakov_examples.md` | [cholakovvv examples/README.md](https://github.com/cholakovvv/foundry-poc-mainnet-fork/blob/e02ebcb/examples/README.md) | MIT | H-2 |
| `s2_h2_dn_exploit_skill.md` | [DarkNavy exploit-investigator SKILL.md](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/SKILL.md) | MIT | H-2 alt |
| `s2_h2_dn_baseexploit.sol` | [DarkNavy BaseExploit.t.sol](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/foundry_template/test/BaseExploit.t.sol) | MIT | H-2 |
| `s2_h2_dn_pipeline.md` | [DarkNavy pipeline.md](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/references/pipeline.md) | MIT | H-2 |
| `s2_h2_dn_poc_gen.md` | [DarkNavy poc_generator.md](https://github.com/DarkNavySecurity/web3-skills/blob/c4036f2/exploit-investigator/references/prompts/poc_generator.md) | MIT | H-2 |
| `s2_h2_arch_generate_poc.ts` | [Archethect generate-foundry-poc.ts @ `942cc13`](https://github.com/Archethect/sc-auditor/blob/942cc13/src/mcp/tools/generate-foundry-poc.ts) | NONE | H-2 (concept) |

---

## Open questions for Sprint 2

1. **H-1 packaging**: separate skill (`argus-prep`) vs argus mode flag (`--mode=scope`) — already decided as **separate skill** in Sprint 1 BOM. Confirm Sprint 1 lessons don't change this.

2. **H-1 sandbox dependency**: scoping-bee's threat-intel sandbox scan requires Docker. Do we require it or fallback gracefully? Recommendation: **require for production scans**, allow `--no-sandbox` for trusted codebases.

3. **H-2 multi-chain**: cholakovvv supports ethereum/arbitrum/base/optimism/polygon. Should we extend to BSC, Avalanche, Fantom from day one? Recommendation: **start with ethereum + arbitrum + base** (highest audit demand), add others on request.

4. **H-6 priority order**: 4 tools is a lot. Order recommendation: **Aderyn first** (modern Slither companion, easy win), **Medusa second** (best modern invariant fuzzer), **Echidna third** (mature but Halmos-overlapping), **Halmos fourth** (symbolic — niche).

5. **C-4 default benchmark_mode**: should `reporting.benchmark_mode` default to `true` or `false`? Recommendation: **`false` by default**, `true` only when running evals (Sprint 1 C-2 sets it automatically).

6. **`argus_mode` default per release**: `audit` ships as default. Should `bounty` and `dev` be visible flags in initial release or hidden behind `argus init --advanced`? Recommendation: **visible from day one** — users self-select.

---

Status: Sprint 2 BOM complete. Refresh before sprint kickoff. Source data current as of 2026-05-18 fetch.
