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

## [2026-02-18] Task: 25
- kadenzipfel/smart-contract-vulnerabilities has 38 reference files (not 39 as initially estimated)
- All files follow consistent structure: Preconditions, Vulnerable Pattern, Detection Heuristics, False Positives, Remediation
- Repo uses different naming than task spec: e.g. `weak-sources-randomness` not `weak-randomness`, `authorization-txorigin` not `tx-origin-phishing`
- Additional files not in task spec: `unsecure-signatures`, `unused-variables`, `unsupported-opcodes`, `use-of-deprecated-functions`, `unbounded-return-data`, `asserting-contract-from-code-size`, `assert-violation`, `requirement-violation`, etc.
- Description extraction: first non-header paragraph from content works well as description
- Bun.write auto-creates intermediate directories — no need to mkdir each topic dir
- SKILL.md frontmatter pattern: `name` matches directory name, `description` quoted to handle special chars
## [2026-02-17 21:16:19] Task: 24
- Forked DeFiFoFum Solidity audit content into 15 modular SKILL files under `skills/.staging/defifofum/`.
- Standardized each file with YAML frontmatter (`name` = directory slug, concise `description`) and MIT attribution header.
- Preserved source markdown/code blocks while excluding agent-instruction boilerplate from staged artifacts.
- Captured verifiable output in `.sisyphus/evidence/task-24-defifofum-fork.txt` with file inventory and URL failure status.


## [2026-02-17] Task: 28

### Exploit Case Study SKILL.md Files

**Pattern: GitHub URL format for DeFiHackLabs references**
- Always use: `https://github.com/SunWeb3Sec/DeFiHackLabs/blob/main/src/test/{ExploitName}.sol`
- Never use local submodule paths — skills must be self-contained with external references

**SKILL.md structure that works for OpenCode's skills system:**
- YAML frontmatter with `name` and `description` fields
- Attribution comment immediately after frontmatter: `<!-- Source: ... -->`
- Markdown content with tables, code blocks, and sections

**15 exploit filenames confirmed (from task spec):**
TheDAO_exp.sol, Parity_exp.sol, bZx_exp.sol, Harvest_exp.sol, Compound_exp.sol,
Cream_exp.sol, PolyNetwork_exp.sol, Wormhole_exp.sol, Ronin_exp.sol, Beanstalk_exp.sol,
Nomad_exp.sol, MangoMarkets_exp.sol, Euler_exp.sol, Wintermute_exp.sol, BadgerDAO_exp.sol

**Vulnerability taxonomy used:**
- Reentrancy: The DAO, Cream Finance
- Access Control: Parity, Poly Network, Ronin, Wintermute, BadgerDAO
- Flash Loan + Oracle: bZx, Harvest, Mango Markets
- Flash Loan + Governance: Beanstalk
- Flash Loan + Logic: Euler Finance
- Logic Error: Compound, Nomad
- Signature Verification: Wormhole

**Staging workflow:**
- All content goes to `skills/.staging/` — Task 29 will merge into final `skills/` structure
- This pattern allows review before promotion to production skills

## [2026-02-18] Task: 26
- Cyfrin audit-checklist has 370 items total (not 221 as initially estimated — grew since last count)
- Cyfrin JSON has non-uniform nesting: some categories have 3-level depth (top > subcat > items), others have direct items (top > items)
- Must use recursive flattener to handle the tree — can't assume uniform depth
- Cyfrin focuses heavily on security, minimal gas optimization content (only 5 items matched gas criteria)
- SmartBugs curated has 143 contracts across 10 DASP categories, with `master` branch (not `main`)
- DASP category from SmartBugs path: `dataset/{category}/{filename}` — extract via `path.split("/")[1]`
- Categorization approach: define Set of known category names for DeFi and BestPractices buckets, rest goes to General, then extract gas items post-hoc
- DeFi bucket is largest (151 items) due to Cyfrin's emphasis on DeFi-specific checks + integrations
- Unchecked Low Level Calls is the largest SmartBugs category with 52 contracts

## [2026-02-17 21:20:24] Task: 27
- Implemented `ScvdClient` with `/stats` and paginated `/findings` support, abort forwarding, strict payload parsing, and resilient list-fetch fallback to empty arrays on fetch failures.
- Implemented JSON-based SCVD local index (`buildIndex`, `searchIndex`, `saveIndex`, `loadIndex`) using `Bun.file()`/`Bun.write()` only, with AND-combined filters for SWC/severity/keyword and default result cap.
- Implemented sync orchestration (`syncAll`, `syncIncremental`, `getSyncStatus`) with early return when remote totals match local index and structured `SyncResult` error handling.
- Added full TDD coverage across `scvd-client`, `scvd-index`, and `scvd-sync`; `bun test src/knowledge/` passes (20 tests).

## [2026-02-18T00:25:55.288Z] Task: 29
- Merged overlap topics into authoritative destination slugs and preserved source attribution headers from each origin.
- Enforced frontmatter normalization (`name` matches parent directory and non-empty `description`) during migration to final skills tree.
- Generated inventory with per-file source attribution and word counts to support future dedup and coverage checks.

## [2026-02-18T00:27:44.303Z] Task: 29
- For oversized checklist SKILL files, split at section boundaries and preserve source attribution/comments to keep each artifact under 5000 words.
- Keep merge-topic destinations stable while mapping related secondary taxonomy slugs into supplemental heuristic sections for deduplicated coverage.
- Regenerate inventory from final tree only (excluding .staging) to provide accurate source attribution and size metadata.

## [2026-02-18T00:31:43.383123Z] Task: 29
- Inventory integrity depends on correct source-path parsing for non-standard staging trees (exploit-case-studies had 2-level paths), otherwise malformed destination slugs appear.
- When splitting checklist files for word-count constraints, preserve attribution headers in every split artifact so inventory source attribution remains accurate.
- If final SKILL count exceeds the required envelope, merge tightly related reference artifacts rather than dropping content to keep coverage intact.
## [2026-02-17] Task: 31
Created comprehensive documentation for the Argus knowledge base and companion plugins. Documented source attribution for all 6 knowledge sources and provided clear instructions for integrating Trail of Bits, Solodit, and SCVD. Ensured no licensing violations by referencing rather than duplicating Trail of Bits content.

## [2026-02-17T21:38:36] Task: 30
Implemented argus_sync_knowledge tool with force/incremental modes and structured error output, added non-blocking SCVD auto-sync hook wired from config handler, and extended pattern checker with optional SCVD MatchSource enrichment via category->SWC mapping while preserving pattern-db behavior. Added dependency-injection seams for deterministic Bun tests around async fire-and-forget and SCVD index lookups.
