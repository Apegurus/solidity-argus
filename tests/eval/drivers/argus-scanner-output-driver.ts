import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { z } from "zod"
import { isContained } from "../../../src/shared/path-safety"
import type { AuditDriver } from "../runner"

const PredictedFindingSchema = z.object({
  check: z.string(),
  severity: z.enum(["Critical", "High", "Medium", "Low", "Informational"]),
  confidence: z.enum(["High", "Medium", "Low"]),
  confidence_score: z.number().optional(),
  rubric_verdict: z.enum(["CONFIRMED", "DEMOTED", "REJECTED_DEMOTED"]).optional(),
  tier: z.enum(["finding", "lead"]).optional(),
  file: z.string(),
  lines: z.tuple([z.number(), z.number()]),
  source: z.enum(["slither", "manual", "pattern", "scvd", "solodit", "fuzz"]),
})

const WorkerResultSchema = z.object({ predicted: z.array(PredictedFindingSchema) })

export type ArgusScannerOutputDriverOptions = {
  readonly patterns?: readonly string[]
  readonly repoRoot?: string
}

class ArgusScannerOutputWorkerError extends Error {
  readonly exitCode: number

  constructor(exitCode: number, stderr: string) {
    super(`Argus pipeline worker exited with code ${exitCode}: ${stderr.trim()}`)
    this.name = "ArgusScannerOutputWorkerError"
    this.exitCode = exitCode
  }
}

export function createArgusScannerOutputDriver(
  options: ArgusScannerOutputDriverOptions = {},
): AuditDriver {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dir, "..", "..", "..")
  const workerPath = join(import.meta.dir, "argus-scanner-output-worker.ts")

  return {
    async audit(fixture) {
      const sandbox = mkdtempSync(join(tmpdir(), `argus-eval-${fixture.slug}-`))
      try {
        const sourceProjectDir = resolve(repoRoot, fixture.project.root)
        if (!isContained(sourceProjectDir, repoRoot)) {
          throw new Error(`Fixture project escapes repository root: ${fixture.project.root}`)
        }
        const projectDir = join(sandbox, "project")
        cpSync(sourceProjectDir, projectDir, { recursive: true, dereference: true })

        const worker = Bun.spawn(
          ["bun", workerPath, projectDir, JSON.stringify(options.patterns ?? [])],
          {
            cwd: repoRoot,
            env: {
              ...process.env,
              ARGUS_CACHE_DIR: join(sandbox, "cache"),
              ARGUS_LOG_FILE: join(sandbox, "argus.log"),
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        )
        const [exitCode, stdout, stderr] = await Promise.all([
          worker.exited,
          new Response(worker.stdout).text(),
          new Response(worker.stderr).text(),
        ])
        if (exitCode !== 0) throw new ArgusScannerOutputWorkerError(exitCode, stderr)
        return WorkerResultSchema.parse(JSON.parse(stdout))
      } finally {
        rmSync(sandbox, { recursive: true, force: true })
      }
    },
  }
}
