import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { z } from "zod"
import { computeRunMetrics } from "./metrics"
import type {
  AuditResult,
  FixtureManifest,
  PredictedFinding,
  RunMetrics,
  RunOptions,
} from "./types"

const SEVERITY = z.enum(["Critical", "High", "Medium", "Low", "Informational"])

const GroundTruthFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: SEVERITY,
  file: z.string(),
  lines: z.tuple([z.number(), z.number()]),
  cwe: z.string().optional(),
  swc: z.string().optional(),
  source: z.object({
    audit: z.string(),
    url: z.string().optional(),
    finding_number: z.union([z.string(), z.number()]).optional(),
  }),
  category: z.string().optional(),
  acceptance_criteria: z.array(z.string()),
})

const FixtureManifestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  source: z.object({
    name: z.string(),
    url: z.string().optional(),
    license: z.string(),
    commit: z.string().optional(),
  }),
  project: z.object({
    root: z.string(),
    contracts_glob: z.string(),
    foundry: z.boolean(),
  }),
  expected_findings: z.array(GroundTruthFindingSchema),
})

export function loadFixture(fixtureDir: string): FixtureManifest {
  const yamlPath = join(fixtureDir, "fixture.yaml")
  const jsonPath = join(fixtureDir, "fixture.json")
  let raw: string
  let parsed: unknown
  if (existsSync(yamlPath)) {
    raw = readFileSync(yamlPath, "utf8")
    parsed = parseYaml(raw)
  } else if (existsSync(jsonPath)) {
    raw = readFileSync(jsonPath, "utf8")
    parsed = JSON.parse(raw)
  } else {
    throw new Error(`Fixture manifest not found: ${yamlPath} or ${jsonPath}`)
  }
  return FixtureManifestSchema.parse(parsed)
}

export interface AuditDriver {
  audit(fixture: FixtureManifest): Promise<{ predicted: PredictedFinding[]; tokens_used?: number }>
}

export async function runFixture(
  options: RunOptions & { driver: AuditDriver },
): Promise<RunMetrics> {
  const { fixture, driver } = options

  const started_at = Date.now()
  const { predicted, tokens_used } = await driver.audit(fixture)
  const finished_at = Date.now()

  const filtered_predicted = options.confidence_threshold
    ? predicted.filter(
        (p) =>
          typeof p.confidence_score !== "number" ||
          p.confidence_score >= (options.confidence_threshold ?? 0),
      )
    : predicted

  const result: AuditResult = {
    fixture_slug: fixture.slug,
    started_at,
    finished_at,
    predicted: filtered_predicted,
    raw_predicted_count: predicted.length,
    filtered_predicted_count: filtered_predicted.length,
    tokens_used,
  }

  return computeRunMetrics(fixture, result, {
    allow_file_match_fallback: false,
    severity_floor: options.severity_threshold,
  })
}
