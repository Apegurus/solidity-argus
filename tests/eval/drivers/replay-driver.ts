import { readFileSync } from "node:fs"
import { join } from "node:path"
import { finalizeProjectedFindings } from "../../../src/state/finding-aggregation"
import type { CanonicalFinding, CanonicalToolExecution } from "../../../src/state/schemas"
import type { AuditDriver } from "../runner"
import type { PredictedFinding } from "../types"

type ReplayObservations = {
  findings: CanonicalFinding[]
  toolExecutions: CanonicalToolExecution[]
  forgeAvailable: boolean
}

function normalizeFixtureFile(file: string, fixtureRoot: string): string {
  const prefix = `${fixtureRoot.replace(/^\.\//, "")}/`
  return file.startsWith(prefix) ? file.slice(prefix.length) : file
}

export function createReplayDriver(observationsPath?: string): AuditDriver {
  return {
    async audit(fixture) {
      const path =
        observationsPath ??
        join(import.meta.dir, "..", "fixtures", fixture.slug, "observations.json")
      const observations = JSON.parse(readFileSync(path, "utf8")) as ReplayObservations
      const finalized = finalizeProjectedFindings(
        observations.findings,
        observations.toolExecutions,
        {
          forgeAvailable: observations.forgeAvailable,
        },
      )
      const predicted: PredictedFinding[] = finalized.map((finding) => ({
        check: finding.check,
        severity: finding.severity,
        confidence: finding.confidence,
        confidence_score: finding.confidence_score,
        rubric_verdict: finding.rubric_verdict,
        tier: finding.rubric_verdict === "CONFIRMED" ? "finding" : "lead",
        file: normalizeFixtureFile(finding.file, fixture.project.root),
        lines: finding.lines,
        source: finding.source,
      }))
      return { predicted }
    },
  }
}
