import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ArtifactResolverError, createAuditArtifactResolver } from "./audit-artifact-resolver"

const RUN_ID = "run-abc-123"
const PROJECT_DIR = "/home/user/my-project"

describe("createAuditArtifactResolver", () => {
  test("same inputs always produce same paths (idempotent)", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const paths1 = resolver.paths()
    const paths2 = resolver.paths()

    expect(paths1.stateFile).toBe(paths2.stateFile)
    expect(paths1.journalFile).toBe(paths2.journalFile)
    expect(paths1.findingsFile).toBe(paths2.findingsFile)
    expect(paths1.reportDir).toBe(paths2.reportDir)
    expect(paths1.evidenceDir).toBe(paths2.evidenceDir)
    expect(paths1.archiveDir).toBe(paths2.archiveDir)
    expect(paths1.runDir).toBe(paths2.runDir)
  })

  test("two resolvers with same inputs produce byte-equal paths", () => {
    const r1 = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const r2 = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)

    const p1 = r1.paths()
    const p2 = r2.paths()

    expect(p1.stateFile).toBe(p2.stateFile)
    expect(p1.journalFile).toBe(p2.journalFile)
    expect(p1.findingsFile).toBe(p2.findingsFile)
    expect(p1.reportDir).toBe(p2.reportDir)
    expect(p1.evidenceDir).toBe(p2.evidenceDir)
    expect(p1.archiveDir).toBe(p2.archiveDir)
    expect(p1.runDir).toBe(p2.runDir)
  })

  test("empty runId throws ArtifactResolverError", () => {
    expect(() => createAuditArtifactResolver("", PROJECT_DIR)).toThrow(ArtifactResolverError)
  })

  test("whitespace-only runId throws ArtifactResolverError", () => {
    expect(() => createAuditArtifactResolver("   ", PROJECT_DIR)).toThrow(ArtifactResolverError)
  })

  test("empty projectDir throws ArtifactResolverError", () => {
    expect(() => createAuditArtifactResolver(RUN_ID, "")).toThrow(ArtifactResolverError)
  })

  test("whitespace-only projectDir throws ArtifactResolverError", () => {
    expect(() => createAuditArtifactResolver(RUN_ID, "   ")).toThrow(ArtifactResolverError)
  })

  test("reportFilePath returns reportDir joined with filename", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { reportDir } = resolver.paths()
    expect(resolver.reportFilePath("my-report.md")).toBe(join(reportDir, "my-report.md"))
  })

  test("evidenceFilePath returns evidenceDir joined with filename", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { evidenceDir } = resolver.paths()
    expect(resolver.evidenceFilePath("task-3.txt")).toBe(join(evidenceDir, "task-3.txt"))
  })

  test("journalFile path contains runs/{runId}/events.jsonl", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { journalFile } = resolver.paths()
    expect(journalFile).toContain(join("runs", RUN_ID, "events.jsonl"))
  })

  test("paths() uses .argus as write root by default", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { stateFile } = resolver.paths()
    expect(stateFile).toContain(join(PROJECT_DIR, ".argus"))
    expect(stateFile).toBe(join(PROJECT_DIR, ".argus", "argus-state.json"))
  })

  test("resolver exposes runId and projectDir as readonly properties", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    expect(resolver.runId).toBe(RUN_ID)
    expect(resolver.projectDir).toBe(PROJECT_DIR)
  })

  test("paths().runDir is under .argus/runs/{runId}", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { runDir } = resolver.paths()
    expect(runDir).toBe(join(PROJECT_DIR, ".argus", "runs", RUN_ID))
  })

  test("findingsFile is inside runDir", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { findingsFile, runDir } = resolver.paths()
    expect(findingsFile).toBe(join(runDir, "findings.json"))
  })

  test("evidenceDir is inside runDir", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { evidenceDir, runDir } = resolver.paths()
    expect(evidenceDir).toBe(join(runDir, "evidence"))
  })

  test("reportDir is {projectDir}/.argus/reports", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { reportDir } = resolver.paths()
    expect(reportDir).toBe(join(PROJECT_DIR, ".argus", "reports"))
  })

  test("archiveDir is {projectDir}/.argus/archives", () => {
    const resolver = createAuditArtifactResolver(RUN_ID, PROJECT_DIR)
    const { archiveDir } = resolver.paths()
    expect(archiveDir).toBe(join(PROJECT_DIR, ".argus", "archives"))
  })
})
