## [2026-02-17] Task: 18
- Created `src/agents/pythia-prompt.ts` for the Pythia subagent.
- Defined Pythia's role as a "Research Specialist" and "Vulnerability Historian".
- Integrated instructions for `argus_solodit_search` and `argus_check_patterns`.
- Added a section on using the OpenCode Skills system for domain-specific knowledge.
- Established a structured research workflow: Protocol ID -> Pattern Scan -> Deep Dive -> Report.
- Defined a specific Markdown output format for research findings, emphasizing "Precedent" and "Solodit Reference".

## [2026-02-17] Task: 19
- Created `src/agents/scribe-prompt.ts` for the Scribe subagent.
- Defined Scribe's identity as the "Historian" and report writer.
- Included detailed instructions for `argus_generate_report` usage.
- Established a strict professional writing style and report structure.
- Ensured alignment with `argus-prompt.ts` and `sentinel-prompt.ts` styles.

## [2026-02-17] Task: 21
- Created `src/hooks/compaction-hook.ts` — session compaction hook that serializes audit state into XML.
- `AuditState.startTime` is `number` (epoch millis), not `Date` — use `new Date(startTime).toISOString()`.
- `AuditState.toolsExecuted` is `ToolExecution[]`, not `string[]` — need `.map(t => t.tool)` to get names.
- Factory pattern: `createCompactionHook(getAuditState)` returns `async (input) => Promise<string>`.
- Config handler pattern in `config-handler.ts` uses same factory-returns-handler shape.
- Hook is for OpenCode's `experimental.session.compacting` — called during context window compression.
- XML tag `<argus-audit-state>` wraps serialized state; prepended to the original summary string.

## [2026-02-17] Task: 20
- Created `src/hooks/system-prompt-hook.ts` — system prompt transform hook for OpenCode's `experimental.chat.system.transform`.
- Factory pattern: `createSystemPromptHook(getAuditState)` returns `async (input: { system: string; cwd: string }) => Promise<string>`.
- Uses `Bun.file(path).exists()` (not `fs.existsSync`) for Solidity project detection — checks `foundry.toml`, `hardhat.config.{js,ts}`.
- Runs all 3 file existence checks in parallel with `Promise.all()` for speed since this hook runs on EVERY agent interaction.
- Injected context uses `<argus-context>` XML wrapper, kept concise (~500-600 tokens).
- `countFindingsBySeverity()` iterates findings once and returns `Record<FindingSeverity, number>`.
- Test fixture at `tests/fixtures/vulnerable-vault/` has `foundry.toml` — reliable positive test for Solidity detection.
- For negative test: use a nonexistent directory path — `Bun.file().exists()` returns false for missing files.

## [2026-02-17] Task: 23
- Created `src/hooks/event-hook.ts` — session lifecycle event hook managing audit state.
- Factory pattern: `createEventHook(projectDir?)` returns `{ hook, getAuditState, setAuditState }`.
- This is the "state owner" — other hooks receive `getAuditState` accessor from this factory's return.
- `createAuditState(projectDir)` returns `{ state: AuditState; store: FindingStore }` — we store only `state` in the closure since FindingStore is for finding-store consumers.
- Event types handled: `session.created` (fresh state), `session.idle` (log), `session.error` (error log), `session.deleted` (null state).
- Unknown events are no-op via `default: break` — never throw from event hooks.
- `projectDir` param defaults to `process.cwd()` when not provided.
- 10 tests covering all event types + state accessors + edge cases (null state on idle, error preserving state).

## [2026-02-17] Task: 22
- Created `src/hooks/tool-tracking-hook.ts` — tool execution hook intercepting argus_* tool results.
- Factory pattern: `createToolTrackingHook(auditState, store)` — needs both AuditState AND FindingStore (store for dedup).
- `AuditState.toolsExecuted` is `ToolExecution[]` with `{ tool, startTime, endTime?, success, findingsCount }` — not `string[]`.
- `Finding.source` union is `"slither" | "manual" | "pattern" | "scvd"` — use `"pattern"` not `"pattern-checker"`.
- Slither tool already maps findings to `Finding[]` with `id` — hook strips `id` and re-adds via `store.addFinding(Omit<Finding, "id">)`.
- Contract analyzer returns `ContractProfile` directly (not wrapped in `{ contractProfile: ... }`), so `parsed.filePath` is correct.
- Pattern checker `Match` lacks `confidence` field — defaulted to `"Medium"` for all pattern findings.
- Used `toRecord()` helper for safe `unknown → Record<string, unknown>` narrowing — standard TS JSON parsing pattern, not type suppression.
- Cross-tool dedup works via FindingStore's ID generation: `hash(check:file:lines[0]-lines[1])` — same check+file+lines from different tools collide.
- 11 tests: no-op non-argus, slither extraction, pattern extraction, cross-tool dedup, contract path tracking, tool recording, malformed JSON, empty findings, duplicate tool exec, fuzz no-findings, duplicate contract paths.
