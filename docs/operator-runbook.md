# Argus Production-Grade Hardening — Operator Runbook

> **Audience**: Release managers, platform engineers, and on-call operators responsible for deploying and maintaining `solidity-argus` in production.
> **Scope**: Migration mode transitions, cutover procedures, rollback steps, and troubleshooting for the canonical state, report pipeline, and Solodit integration.

---

## 1. Overview

This runbook covers the operational procedures for the **Argus Production-Grade State and Reporting Hardening** release. The hardening introduces:

- **Event-sourced canonical audit state** — all findings and lifecycle events are appended to a per-run journal (`events.jsonl`) and projected deterministically.
- **Single report writer pipeline** — only `argus_generate_report` writes final report files; Scribe no longer writes directly.
- **Migration modes** — a three-stage compatibility system (`legacy` → `dual` → `strict`) for safe rollout.
- **Parity telemetry** — dual mode compares legacy and canonical outputs to validate equivalence before cutover.
- **Quality gates** — Critical/High findings require non-empty impact, recommendation, and PoC evidence.

**Schema versions in this release:**
- `SCHEMA_VERSION = "1.0.0"` (canonical event/finding schema)
- `SINGLE_WRITER_POLICY_VERSION = "1.0.0"` (report writer policy)

---

## 2. Architecture Summary

### Canonical State Model

```
Audit Session
  └── AuditRun (run_id = UUID)
        ├── events.jsonl          ← append-only event journal
        │     ├── session.created
        │     ├── tool.executed   (argus_slither_analyze, argus_forge_test, etc.)
        │     ├── finding.added   (CanonicalFinding records)
        │     └── session.deleted
        ├── sessions/state-{sessionId}.json   ← live session state while audit is active
        ├── archives/argus-state.{timestamp}.json   ← archived teardown snapshot
        └── reports/
              └── {ContractName}-security-audit-YYYY-MM-DD.md
```

**Artifact paths (write root is `.argus`; `.opencode` is transitional read fallback):**
| Artifact | Path |
|----------|------|
| Event journal | `{projectDir}/.argus/runs/{runId}/events.jsonl` |
| Live session state | `{projectDir}/.argus/sessions/state-{sessionId}.json` |
| Archives | `{projectDir}/.argus/archives/argus-state.{timestamp}.json` |
| Reports | `{projectDir}/.argus/reports/{ContractName}-security-audit-YYYY-MM-DD.md` |

**Root precedence contract:**
- Write root: `.argus` only.
- Read roots: `[.argus, .opencode]` in that order.
- Migration posture: `.opencode` remains supported as a read fallback during transition.

### Report Pipeline

```
Argus (orchestrator)
  → collects findings via hooks (tool-tracking-hook.ts)
  → dispatches Scribe with structured ReportInput payload
  → Scribe calls argus_generate_report (ONLY writer)
  → report written to canonical path
  → contentHash embedded in report metadata comment
```

### Projectors

```typescript
// Replay events to canonical state (deterministic, pure function)
const findings = projectFindings(events)           // CanonicalFinding[]
const state    = projectAuditState(events, dir)    // AuditState
const hash     = stableHash(findings)              // SHA-256 of sorted JSON
```

---

## 3. Migration Modes

Configure in `.argus/solidity-argus.jsonc`:

```jsonc
{
  "migration": {
    "mode": "legacy"   // "legacy" | "dual" | "strict"
  }
}
```

| Mode | Behavior | Use Case |
|------|----------|----------|
| `"legacy"` | Uses only the legacy `AuditState` path. Backward compatible. | Default. Safe for all existing deployments. |
| `"dual"` | Runs both legacy and canonical paths. Emits parity metrics comparing outputs. | Validation phase before strict cutover. |
| `"strict"` | Uses only the canonical path. Rejects legacy-only payloads missing canonical fields. | Post-validation production mode. |

**Default**: `"legacy"` — no behavior change from pre-hardening releases.

### Parity Metrics (dual mode)

In `dual` mode, `computeParityMetrics()` emits:
- `findingCountDiff` — difference in finding count between legacy and canonical projections
- `severityDistributionDiff` — per-severity count differences
- `contentHashMatch` — whether the projected finding hashes match
- `onlyInLegacy` / `onlyInCanonical` — findings present in one path but not the other

---

## 4. Pre-Cutover Checklist

Run these checks **before** switching from `legacy` to `dual` or from `dual` to `strict`.

### 4.1 Health Check

```bash
# Verify all components are healthy
argus doctor
```

Expected output:
```
✓ Slither: installed
✓ Forge: installed
✓ Config: valid
✓ Skills: required audit skills resolvable
✓ SCVD API: reachable
✓ Solodit MCP: reachable on port 3000
```

If any check fails, resolve before proceeding.

### 4.2 Full Test Suite

```bash
bun test
```

Expected: **0 failures**. If any tests fail, do NOT proceed with cutover.

### 4.3 Production Readiness Suite

```bash
bun test tests/integration/determinism-replay.test.ts
bun test tests/integration/subagent-telemetry-capture.test.ts
bun test tests/integration/report-contract.test.ts
bun test tests/integration/report-quality-gates.test.ts
bun test tests/integration/migration-modes.test.ts
bun test tests/integration/single-writer-policy.test.ts
```

Expected: All pass. These are the canonical production invariant tests.

### 4.4 Typecheck

```bash
bun run typecheck
```

Expected: Exit 0, no errors.

### 4.5 Archive Current State (rollback checkpoint)

```bash
# Create a timestamped backup of the legacy shared state if it exists
if [ -f .argus/argus-state.json ]; then
  cp .argus/argus-state.json .argus/argus-state.pre-cutover-$(date +%Y%m%d-%H%M%S).json
fi
```

---

## 5. Cutover Execution

### 5.1 Switch to Dual Mode (validation phase)

1. Edit `.argus/solidity-argus.jsonc`:
   ```jsonc
   {
     "migration": {
       "mode": "dual"
     }
   }
   ```

2. Run a test audit to generate parity metrics:
   ```bash
   # Run a full audit on a known contract
   # Parity metrics will be logged to the run journal
   ```

3. Check parity metrics in the run journal:
   ```bash
    cat .argus/runs/$(ls -t .argus/runs/ | head -1)/events.jsonl | grep "parity"
   ```

4. Verify `findingCountDiff = 0` and `contentHashMatch = true` before proceeding to strict mode.

### 5.2 Switch to Strict Mode (production cutover)

Only proceed if dual-mode parity validation passed (Step 5.1).

1. Edit `.argus/solidity-argus.jsonc`:
   ```jsonc
   {
     "migration": {
       "mode": "strict"
     }
   }
   ```

2. Run the migration modes test to confirm strict mode works:
   ```bash
   bun test tests/integration/migration-modes.test.ts
   ```

3. Run a full audit to confirm end-to-end behavior.

---

## 6. Post-Cutover Validation

After switching modes, verify the system is operating correctly.

### 6.1 Verify Event Journal is Being Written

```bash
# After running an audit, check that events.jsonl exists
ls -la .argus/runs/*/events.jsonl
```

Expected: One `events.jsonl` per run, with `session.created`, `tool.executed`, `finding.added`, and `session.deleted` events.

### 6.2 Verify Report Path Determinism

```bash
# Run the report path resolver tests
bun test src/shared/report-path-resolver.test.ts
```

Expected: All pass. Report filenames follow `{ContractName}-security-audit-YYYY-MM-DD.md`.

### 6.3 Verify Single Writer Policy

```bash
bun test tests/integration/single-writer-policy.test.ts
```

Expected: All pass. No duplicate report artifacts for the same `run_id`.

### 6.4 Verify Deterministic Replay

```bash
bun test tests/integration/determinism-replay.test.ts
```

Expected: All pass. Identical event streams produce byte-identical outputs.

### 6.5 Verify Quality Gates

```bash
bun test tests/integration/report-quality-gates.test.ts
```

Expected: All pass. Critical/High findings require non-empty impact and recommendation.

---

## 7. Rollback Procedure

### 7.1 Rollback from Strict to Dual

1. Edit `.argus/solidity-argus.jsonc`:
   ```jsonc
   {
     "migration": {
       "mode": "dual"
     }
   }
   ```

2. Verify the system is healthy:
   ```bash
   argus doctor
   bun test tests/integration/migration-modes.test.ts
   ```

### 7.2 Rollback from Dual to Legacy

1. Edit `.argus/solidity-argus.jsonc`:
   ```jsonc
   {
     "migration": {
       "mode": "legacy"
     }
   }
   ```
   Or remove the `migration` section entirely (defaults to `"legacy"`).

2. Restore pre-cutover state if needed:
   ```bash
   # Restore from the backup created in Pre-Cutover step 4.5, if you captured one
   cp .argus/argus-state.pre-cutover-YYYYMMDD-HHMMSS.json .argus/argus-state.json
   ```

3. Verify:
   ```bash
   argus doctor
   bun test
   ```

### 7.3 Emergency Rollback (data corruption suspected)

1. Immediately switch to `legacy` mode (see 7.2).
2. Do NOT delete any `.argus/runs/*/events.jsonl` files — they are forensic evidence.
3. Archive the corrupted run:
   ```bash
    mv .argus/runs/{runId} .argus/runs/{runId}.corrupted-$(date +%Y%m%d-%H%M%S)
   ```
4. File an incident report with the archived run directory for post-mortem analysis.

---

## 8. Troubleshooting

### 8.1 State / Event Journal Issues

**Symptom**: `events.jsonl` not being created or missing events.

**Diagnosis**:
```bash
# Check if the event sink is writing
ls -la .argus/runs/*/events.jsonl
# Check for permission issues
ls -la .argus/runs/
```

**Remediation**:
- Ensure `.argus/runs/` directory is writable.
- Check for disk space issues.
- Review `src/features/persistent-state/event-sink.ts` for `EventSinkError` in logs.

---

**Symptom**: Run finalization fails with invariant errors.

**Diagnosis**:
```bash
# Check for failed-finalization events in the journal
cat .argus/runs/*/events.jsonl | grep "finalization"
```

**Remediation**:
- Finalization failures are non-fatal — the archive still proceeds.
- Review the `errors` field in the finalization event for specific invariant violations.
- Common cause: missing terminal `session.deleted` event (session crashed before cleanup).

---

### 8.2 Report Pipeline Issues

**Symptom**: Report not generated or written to wrong path.

**Diagnosis**:
```bash
# Check canonical report path
ls -la .argus/reports/
# Check for DUPLICATE_WRITE_ATTEMPT error in report result
```

**Remediation**:
- Verify `argus_generate_report` is the only tool writing reports (check Scribe prompt for direct write instructions).
- If `DUPLICATE_WRITE_ATTEMPT` error: same `run_id` tried to write twice. Check for duplicate tool calls.
- Report path follows: `{outputDir}/{ContractName}-security-audit-YYYY-MM-DD.md`

---

**Symptom**: Quality gate failures blocking report generation in strict mode.

**Diagnosis**:
```bash
bun test tests/integration/report-quality-gates.test.ts --verbose
```

**Remediation**:
- Quality gates require Critical/High findings to have non-empty `impact`, `recommendation`, and `exploitReference` or `proofOfConcept`.
- Switch to `warn` policy temporarily: pass `dropPolicy: "warn"` to `argus_generate_report`.
- Fix the finding data to include required fields before switching back to strict.

---

### 8.3 Solodit Integration Issues

**Symptom**: Solodit search returning empty results or errors.

**Diagnosis**:
```bash
argus doctor
# Check: ✓ Solodit MCP: reachable on port 3000
```

**Remediation**:
- If Solodit MCP is unreachable, the HTTP fallback will be used automatically.
- Check if Solodit MCP server is running: `lsof -i :3000`
- If port conflict (EADDRINUSE): kill the conflicting process or change the Solodit port in config.
- The search tool always attempts HTTP fallback — no manual intervention needed for degraded mode.

---

**Symptom**: Solodit health check failing with protocol errors.

**Diagnosis**:
```bash
bun test src/utils/solodit-health.test.ts --verbose
```

**Remediation**:
- Health probe uses JSON-RPC POST with `initialize` handshake.
- If the MCP server version changed, check `src/utils/solodit-health.ts` for protocol compatibility.

---

### 8.4 Migration Mode Issues

**Symptom**: Strict mode rejecting valid payloads.

**Diagnosis**:
```bash
bun test tests/integration/migration-modes.test.ts --verbose
```

**Remediation**:
- Strict mode requires canonical fields (`run_id`, `schema_version`, `findings` as `CanonicalFinding[]`).
- Use `validateStrictCompatibility(payload)` from `src/features/migration/migration-adapter.ts` to diagnose missing fields.
- Switch to `dual` mode to see parity metrics and identify what's missing.

---

**Symptom**: Parity metrics show `findingCountDiff != 0` in dual mode.

**Diagnosis**:
```bash
# Check parity events in the run journal
cat .argus/runs/$(ls -t .argus/runs/ | head -1)/events.jsonl | grep "parity"
```

**Remediation**:
- `onlyInLegacy` findings: canonical path is missing findings that legacy captures. Do NOT switch to strict mode.
- `onlyInCanonical` findings: canonical path is capturing more findings than legacy. Investigate if these are valid new findings or false positives.
- Do NOT switch to strict mode until `findingCountDiff = 0` and `contentHashMatch = true`.

---

## 9. Background vs Foreground Delegation

This section covers when to use background (async) vs foreground (sync) subagent delegation, how to recognize degraded `background_output` retrieval, and how to recover.

### 9.1 Decision Table: Background vs Foreground

Use this table to determine the correct execution mode for each audit situation.

| Audit Situation | Execution Mode | Rationale |
|-----------------|---------------|-----------|
| Independent tool scans (Slither + pattern check) | **Background** | No data dependency; parallel execution saves wall-clock time |
| Solodit research concurrent with static analysis | **Background** | Independent knowledge retrieval; safe to parallelize |
| Synthesis of findings from multiple tools | **Foreground** | Requires reading durable state from prior tool outputs |
| Report generation via Scribe | **Foreground** | Depends on complete findings and `toolsExecuted` state |
| Re-dispatch for missing evidence segments | **Foreground** | Must confirm retrieval before proceeding; re-dispatch is foreground-only |
| Single-tool quick checks (≤60s workload class) | **Background** | Low retrieval risk; quick turnaround |
| Multi-agent deep audits (≤600s workload class) | **Background (bounded)** | Use bounded fan-out: max 2 concurrent high-context tasks; split into waves |

**Bounded fan-out rule**: Never exceed 2 concurrent high-context background delegations. Split larger workloads into sequential waves to prevent retrieval blind spots.

### 9.2 Workload Classes and Retrieval Budgets

Each background delegation should be classified by expected duration:

| Workload Class | Budget | Criteria | Retrieval Risk |
|----------------|--------|----------|----------------|
| **quick** | ≤60s | Single-tool or single-contract checks | Low |
| **standard** | ≤180s | Multi-tool single-agent batches | Medium |
| **deep** | ≤600s | Multi-agent or synthesis-heavy runs | High — apply bounded fan-out |

Poll until the task reaches a terminal state: `completed`, `error`, `cancelled`, or `interrupt`.

### 9.3 Recognized Symptoms of Degraded `background_output` Retrieval

When background delegations complete but retrieval is degraded, operators may observe:

| Symptom | Description | Likely Cause |
|---------|-------------|-------------|
| Empty transcript | `background_output` returns no messages despite task completing | Retrieval timeout; transcript evicted before read |
| Missing terminal status | Task appears stuck without `completed`/`error` state | Background task crashed or exceeded budget |
| Partial tool results | Some `toolsExecuted` entries present but others missing | Concurrent fan-out exceeded retrieval capacity |
| Stale or incomplete findings | Findings count lower than expected for the scope | Background task produced results but transcript was truncated |
| Orphaned tool starts | `toolsExecuted` shows start but no end time | Task interrupted mid-execution |

### 9.4 Recovery Steps: Foreground Re-dispatch

When degraded retrieval is confirmed, follow these steps:

1. **Check durable state first**: Before re-dispatching, verify whether durable evidence already exists in `toolsExecuted` records, `findings` state, and the event stream (`events.jsonl`). If durable state is complete, no re-dispatch is needed — proceed to synthesis.

2. **Identify specific gaps**: Determine exactly which tool outputs or evidence segments are missing. Do not re-dispatch everything — target only the missing segments.

3. **Re-dispatch in foreground only**: Use `run_in_background=false` for all recovery dispatches. This ensures results are retrieved synchronously and avoids compounding retrieval failures.
   ```
   Task(subagent_type="sentinel", run_in_background=false,
     prompt="Re-run argus_check_patterns on src/Vault.sol — prior background run did not produce durable pattern results.")
   ```

4. **Verify evidence after re-dispatch**: Confirm that `toolsExecuted` now contains the missing entries and that finding counts match expectations before proceeding to synthesis or reporting.

5. **Do not retry indefinitely**: Re-dispatch is a **last resort**. If a foreground re-dispatch also fails, note the gap in the report Limitations section (see 9.5) and proceed with available evidence.

### 9.5 Limitation Disclosure Policy

When background retrieval degrades and re-dispatch cannot fully recover, the operator must ensure the final report discloses the gap:

- Scribe's `## Limitations` section must list any tool that was unavailable, timed out, or produced incomplete results.
- Use the format: `**Tool name**: [reason]. [Impact on finding coverage.]`
- Example: `**argus_forge_fuzz**: Background retrieval returned empty transcript; foreground re-dispatch timed out. Fuzz testing coverage is absent for mathematical functions.`
- Never silently omit limitations — incomplete coverage must always be disclosed per Scribe's contract.

### 9.6 Operator Checklist: Background Retrieval Incident

Use this checklist when a background retrieval incident occurs during an audit:

- [ ] Confirm the background task reached terminal state (`completed`, `error`, `cancelled`, `interrupt`)
- [ ] Check durable state: are `toolsExecuted` records and findings present despite empty transcript?
- [ ] If durable state is complete: proceed to synthesis (no re-dispatch needed)
- [ ] If durable state has gaps: identify specific missing evidence segments
- [ ] Re-dispatch missing segments in foreground (`run_in_background=false`)
- [ ] Verify re-dispatched results appear in durable state
- [ ] If re-dispatch fails: document gap in report Limitations section
- [ ] Confirm bounded fan-out was respected (max 2 concurrent background tasks)

---

## 10. CI Gates Reference

| CI Job | Command | What It Enforces |
|--------|---------|-----------------|
| `quality` | `biome ci .` | Code formatting and lint rules |
| `typecheck` | `bun run typecheck` | TypeScript type correctness |
| `test` | `bun test` | All unit and integration tests (1138+ tests) |
| `e2e` | `bun test` (with Slither + Foundry) | End-to-end audit pipeline with real tools |
| `production-readiness` | 6 integration test files (see below) | Production invariants |

### Production Readiness CI Tests

| Test File | Invariant |
|-----------|-----------|
| `tests/integration/determinism-replay.test.ts` | Identical event streams → byte-identical outputs |
| `tests/integration/subagent-telemetry-capture.test.ts` | Parent/child session telemetry correlation |
| `tests/integration/report-contract.test.ts` | Structured ReportInput contract compliance |
| `tests/integration/report-quality-gates.test.ts` | Critical/High finding completeness gates |
| `tests/integration/migration-modes.test.ts` | Migration mode behavior (legacy/dual/strict) |
| `tests/integration/single-writer-policy.test.ts` | No duplicate report artifacts per run_id |

**All production-readiness tests are blocking** — a failure prevents merge to main.

Evidence artifacts from CI runs are uploaded to the `production-readiness-evidence` artifact with 90-day retention.

---

## Appendix: Key Configuration Reference

```jsonc
// .argus/solidity-argus.jsonc
{
  "migration": {
    "mode": "legacy"   // "legacy" | "dual" | "strict" — default: "legacy"
  },
  "reporting": {
    "format": "markdown",
    "severityThreshold": "low"
  },
  "solodit": {
    "enabled": true,
    "port": 3000
  }
}
```

## Appendix: Schema Version History

| Version | Release | Changes |
|---------|---------|---------|
| `1.0.0` | This release | Initial canonical schema: `AuditEvent`, `CanonicalFinding`, `ReportInput` |

---

*Last updated: 2026-02-22 | Argus Production-Grade Hardening release*
