# Argus Knowledge Base

The Argus knowledge base provides a structured collection of Solidity security patterns, audit methodologies, and protocol-specific security guides. OpenCode's skills system uses these files to provide context-aware security analysis and auditing assistance.

## Architecture

```
OpenCode Skills System
├── skills/ (bundled with plugin)
│   ├── vulnerability-patterns/ (37 patterns from kadenzipfel + DeFiFoFum)
│   ├── methodology/ (3 files from DeFiFoFum)
│   ├── protocol-patterns/ (5 files from DeFiFoFum)
│   ├── checklists/ (6 files from DeFiFoFum + Cyfrin)
│   └── references/ (2 files: SmartBugs + DeFiHackLabs)
├── SCVD Local Index (~/.cache/opencode-argus/scvd-index.json)
│   └── 7,769+ findings, auto-synced from api.scvd.dev
└── Companion Plugins (installed separately)
    ├── Trail of Bits Skills (trailofbits/skills)
    └── Solodit MCP (auto-registered by Argus)
```

## Source Attribution

| Source | License | URL | What Was Imported |
|--------|---------|-----|-------------------|
| DeFiFoFum/fofum-solidity-skills | MIT | https://github.com/DeFiFoFum/fofum-solidity-skills | 15 SKILL.md files: methodology, vulnerability patterns, protocol patterns |
| kadenzipfel/smart-contract-vulnerabilities | MIT | https://github.com/kadenzipfel/smart-contract-vulnerabilities | 37 vulnerability reference files with Detection Heuristics |
| Cyfrin/audit-checklist | Unspecified (attributed) | https://github.com/Cyfrin/audit-checklist | 221 structured checklist items organized by category |
| smartbugs/smartbugs-curated | Apache-2.0 | https://github.com/smartbugs/smartbugs-curated | 143 annotated vulnerable contract references |
| SunWeb3Sec/DeFiHackLabs | Reference only | https://github.com/SunWeb3Sec/DeFiHackLabs | 15 exploit PoC GitHub URL references |
| SCVD (api.scvd.dev) | CC0 | https://api.scvd.dev | 7,769+ findings via local index (auto-synced) |

## SKILL.md Format Specification

Contributors can add custom skills using this format:

```yaml
---
name: topic-name          # Must match parent directory name
description: One sentence description (1-1024 chars)
---
<!-- Source: Author/repo (License) -->

# Topic Title

## Overview
...
```

## Custom Skills

To add your own skills, use the `knowledge.customSkillsDir` configuration option in your `opencode-argus.jsonc` file. Point this to a directory containing your custom `SKILL.md` files organized into subdirectories.

## Inventory

See [INVENTORY.md](./INVENTORY.md) for a complete listing of all 55 SKILL.md files currently bundled with Argus.
