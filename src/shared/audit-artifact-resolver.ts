import { join } from "node:path"

export class ArtifactResolverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArtifactResolverError"
  }
}

export interface AuditArtifactPaths {
  /** {projectDir}/.opencode/argus-state.json (legacy compat) */
  stateFile: string
  /** {projectDir}/.opencode/runs/{runId}/events.jsonl */
  journalFile: string
  /** {projectDir}/.opencode/runs/{runId}/findings.json */
  findingsFile: string
  /** {projectDir}/.opencode/reports */
  reportDir: string
  /** {projectDir}/.opencode/runs/{runId}/evidence */
  evidenceDir: string
  /** {projectDir}/.opencode/archives */
  archiveDir: string
  /** {projectDir}/.opencode/runs/{runId} */
  runDir: string
}

export interface AuditArtifactResolver {
  readonly runId: string
  readonly projectDir: string
  paths(): AuditArtifactPaths
  /** Returns {reportDir}/{filename} */
  reportFilePath(filename: string): string
  /** Returns {evidenceDir}/{filename} */
  evidenceFilePath(filename: string): string
}

export function createAuditArtifactResolver(
  runId: string,
  projectDir: string,
): AuditArtifactResolver {
  if (!runId || runId.trim() === "") {
    throw new ArtifactResolverError("runId must not be empty")
  }
  if (!projectDir || projectDir.trim() === "") {
    throw new ArtifactResolverError("projectDir must not be empty")
  }

  const opencodeDir = join(projectDir, ".opencode")
  const runDir = join(opencodeDir, "runs", runId)

  const cachedPaths: AuditArtifactPaths = {
    stateFile: join(opencodeDir, "argus-state.json"),
    journalFile: join(runDir, "events.jsonl"),
    findingsFile: join(runDir, "findings.json"),
    reportDir: join(opencodeDir, "reports"),
    evidenceDir: join(runDir, "evidence"),
    archiveDir: join(opencodeDir, "archives"),
    runDir,
  }

  return {
    runId,
    projectDir,
    paths(): AuditArtifactPaths {
      return cachedPaths
    },
    reportFilePath(filename: string): string {
      return join(cachedPaths.reportDir, filename)
    },
    evidenceFilePath(filename: string): string {
      return join(cachedPaths.evidenceDir, filename)
    },
  }
}
