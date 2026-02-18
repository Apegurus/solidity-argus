# Companion Plugins Guide

Argus works best when used with these companion plugins. They provide additional security patterns, audit methodologies, and vulnerability data.

## Trail of Bits Skills

The Trail of Bits skills repository is the most important companion for Argus. It adds professional audit methodologies and advanced vulnerability patterns.

- **Installation**: Run `/plugin marketplace add trailofbits/skills` in OpenCode.
- **Why it's separate**: Trail of Bits content uses the CC-BY-SA-4.0 license. Argus references it as a companion rather than bundling it to respect licensing and allow for independent updates.
- **How it complements Argus**: Trail of Bits covers advanced security topics and general Solidity best practices. Argus focuses on DeFi-specific patterns and protocol security.

## Solodit MCP

Argus auto-registers the Solodit MCP server. No manual setup is required.

- **Usage**: The `argus_solodit_search` tool queries Solodit automatically during analysis.
- **Query Examples**:
  - "reentrancy ERC4626"
  - "flash loan oracle manipulation"
- **Disabling**: Set `solodit.enabled: false` in your `opencode-argus.jsonc` file.

## SCVD Integration

The Smart Contract Vulnerability Database (SCVD) is built directly into Argus. It contains over 7,769 findings from 213 audit reports.

- **How it works**: Argus maintains a local JSON index that auto-syncs on plugin initialization.
- **Configuration**:
  - `knowledge.scvd.enabled`: Enable or disable SCVD (default: `true`).
  - `knowledge.scvd.apiUrl`: The API endpoint for syncing (default: `https://api.scvd.dev`).
  - `knowledge.autoSync`: Automatically sync the index on startup (default: `true`).
- **Manual Sync**: Use the `argus_sync_knowledge` tool with `force: true` to trigger a manual update.

## kadenzipfel References

Argus bundles 37 vulnerability patterns from the kadenzipfel smart-contract-vulnerabilities repository. These are imported into the knowledge base and include:

- Detection heuristics
- False positive guidance
- Real-world examples

Source: [https://github.com/kadenzipfel/smart-contract-vulnerabilities](https://github.com/kadenzipfel/smart-contract-vulnerabilities)
