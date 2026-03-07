# Production Readiness Findings

Date: 2026-03-06
Project: solidity-auditor
Reviewer: OpenCode (read-only assessment, no code changes)

## Executive Summary

The codebase has solid test coverage and strong architectural intent, but it is not yet production-ready due to several high-impact security and reliability risks. The highest-priority concerns are remote code execution surface in Solodit fallback handling, report overwrite risk across same-day runs, and silent finding loss in large/truncated tool outputs.

## Findings

### Critical

1. Remote code execution risk in Solodit fallback parsing
   - Evidence: `src/tools/solodit-search-tool.ts:352`, `src/tools/solodit-search-tool.ts:366`
   - Details: Remote response text is processed and then evaluated using `new Function(...)`.
   - Impact: If upstream payloads are compromised or malformed, arbitrary JavaScript can execute inside the plugin process.

### High

2. Report overwrite risk across same-day runs
   - Evidence: `src/shared/report-path-resolver.ts:60`, `src/tools/report-generator-tool.ts:1405`
   - Details: Report filename is based on contract/project name + date only. Duplicate-write blocking is keyed by run id, not by path uniqueness across different run ids.
   - Impact: Two audits of the same target on the same date can overwrite each other.

3. Silent false negatives when tool output is truncated
   - Evidence: `src/hooks/tool-tracking-hook.ts:701`, `src/hooks/tool-tracking-hook.ts:711`, `src/hooks/tool-tracking-hook.ts:717`
   - Details: Truncated partial JSON is treated as success but with `findingsCount = 0`, then returns early.
   - Impact: Real findings from large successful runs can be silently dropped.

4. Cross-session state contamination
   - Evidence: `src/features/persistent-state/audit-state-manager.ts:249`, `src/create-hooks.ts:292`
   - Details: When no session-scoped state exists, loader falls back to newest session file and can merge recovered state into a new run.
   - Impact: New audits can inherit prior findings/tools, producing incorrect reports.

5. Event replay/materialization can lose key audit context
   - Evidence: `src/state/projectors.ts:399`, `src/state/projectors.ts:400`, `src/state/projectors.ts:405`, `src/state/projectors.ts:409`, `src/hooks/event-hook.ts:250`, `src/hooks/tool-tracking-hook.ts:845`
   - Details: Projector expects enriched payload keys (solodit results, fuzz counterexamples, coverage, gas hotspots, proxy contracts, skills loaded), but emitted event payloads do not consistently carry that context; `session.created` payload also omits scope.
   - Impact: Replayed/materialized artifacts can omit evidence and produce drift from in-memory state.

6. Host process lifecycle risk from plugin signal handlers
   - Evidence: `src/solodit-lifecycle.ts:123`, `src/solodit-lifecycle.ts:124`
   - Details: Plugin-level SIGINT/SIGTERM handlers call `process.exit(...)`.
   - Impact: Plugin code can terminate the host process unexpectedly.

7. Global stdout/stderr mutation during plugin initialization
   - Evidence: `src/index.ts:16`, `src/index.ts:20`
   - Details: `process.stdout.write` and `process.stderr.write` are globally replaced with no-op during init.
   - Impact: Can suppress unrelated host logs/errors while initialization is running.

### Medium

8. Error swallowing in persistence and utility paths reduces observability
   - Evidence: `src/shared/file-utils.ts:60`, `src/features/persistent-state/event-sink.ts:83`, `src/features/persistent-state/global-run-index.ts:39`
   - Details: Multiple catch blocks intentionally ignore failures.
   - Impact: Silent degradation and harder root-cause analysis in production incidents.

9. DRY/KISS maintainability debt in tool execution wrappers
   - Evidence: `src/tools/forge-test-tool.ts:314`, `src/tools/forge-fuzz-tool.ts:180`, `src/tools/gas-analysis-tool.ts:164`, `src/tools/forge-coverage-tool.ts:141`
   - Details: Repeated spawn/collect/fail boilerplate and near-identical error handling.
   - Impact: Higher divergence risk and slower maintenance.

10. Skill metadata consistency gap vs health checks
    - Evidence: `src/cli/commands/doctor.ts:57`, `skills/methodology/audit-workflow/SKILL.md:1`, `skills/protocol-patterns/amm-dex/SKILL.md:1`
    - Details: Doctor requires category presence for key groups, but many SKILL frontmatters omit `category`.
    - Impact: Persistent warnings and reduced trust in knowledge health signals.

## Verification Signals Collected During Review

- `bun run typecheck`: passed
- `bun test`: passed (`1301` passed, `0` failed)
- `bun run lint`: failed (2 lint errors in `src/tools/solodit-search-tool.ts`)
- `bun run check`: failed (same lint issues + formatting drift in several files)
- `bun run doctor`: warnings present (notably Solodit API reachability and skill-category health warnings)

## Notable Non-Issue (to avoid over-prioritizing)

- Non-null assertions in `src/tools/solodit-search-tool.ts:48` and `src/tools/solodit-search-tool.ts:54` are lint-cleanup items, but they are not the primary production risk. The `new Function(...)` execution path is the critical issue.

## Suggested Remediation Order

1. Remove dynamic code execution from Solodit parsing path.
2. Make report filenames run-unique and collision-safe.
3. Treat truncated outputs as explicit failures, not success with zero findings.
4. Enforce strict session isolation in state recovery.
5. Align emitted events with projector expectations and include required context.
6. Remove plugin-owned `process.exit(...)` and global stdio mutation behavior.
