# Learnings

<!-- Append findings here. Format: ## [TIMESTAMP] Task: {task-id} -->

## [2026-02-22] Task: 1 - Canonical Contracts
- Schema module location: src/state/schemas.ts
- Adapters module location: src/state/adapters.ts
- Key design decisions: kept legacy `Finding` intact, introduced `SCHEMA_VERSION` and explicit validation contract, and isolated alias handling into adapters to avoid runtime behavior changes in hooks/tools.
- Diagnostics format: `ValidationError` uses `{ field, code, message }`; adapter `Diagnostic` uses `{ level, code, message, field? }` with validation errors remapped as `validation.*` codes.
- Existing aliases handled: `impact -> description`, `detector -> check`, `first_markdown_element -> description`, `elements[0].source_mapping.filename_relative -> file`.
- Any deviation from plan: canonical finding enforces required `run_id`, `seq`, `schema_version` per explicit interface contract while preserving backward compatibility through adapter defaults and diagnostics.

## [2026-02-22] Task: 2 - Event Sink
 Event sink: src/features/persistent-state/event-sink.ts
 Journal path pattern: {projectDir}/.opencode/runs/{runId}/events.jsonl
 Mutex: promise-chain mutex (no external deps) — each run() awaits prior holder's release
 Sequence enforcement: reads lastSeq from journal on init; rejects event.seq <= lastSeq with SEQUENCE_CONFLICT
 Atomic write: Bun.write to .tmp file then fs.rename (same pattern as audit-state-manager.ts)
 Note: seq is auto-assigned (lastSeq+1) regardless of input seq; explicit seq>0 only triggers conflict validation
 Exports: createEventSink, readEvents, EventSinkError, EventSink (type), EventSinkErrorCode (type)

## [2026-02-21] Task: 3 - AuditRun Identity and Artifact Layout
- Resolver file: src/shared/audit-artifact-resolver.ts
- Key paths: stateFile (legacy compat), journalFile, findingsFile, reportDir, evidenceDir, archiveDir, runDir
- Root structure: {projectDir}/.opencode/
- Journal path matches event-sink.ts: {projectDir}/.opencode/runs/{runId}/events.jsonl

## [2026-02-21] Task: 5 - Report Path Policy
  Resolver file: src/shared/report-path-resolver.ts
  Canonical filename: {sanitizedName}-security-audit-{YYYY-MM-DD}.md
  canonicalId: runId when provided, else filename
  Pure resolver: no I/O, no filesystem side effects

## [2026-02-22] Task: 6 - Deterministic Projectors
- Projectors file: src/state/projectors.ts
- Sort order: severity rank ASC, file ASC, lines[0] ASC, id ASC
- stableHash: SHA-256 of JSON.stringify with sorted keys
- validateEventSequence: checks monotonically increasing seq starting at 1
- Event payload types: "finding.added" carries CanonicalFinding, "tool.started"/"tool.completed" carry tool data

## [2026-02-21] Task: 9 - Solodit MCP Health Check Protocol Compliance
- Health probe changed from plain GET to JSON-RPC POST to /mcp
- MCP Streamable HTTP transport requires: POST, Content-Type: application/json, Accept: application/json, text/event-stream
- Body: initialize handshake with protocolVersion "2024-11-05"
- Any 2xx response (even with JSON-RPC error body) = server reachable; non-2xx or network error = unreachable
- 2000ms timeout preserved via AbortSignal.timeout(2000)
- solodit-lifecycle.ts function signature unchanged — fully compatible
- Test pattern: mock globalThis.fetch to capture method/headers/body for protocol compliance assertions
- GET regression test: simulate server returning 405 for GET, assert probe uses POST

## [2026-02-21] Task: 4 - Hook Adapters (Canonical Event Emission)
 Modified files: src/hooks/event-hook.ts, src/hooks/tool-tracking-hook.ts, src/create-hooks.ts
 Pattern: dual-write — existing AuditState mutation preserved, new EventSink emissions added alongside
 event-hook.ts emits: session.created, session.idle, session.deleted via setEventSink() injector
 tool-tracking-hook.ts emits: tool.started, tool.completed, finding.added via ToolTrackingOptions closures
 create-hooks.ts wires sink lifecycle: creates sink on session.created, passes getEventSink/getSessionId closures to tool hook, clears on session.deleted
 Key insight: event emission must happen AFTER sub-handlers run, because the sink is created inside a session.created sub-handler
 preDeleteState pattern: capture state before nullifying currentAuditState so session.deleted event carries meaningful payload
 seq:0 convention: sink auto-assigns sequence numbers, hooks pass 0 as placeholder
 tool_call_id: randomUUID() per tool invocation, shared between tool.started and tool.completed for correlation
 normalizeToCanonicalFinding used for finding.added payloads to ensure canonical format
 Graceful degradation: all sink operations wrapped in try/catch, failures logged but never crash hooks
 Test count: 64 tests across 3 files (15 new sink emission tests added)

## [2026-02-22] Task: 12 - Replace Silent Drops with Structured Diagnostics

 Created `DropPolicy` type with three levels: `warn` (default, backward-compat), `error` (collect + surface), `strict-fail` (collect + throw)
 `DropDiagnosticsCollector` pattern: accumulate all diagnostics first, then `throwIfStrict()` at the end — ensures all issues are reported in a single error, not just the first one
 Two diagnostic codes: `MALFORMED_JSON` (unparseable input) and `MISSING_REQUIRED_FIELD` (finding dropped due to missing check/file/lines after normalization)
 `DropDiagnosticsError` extends Error with `.diagnostics` array for programmatic access to all collected issues
 Key design decision: `emitDropDiagnosticsForFindings()` compares raw→normalized→valid pipeline stages to identify exactly which findings were dropped and why
 `parseAuditStateWithDiagnostics()` returns `{ state, diagnostics }` tuple for callers who want diagnostics without throwing
 `parseAuditState()` accepts optional `{ dropPolicy }` param — existing callers unaffected (defaults to warn)
 Tool tracking hook stores `lastDiagnostics` per invocation, accessible via `hookFn.getLastDiagnostics()`
 All logging routed through existing `createLogger()` — no console.warn/console.error calls
 13 new tests total (6 in tool-tracking-hook, 7 in report-generator-tool), 93 tests pass across both files

## [2026-02-22] Task: 7 - Capture Tool Executions Across Parent/Subagent Boundaries
 Modified files: src/hooks/tool-tracking-hook.ts, src/hooks/agent-tracker.ts
 Created: tests/integration/subagent-telemetry-capture.test.ts (23 tests)
 parseChildSessionId() uses 3-layer defensive parsing: JSON top-level → JSON nested result → regex fallback
 Task tool handling inserted BEFORE the argus_ prefix filter so `task` tool calls are captured without modifying the existing argus tool flow
 correlation_id (randomUUID) links parent task.started/task.completed events to child_session_id in payload
 onChildSessionDetected callback in ToolTrackingOptions enables external wiring without modifying create-hooks.ts (which was out of scope)
 AgentTracker extended with childSessions Map, trackChildSession() uses Set for dedup, getChildSessions() returns string[]
 AgentTrackerRef type in create-hooks.ts only exposes getAgentForSession/isArgusAgent — new methods available on AgentTracker class but not wired through ref (separate task needed)
 Non-null assertions forbidden by biome — used helper functions with runtime checks in tests instead
 LSP diagnostics can show stale errors after edits — always verify with `bun run typecheck` as source of truth
 23 new tests, 136 total tests pass, zero regressions
## [2026-02-22] Task: 8 - Session Lifecycle Correlation and Run Finalization
- Added run finalizer at src/features/persistent-state/run-finalizer.ts with invariant checks for contiguous seq (via validateEventSequence), required session.created/session.deleted lifecycle events, orphaned tool.started detection, and parent-child edge consistency checks (correlation_id + stable parent mapping).
- Finalization now always records deterministic outcome in events.jsonl as run.finalized with payload status finalized|failed-finalization, invariantsPassed, and error list (forensics preserved even on invariant failure).
- event-hook.ts now invokes finalizeRun during session.deleted canonical emission and keeps failures non-fatal (logged, no crash).
- create-hooks.ts session.deleted flow was reordered so finalization runs before archive; archive moved to event wrapper finally-block so archive always executes even if finalization fails.
- Added tests for successful finalization, orphaned tool terminal-event failure recording, and archive non-blocking behavior under invariant failure.

## [2026-02-22] Task: 10 - Solodit Process Lifecycle and Orphan Handling
 Added LifecycleState type (starting|running|failed|stopped) and getLifecycleStatus() export for deterministic state introspection
 classifySpawnError() maps EADDRINUSE -> port conflict message, ENOENT -> binary-not-found message, else generic with port context
 restartSoloditMcp() now pre-checks health before killing existing process — prevents unnecessary kill+respawn when server self-recovered
 startSoloditMcp() wraps spawn in try/catch and still starts monitoring on failure (allows future recovery detection)
 SoloditChildProcess interface extended with optional pid for status reporting via getLifecycleStatus()
 _resetSoloditState() now also resets lifecycleState to 'stopped' and clears lifecycleError
 Test pattern: Object.assign(error, { code: 'EADDRINUSE' }) to simulate errno-style errors from Bun.spawn
 Test pattern: counting fetch calls with fetchCallCount++ to simulate server recovery between monitoring check and restart pre-check
 13 new tests added (25 total), 54 expect() calls, zero regressions on existing 12 tests


## Task 11: Solodit Search Fallback Fix (2026-02-22)

### Problem
`executeSoloditSearch` had a premature availability gate: when `soloditAvailable === false`
and `NODE_ENV !== "test"`, it would wait 3s then return early with an error message, never
reaching the HTTP fallback. This violated the design intent of always trying fallback paths.

### Fix
- Removed the early-return gate entirely.
- New logic: if no `mcpCaller` (no `callMcpTool` arg and no `context.callMcpTool`), go
  straight to HTTP fallback regardless of `soloditAvailable` state.
- If `mcpCaller` is present, always try MCP first (even when `soloditAvailable=false`),
  then fall back to HTTP if all MCP tool names fail.
- Added `logger.debug()` telemetry at each decision point.

### Tool Mapping
`SOLODIT_MCP_TOOLS = ["search", "search_findings"]` was already correct. The "search" tool
uses `{ keywords: query }` args; "search_findings" uses `{ keywords, impact, pageSize }`.

### Key Insight
`soloditAvailable` is a lifecycle monitoring flag — it reflects whether the MCP server
process is healthy. But a `callMcpTool` caller may still work even when the flag is false
(e.g., during startup race). The gate should never block the caller from trying.

### Tests: 18 pass, 0 fail

## [2026-02-22] Task: 15 - Deterministic Rendering and Report Quality Gates
- Report generator now performs deterministic finding ordering with rank/file/line/id comparator before rendering.
- Per-finding `Impact` and `Recommendation` now prefer structured payload fields (`impact`, `recommendation`, `remediation`) instead of severity-generic defaults.
- Added `validateReportQuality(findings, policy)` with machine-readable violations `{ findingId, code, message }` covering schema, completeness, severity-justification, and provenance checks.
- Critical/High quality policy enforces non-generic impact/recommendation and PoC evidence via `exploitReference` or `proofOfConcept`.
- Strict mode (`strict-fail`) aborts report emission pre-render with serialized violations; warn mode logs violations and continues for backward compatibility.
- Report result now includes deterministic `contentHash` (via `stableHash(reportMarkdown)`) and `qualityGates` diagnostics payload.
- New integration coverage in `tests/integration/report-quality-gates.test.ts` validates deterministic hashes, strict failures, warn continuation, and deterministic ordering.

## [2026-02-22] Task: 14 - Single Report Writer Policy
 Single-writer policy enforced via `SINGLE_WRITER_POLICY_VERSION = "1.0.0"` constant and `checkDuplicateWrite()` function in report-generator-tool.ts.
 Report metadata embedded as HTML comment `<!-- argus:report_metadata {...} -->` at end of report; extracted via regex for duplicate detection.
 Canonical path uses date-based filename (`${safeName}-audit-${auditDate}.md`) when run_id available; timestamp-based otherwise for backward compat.
 When `parseAuditState` receives `{ findings: [...] }` without `sessionId`, the spread `{ ...emptyAuditState(), ...state }` preserves `sessionId: ""` → no run_id → no duplicate check → existing tests pass unchanged.
 Scribe prompt updated with explicit SINGLE-WRITER POLICY section forbidding direct file writes; workflow step 4 changed to use `argus_generate_report`.
 `ReportGenerationResult.error` field added as optional `{ code: string; message: string }` — when duplicate detected, error is set but report content is still returned (no throw).
 Different run_id at same canonical path is allowed (overwrites file); same run_id triggers DUPLICATE_WRITE_ATTEMPT error code.
 LSP may show stale errors after edits — `bun run typecheck` (tsc --noEmit) is the authoritative check.

## [2026-02-22] Task: 13 - ReportInput Contract Unification
-  now accepts canonical  (ReportInput v1.0.0) and supports legacy  via explicit compatibility adapter.
- Contract validation is centralized in  () and used by report generation to fail fast on malformed/mismatched payloads.
- Legacy transition path emits deterministic deprecation diagnostics via  with explicit codes instead of silent coercion.
- Argus and Scribe prompts are now aligned on the same machine-actionable handoff: pass serialized ReportInput JSON to  and treat  as deprecated.
- ReportInput now carries optional  and  so legacy and projected contexts preserve provenance appendix sections.

## [2026-02-22] Task: 13 - ReportInput Contract Unification (Corrected Entry)
- `argus_generate_report` now accepts canonical `report_input` (ReportInput v1.0.0) and supports legacy `audit_state` via explicit compatibility adapter.
- Contract validation is centralized in `validateReportInput` (`src/state/schemas.ts`) and used by report generation to fail fast on malformed/mismatched payloads.
- Legacy transition path emits deterministic deprecation diagnostics via `createDropDiagnosticsCollector("warn")` with explicit codes instead of silent coercion.
- Argus and Scribe prompts are now aligned on the same machine-actionable handoff: pass serialized ReportInput JSON to `argus_generate_report` and treat `audit_state` as deprecated.
- ReportInput now carries optional `patternVersion` and `skillsLoaded` so legacy and projected contexts preserve provenance appendix sections.
