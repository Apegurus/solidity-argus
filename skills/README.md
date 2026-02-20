# Argus Knowledge Base

The Argus knowledge base provides a structured collection of Solidity security patterns, audit methodologies, and protocol-specific security guides. OpenCode's skills system uses these files to provide context-aware security analysis and auditing assistance.

## Architecture

```
OpenCode Skills System
├── skills/ (bundled with plugin)
│   ├── vulnerability-patterns/ (44 patterns from kadenzipfel + DeFiFoFum + BailSec)
│   ├── methodology/ (3 files from DeFiFoFum)
│   ├── protocol-patterns/ (5 files from DeFiFoFum)
│   ├── checklists/ (6 files from DeFiFoFum + Cyfrin)
│   ├── references/ (2 files: SmartBugs + DeFiHackLabs)
│   └── case-studies/ (15 case studies from DeFiFoFum)
├── SCVD Local Index (~/.cache/solidity-argus/scvd-index.json)
│   └── 7,769+ findings, auto-synced from api.scvd.dev
└── Companion Plugins (installed separately)
    ├── Trail of Bits Skills (trailofbits/skills)
    └── Solodit MCP (auto-registered by Argus)
```

## Source Attribution

All sources in the table below must include the following metadata in their SKILL.md frontmatter or index entry:
- **Source name** — Human-readable identifier (e.g., "Cyfrin", "Trail of Bits")
- **URL** — Canonical link to the source repository or API endpoint
- **License identifier** — SPDX license code (e.g., "MIT", "Apache-2.0", "CC0")
- **Last-verified date** — ISO 8601 timestamp of when the source was last checked for updates

| Source | License | URL | What Was Imported |
|--------|---------|-----|-------------------|
| DeFiFoFum/fofum-solidity-skills | MIT | https://github.com/DeFiFoFum/fofum-solidity-skills | 15 SKILL.md files: methodology, vulnerability patterns, protocol patterns, case studies |
| kadenzipfel/smart-contract-vulnerabilities | MIT | https://github.com/kadenzipfel/smart-contract-vulnerabilities | 37 vulnerability reference files with Detection Heuristics |
| Cyfrin/audit-checklist | Unspecified (attributed) | https://github.com/Cyfrin/audit-checklist | 221 structured checklist items organized by category |
| smartbugs/smartbugs-curated | Apache-2.0 | https://github.com/smartbugs/smartbugs-curated | 143 annotated vulnerable contract references |
| SunWeb3Sec/DeFiHackLabs | Reference only | https://github.com/SunWeb3Sec/DeFiHackLabs | 15 exploit PoC GitHub URL references |
| BailSec | CC0 | https://github.com/bailsec/BailSec | Vulnerability patterns extracted from professional audit PDFs |
| SCVD (api.scvd.dev) | CC0 | https://api.scvd.dev | 7,769+ findings via local index (auto-synced) |

## SKILL.md Format Specification

Contributors can add custom skills using this format:

```yaml
---
name: topic-name          # Must match parent directory name
description: One sentence description (1-1024 chars)
version: 1.0.0            # Optional semver
category: vulnerability-pattern # methodology, protocol-pattern, checklist, reference
source_url: "https://github.com/org/repo"
source_license: "MIT"
imported_at: "2024-01-01T00:00:00Z"
detection_rules:
  - regex: "pattern here"
    severity: "High"
    description: "What this detects"
---
<!-- Source: Author/repo (License) -->

# Topic Title

## Overview
...
```

## Custom Skills

To add your own skills, use the `knowledge.customSkillsDir` configuration option in your `solidity-argus.jsonc` file. Point this to a directory containing your custom `SKILL.md` files organized into subdirectories.

### Skill Overrides

By default, built-in skills take priority. You can change this behavior using the `skillPrecedence` option:

```jsonc
"knowledge": {
  "skillPrecedence": "custom-first"
}
```

When set to `custom-first`, skills in your `customSkillsDir` will override built-in skills with the same name. All custom skills must have valid frontmatter with at least `name` and `description` fields.

## Pattern Pack Authoring

Pattern packs are YAML files that define collections of regex-based vulnerability detectors.

### Structure

```yaml
pack_name: "My Security Pack"
pack_version: "1.1"
patterns:
  - name: "Unprotected Selfdestruct"
    category: "access-control"
    severity: "Critical"
    regex: "selfdestruct\\("
    description: "Detects use of selfdestruct which may be unprotected"
    swc: "SWC-106"
```

### Available Categories

- `reentrancy`
- `oracle-manipulation`
- `flash-loan`
- `access-control`
- `erc4626`
- `proxy`
- `signature`
- `dos`
- `front-running`
- `governance`
- `token-standard`
- `gas-optimization`
- `logic-error`
- `delegatecall`

## Inventory

See [INVENTORY.md](./INVENTORY.md) for a complete listing of all 75 SKILL.md files currently bundled with Argus.
