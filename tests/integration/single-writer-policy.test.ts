import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ArgusConfig } from "../../src/config/types"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import type { Finding } from "../../src/state/types"
import {
  executeReportGeneration,
  extractReportRunId,
  SINGLE_WRITER_POLICY_VERSION,
} from "../../src/tools/report-generator-tool"

function createContext(directory: string): ToolContext {
  return {
    sessionID: "session-policy",
    messageID: "message-policy",
    agent: "scribe",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function createTestConfig(outputDir: string): ArgusConfig {
  return {
    agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
    tools: {},
    knowledge: {
      scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
      autoSync: true,
      skillPrecedence: "bundled-first" as const,
    },
    reporting: {
      format: "markdown" as const,
      severityThreshold: "low" as const,
      gasAnalysis: false,
      output_dir: outputDir,
    },
    solodit: { enabled: true, port: 54173 },
    disabled_hooks: [],
    hooks: {},
    cli: {},
    background: { max_concurrent: 3 },
  }
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? "f-policy-1",
    check: overrides.check ?? "reentrancy-eth",
    severity: overrides.severity ?? "High",
    confidence: overrides.confidence ?? "High",
    description: overrides.description ?? "Potential reentrancy vulnerability",
    file: overrides.file ?? "src/Vault.sol",
    lines: overrides.lines ?? [10, 15],
    source: overrides.source ?? "slither",
  }
}

describe("single-writer policy", () => {
  test("first write succeeds and creates report at canonical path with metadata", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-"))
    const outputDir = "reports"

    try {
      const findings: Finding[] = [makeFinding()]
      const sessionId = "run-first-write-test"

      const result = await executeReportGeneration(
        {
          project_name: "PolicyTest",
          scope: ["Vault.sol"],
          report_input: JSON.stringify({
            run_id: sessionId,
            seq: findings.length,
            session_id: sessionId,
            tool_call_id: "tc-report",
            source: "test",
            schema_version: SCHEMA_VERSION,
            projectDir: "/tmp/project",
            findings: findings.map((f, i) => ({
              ...f,
              run_id: sessionId,
              seq: i + 1,
              session_id: sessionId,
              tool_call_id: "tc-1",
              source: f.source ?? "slither",
              schema_version: SCHEMA_VERSION,
              observation_id: `obs-${f.id ?? i}`,
              issue_fingerprint: `issue-${f.id ?? i}`,
              observation_fingerprint: `obs-fp-${f.id ?? i}`,
              reported_by_agent: "sentinel" as const,
            })),
            toolsExecuted: [],
            scope: ["Vault.sol"],
          }),
          tool_coverage_policy: "skip",
        },
        createContext(tempDir),
        { loadConfig: () => createTestConfig(outputDir) },
      )

      expect(result.error).toBeUndefined()
      expect(result.filePath).toBeDefined()
      expect(existsSync(result.filePath ?? "")).toBe(true)

      const filename = path.basename(result.filePath ?? "")
      const auditDate = new Date().toISOString().slice(0, 10)
      const runIdPrefix = sessionId.substring(0, 8)
      expect(filename).toBe(`PolicyTest-security-audit-${auditDate}-${runIdPrefix}.md`)

      const content = await Bun.file(result.filePath ?? "").text()
      expect(content).toContain("<!-- argus:report_metadata")
      const extractedRunId = extractReportRunId(content)
      expect(extractedRunId).toBe(sessionId)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("second write with same run_id is rejected with DUPLICATE_WRITE_ATTEMPT", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-dup-"))
    const outputDir = "reports"

    try {
      const findings: Finding[] = [makeFinding()]
      const sessionId = "run-duplicate-test"
      const args = {
        project_name: "DupTest",
        scope: ["Vault.sol"],
        report_input: JSON.stringify({
          run_id: sessionId,
          seq: findings.length,
          session_id: sessionId,
          tool_call_id: "tc-report",
          source: "test",
          schema_version: SCHEMA_VERSION,
          projectDir: "/tmp/project",
          findings: findings.map((f, i) => ({
            ...f,
            run_id: sessionId,
            seq: i + 1,
            session_id: sessionId,
            tool_call_id: "tc-1",
            source: f.source ?? "slither",
            schema_version: SCHEMA_VERSION,
            observation_id: `obs-${f.id ?? i}`,
            issue_fingerprint: `issue-${f.id ?? i}`,
            observation_fingerprint: `obs-fp-${f.id ?? i}`,
            reported_by_agent: "sentinel" as const,
          })),
          toolsExecuted: [],
          scope: ["Vault.sol"],
        }),
        tool_coverage_policy: "skip" as const,
      }
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig(outputDir) }

      const first = await executeReportGeneration(args, context, deps)
      expect(first.error).toBeUndefined()
      expect(first.filePath).toBeDefined()
      expect(existsSync(first.filePath ?? "")).toBe(true)

      const second = await executeReportGeneration(args, context, deps)
      expect(second.error).toBeDefined()
      expect(second.error?.code).toBe("DUPLICATE_WRITE_ATTEMPT")
      expect(second.error?.message).toContain(sessionId)
      expect(second.error?.message).toContain(SINGLE_WRITER_POLICY_VERSION)

      expect(second.filePath).toBeUndefined()

      expect(second.report).toContain("# Security Audit Report — DupTest")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("write with different run_id succeeds (different run)", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-diff-"))
    const outputDir = "reports"

    try {
      const findings: Finding[] = [makeFinding()]
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig(outputDir) }

      const firstResult = await executeReportGeneration(
        {
          project_name: "DiffRunTest",
          scope: ["Vault.sol"],
          report_input: JSON.stringify({
            run_id: "run-alpha",
            seq: findings.length,
            session_id: "run-alpha",
            tool_call_id: "tc-report",
            source: "test",
            schema_version: SCHEMA_VERSION,
            projectDir: "/tmp/project",
            findings: findings.map((f, i) => ({
              ...f,
              run_id: "run-alpha",
              seq: i + 1,
              session_id: "run-alpha",
              tool_call_id: "tc-1",
              source: f.source ?? "slither",
              schema_version: SCHEMA_VERSION,
              observation_id: `obs-${f.id ?? i}`,
              issue_fingerprint: `issue-${f.id ?? i}`,
              observation_fingerprint: `obs-fp-${f.id ?? i}`,
              reported_by_agent: "sentinel" as const,
            })),
            toolsExecuted: [],
            scope: ["Vault.sol"],
          }),
          tool_coverage_policy: "skip" as const,
        },
        context,
        deps,
      )
      expect(firstResult.error).toBeUndefined()
      expect(firstResult.filePath).toBeDefined()

      const secondResult = await executeReportGeneration(
        {
          project_name: "DiffRunTest",
          scope: ["Vault.sol"],
          report_input: JSON.stringify({
            run_id: "run-beta",
            seq: findings.length,
            session_id: "run-beta",
            tool_call_id: "tc-report",
            source: "test",
            schema_version: SCHEMA_VERSION,
            projectDir: "/tmp/project",
            findings: findings.map((f, i) => ({
              ...f,
              run_id: "run-beta",
              seq: i + 1,
              session_id: "run-beta",
              tool_call_id: "tc-1",
              source: f.source ?? "slither",
              schema_version: SCHEMA_VERSION,
              observation_id: `obs-${f.id ?? i}`,
              issue_fingerprint: `issue-${f.id ?? i}`,
              observation_fingerprint: `obs-fp-${f.id ?? i}`,
              reported_by_agent: "sentinel" as const,
            })),
            toolsExecuted: [],
            scope: ["Vault.sol"],
          }),
          tool_coverage_policy: "skip" as const,
        },
        context,
        deps,
      )
      expect(secondResult.error).toBeUndefined()
      expect(secondResult.filePath).toBeDefined()
      expect(existsSync(secondResult.filePath ?? "")).toBe(true)

      const content = await Bun.file(secondResult.filePath ?? "").text()
      expect(extractReportRunId(content)).toBe("run-beta")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
