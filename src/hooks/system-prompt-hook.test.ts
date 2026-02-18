import { describe, test, expect, beforeEach } from "bun:test";
import { join, resolve } from "node:path";
import { createSystemPromptHook } from "./system-prompt-hook";
import type { AuditState } from "../state/types";

const FIXTURES_DIR = resolve(import.meta.dir, "../../tests/fixtures");
const FOUNDRY_PROJECT_DIR = join(FIXTURES_DIR, "vulnerable-vault");
const NON_SOLIDITY_DIR = join(FIXTURES_DIR, "nonexistent-project-dir-abc123");
const BASE_SYSTEM_PROMPT = "You are a helpful assistant.";

function createMockAuditState(
  overrides?: Partial<AuditState>
): AuditState {
  return {
    sessionId: "test-session-001",
    projectDir: FOUNDRY_PROJECT_DIR,
    contractsReviewed: [],
    findings: [],
    toolsExecuted: [],
    currentPhase: "reconnaissance",
    scope: [],
    startTime: Date.now(),
    ...overrides,
  };
}

describe("createSystemPromptHook", () => {
  let nullStateHook: (input: { system: string; cwd: string }) => Promise<string | null>;

  beforeEach(() => {
    nullStateHook = createSystemPromptHook(() => null);
  });

  test("returns null for non-Solidity project", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: NON_SOLIDITY_DIR,
    });

    expect(result).toBeNull();
  });

  test("returns only context block for Foundry project", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("<argus-context>");
    expect(result).toContain("</argus-context>");
    expect(result).not.toContain(BASE_SYSTEM_PROMPT);
  });

  test("severity definitions are present in injected content", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("Critical");
    expect(result).toContain("High");
    expect(result).toContain("Medium");
    expect(result).toContain("Low");
    expect(result).toContain("Informational");
  });

  test("tools list is present in injected content", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("argus_slither_analyze");
    expect(result).toContain("argus_forge_test");
    expect(result).toContain("argus_forge_fuzz");
    expect(result).toContain("argus_analyze_contract");
    expect(result).toContain("argus_check_patterns");
    expect(result).toContain("argus_solodit_search");
    expect(result).toContain("argus_generate_report");
    expect(result).toContain("argus_sync_knowledge");
  });

  test("skills section is present in injected content", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("Available Skills");
    expect(result).toContain("vulnerability-patterns");
    expect(result).toContain("protocol-patterns");
    expect(result).toContain("methodology");
    expect(result).toContain("skill");
  });

  test("skill index snapshot is present in injected content", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("Skill Index Snapshot");
    expect(result).toContain("Bundled skills:");
    expect(result).toContain("Trail of Bits skills:");
    expect(result).toContain("Custom project skills:");
  });

  test("includes audit state when active", async () => {
    const state = createMockAuditState({
      currentPhase: "manual-review",
      scope: ["Vault.sol", "Token.sol"],
      contractsReviewed: ["Vault.sol"],
      findings: [
        {
          id: "f1",
          check: "reentrancy-eth",
          severity: "Critical",
          confidence: "High",
          description: "Reentrancy in withdraw",
          file: "src/Vault.sol",
          lines: [42, 55],
          source: "slither",
        },
        {
          id: "f2",
          check: "unchecked-transfer",
          severity: "Medium",
          confidence: "Medium",
          description: "Unchecked return value",
          file: "src/Vault.sol",
          lines: [60, 60],
          source: "manual",
        },
        {
          id: "f3",
          check: "missing-events",
          severity: "Low",
          confidence: "High",
          description: "Missing event emission",
          file: "src/Token.sol",
          lines: [10, 12],
          source: "pattern",
        },
      ],
    });

    const hook = createSystemPromptHook(() => state);
    const result = await hook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("Phase: manual-review");
    expect(result).toContain("Vault.sol");
    expect(result).toContain("Critical: 1");
    expect(result).toContain("Medium: 1");
    expect(result).toContain("Low: 1");
    expect(result).toContain("3 total");
  });

  test("shows no active audit message when state is null", async () => {
    const result = await nullStateHook({
      system: BASE_SYSTEM_PROMPT,
      cwd: FOUNDRY_PROJECT_DIR,
    });

    expect(result).toContain("No active audit session");
    expect(result).toContain("@argus");
  });
});
