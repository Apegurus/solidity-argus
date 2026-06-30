import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ArgusConfig } from "../../src/config/types"
import { createAuditArtifactResolver } from "../../src/shared/audit-artifact-resolver"
import { SCHEMA_VERSION } from "../../src/state/schemas"
import type { Finding } from "../../src/state/types"
import { executeReportGeneration, extractReportRunId } from "../../src/tools/report-generator-tool"

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
    agents: { argus: {}, sentinel: {}, pythia: {}, auditSpecialist: {}, scribe: {}, themis: {} },
    tools: {},
    knowledge: {
      scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
      autoSync: true,
      skillPrecedence: "bundled-first" as const,
    },
    reporting: {
      confidenceThreshold: 80,
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

function reportArgs(projectName: string, runId: string, findings: Finding[] = [makeFinding()]) {
  return {
    project_name: projectName,
    scope: ["Vault.sol"],
    report_input: JSON.stringify({
      run_id: runId,
      seq: findings.length,
      session_id: runId,
      tool_call_id: "tc-report",
      source: "test",
      schema_version: SCHEMA_VERSION,
      projectDir: "/tmp/project",
      findings: findings.map((f, i) => ({
        ...f,
        run_id: runId,
        seq: i + 1,
        session_id: runId,
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

  test("second write with same run_id and content reuses the existing report", async () => {
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
      expect(second.error).toBeUndefined()
      expect(second.filePath).toBe(first.filePath)
      expect(second.idempotent).toBe(true)
      expect(second.reportStatus).toBe("reused")

      expect(second.report).toContain("# Security Audit Report — DupTest")

      const manifestPath = createAuditArtifactResolver(sessionId, tempDir).paths()
        .reportsManifestFile
      expect(existsSync(manifestPath)).toBe(true)
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        reports: Array<{ revision: number; filePath: string; contentHash: string }>
      }
      expect(manifest.reports).toHaveLength(1)
      expect(manifest.reports[0]?.revision).toBe(1)
      expect(manifest.reports[0]?.filePath).toBe(first.filePath)
      expect(manifest.reports[0]?.contentHash).toBe(first.contentHash)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("changed same-run content without explicit revision returns revision-required error", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-changed-no-rev-"))
    try {
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig("reports") }
      const base = await executeReportGeneration(
        reportArgs("ChangedNoRevision", "run-changed-no-revision", [
          makeFinding({ check: "first-check" }),
        ]),
        context,
        deps,
      )
      const changed = await executeReportGeneration(
        reportArgs("ChangedNoRevision", "run-changed-no-revision", [
          makeFinding({ check: "second-check" }),
        ]),
        context,
        deps,
      )

      expect(base.error).toBeUndefined()
      expect(changed.error?.code).toBe("REVISION_REQUIRED")
      expect(changed.error?.message).toContain("content changed")
      expect(changed.error?.message).toContain("revision: 2")
      expect(changed.filePath).toBeUndefined()
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

  test("revision 2 writes revised report only when content changes and preserves base report", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-revision-"))
    try {
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig("reports") }
      const args = reportArgs("RevisionTest", "run-revision-test", [
        makeFinding({ check: "base-check" }),
      ])

      const base = await executeReportGeneration(args, context, deps)
      const revised = await executeReportGeneration(
        {
          ...reportArgs("RevisionTest", "run-revision-test", [
            makeFinding({ check: "revised-check" }),
          ]),
          revision: 2,
        },
        context,
        deps,
      )

      expect(base.error).toBeUndefined()
      expect(revised.error).toBeUndefined()
      expect(base.filePath).toBeDefined()
      expect(revised.filePath).toBeDefined()
      if (!base.filePath || !revised.filePath) {
        throw new Error("Expected both revision reports to have file paths")
      }
      expect(base.filePath).not.toBe(revised.filePath)
      expect(path.basename(revised.filePath)).toContain("-r2.md")
      expect(existsSync(base.filePath)).toBe(true)
      expect(existsSync(revised.filePath)).toBe(true)

      const manifestPath = createAuditArtifactResolver("run-revision-test", tempDir).paths()
        .reportsManifestFile
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        reports: Array<{ revision: number; filePath: string; contentHash: string }>
      }
      expect(manifest.reports.map((report) => report.revision)).toEqual([1, 2])
      expect(manifest.reports.map((report) => report.filePath)).toEqual([
        base.filePath,
        revised.filePath,
      ])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("duplicate revision 2 write reuses the existing revised report", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-revision-dup-"))
    try {
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig("reports") }
      const args = { ...reportArgs("RevisionDupTest", "run-revision-dup-test"), revision: 2 }

      const first = await executeReportGeneration(args, context, deps)
      const second = await executeReportGeneration(args, context, deps)

      expect(first.error).toBeUndefined()
      expect(second.error).toBeUndefined()
      expect(second.filePath).toBe(first.filePath)
      expect(second.idempotent).toBe(true)
      expect(second.reportStatus).toBe("reused")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("force overwrites only same-run Argus report at base path", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-force-"))
    try {
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig("reports") }
      const args = reportArgs("ForceTest", "run-force-test", [
        makeFinding({ check: "first-check" }),
      ])

      const first = await executeReportGeneration(args, context, deps)
      expect(first.error).toBeUndefined()
      expect(readFileSync(first.filePath ?? "", "utf8")).toContain("First Check")

      const forced = await executeReportGeneration(
        {
          ...reportArgs("ForceTest", "run-force-test", [makeFinding({ check: "second-check" })]),
          force: true,
        },
        context,
        deps,
      )

      expect(forced.error).toBeUndefined()
      expect(forced.filePath).toBe(first.filePath)
      expect(readFileSync(first.filePath ?? "", "utf8")).toContain("Second Check")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("force refuses non-Argus or different-run report files", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-force-refuse-"))
    try {
      const context = createContext(tempDir)
      const deps = { loadConfig: () => createTestConfig("reports") }
      const args = reportArgs("RefuseForceTest", "run-force-refuse-test")
      const first = await executeReportGeneration(args, context, deps)
      expect(first.filePath).toBeDefined()
      writeFileSync(first.filePath ?? "", "# Manual report\n")

      const forced = await executeReportGeneration({ ...args, force: true }, context, deps)

      expect(forced.error?.code).toBe("INSECURE_OVERWRITE_REFUSED")
      expect(forced.filePath).toBeUndefined()
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("force plus revision is rejected before writing", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-force-revision-"))
    try {
      const result = await executeReportGeneration(
        { ...reportArgs("ForceRevisionTest", "run-force-revision-test"), force: true, revision: 2 },
        createContext(tempDir),
        { loadConfig: () => createTestConfig("reports") },
      )

      expect(result.error?.code).toBe("INVALID_REGENERATION_OPTIONS")
      expect(result.error?.message).toContain("revision: 2")
      expect(result.error?.message).toContain("omit force")
      expect(result.filePath).toBeUndefined()
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("revision below 2 is rejected with prescriptive guidance", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "argus-policy-revision-low-"))
    try {
      const result = await executeReportGeneration(
        { ...reportArgs("RevisionLowTest", "run-revision-low-test"), revision: 1 },
        createContext(tempDir),
        { loadConfig: () => createTestConfig("reports") },
      )

      expect(result.error?.code).toBe("INVALID_REGENERATION_OPTIONS")
      expect(result.error?.message).toContain("revision: 2")
      expect(result.filePath).toBeUndefined()
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
