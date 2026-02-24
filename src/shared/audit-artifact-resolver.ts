import { join } from "node:path"
import { defaultRootResolver } from "./path-root-resolver"

export class ArtifactResolverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ArtifactResolverError"
  }
}

export interface AuditArtifactPaths {
  /** {projectDir}/.argus/argus-state.json */
  stateFile: string
  /** {projectDir}/.argus/runs/{runId}/events.jsonl */
  journalFile: string
  /** {projectDir}/.argus/runs/{runId}/findings.json */
  findingsFile: string
  reportInputFile: string
  /** {projectDir}/.argus/reports */
  reportDir: string
  /** {projectDir}/.argus/runs/{runId}/evidence */
  evidenceDir: string
  /** {projectDir}/.argus/archives */
  archiveDir: string
  /** {projectDir}/.argus/runs/{runId} */
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

  const writeRoot = defaultRootResolver.writeRoot(projectDir)
  const runDir = join(writeRoot, "runs", runId)

  const cachedPaths: AuditArtifactPaths = {
    stateFile: join(writeRoot, "argus-state.json"),
    journalFile: join(runDir, "events.jsonl"),
    findingsFile: join(runDir, "findings.json"),
    reportInputFile: join(runDir, "report-input.json"),
    reportDir: join(writeRoot, "reports"),
    evidenceDir: join(runDir, "evidence"),
    archiveDir: join(writeRoot, "archives"),
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
