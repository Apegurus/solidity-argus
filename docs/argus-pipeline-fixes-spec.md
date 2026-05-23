# Argus Pipeline Fixes Spec

> **Date**: 2026-05-20  
> **Scope**: Fixes discovered during the Endure wAlpha/wsTAO audit run `ac907926-552c-4143-af23-b76ab40401ff`  
> **Goal**: Make audit output deterministic, regenerable, and easier to recover when tools or background agents fail.

---

## Executive Summary

The run validated the core Argus architecture: multi-agent convergence was useful, Themis caught a real report-integrity issue, and the artifact-first design made recovery possible. The main weaknesses are not vulnerability-detection quality; they are pipeline integrity and remediation ergonomics.

Priority order:

1. Enforce deduped-finding lineage in `argus_persist_deduped`.
2. Add a safe report-regeneration path to `argus_generate_report`.
3. Improve failure diagnostics for Sentinel/background-tool workflows.
4. Add targeted hints for brittle Forge coverage and Slither mixed-pragma failures.
5. Treat `task.load_skills` confusion primarily as upstream OpenCode UX, with Argus prompt/test hardening only.

---

## P0-1: Enforce Lineage At Dedup Persistence

**Problem**: `argus_persist_deduped` accepted a deduped artifact where one raw observation ID appeared in two findings and another observation ID did not exist in raw observations. Themis caught part of it; Scribe caught the rest during remediation. This should fail before disk write.

**Current evidence**:

- `src/tools/persist-deduped-tool.ts` parses and writes findings directly.
- `src/tools/report-generator-tool.ts` has downstream parity checks, but default `preflight_policy` can warn instead of fail.
- `observation_count` is normalized/preserved elsewhere but not enforced against `observation_ids` at persistence time.

**Required behavior**:

`argus_persist_deduped` must reject invalid lineage with a structured `LineageError` response and must not write `deduped-findings.json`.

Raw observations source:

- Load raw observations from `createAuditArtifactResolver(run_id, projectDir).paths().findingsFile`, i.e. `.argus/runs/{run_id}/findings.json`.
- Use that file's `findings[].observation_id` values as the authoritative raw observation set.
- If `findings.json` is missing, unreadable, invalid JSON, or has no `findings` array, return `MissingRawFindingsError` and do not write `deduped-findings.json`.
- Do not fall back to session state or sibling runs for lineage validation; per-run lineage must be proven from the run artifact.

Shared validator:

- Add a focused shared validator, preferably `src/shared/lineage-validator.ts`, and use it from both `src/tools/persist-deduped-tool.ts` and report preflight code in `src/tools/report-generator-tool.ts`.
- The validator should accept raw `CanonicalFinding[]` and deduped `CanonicalFinding[]` or finding-like records, then return a deterministic result containing counts and sorted diagnostic ID arrays.
- `argus_persist_deduped` enforces the validator result. `argus_generate_report` may continue to surface report preflight warnings/errors, but it must compute parity from the same helper to avoid divergent logic.

Validation rules:

- Every deduped finding must include non-empty `observation_ids`.
- `observation_count` must equal `observation_ids.length` when supplied.
- No `observation_id` may appear in more than one deduped finding.
- Every `observation_id` must exist in the raw observations for the same `run_id`.
- The total mapped observation count must equal the raw observation count.

Structured error shape:

```json
{
  "success": false,
  "error": "LineageError",
  "lineage": {
    "raw_count": 39,
    "mapped_count": 41,
    "duplicate_observation_ids": ["obs-a"],
    "phantom_observation_ids": ["obs-missing"],
    "missing_observation_ids": ["obs-unmapped"],
    "count_mismatches": [
      {
        "check": "finding-slug",
        "observation_count": 4,
        "observation_ids_length": 3
      }
    ]
  }
}
```

Missing raw findings error shape:

```json
{
  "success": false,
  "error": "MissingRawFindingsError",
  "message": "Cannot verify deduped lineage because .argus/runs/{run_id}/findings.json is missing or invalid"
}
```

**Files likely touched**:

- `src/shared/lineage-validator.ts` (new shared validation helper)
- `src/shared/lineage-validator.test.ts` (shared validator unit tests)
- `src/tools/persist-deduped-tool.ts`
- `src/tools/persist-deduped-tool.test.ts` (new file)
- `src/tools/report-generator-tool.ts` (replace local parity logic with shared helper where practical)
- `src/state/adapters.ts` only if count consistency belongs in canonical normalization

**Acceptance tests**:

- Valid deduped artifact writes successfully.
- Missing or invalid `.argus/runs/{run_id}/findings.json` is rejected as `MissingRawFindingsError` and file is not written.
- Duplicate observation ID is rejected and file is not written.
- Phantom observation ID is rejected and file is not written.
- Missing raw observation is rejected and file is not written.
- `observation_count !== observation_ids.length` is rejected.
- Report preflight and `argus_persist_deduped` report the same duplicate, phantom, and missing observation IDs for the same inputs.

---

## P0-2: Add Safe Report Regeneration

**Problem**: Themis remediation may require report regeneration after Scribe corrects deduped findings. `argus_generate_report` currently enforces single-writer duplicate protection with no `force` or `revision` escape hatch, so remediation can devolve into manual report editing.

**Current evidence**:

- Tool schema in `src/tools/report-generator-tool.ts` exposes no `force` or `revision` argument.
- Duplicate writes for the same `run_id` are rejected by `checkDuplicateWrite`.
- This protects against accidental overwrite, but blocks legitimate remediation re-renders.

**Required behavior**:

Add an explicit regeneration mode. Prefer revisioned output over destructive overwrite.

Recommended API:

```ts
type ReportGeneratorArgs = {
  // existing args...
  revision?: number;
  force?: boolean;
};
```

Rules:

- Default behavior remains unchanged: duplicate same-run write is rejected.
- `revision` is caller-supplied. The tool must not auto-select the next revision number in this iteration.
- `revision` must be an integer greater than or equal to `2`; `revision: 1` is invalid because the base report is revision 1.
- `revision: N` writes a deterministic revised filename, e.g. `...-{run_id8}-r2.md`, by extending `src/shared/report-path-resolver.ts`.
- `revision: N` preserves the original base report and is subject to duplicate-write checks only at the resolved revision path.
- `force: true` overwrites only the base canonical report path, never a revision path.
- `force: true` overwrites only when the existing file contains Argus metadata for the same `run_id`, as parsed by `extractReportRunId`.
- If `force: true` sees an existing file with no Argus metadata or different-run metadata, return `INSECURE_OVERWRITE_REFUSED` and do not write.
- `force` and `revision` must not both be set.
- Tool output must state the authoritative report path.

Report path contract:

- Base filename remains: `{Project}-security-audit-{YYYY-MM-DD}-{run_id8}.md`.
- Revised filename is: `{Project}-security-audit-{YYYY-MM-DD}-{run_id8}-r{revision}.md`.
- `ReportPathOptions` should gain `revision?: number` and `resolveReportPath` should own suffix formatting so tests and tools do not duplicate filename rules.

**Files likely touched**:

- `src/tools/report-generator-tool.ts`
- `src/shared/report-path-resolver.ts`
- `tests/integration/single-writer-policy.test.ts`
- `src/tools/report-generator-tool.test.ts`
- `src/agents/scribe-prompt.ts`
- `src/agents/argus-prompt.ts`

**Acceptance tests**:

- Existing duplicate-write test still fails without override.
- `revision: 2` creates a second report and preserves the original.
- A second `revision: 2` write is rejected unless an explicit safe overwrite mode for revisions is later specified.
- `force: true` overwrites only a same-run Argus-managed report.
- `force: true` refuses to overwrite a non-Argus or different-run file.
- `force: true` plus `revision` is rejected before write.
- `revision: 1`, `revision: 0`, negative revisions, and non-integer revisions are rejected before write.
- Scribe remediation prompt instructs regeneration through the tool, not manual file edits.

---

## P1-1: Improve Background And Sentinel Failure Diagnostics

**Problem**: A Sentinel background task failed with an Anthropic assistant-prefill/runtime error. Retry with a shorter prompt succeeded. The error was surfaced as raw provider text with no category or retry advice.

**Required behavior**:

Background failures should carry structured metadata:

```json
{
  "category": "model_error | tool_error | timeout | cancelled | unknown",
  "retry_recommendation": "safe_to_retry | retry_with_changes | do_not_retry",
  "summary": "short human-readable explanation"
}
```

Background diagnostic API:

- Add a named type such as `BackgroundFailureDiagnostic` with fields `category`, `retry_recommendation`, and `summary`.
- Failed tasks must remain retrievable for diagnostics. Either change `getResult(taskId)` to return the diagnostic for `failed` tasks, or add an explicit method such as `getTaskStatus(taskId)` / `getDiagnostics(taskId)`. Pick one API and document it in `BackgroundManagerWithTaskCallbacks`.
- Provider assistant-prefill errors such as `This model does not support assistant message prefill` classify as `model_error` with `retry_with_changes`.
- Timeout errors classify as `timeout`; use `retry_with_changes` when the prompt/output size likely caused the timeout, otherwise `safe_to_retry`.
- Tool execution failures classify as `tool_error` when the error text identifies a failed tool command or an Argus tool error payload.

Sentinel should also be prompted to summarize large tool results before continuing.

Sentinel bounded-output rule:

- Add a prompt rule to `src/agents/sentinel-prompt.ts`: if any tool output or copied log exceeds 5,000 characters, summarize it in at most 10 bullets, preserve the exact failing command/tool name, preserve artifact paths, and do not paste the full output back into the conversation.
- If a full output artifact path is available, Sentinel should reference the path instead of embedding the full text.

**Files likely touched**:

- `src/features/background-agent/background-manager.ts`
- `src/agents/sentinel-prompt.ts`
- `src/features/error-recovery/tool-error-recovery.ts`
- related tests under `src/features/background-agent/` and `src/features/error-recovery/`

**Acceptance tests**:

- Provider prefill error is classified as `model_error` + `retry_with_changes`.
- Timeout is classified as `timeout` + `safe_to_retry` or `retry_with_changes` depending on task state.
- Failed task result remains retrievable for diagnostics.
- Sentinel prompt includes a bounded-output/summarization rule.
- The selected diagnostics retrieval API is covered by tests for completed, failed, queued, and unknown task IDs.

---

## P1-2: Improve Forge Coverage Diagnostics

**Problem**: `argus_forge_coverage` can fail on project-specific Foundry config such as incompatible coverage instrumentation settings. The current failure is raw Forge stderr or generic invalid-output text.

**Required behavior**:

- Detect known unsupported coverage config keys/errors and return a structured hint.
- Include the project path and suggested workaround.
- Do not silently mutate the project config.
- Extend `ForgeCoverageResult` with optional `hint?: string` and `suggested_command?: string`; keep `error` as the original stderr or concise original failure string.

Recommended initial scope:

- Pattern-match Forge coverage errors mentioning `optimizerSteps`, unsupported optimizer settings, or config parse/instrumentation failures.
- Return: `success: false`, original stderr in `error`, `hint`, and `suggested_command` when possible.
- Prefer extending `src/shared/forge-errors.ts` if the classifier is reusable by other Forge tools; keep coverage-only wording in `src/tools/forge-coverage-tool.ts` if it is specific to coverage instrumentation.
- Suggested command must not edit `foundry.toml`; it may suggest a scoped command such as `forge coverage --report summary --ir-minimum` or a manual config workaround.

**Files likely touched**:

- `src/tools/forge-coverage-tool.ts`
- `src/tools/forge-coverage-tool.test.ts`
- optionally `src/shared/forge-errors.ts`

**Acceptance tests**:

- `optimizerSteps` coverage failure returns a clear remediation hint.
- Existing stack-too-deep `--ir-minimum` retry still works.
- Generic Forge failures still preserve original stderr.
- Type-level callers can read `hint` and `suggested_command` without parsing `error`.

---

## P1-3: Improve Slither Mixed-Pragma Diagnostics

**Problem**: `argus_slither_analyze` can fail on mixed-pragma codebases where vendored 0.5.x contracts coexist with 0.8.x in-scope contracts. The successful workaround was narrowing to a single-pragma subdirectory.

**Required behavior**:

- When Slither/crytic compile fails with mixed-pragma or solc-selection symptoms, return a hint to narrow target scope.
- If safe and deterministic, suggest candidate subdirectories such as `src/` or a user-provided in-scope path.
- Avoid automatic narrowing unless the narrowed target is clearly within the original target and contains Solidity files.
- Extend `SlitherAnalyzeResult` with optional `hint?: string` and `suggested_command?: string`; keep `errors` and `error` available for raw Slither/crytic details.
- Initial pattern triggers should include `CryticCompileError`, `Slither exited with code 1`, `solc`, `pragma`, `requires different compiler version`, and mixed Solidity versions in stderr.
- Hints should mention both narrowing scope and checking `foundry.toml`/remappings. When suggesting `src/`, only do so if it exists under the analyzed project and contains Solidity files.
- Do not run narrowed Slither automatically in this iteration; return guidance only.

**Files likely touched**:

- `src/tools/slither-tool.ts`
- `src/tools/slither-tool.test.ts`
- `src/features/error-recovery/tool-error-recovery.ts`

**Acceptance tests**:

- Mixed-pragma stderr returns a hint: `Try narrowing target to a single-pragma subdirectory`.
- Existing via-IR flatten fallback tests continue to pass.
- Missing Slither and missing Forge fallback errors remain distinct.
- Suggested command is present only when a safe candidate target exists.

---

## P1-4: Clarify Audit Skill Loading Boundary

**Problem**: Passing Argus audit skills to OpenCode `task.load_skills` produces an error like `Skills not found`, even though the skills exist for `argus_skill_load`. This is confusing.

**Assessment**: Mostly upstream/OpenCode UX. Argus already documents the boundary in prompts and tests. Do not build a broad proxy layer unless OpenCode exposes a reliable plugin hook for task skill validation.

**Required Argus-side behavior**:

- Keep prompts explicit: audit skills load via `argus_skill_load`; `task.load_skills` is for generic OpenCode runtime skills only.
- Add or preserve tests that mention representative skill names: `reentrancy`, `access-control`, `oracle-manipulation`.
- If feasible, add an Argus-facing helper note to delegation examples: `load_skills: []` unless using generic OpenCode skills.
- Current code already has meaningful coverage in `src/agents/skill-boundary-prompt.test.ts`; this item should be treated as verification/tightening, not a large implementation task.

**Files likely touched**:

- `src/agents/argus-prompt.ts`
- `src/agents/sentinel-prompt.ts`
- `src/agents/pythia-prompt.ts`
- `src/agents/scribe-prompt.ts`
- `src/agents/skill-boundary-prompt.test.ts`

**Non-goal**:

- Do not make `task.load_skills` proxy to `argus_skill_load` inside Argus unless OpenCode provides a supported interception point.

---

## P2: Product Improvements

These are valuable but should not block the P0/P1 work.

### Canonical Finding Slugs

Add a lightweight slug registry or taxonomy so agents converge on names like `walpha-missing-reentrancy-guard` instead of matching prose after the fact.

Initial approach:

- Add optional `canonical_check_slug` to findings.
- Preserve current `check` for report title compatibility.
- Consider exposing a small `argus_check_slugs` registry later.

### Themis Disposition By Artifact Path

Allow `argus_themis_disposition` to reference a persisted verdict artifact instead of requiring large inline JSON.

Initial approach:

- Keep `verdict_json` for compatibility.
- Add optional `verdict_path` that must resolve under `.argus/runs/{run_id}/`.

### Subphase Tracking

Track deep audit subphases, especially audit-specialist profiles.

Initial approach:

- Extend run events with `subphase.started` / `subphase.completed`.
- Include active/completed subphases in `<argus-context>`.
- Do not expand the top-level phase enum unless necessary.

---

## Non-Goals

- Do not weaken single-writer policy by allowing arbitrary overwrites.
- Do not remove Themis; it proved useful.
- Do not fragment one effective multi-profile audit-specialist task into many separate tasks by default.
- Do not auto-edit project `foundry.toml` for coverage.
- Do not treat manually mirrored `docs/audits` reports as canonical unless explicitly configured.

---

## Suggested Implementation Sequence

0. Create the shared lineage validator and tests before modifying tools.
1. Implement and test `LineageError` / `MissingRawFindingsError` enforcement in `argus_persist_deduped`.
2. Wire report preflight to the shared lineage validator where practical.
3. Add report `revision` support in `resolveReportPath` and `argus_generate_report`.
4. Add `force` only after revision support is passing.
5. Add background failure classification and the chosen failed-diagnostics retrieval API.
6. Add Sentinel summarization guidance.
7. Add Forge coverage and Slither diagnostic hints.
8. Tighten or preserve skill-boundary examples and tests.
9. Re-run a small fixture audit and one remediation flow to confirm end-to-end behavior.

---

## Verification Gate

Before release, run:

```bash
bun test src/shared/lineage-validator.test.ts src/tools/persist-deduped-tool.test.ts src/tools/report-generator-tool.test.ts tests/integration/single-writer-policy.test.ts src/features/background-agent/background-manager.test.ts src/tools/forge-coverage-tool.test.ts src/tools/slither-tool.test.ts src/features/error-recovery/tool-error-recovery.test.ts src/agents/skill-boundary-prompt.test.ts --timeout 10000
bun run typecheck
bun src/cli/index.ts doctor
```

Note: `src/tools/persist-deduped-tool.test.ts` and `src/shared/lineage-validator.test.ts` do not exist yet; creating them is part of P0-1.

Manual QA:

- Run an audit fixture through `record_finding -> persist_deduped -> generate_report -> themis_disposition`.
- Attempt invalid deduped lineage and confirm it fails at `argus_persist_deduped`.
- Regenerate a report with `revision: 2` and confirm both report files exist with correct metadata.
