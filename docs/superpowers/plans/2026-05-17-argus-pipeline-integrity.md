# Argus Pipeline Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Argus audit reports defensible by ensuring tool gates measure effective evidence, generated reports preserve canonical findings, Slither/Coverage handle Foundry projects correctly, and Themis validation has enforceable semantics.

**Architecture:** Add small deterministic helpers around existing tool/report seams rather than refactoring the audit pipeline. Each task introduces a failing regression test first, then a minimal implementation in the current files. The order is chosen so report integrity gates land before expanding tool behavior.

**Tech Stack:** Bun test runner, TypeScript, OpenCode plugin tools, Foundry/Forge CLI, Slither/crytic-compile CLI.

---

## File Structure

- Modify: `src/shared/key-tools.ts` — change reporting coverage from “tool name was seen” to “required tool completed successfully”; expose the same helper to the enforcer.
- Create: `src/shared/key-tools.test.ts` — unit coverage for successful, failed, missing, and unavailable key tools.
- Modify: `src/features/audit-enforcer/audit-enforcer.ts` — reuse shared key-tool logic so the injected reminder and report generator agree.
- Modify: `src/features/audit-enforcer/audit-enforcer.test.ts` — update expectations for failed key tools.
- Modify: `src/tools/report-generator-tool.ts` — preserve canonical finding fields exactly, add optional source excerpts, and harden quality gates against missing evidence for non-informational findings.
- Modify: `src/tools/report-generator-tool.test.ts` — regression tests for deduped JSON precedence, exact field rendering, severity preservation, and source excerpts.
- Modify: `src/tools/slither-tool.ts` — run direct Slither first for Foundry/via-IR targets, retain stderr, and use flatten fallback only after supported invocation fails with known flatten-worthy errors.
- Modify: `src/tools/slither-tool.test.ts` — regression tests for via-IR direct attempt, stderr retention, and fallback sequencing.
- Modify: `src/tools/forge-coverage-tool.ts` — add scoped coverage args and stack-too-deep retry using `--ir-minimum`.
- Modify: `src/tools/forge-coverage-tool.test.ts` — regression tests for `--match-path`, `--ir-minimum`, and retry behavior.
- Modify: `src/agents/argus-prompt.ts` — clarify Themis is mandatory, but Argus remains final judge by recording approval, remediation, or explicit override before final delivery.
- Modify: `src/agents/themis-prompt.ts` — require machine-readable verdict in the final response.
- Modify: `src/features/persistent-state/run-finalizer.ts` — recognize Themis disposition events and fail finalization when report generation happened without a subsequent resolved Themis disposition.
- Modify: `src/features/persistent-state/run-finalizer.test.ts` — regression tests for missing, unresolved, approved, remediated, and overridden Themis dispositions.

Do not commit during execution unless the user explicitly asks. Use checkpoints in the final response instead.

---

### Task 1: Effective Key-Tool Coverage Gate

**Files:**
- Modify: `src/shared/key-tools.ts`
- Create: `src/shared/key-tools.test.ts`
- Modify: `src/features/audit-enforcer/audit-enforcer.ts`
- Modify: `src/features/audit-enforcer/audit-enforcer.test.ts`
- Test: `src/shared/key-tools.test.ts`
- Test: `src/features/audit-enforcer/audit-enforcer.test.ts`

- [ ] **Step 1: Write failing key-tool tests**

Create `src/shared/key-tools.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { computeMissingKeyTools } from "./key-tools"

describe("computeMissingKeyTools", () => {
  test("counts only successful executions as satisfying required tools", () => {
    const missing = computeMissingKeyTools([
      { tool: "argus_slither_analyze", success: false },
      { tool: "argus_forge_test", success: true },
      { tool: "argus_check_patterns", success: true },
      { tool: "argus_solodit_search", success: true },
      { tool: "argus_analyze_contract", success: true },
    ])

    expect(missing).toEqual(["slither"])
  })

  test("keeps unavailable tools excused even when not executed", () => {
    const missing = computeMissingKeyTools(
      [
        { tool: "argus_forge_test", success: true },
        { tool: "argus_check_patterns", success: true },
        { tool: "argus_solodit_search", success: true },
        { tool: "argus_analyze_contract", success: true },
      ],
      ["slither"],
    )

    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
bun test src/shared/key-tools.test.ts
```

Expected: the first test fails because current `computeMissingKeyTools` ignores `success`.

- [ ] **Step 3: Implement successful-only coverage**

Update `src/shared/key-tools.ts` to accept success-aware records:

```ts
type ToolCoverageRecord = {
  tool: string
  success?: boolean
}

export function computeMissingKeyTools(
  toolsExecuted: ToolCoverageRecord[],
  unavailableTools?: string[],
): string[] {
  const executedShortNames = new Set(
    toolsExecuted
      .filter((t) => t.success === true)
      .map((t) => TOOL_SHORT_NAMES[t.tool] ?? t.tool),
  )
  const excused = new Set(
    (unavailableTools ?? []).map((t) => UNAVAILABLE_TO_KEY_TOOL[t]).filter(Boolean),
  )
  return KEY_TOOLS.filter((t) => !executedShortNames.has(t) && !excused.has(t))
}
```

- [ ] **Step 4: Align audit enforcer with shared gate**

Replace local key-family logic in `src/features/audit-enforcer/audit-enforcer.ts` with shared helper:

```ts
import { computeMissingKeyTools } from "../../shared/key-tools"
import { PHASE_ORDER } from "../../shared/audit-phases"
import type { AuditPhase, AuditState } from "../../state/types"

const REPORTING_PHASES: AuditPhase[] = ["reporting", "complete"]

function getNextPhase(current: AuditPhase): AuditPhase | null {
  const idx = PHASE_ORDER.indexOf(current)
  if (idx === -1 || idx >= PHASE_ORDER.length - 1) return null
  return PHASE_ORDER[idx + 1] ?? null
}
```

Then inside the reporting phase block:

```ts
const missing = computeMissingKeyTools(auditState.toolsExecuted, auditState.unavailableTools)
```

- [ ] **Step 5: Update enforcer failed-tool regression**

Add to `src/features/audit-enforcer/audit-enforcer.test.ts`:

```ts
it("treats failed key tools as incomplete", () => {
  const enforcer = createAuditEnforcer()
  const state: AuditState = {
    ...makeMockState("reporting"),
    toolsExecuted: [
      { tool: "argus_slither_analyze", startTime: 1, endTime: 2, success: false, findingsCount: 0 },
      { tool: "argus_forge_test", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
      { tool: "argus_check_patterns", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
      { tool: "argus_solodit_search", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
      { tool: "argus_analyze_contract", startTime: 1, endTime: 2, success: true, findingsCount: 0 },
    ],
  }

  const result = enforcer(state)

  expect(result).toContain("Tool coverage incomplete")
  expect(result).toContain("slither")
})
```

- [ ] **Step 6: Run task tests**

Run:

```bash
bun test src/shared/key-tools.test.ts src/features/audit-enforcer/audit-enforcer.test.ts
```

Expected: all tests pass.

---

### Task 2: Report Fidelity and Evidence Rendering

**Files:**
- Modify: `src/tools/report-generator-tool.ts`
- Modify: `src/tools/report-generator-tool.test.ts`
- Test: `src/tools/report-generator-tool.test.ts`

- [ ] **Step 1: Write failing regression for exact canonical rendering**

Add to `src/tools/report-generator-tool.test.ts`:

```ts
test("executeReportGeneration renders canonical finding fields exactly", async () => {
  const finding = makeFinding({
    id: "f-deadline",
    check: "missing-deadline-parameter-on-wrap-unwrap",
    severity: "Informational",
    confidence: "Medium",
    description:
      "wrap() and unwrap() already implement slippage protection via minWAlphaOut and minAlphaOut; the remaining gap is that neither function accepts a deadline parameter.",
    file: "src/WAlpha.sol",
    lines: [172, 228],
    source: "manual",
    recommendation:
      "Add deadline parameters while preserving the existing minWAlphaOut and minAlphaOut slippage checks.",
  })

  const result = await executeReportGeneration(
    {
      project_name: "FidelityFixture",
      scope: ["src/WAlpha.sol"],
      report_input: JSON.stringify(makeReportInput([finding], { toolsExecuted: [] })),
      tool_coverage_policy: "skip",
    },
    createContext(),
  )

  expect(result.findingsCount.informational).toBe(1)
  expect(result.findingsCount.low).toBe(0)
  expect(result.report).toContain("**Severity**: Informational")
  expect(result.report).toContain(finding.description)
  expect(result.report).toContain(finding.recommendation as string)
  expect(result.report).not.toContain("do not accept a deadline or minSharesOut / minAlphaOut")
  expect(result.report).not.toContain("lack slippage protection")
})
```

- [ ] **Step 2: Write failing regression for source excerpts**

Add to `src/tools/report-generator-tool.test.ts`:

```ts
test("executeReportGeneration includes source excerpts for findings when files are readable", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "argus-report-source-"))
  const sourceDir = path.join(tempDir, "src")
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(
    path.join(sourceDir, "WAlpha.sol"),
    [
      "pragma solidity ^0.8.20;",
      "contract WAlpha {",
      "    function setFeeReceiver(address newReceiver) external {",
      "        if (newReceiver == address(0)) revert WAlpha_ZeroAddress();",
      "    }",
      "}",
    ].join("\n"),
  )

  try {
    const finding = makeFinding({
      id: "f-zero",
      check: "no-zero-coldkey-check-on-set-fee-receiver",
      severity: "Informational",
      confidence: "High",
      description: "setFeeReceiver validates address(0); the missing pre-check is coldkey mapping.",
      file: "src/WAlpha.sol",
      lines: [3, 4],
      source: "manual",
    })
    const input = makeReportInput([finding], { toolsExecuted: [] })
    input.projectDir = tempDir

    const result = await executeReportGeneration(
      {
        project_name: "SourceExcerptFixture",
        scope: ["src/WAlpha.sol"],
        report_input: JSON.stringify(input),
        tool_coverage_policy: "skip",
      },
      createContext(),
    )

    expect(result.report).toContain("**Source Excerpt**")
    expect(result.report).toContain("function setFeeReceiver(address newReceiver) external")
    expect(result.report).toContain("if (newReceiver == address(0)) revert WAlpha_ZeroAddress();")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
bun test src/tools/report-generator-tool.test.ts --timeout 20000
```

Expected: source-excerpt test fails because the current report has no code excerpt. Exact-rendering should pass on current code; keep it as a regression guard.

- [ ] **Step 4: Add source excerpt helper**

In `src/tools/report-generator-tool.ts`, add near `formatLocation`:

```ts
function sourceExcerpt(projectDir: string, finding: Finding): string | null {
  if (!finding.file || !Array.isArray(finding.lines) || finding.lines.length < 2) return null
  const start = finding.lines[0]
  const end = finding.lines[1]
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) return null
  const absolutePath = path.isAbsolute(finding.file)
    ? finding.file
    : path.join(projectDir, finding.file)
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return null
  const contents = readFileSync(absolutePath, "utf-8").split(/\r?\n/)
  const excerpt = contents.slice(start - 1, end).join("\n")
  return excerpt.trim().length > 0 ? excerpt : null
}
```

- [ ] **Step 5: Pass projectDir into finding rendering**

Change `buildFindingsSection` signature:

```ts
function buildFindingsSection(findings: Finding[], projectDir: string): string {
```

Inside the finding loop, after location:

```ts
const excerpt = sourceExcerpt(projectDir, finding)
if (excerpt) {
  lines.push("")
  lines.push("**Source Excerpt**:")
  lines.push("")
  lines.push("```solidity")
  lines.push(excerpt)
  lines.push("```")
}
```

Update the call site in `executeReportGeneration` from:

```ts
buildFindingsSection(reportFindings)
```

to:

```ts
buildFindingsSection(reportFindings, reportInput.projectDir)
```

- [ ] **Step 6: Run task tests**

Run:

```bash
bun test src/tools/report-generator-tool.test.ts --timeout 20000
```

Expected: all report-generator tests pass.

---

### Task 3: Slither Foundry/Via-IR Invocation Semantics

**Files:**
- Modify: `src/tools/slither-tool.ts`
- Modify: `src/tools/slither-tool.test.ts`
- Test: `src/tools/slither-tool.test.ts`

- [ ] **Step 1: Write failing regression for via-IR direct attempt**

Add to `src/tools/slither-tool.test.ts`:

```ts
test("executeSlitherAnalyze attempts direct slither before flatten fallback when via_ir is requested", async () => {
  const commands: string[][] = []
  const { context } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "src/WAlpha.sol", via_ir: true },
    context,
    async (command, _signal, _cwd) => {
      commands.push(command)
      return {
        stdout: JSON.stringify({ success: true, results: { detectors: [] } }),
        stderr: "",
        exitCode: 0,
      }
    },
  )

  expect(result.success).toBe(true)
  expect(commands).toEqual([
    ["slither", "src/WAlpha.sol", "--json", "-", "--filter-paths", "node_modules"],
  ])
})
```

- [ ] **Step 2: Write failing regression for stderr retention on failure**

Add to `src/tools/slither-tool.test.ts`:

```ts
test("executeSlitherAnalyze returns stderr when direct slither fails without fallback", async () => {
  const { context } = createContext()

  const result = await executeSlitherAnalyze(
    { target: "src/WAlpha.sol" },
    context,
    async () => ({
      stdout: "not-json",
      stderr: "crytic-compile could not compile target",
      exitCode: 1,
    }),
  )

  expect(result.success).toBe(false)
  expect(result.errors).toContain("Slither exited with code 1")
  expect(result.errors).toContain("crytic-compile could not compile target")
  expect(result.error).toContain("Slither output parse error")
})
```

- [ ] **Step 3: Run failing Slither tests**

Run:

```bash
bun test src/tools/slither-tool.test.ts --timeout 20000
```

Expected: via-IR direct attempt test fails because current code skips direct Slither and enters flatten fallback immediately.

- [ ] **Step 4: Remove early via-IR flatten path**

In `src/tools/slither-tool.ts`, delete the early block at `executeSlitherAnalyze` that starts with:

```ts
if (args.via_ir) {
```

and ends before:

```ts
const command = buildCommand(args)
```

Keep the existing fallback on parse failure and unsuccessful payload, because those paths are evidence-driven.

- [ ] **Step 5: Improve via-IR error wording if fallback fails**

If a fallback failure still returns an error mentioning direct Slither incompatibility, replace it with:

```ts
"Slither direct analysis failed and flatten fallback also failed. Review stderr for the crytic-compile or forge build error."
```

- [ ] **Step 6: Run task tests**

Run:

```bash
bun test src/tools/slither-tool.test.ts --timeout 20000
```

Expected: all Slither tests pass.

---

### Task 4: Forge Coverage Scope and IR Retry

**Files:**
- Modify: `src/tools/forge-coverage-tool.ts`
- Modify: `src/tools/forge-coverage-tool.test.ts`
- Test: `src/tools/forge-coverage-tool.test.ts`

- [ ] **Step 1: Write failing tests for scoped coverage and IR retry**

Add to `src/tools/forge-coverage-tool.test.ts`:

```ts
test("executeForgeCoverage forwards match_path and ir_minimum flags", async () => {
  const { context } = createContext()
  const stdout = "| File | % Lines | % Statements | % Branches | % Funcs |\n|---|---|---|---|---|\n| Total | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) |"

  const result = await executeForgeCoverage(
    { target: ".", match_path: "test/WAlpha.t.sol", ir_minimum: true },
    context,
    async (command, options) => {
      expect(command).toEqual([
        "forge",
        "coverage",
        "--report",
        "summary",
        "--match-path",
        "test/WAlpha.t.sol",
        "--ir-minimum",
      ])
      expect(options.cwd).toBe(".")
      return { stdout, stderr: "", exitCode: 0 }
    },
  )

  expect(result.success).toBe(true)
})

test("executeForgeCoverage retries stack-too-deep failures with ir_minimum", async () => {
  const { context } = createContext()
  const commands: string[][] = []
  const stdout = "| File | % Lines | % Statements | % Branches | % Funcs |\n|---|---|---|---|---|\n| Total | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) | 100.00% (1/1) |"

  const result = await executeForgeCoverage(
    { target: "." },
    context,
    async (command) => {
      commands.push(command)
      if (commands.length === 1) {
        return { stdout: "", stderr: "Compiler error: Stack too deep", exitCode: 1 }
      }
      return { stdout, stderr: "", exitCode: 0 }
    },
  )

  expect(result.success).toBe(true)
  expect(commands).toEqual([
    ["forge", "coverage", "--report", "summary"],
    ["forge", "coverage", "--report", "summary", "--ir-minimum"],
  ])
})
```

- [ ] **Step 2: Run failing coverage tests**

Run:

```bash
bun test src/tools/forge-coverage-tool.test.ts
```

Expected: tests fail because args and command builder do not exist yet.

- [ ] **Step 3: Extend args and command builder**

Update `src/tools/forge-coverage-tool.ts` types:

```ts
type ForgeCoverageArgs = {
  target?: string
  match_path?: string
  ir_minimum?: boolean
}

type NormalizedForgeCoverageArgs = {
  target: string
  match_path?: string
  ir_minimum: boolean
}
```

Update normalization:

```ts
return {
  target: args.target ?? resolveProjectDir(context),
  match_path: args.match_path,
  ir_minimum: args.ir_minimum ?? false,
}
```

Add helper:

```ts
function buildCoverageCommand(args: NormalizedForgeCoverageArgs, forceIrMinimum = false): string[] {
  const command = ["forge", "coverage", "--report", "summary"]
  if (args.match_path) command.push("--match-path", args.match_path)
  if (args.ir_minimum || forceIrMinimum) command.push("--ir-minimum")
  return command
}

function isStackTooDeep(stderr: string): boolean {
  return /stack too deep/i.test(stderr)
}
```

- [ ] **Step 4: Add retry path**

Replace the single `runCommand(["forge", "coverage"], ...)` call with:

```ts
let runResult = await runCommand(buildCoverageCommand(normalizedArgs), {
  signal: context.abort,
  cwd: normalizedArgs.target,
})

if (runResult.exitCode !== 0 && !normalizedArgs.ir_minimum && isStackTooDeep(runResult.stderr)) {
  runResult = await runCommand(buildCoverageCommand(normalizedArgs, true), {
    signal: context.abort,
    cwd: normalizedArgs.target,
  })
}
```

Update tool schema:

```ts
args: {
  target: tool.schema.string().optional(),
  match_path: tool.schema.string().optional(),
  ir_minimum: tool.schema.boolean().optional(),
},
```

- [ ] **Step 5: Run task tests**

Run:

```bash
bun test src/tools/forge-coverage-tool.test.ts
```

Expected: all coverage tests pass.

---

### Task 5: Themis Disposition Enforcement

**Files:**
- Modify: `src/agents/argus-prompt.ts`
- Modify: `src/agents/themis-prompt.ts`
- Modify: `src/features/persistent-state/run-finalizer.ts`
- Modify: `src/features/persistent-state/run-finalizer.test.ts`
- Test: `src/features/persistent-state/run-finalizer.test.ts`

- [ ] **Step 1: Write failing finalizer tests for Themis disposition gate**

Add to `src/features/persistent-state/run-finalizer.test.ts`:

```ts
test("fails invariants when report generation is not followed by resolved themis disposition", async () => {
  const sink = makeInMemorySink([
    makeEvent({ type: "session.created", seq: 1 }),
    makeEvent({
      type: "tool.completed",
      seq: 2,
      tool_call_id: "report-tool-1",
      payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
    }),
  ])

  const result = await finalizeRun(RUN_ID, process.cwd(), sink)

  expect(result.invariantsPassed).toBe(false)
  expect(result.errors).toContain("generated report has no resolved Themis disposition")
})

test("passes invariants when report generation is followed by approved themis disposition", async () => {
  const sink = makeInMemorySink([
    makeEvent({ type: "session.created", seq: 1 }),
    makeEvent({
      type: "tool.completed",
      seq: 2,
      tool_call_id: "report-tool-1",
      payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
    }),
    makeEvent({
      type: "tool.completed",
      seq: 3,
      tool_call_id: "themis-task-1",
      payload: {
        tool: "task",
        success: true,
        subagent_type: "themis",
        themisDisposition: {
          status: "approved",
          verdict: { approved: true, pipeline_issues: [], false_positives: [], missed_findings: [], severity_adjustments: [] },
        },
      },
    }),
  ])

  const result = await finalizeRun(RUN_ID, process.cwd(), sink)

  expect(result.invariantsPassed).toBe(true)
})

test("passes invariants when Argus records an explicit Themis override", async () => {
  const sink = makeInMemorySink([
    makeEvent({ type: "session.created", seq: 1 }),
    makeEvent({
      type: "tool.completed",
      seq: 2,
      tool_call_id: "report-tool-1",
      payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
    }),
    makeEvent({
      type: "tool.completed",
      seq: 3,
      tool_call_id: "themis-disposition-1",
      payload: {
        tool: "argus_themis_disposition",
        success: true,
        themisDisposition: {
          status: "overridden",
          verdict: { approved: false, pipeline_issues: ["severity disagreement"], false_positives: [], missed_findings: [], severity_adjustments: [] },
          justification: "Argus reviewed the cited evidence and determined the reported issue is an accepted documented trade-off.",
        },
      },
    }),
  ])

  const result = await finalizeRun(RUN_ID, process.cwd(), sink)

  expect(result.invariantsPassed).toBe(true)
})

test("fails invariants when Themis rejects output and Argus records no disposition", async () => {
  const sink = makeInMemorySink([
    makeEvent({ type: "session.created", seq: 1 }),
    makeEvent({
      type: "tool.completed",
      seq: 2,
      tool_call_id: "report-tool-1",
      payload: { tool: "argus_generate_report", success: true, findingsCount: 0 },
    }),
    makeEvent({
      type: "tool.completed",
      seq: 3,
      tool_call_id: "themis-task-1",
      payload: {
        tool: "task",
        success: true,
        subagent_type: "themis",
        themis: { approved: false, pipeline_issues: ["report mismatch"], false_positives: [], missed_findings: [], severity_adjustments: [] },
      },
    }),
  ])

  const result = await finalizeRun(RUN_ID, process.cwd(), sink)

  expect(result.invariantsPassed).toBe(false)
  expect(result.errors).toContain("generated report has unresolved Themis issues")
})
```

- [ ] **Step 2: Run failing finalizer tests**

Run:

```bash
bun test src/features/persistent-state/run-finalizer.test.ts
```

Expected: new Themis tests fail because no Themis disposition gate exists.

- [ ] **Step 3: Add Themis disposition gate helper**

In `src/features/persistent-state/run-finalizer.ts`, add helper near report gate helpers:

```ts
type ThemisVerdict = {
  approved?: unknown
  pipeline_issues?: unknown
  false_positives?: unknown
  missed_findings?: unknown
  severity_adjustments?: unknown
}

type ThemisDisposition = {
  status?: unknown
  verdict?: ThemisVerdict
  notes?: unknown
  justification?: unknown
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isResolvedThemisDisposition(value: unknown): boolean {
  const disposition = value as ThemisDisposition | undefined
  if (disposition?.status === "approved") {
    return disposition.verdict?.approved === true
  }
  if (disposition?.status === "remediated") {
    return disposition.verdict?.approved === false && hasText(disposition.notes)
  }
  if (disposition?.status === "overridden") {
    return disposition.verdict?.approved === false && hasText(disposition.justification)
  }
  return false
}

function hasRejectedThemisVerdict(value: unknown): boolean {
  const verdict = value as ThemisVerdict | undefined
  return verdict?.approved === false
}

function collectThemisDispositionErrors(events: AuditEvent[]): string[] {
  const reportIndex = events.findLastIndex(
    (event) =>
      event.type === "tool.completed" &&
      (event.payload as { tool?: unknown }).tool === "argus_generate_report" &&
      (event.payload as { success?: unknown }).success === true,
  )
  if (reportIndex === -1) return []

  const laterEvents = events.slice(reportIndex + 1)
  const hasResolvedDisposition = laterEvents.some((event) => {
    if (event.type !== "tool.completed") return false
    const payload = event.payload as { themisDisposition?: unknown }
    return isResolvedThemisDisposition(payload.themisDisposition)
  })

  if (hasResolvedDisposition) return []

  const hasUnresolvedRejection = laterEvents.some((event) => {
    if (event.type !== "tool.completed") return false
    const payload = event.payload as { tool?: unknown; subagent_type?: unknown; themis?: unknown }
    return payload.tool === "task" && payload.subagent_type === "themis" && hasRejectedThemisVerdict(payload.themis)
  })

  return hasUnresolvedRejection
    ? ["generated report has unresolved Themis issues"]
    : ["generated report has no resolved Themis disposition"]
}
```

Then add to `finalizeRun` before computing `invariantsPassed`:

```ts
errors.push(...collectThemisDispositionErrors(events))
```

- [ ] **Step 4: Clarify prompts to emit parseable verdicts**

In `src/agents/themis-prompt.ts`, replace the verdict section with wording that preserves the existing JSON shape and adds persistence guidance:

```ts
Return the JSON verdict as the final fenced code block in your response. Do not add a second JSON object after it. Argus uses this verdict to decide whether to accept it, remediate it, or explicitly override it.
```

In `src/agents/argus-prompt.ts`, change the Themis section to state:

```ts
If Themis returns approved=false, Argus remains the final judge but must record a disposition before the audit is complete: remediate the issue and record status="remediated", or deliberately override with status="overridden" and a concrete justification. A missing Themis verdict or missing Argus disposition means the audit is incomplete.
```

Implementation note: if no dedicated `argus_themis_disposition` tool exists yet, add the smallest durable recording mechanism in this task, either by extending `argus_record_finding`-style event recording or by adding a tiny internal tool whose payload is exactly `{ status, verdict, notes?, justification? }`.

- [ ] **Step 5: Run task tests**

Run:

```bash
bun test src/features/persistent-state/run-finalizer.test.ts
```

Expected: all finalizer tests pass.

Implementation note: if actual task events do not contain `subagent_type`, parsed `themis`, or `themisDisposition`, add the minimal hook support in `src/hooks/tool-tracking-hook.ts` during this task and extend the test fixture to match the real event payload shape observed in the hooks.

---

### Task 6: Full Verification and Manual QA

**Files:**
- No new source files expected beyond earlier tasks.
- Verify all modified files.

- [ ] **Step 1: Run focused test suites**

Run:

```bash
bun test src/shared/key-tools.test.ts src/features/audit-enforcer/audit-enforcer.test.ts src/tools/report-generator-tool.test.ts src/tools/slither-tool.test.ts src/tools/forge-coverage-tool.test.ts src/features/persistent-state/run-finalizer.test.ts --timeout 30000
```

Expected: all focused suites pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run changed-file lint/format check**

Run:

```bash
bunx biome check src/shared/key-tools.ts src/shared/key-tools.test.ts src/features/audit-enforcer/audit-enforcer.ts src/features/audit-enforcer/audit-enforcer.test.ts src/tools/report-generator-tool.ts src/tools/report-generator-tool.test.ts src/tools/slither-tool.ts src/tools/slither-tool.test.ts src/tools/forge-coverage-tool.ts src/tools/forge-coverage-tool.test.ts src/agents/argus-prompt.ts src/agents/themis-prompt.ts src/features/persistent-state/run-finalizer.ts src/features/persistent-state/run-finalizer.test.ts
```

Expected: exits 0.

- [ ] **Step 4: Run full tests**

Run:

```bash
bun test --timeout 30000
```

Expected: exits 0. If unrelated pre-existing failures appear, capture exact failing test names and confirm focused suites still pass.

- [ ] **Step 5: Manual QA driver for report fidelity**

Create a temporary script outside the repo in `/var/folders/zc/y3j6cbzs40q919jrc89v_2100000gn/T/opencode/argus-report-fidelity-driver.ts` that imports `executeReportGeneration`, builds a one-finding report input with a source file, and asserts the rendered markdown contains the exact description, severity, recommendation, and source excerpt.

Run:

```bash
bun /var/folders/zc/y3j6cbzs40q919jrc89v_2100000gn/T/opencode/argus-report-fidelity-driver.ts
```

Expected output includes:

```text
report fidelity ok
```

- [ ] **Step 6: Manual QA driver for tool commands**

Create a temporary script in `/var/folders/zc/y3j6cbzs40q919jrc89v_2100000gn/T/opencode/argus-tool-command-driver.ts` that calls `executeSlitherAnalyze` and `executeForgeCoverage` with mocked runners and asserts:

```ts
// Slither via_ir direct first
["slither", "src/WAlpha.sol", "--json", "-", "--filter-paths", "node_modules"]

// Coverage retry path
["forge", "coverage", "--report", "summary"]
["forge", "coverage", "--report", "summary", "--ir-minimum"]
```

Run:

```bash
bun /var/folders/zc/y3j6cbzs40q919jrc89v_2100000gn/T/opencode/argus-tool-command-driver.ts
```

Expected output includes:

```text
tool commands ok
```

---

## Self-Review

**Spec coverage:**
- Report fidelity: Task 2 covers exact canonical rendering and source excerpts.
- Slither handling: Task 3 covers direct Slither invocation before fallback and stderr retention.
- Themis semantics: Task 5 covers mandatory resolved disposition while preserving Argus as final judge.
- Coverage IR/scoping: Task 4 covers `--match-path`, `--report summary`, and `--ir-minimum` retry.
- Reporting gates: Task 1 covers successful-only key tool coverage and enforcer alignment.

**Placeholder scan:** No task contains deferred-work language or unspecified test instructions. The only conditional note is bounded to real event payload shape discovery for Themis task events.

**Type consistency:** New `computeMissingKeyTools` accepts `{ tool: string; success?: boolean }[]`, compatible with existing `ToolExecution[]`. Coverage args use snake_case to match tool argument style. Themis disposition payload uses a namespaced `themisDisposition` object to separate Themis' recommendation from Argus' final decision.
