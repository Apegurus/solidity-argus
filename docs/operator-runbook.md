# Argus Production Operations Runbook

> **Audience**: Release managers, platform engineers, and on-call operators responsible for deploying and maintaining `solidity-argus` in production.
> **Scope**: Deployment checks, rollback steps, and troubleshooting for canonical state, report generation, configuration, and Solodit search.

---

## 1. Overview

This runbook covers the supported production operation of `solidity-argus`:

- **Event-sourced canonical audit state** — all findings and lifecycle events are appended to a per-run journal (`events.jsonl`) and projected deterministically.
- **Single report writer pipeline** — only `argus_generate_report` writes final report files; Scribe no longer writes directly.
- **Quality gates** — Critical/High findings require non-empty impact, recommendation, and PoC evidence.
- **Direct Solodit search** — `argus_solodit_search` queries Solodit over HTTPS without a local MCP process.

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
- Compatibility posture: `.opencode` remains supported as a read fallback.

### Report Pipeline

```
Argus (orchestrator)
  → collects findings via hooks (tool-tracking-hook.ts)
  → dispatches Scribe with structured ReportInput payload
  → Scribe calls argus_generate_report (Argus may invoke it only for render recovery)
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

## 3. Supported Configuration

Create `.argus/solidity-argus.jsonc`. The project-level `.opencode/solidity-argus.jsonc` path remains a compatibility fallback.

```jsonc
{
  "reporting": {
    "confidenceThreshold": 80,
    "severityThreshold": "low",
    "output_dir": ".argus/reports/"
  },
  "solodit": {
    "enabled": true
  },
  "disabled_hooks": []
}
```

Forge and Slither executables are resolved from the host `PATH`; audited projects cannot override
them. The schema rejects unsupported fields and falls back to defaults after logging a warning.
Review the Argus log after configuration changes, and use the generated starter from `argus init`
when creating a new configuration.

---

## 4. Pre-Deployment Checklist

Run these checks before releasing a new plugin version or changing production configuration.

### 4.1 Health Check

```bash
# Verify all components are healthy
argus doctor
```

Expected output:
```
✓ Slither: installed (<version>, Python <version>)
✓ Forge: installed (<version>)
✓ solc-select: installed (<version>)
✓ Config: valid
✓ Skills: required audit skills resolvable
✓ SCVD API: reachable
✓ Solodit: enabled (direct tRPC search)
```

The Solodit line confirms configuration only; it does not probe the upstream service. A missing
`solc-select` is advisory unless the guarded Slither flatten fallback is needed. If any required
check fails, resolve it before proceeding.

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
bun test src/config/loader.test.ts src/config/loader-partial-validation.test.ts tests/e2e/plugin-e2e.test.ts
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
# Preserve current session, run, and report artifacts when they exist
if [ -d .argus ]; then
  cp -R .argus ".argus.pre-deploy-$(date +%Y%m%d-%H%M%S)"
fi
```

---

## 5. Deployment Execution

1. Install or update the intended `solidity-argus` package version.
2. Validate configuration before opening an audit session:
   ```bash
   argus doctor
   ```
3. Start OpenCode in a known Solidity project and confirm the Argus load banner names the expected version and project directory.
4. Run a smoke audit that exercises at least one static-analysis tool and one finding write.
5. Confirm the run journal and report artifacts appear under `.argus/`.

---

## 6. Post-Deployment Validation

After deployment, verify the system is operating correctly.

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

### 7.1 Package or Configuration Rollback

1. Stop creating new audit sessions.
2. Restore the previously deployed plugin version and the last known-good `solidity-argus.jsonc`.
3. Do not overwrite `.argus/runs`, `.argus/sessions`, or `.argus/reports`; they may contain evidence needed to diagnose the failed release.
4. Verify the rollback:
   ```bash
   argus doctor
   ```
5. Run a smoke audit and confirm the load banner reports the expected rollback version.

### 7.2 Emergency Rollback (data corruption suspected)

1. Stop new audit sessions and preserve the affected project directory.
2. Do NOT delete any `.argus/runs/*/events.jsonl` files; they are forensic evidence.
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

**Symptom**: Quality gate failures blocking report generation.

**Diagnosis**:
```bash
bun test tests/integration/report-quality-gates.test.ts --verbose
```

**Remediation**:
- Quality gates require Critical/High findings to have non-empty `impact`, `recommendation`, and `exploitReference` or `proofOfConcept`.
- Switch to warning-only quality gates temporarily: pass `quality_gate_policy: "warn"` to `argus_generate_report`.
- Fix the finding data to include required fields before regenerating the report.

---

### 8.3 Solodit Search Issues

**Symptom**: Solodit search returning empty results or errors.

**Diagnosis**:
```bash
argus doctor
```

**Remediation**:
- Confirm `solodit.enabled` is still `true` in config.
- The search tool uses direct Solodit tRPC requests; network or upstream API failures can surface as empty results.
- If you need to disable Solodit temporarily, set `solodit.enabled: false`.

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
| `test` | `bun test` | All unit and integration tests |
| `e2e` | `bun test` (with Slither + Foundry) | End-to-end audit pipeline with real tools |
| `production-readiness` | 6 integration test files (see below) | Production invariants |

### Production Readiness CI Tests

| Test File | Invariant |
|-----------|-----------|
| `tests/integration/determinism-replay.test.ts` | Identical event streams → byte-identical outputs |
| `tests/integration/subagent-telemetry-capture.test.ts` | Parent/child session telemetry correlation |
| `tests/integration/report-contract.test.ts` | Structured ReportInput contract compliance |
| `tests/integration/report-quality-gates.test.ts` | Critical/High finding completeness gates |
| `src/config/loader.test.ts` + `src/config/loader-partial-validation.test.ts` + `tests/e2e/plugin-e2e.test.ts` | Config precedence, `.argus`/`.opencode` fallback, and plugin compatibility behavior |
| `tests/integration/single-writer-policy.test.ts` | No duplicate report artifacts per run_id |

**All production-readiness tests are blocking** — a failure prevents merge to main.

Evidence artifacts from CI runs are uploaded to the `production-readiness-evidence` artifact with 90-day retention.

---

## Appendix: Key Configuration Reference

```jsonc
// .argus/solidity-argus.jsonc
{
  "reporting": {
    "confidenceThreshold": 80,
    "severityThreshold": "low"
  },
  "solodit": {
    "enabled": true
  },
  "disabled_hooks": []
}
```

## Appendix: Schema Version History

| Version | Release | Changes |
|---------|---------|---------|
| `1.0.0` | This release | Initial canonical schema: `AuditEvent`, `CanonicalFinding`, `ReportInput` |

---

*Last updated: 2026-07-14*
