import { join } from "node:path";
import type { AuditState, FindingSeverity } from "../state/types";

interface SystemPromptInput {
  system: string;
  cwd: string;
}

/**
 * Checks if the given directory contains a Solidity project
 * by looking for foundry.toml or hardhat.config.{js,ts}
 */
async function isSolidityProject(cwd: string): Promise<boolean> {
  const checks = [
    Bun.file(join(cwd, "foundry.toml")).exists(),
    Bun.file(join(cwd, "hardhat.config.js")).exists(),
    Bun.file(join(cwd, "hardhat.config.ts")).exists(),
  ];

  const results = await Promise.all(checks);
  return results.some(Boolean);
}

/**
 * Counts findings by severity from the audit state
 */
function countFindingsBySeverity(
  findings: AuditState["findings"]
): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Informational: 0,
  };

  for (const finding of findings) {
    counts[finding.severity]++;
  }

  return counts;
}

/**
 * Builds the audit state summary section for the injected context
 */
function buildAuditStateSummary(state: AuditState | null): string {
  if (!state) {
    return "No active audit session. Use @argus to start an audit.";
  }

  const counts = countFindingsBySeverity(state.findings);
  const scopeList =
    state.scope.length > 0 ? state.scope.join(", ") : "not defined";
  const reviewedList =
    state.contractsReviewed.length > 0
      ? state.contractsReviewed.join(", ")
      : "none yet";

  return [
    `Phase: ${state.currentPhase}`,
    `Scope: ${scopeList}`,
    `Contracts reviewed: ${reviewedList}`,
    `Findings: ${state.findings.length} total — Critical: ${counts.Critical}, High: ${counts.High}, Medium: ${counts.Medium}, Low: ${counts.Low}, Info: ${counts.Informational}`,
  ].join("\n");
}

/**
 * Builds the full audit context block to inject into the system prompt.
 * Designed to be concise (500-800 tokens).
 */
function buildAuditContextBlock(state: AuditState | null): string {
  return `
<argus-context>
## Solidity Audit Context

### Severity Classification
- **Critical**: Direct theft/freezing of funds, unauthorized admin access, contract destruction
- **High**: Indirect fund loss, business logic manipulation, DoS on critical functions
- **Medium**: Degraded functionality, edge-case bugs, partial DoS, poor validation
- **Low**: Code quality issues, suboptimal patterns, missing events, minor logic issues
- **Informational**: Gas optimizations, style suggestions, best practices, non-security notes

### Available Argus Tools
- \`argus_slither_analyze\`: Run Slither static analysis on Solidity codebase
- \`argus_forge_test\`: Execute Foundry/Forge tests for vulnerability verification
- \`argus_forge_fuzz\`: Fuzz specific functions to discover edge cases
- \`argus_analyze_contract\`: Generate deep structural profile of a contract
- \`argus_check_patterns\`: Scan code against known vulnerability pattern library
- \`argus_solodit_search\`: Search real-world audit reports and known vulnerabilities
- \`argus_generate_report\`: Compile findings into structured audit report
- \`argus_sync_knowledge\`: Update local vulnerability database (SCVD)

### Audit State
${buildAuditStateSummary(state)}

### Quick Reference
Use @argus for full audits, @sentinel for testing, @pythia for research, @scribe for reports.
Severity must follow classification above. Do not inflate severity.
</argus-context>`.trim();
}

/**
 * Factory function that creates a system prompt transform hook.
 * The hook injects Solidity audit context when working in a Solidity project.
 *
 * @param getAuditState - Accessor function for current audit state (may return null)
 * @returns Async transform function compatible with OpenCode's experimental.chat.system.transform
 */
export function createSystemPromptHook(
  getAuditState: () => AuditState | null
): (input: SystemPromptInput) => Promise<string | null> {
  return async (input: SystemPromptInput): Promise<string | null> => {
    const isSolidity = await isSolidityProject(input.cwd);

    if (!isSolidity) {
      return null;
    }

    const auditState = getAuditState();
    return buildAuditContextBlock(auditState);
  };
}

export default createSystemPromptHook;
