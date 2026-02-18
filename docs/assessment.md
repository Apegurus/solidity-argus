# Argus Plugin — Implementation Assessment Report

**Date**: 2026-02-18
**Assessed by**: Claude Opus 4.6
**Plans reviewed**: `argus-plugin.md` (original 35-task plan), `argus-overhaul.md` (30-task architectural overhaul)
**Codebase stats**: ~13,600 LOC TypeScript, 359 tests (0 failures), clean typecheck

---

## Executive Summary

The `opencode-argus` plugin is **architecturally sound and functional in a real OpenCode session**. The original 35-task plan is fully implemented. The overhaul plan successfully restructured the codebase from monolithic to factory-based architecture. However, several overhaul features were implemented as isolated modules but **never wired** into the main plugin flow, and a **split-brain audit state** issue exists in the hook system that undermines cross-hook state consistency.

**Overall Grade**: B+ (strong foundation, needs integration work)

---

## 1. CRITICAL ISSUES (Fix Before Relying On)

### 1.1 Split-Brain Audit State

**Location**: `src/create-hooks.ts:30-32`
**Severity**: HIGH

```
createHooks() does:
  1. Creates auditState + findingStore via createAuditState(projectDir)
  2. Creates eventHook with its own internal state via createEventHook(projectDir)
  3. Passes the auditState from step 1 into eventHook via setAuditState()
```

But when `session.created` fires (in `event-hook.ts:32-36`), the event hook creates a **brand new** state:
```typescript
case "session.created": {
  const { state } = createAuditState(dir)
  currentAuditState = state  // NEW state — not the one from createHooks
}
```

**Impact**: After `session.created`:
- `toolTrackingHook` writes findings to the **original** state (closed over in `createHooks`)
- `systemPromptHook` and `compactionHook` read from `getAuditState()` which returns the **new** state
- Findings accumulated by tool tracking are invisible to system prompt and compaction hooks

**Fix**: Either (a) remove the `session.created` state recreation and let `createHooks` own state creation, or (b) wire `toolTrackingHook` to use `getAuditState()` instead of a closed-over reference.

### 1.2 Managers Created But Never Used

**Location**: `src/create-managers.ts`, `src/create-hooks.ts`
**Severity**: HIGH

`createManagers()` creates `BackgroundManager` and `AuditStateManager`, which are passed to `createHooks()`. However:
- `createHooks()` accepts `managers: Managers` in its args but **never references it**
- `BackgroundManager` has a noop dispatcher: `logger.warn("Background dispatch not wired: ...")`
- `AuditStateManager` (which provides file-based persistence via atomic write) is never called

**Impact**: Persistent audit state across session restarts doesn't actually work. The plan (Task 13, overhaul) and the Definition of Done both require "Audit state persists across session restarts (verified by file existence)."

**Fix**: Wire `AuditStateManager.load()` on startup, `AuditStateManager.save()` on state changes, and connect the event hook to the manager.

### 1.3 Dual Solodit MCP Launch

**Location**: `src/index.ts:10-18` and `src/hooks/config-handler.ts:89-98`
**Severity**: MEDIUM

The plugin launches Solodit MCP in **two** ways:
1. `startSoloditMcp()` in `index.ts` — spawns `npx -y @lyuboslavlyubenov/solodit-mcp` as a child process
2. `config.mcp["solodit-mcp"]` registration in `config-handler.ts` — tells OpenCode to manage the MCP

If OpenCode also launches the MCP based on the config registration, there would be two instances competing for the same port. Additionally, `startSoloditMcp()` uses `node:child_process` `spawn` (not `Bun.spawn`), silently swallows all errors, and never cleans up the child process.

**Fix**: Remove `startSoloditMcp()` from `index.ts` and rely solely on `config.mcp` registration, OR remove the `config.mcp` registration and keep the manual spawn. Prefer the former (let OpenCode manage it).

---

## 2. PLAN COMPLIANCE

### Original Plan (`argus-plugin.md`) — 35 Tasks

| Category | Status | Notes |
|----------|--------|-------|
| Tasks 1-6 (Foundation) | COMPLETE | All scaffolding, types, project detector, parser, fixtures present |
| Tasks 7-13 (Tools) | COMPLETE | All 8 tools implemented with structured returns |
| Tasks 14-15 (Config Handler) | COMPLETE | Agents, MCP, skills all registered |
| Tasks 16-19 (Agent Prompts) | COMPLETE | All 4 prompts well-written and comprehensive |
| Tasks 20-23 (Hooks) | COMPLETE | System prompt, compaction, tool tracking, event hooks |
| Tasks 24-28 (Knowledge Import) | COMPLETE | 55 SKILL.md files in final structure |
| Tasks 29 (Dedup) | COMPLETE | Unified knowledge base, INVENTORY.md present |
| Tasks 30-31 (Sync + Docs) | COMPLETE | SCVD sync, knowledge-sync-hook, companion docs |
| Tasks 32-35 (Assembly) | COMPLETE | Entry point, integration tests, README, examples |
| Final Wave (F1-F4) | Marked complete but .sisyphus/evidence/ directory missing |

**Skills count**: 55 SKILL.md files (plan target: 35-45). Exceeds target but content appears non-redundant.

**Plan deviations**:
- Scribe default model: `claude-sonnet-4-6` instead of plan's `claude-sonnet-4-5-20250929`
- `argus_sync_knowledge` syncs SCVD only (plan's final checklist mentions kadenzipfel, but Task 30 description clarifies SCVD-only is correct)
- QA evidence files not generated to `.sisyphus/evidence/`

### Overhaul Plan (`argus-overhaul.md`) — 30 Tasks

| Category | Status | Notes |
|----------|--------|-------|
| Tasks 1-7 (Foundation) | COMPLETE | Shared utils, config schema, hook types, manager interfaces, CLI scaffold |
| Tasks 8-14 (Core Architecture) | COMPLETE | Config loader, factories (tools/hooks/managers), plugin-interface |
| Task 15: Session recovery | **BUILT, NOT WIRED** | Module exists in `features/error-recovery/session-recovery.ts`, tested, but not imported by `create-hooks.ts` |
| Task 16: Tool error recovery | **BUILT, NOT WIRED** | Module exists in `features/error-recovery/tool-error-recovery.ts`, tested, but not imported |
| Task 17: Context window monitor | **BUILT, NOT WIRED** | Module exists in `features/context-monitor/context-monitor.ts`, tested, not imported |
| Task 18: Tool output truncator | **BUILT, NOT WIRED** | Module exists in `features/context-monitor/tool-output-truncator.ts`, tested, not imported |
| Task 19: Audit enforcer | **BUILT, NOT WIRED** | Module exists in `features/audit-enforcer/audit-enforcer.ts`, tested, not imported |
| Task 20: Event v2 | COMPLETE | `event-hook-v2.ts` exists and tested |
| Tasks 21-24 (CLI) | PARTIALLY COMPLETE | Commands exist but CLI dispatcher routes to stubs, not real implementations |
| Tasks 25-30 (Integration) | COMPLETE | New index.ts, hook migration, tool migration, test migration |

**5 overhaul feature modules are implemented and tested but disconnected from the plugin pipeline.** This is the biggest gap in the overhaul.

---

## 3. CODE QUALITY

### 3.1 Type Safety
- **Typecheck**: CLEAN (zero errors)
- **`as any` violations**: 24 instances, all in `src/utils/solidity-parser.test.ts` (mocking `Bun.spawnSync`). Also 2 instances in `src/config/schema.test.ts` (testing invalid config).
- **`as Record<string, unknown>`**: Used safely after type guards in `solodit-search-tool.ts` and `tool-tracking-hook.ts`
- **Verdict**: Production code is clean. Test code uses `as any` for Bun mock injection — fixable with dependency injection.

### 3.2 Error Handling
- Slither tool: Excellent — handles ENOENT, abort, parse errors, compilation failures, with a flatten fallback strategy
- Forge tools: Good — handle missing binary, parse errors
- Pattern checker: Throws on empty target (could be more graceful)
- SCVD client: Good — `fetchFindings` returns empty on error, `fetchStats` throws (appropriate since stats failures break sync logic)
- Knowledge sync hook: Silently swallows errors (fire-and-forget, as designed)

### 3.3 Logging Inconsistency
Production files use `console.error` directly in:
- `src/hooks/safe-create-hook.ts`
- `src/hooks/event-hook.ts` (2 locations)
- `src/hooks/knowledge-sync-hook.ts`

A `createLogger()` abstraction exists in `src/shared/logger.ts` — these should use it.

### 3.4 Test Quality
- **359 tests, 0 failures, 1100 expect() calls**
- Coverage: Every module has a corresponding `.test.ts` file
- Integration test: `tests/integration/full-audit.test.ts` covers plugin loading, config handler, contract analyzer, pattern checker, report generator, compaction, tool tracking, and conditional Slither/Forge tests
- Weak spot: Integration test conditionally skips Slither/Forge tests if binaries not installed (acceptable for CI, but means the full pipeline is never tested automatically)

---

## 4. ARCHITECTURE ANALYSIS

### 4.1 What Works Well

**Factory composition pattern** — The `index.ts` -> `createManagers` -> `createTools` -> `createHooks` -> `createPluginInterface` pipeline is clean and testable. Each factory is independently importable.

**Multi-level config** — User-level (~/.config) + project-level (.opencode) with deep merge and Zod validation. Sensible defaults. `disabled_hooks` array for toggling hooks.

**Hook guard system** — `createHookGuard()` enables/disables hooks based on config. `safeCreateHook()` wraps hook creation in error boundary. Both are compositional patterns from the overhaul.

**Argus prompt** — The 623-line orchestrator prompt is comprehensive: 7-step methodology, severity classification with concrete examples, delegation instructions with code examples, fallback procedures, and a mandatory report generation step. This is production-quality prompt engineering.

**SCVD integration** — Full pipeline: REST client with pagination -> local JSON index with keyword/SWC/CWE search -> incremental sync with freshness check -> non-blocking auto-sync on init. Well-layered.

**Finding deduplication** — SHA-256 hash of `check:file:start-end` as dedup key in `FindingStore`. Cross-tool dedup works (Slither + pattern checker reporting same issue).

### 4.2 What Needs Work

**Pattern checker is shallow** — Only 5 hardcoded regex patterns. The plan described 10 categories. The 55 SKILL.md files contain rich vulnerability information that could feed pattern detection. The `MatchSource` interface is extensible (SCVD source already plugged in), but the core `pattern-db` source is minimal.

**Report generator requires serialized state as string arg** — Instead of reading from shared audit state, `argus_generate_report` takes `audit_state: string` (JSON). This means the Scribe agent must receive all findings as text from Argus, serialize them, and pass them to the tool. The plan envisioned the tool reading accumulated findings directly.

**Argus agent's tool access config uses `false`** — In `config-handler.ts:43-46`, Argus has `"argus_*": false`. This is intentional (forcing delegation), but the wildcard pattern `argus_*` isn't standard OpenCode config — verify OpenCode supports glob patterns in tool configs.

**No temperature set on agents** — The plan specified `temperature: 0.1` for Argus (security auditing benefits from determinism). Implementation doesn't set temperature on any agent.

---

## 5. DISCONNECTED OVERHAUL FEATURES — Review

These 5 features from the overhaul plan are **implemented and tested** but not wired into the plugin:

### 5.1 Session Recovery (`features/error-recovery/session-recovery.ts`)
**What it does**: Detects interrupted sessions and provides recovery context (last phase, findings, tools executed).
**Value**: HIGH for production use — sessions do crash/timeout.
**Wiring needed**: Call on `session.created` event before creating fresh state; if recovery data exists, restore instead of creating new.

### 5.2 Tool Error Recovery (`features/error-recovery/tool-error-recovery.ts`)
**What it does**: Provides fallback suggestions when tools fail (e.g., "Slither failed? Try argus_analyze_contract instead").
**Value**: MEDIUM — useful for agent resilience, already partially addressed by Argus prompt's Fallback Procedures section.
**Wiring needed**: Hook into `tool.execute.after` when tool result indicates failure.

### 5.3 Context Window Monitor (`features/context-monitor/context-monitor.ts`)
**What it does**: Tracks estimated context usage (chars/4 heuristic) and signals "pressure" when approaching limits.
**Value**: MEDIUM — prevents context overflow in long audits.
**Wiring needed**: Monitor system prompt + tool outputs; when pressure high, trigger truncation.

### 5.4 Tool Output Truncator (`features/context-monitor/tool-output-truncator.ts`)
**What it does**: Truncates tool output when context pressure is high, keeping only critical information.
**Value**: MEDIUM — companion to context monitor.
**Wiring needed**: Insert as `tool.execute.after` middleware before tool tracking.

### 5.5 Audit Enforcer (`features/audit-enforcer/audit-enforcer.ts`)
**What it does**: Injects "continue the audit" messages when audit is in progress but agent appears idle.
**Value**: LOW-MEDIUM — the Argus prompt already has mandatory methodology steps.
**Wiring needed**: Inject via system prompt transform when audit is active but no progress detected.

### Recommendation

**Wire sessions recovery + persistent state first** (highest value for production). The other features can be deferred — their value is incremental, and the prompt already handles most of their concerns.

---

## 6. CLI STATUS

| Command | Implementation | Dispatcher | Status |
|---------|---------------|------------|--------|
| `argus doctor` | `cli/commands/doctor.ts` (78 lines) | Routes to stub: "not yet implemented" | BROKEN |
| `argus init` | `cli/commands/init.ts` (44 lines) | Routes to stub: "not yet implemented" | BROKEN |
| `argus install` | `cli/commands/install.ts` (51 lines) | Routes to stub: "not yet implemented" | BROKEN |
| TUI prompts | `cli/tui-prompts.ts` (78 lines) | N/A | Implemented but unused |

The command implementations exist and are tested, but `cli-program.ts` dispatches to inline stubs instead of importing them. Simple fix: replace stubs with imports.

---

## 7. KNOWLEDGE BASE STATUS

| Category | Count | Sources |
|----------|-------|---------|
| Vulnerability patterns | 38 | DeFiFoFum, kadenzipfel, merged |
| Methodology | 3 | DeFiFoFum (audit-workflow, report-template, severity-classification) |
| Protocol patterns | 5 | DeFiFoFum (AMM, bridges, DAO, lending, staking) |
| Checklists | 6 | DeFiFoFum + Cyfrin (general, best-practices, defi-core, defi-integrations, gas, upgrades) |
| References | 2 | SmartBugs examples, DeFiHackLabs exploit reference |
| **Total** | **55** | |

- `skills/INVENTORY.md` exists
- `skills/README.md` exists with source attribution
- `docs/companion-plugins.md` exists (Trail of Bits, Solodit, SCVD instructions)
- YAML frontmatter verified on spot checks
- No `.staging/` remnants (cleanup completed)

---

## 8. PRIORITY ACTION ITEMS

### P0 (Critical — fix before production reliance)
1. **Fix split-brain audit state** — Ensure toolTrackingHook, systemPromptHook, and compactionHook all share one state instance
2. **Wire AuditStateManager** — Connect persistent state to the hook system for cross-session survival
3. **Resolve Solodit MCP dual launch** — Pick one mechanism (prefer config.mcp registration)

### P1 (High — fix before npm publish)
4. **Wire CLI commands** — Replace stubs in cli-program.ts with real implementations
5. **Set temperature on agent configs** — At least 0.1 for Argus
6. **Replace console.error with logger** — In hooks that bypass the logger abstraction

### P2 (Medium — enhancement)
7. **Wire session recovery feature** — Detect interrupted audits and restore state
8. **Expand pattern checker** — Add patterns for the remaining 6 categories
9. **Remove `as any` from solidity-parser tests** — Refactor to use dependency injection
10. **Verify Argus tool wildcard** — Confirm OpenCode supports `argus_*: false` glob syntax

### P3 (Low — nice to have)
11. **Wire context monitor + truncator** — For long audit sessions
12. **Wire audit enforcer** — For methodology compliance
13. **Wire tool error recovery** — For graceful degradation
14. **Add integration test for full pipeline** — That doesn't conditionally skip Slither/Forge

---

## 9. QUESTIONS REMAINING

1. **OpenCode's `config.agent.tools` wildcard support**: Does `"argus_*": false` work as a glob, or does it need to enumerate each tool explicitly?
2. **OpenCode's MCP lifecycle**: When `config.mcp` registers an MCP server, does OpenCode spawn it? If so, the manual `startSoloditMcp()` spawn is definitely redundant.
3. **`config.mcp` type "remote" vs "local"**: The config-handler registers Solodit as `type: "remote"` pointing to `localhost:3000`, but `index.ts` spawns it locally. If OpenCode expects to manage the lifecycle with `type: "local"`, the registration type is wrong.
4. **OpenCode subagent delegation mechanism**: The Argus prompt instructs the agent to use `Task(subagent_type="sentinel", ...)`. Is this the actual API, or does OpenCode use `@sentinel` mentions? The prompt mentions both patterns.
5. **SCVD API status**: Is `api.scvd.dev` reliably available? The sync pipeline has good offline fallback, but worth knowing if it's actively maintained.

---

## 10. METRICS SUMMARY

| Metric | Value | Assessment |
|--------|-------|-----------|
| Tests | 359 pass, 0 fail | Excellent |
| Type safety | Clean typecheck | Excellent |
| `as any` violations | 24 (test files only) | Acceptable |
| LOC | ~13,600 | Moderate complexity |
| SKILL.md files | 55 | Exceeds target (good) |
| Tools | 8/8 implemented | Complete |
| Agents | 4/4 registered | Complete |
| Hooks | 5/5 core hooks | Complete |
| Feature modules | 5 built, 0 wired | Gap |
| CLI commands | 3 built, 0 routed | Gap |
| Integration tests | 1 file, 8 tests | Adequate |
| Plan compliance | ~92% | Good |
