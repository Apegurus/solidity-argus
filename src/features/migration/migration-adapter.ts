import {
  createDropDiagnosticsCollector,
  type DropDiagnosticsCollector,
} from "../../shared/drop-diagnostics"
import { normalizeLegacyFindingsArray, normalizeToCanonicalFinding } from "../../state/adapters"
import type { CanonicalFinding, ReportInput } from "../../state/schemas"
import { SCHEMA_VERSION } from "../../state/schemas"
import type { AuditState, Finding } from "../../state/types"

export type MigrationMode = "legacy" | "dual" | "strict"

/**
 * Adapts a legacy `AuditState` into canonical `CanonicalFinding[]`.
 *
 * In legacy mode: returns the raw findings as-is (backward compatible).
 * In dual mode: normalizes findings to canonical AND returns both.
 * In strict mode: normalizes to canonical, rejects payloads missing required canonical fields.
 */
export function adaptLegacyFindings(
  state: AuditState,
  mode: MigrationMode,
  runId: string,
): {
  legacyFindings: Finding[]
  canonicalFindings: CanonicalFinding[]
  diagnostics: ReturnType<DropDiagnosticsCollector["getDiagnostics"]>
} {
  const legacyFindings = state.findings

  if (mode === "legacy") {
    return {
      legacyFindings,
      canonicalFindings: [],
      diagnostics: [],
    }
  }

  const policy = mode === "strict" ? "strict-fail" : "warn"
  const diag = createDropDiagnosticsCollector(policy, "migration-adapter")

  const { findings: canonicalFindings, diagnostics: adapterDiags } = normalizeLegacyFindingsArray(
    legacyFindings as unknown as unknown[],
    runId,
  )

  for (const d of adapterDiags) {
    if (d.level === "error") {
      diag.error(d.code, d.message, d.field)
    } else {
      diag.warn(d.code, d.message, d.field)
    }
  }

  // In strict mode, validate that all legacy findings survived normalization
  if (mode === "strict" && canonicalFindings.length < legacyFindings.length) {
    const dropped = legacyFindings.length - canonicalFindings.length
    diag.error(
      "STRICT_FINDINGS_DROPPED",
      `${dropped} legacy finding(s) could not be normalized to canonical format`,
    )
  }

  // Throws DropDiagnosticsError in strict mode if errors exist
  diag.throwIfStrict()

  return {
    legacyFindings,
    canonicalFindings,
    diagnostics: diag.getDiagnostics(),
  }
}

/**
 * Adapts a legacy `AuditState` into a canonical `ReportInput`.
 *
 * Maps legacy AuditState fields to the canonical ReportInput contract.
 */
export function adaptLegacyStateToReportInput(
  state: AuditState,
  mode: MigrationMode,
  runId: string,
): {
  reportInput: ReportInput
  diagnostics: ReturnType<DropDiagnosticsCollector["getDiagnostics"]>
} {
  const { canonicalFindings, diagnostics } = adaptLegacyFindings(
    state,
    mode === "legacy" ? "dual" : mode,
    runId,
  )

  const reportInput: ReportInput = {
    run_id: runId,
    seq: 0,
    session_id: state.sessionId,
    tool_call_id: "",
    source: "migration-adapter",
    schema_version: SCHEMA_VERSION,
    projectDir: state.projectDir,
    findings: canonicalFindings,
    toolsExecuted: state.toolsExecuted.map((t) => ({
      ...t,
      run_id: runId,
      schema_version: SCHEMA_VERSION,
    })),
    scope: state.scope,
    soloditResults: state.soloditResults,
    fuzzCounterexamples: state.fuzzCounterexamples,
    coverageReport: state.coverageReport,
    gasHotspots: state.gasHotspots,
    proxyContracts: state.proxyContracts,
  }

  return { reportInput, diagnostics }
}

/**
 * Validates that a legacy AuditState is compatible with strict mode.
 * Returns true if ALL findings can be normalized without errors.
 */
export function validateStrictCompatibility(
  state: AuditState,
  runId: string,
): { compatible: boolean; errors: string[] } {
  const errors: string[] = []

  for (const [index, finding] of state.findings.entries()) {
    const result = normalizeToCanonicalFinding(
      finding as unknown as Record<string, unknown>,
      runId,
      index + 1,
    )
    const hasErrors = result.diagnostics.some((d) => d.level === "error")
    if (hasErrors) {
      errors.push(
        ...result.diagnostics
          .filter((d) => d.level === "error")
          .map((d) => `[finding:${index}] ${d.message}`),
      )
    }
  }

  return { compatible: errors.length === 0, errors }
}
