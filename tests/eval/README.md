# `tests/eval/` — Audit Quality Eval Harness

A regression and quality-measurement harness for solidity-argus. Given a fixture (an audited Solidity project with a published findings-of-record list), the harness runs argus end-to-end and computes precision, recall, F1, wall-time, and token-cost against the ground truth.

## Layout

```
tests/eval/
├── README.md          ← this file
├── types.ts           ← Fixture / GroundTruth / AuditResult / RunMetrics types
├── metrics.ts         ← precision / recall / F1 / matching algorithm
├── runner.ts          ← loadFixture + runFixture entry points
├── drivers/           ← replay and deterministic scanner-output drivers
├── example.test.ts    ← smoke test against the vulnerable-vault fixture
└── fixtures/
    ├── README.md      ← per-fixture authoring guide
    └── vulnerable-vault/
        └── fixture.yaml   ← smoke fixture manifest
```

## How to run

```bash
bun test tests/eval/example.test.ts
```

The example test loads the manifest, walks the assertions, and proves the harness wiring works. Real fixture runs (Code4rena, pashov) will land as separate tests once the manifests are authored — see `fixtures/README.md`.

## How matching works

The matcher in `metrics.ts` compares each predicted finding to each ground-truth finding using three quality tiers:

1. `exact_line` — same file, same `[startLine, endLine]`
2. `line_overlap` — same file, overlapping line ranges
3. `file_match` — same file only (disabled by default; opt-in via `allow_file_match_fallback`)

The matcher does a greedy bipartite assignment ordered by quality tier. Each predicted finding can match at most one ground-truth finding (no double-counting).

## Metrics

Per-fixture:

- `true_positives` / `false_positives` / `false_negatives`
- `precision = TP / (TP + FP)`
- `recall = TP / (TP + FN)`
- `f1 = 2 * P * R / (P + R)`
- `wall_time_ms`
- `tokens_used` (optional, when driver reports it)
- `cost_usd` (optional, computed from tokens × per-million-token rate)

Aggregate (across fixtures):

- `micro_*` — pooled TP/FP/FN, then compute P/R/F1 once
- `macro_*` — per-fixture P/R/F1, then unweighted mean

Micro is the headline number when fixture sizes differ; macro is the headline when every fixture should weigh equally.

## How to add a fixture

See [`fixtures/README.md`](fixtures/README.md).

## What the AuditDriver must do

The runner takes an `AuditDriver` with a single method:

```typescript
audit(fixture: FixtureManifest): Promise<{ predicted: PredictedFinding[]; tokens_used?: number }>
```

Full-audit implementations are responsible for:

1. Spawning an Argus plugin run against `fixture.project.root`
2. Collecting the resulting `findings[]` from the persisted run artifact
3. Mapping each finding to a `PredictedFinding` (subset of argus's `Finding` shape — see `types.ts`)
4. (Optional) Returning a token-cost estimate

The deterministic control driver at `tests/eval/drivers/argus-scanner-output-driver.ts` measures complete, untruncated `argus_check_patterns` match output. It verifies scanner recall and precision only; it does not exercise agent verification, `argus_record_finding`, lifecycle hooks, durable finding state, rubric/tier routing, or report materialization. Live LLM orchestration and persisted-pipeline quality remain credentialed/manual evals because CI has no OpenCode session runner or model credentials.

The smoke test in `example.test.ts` uses an inline mock driver to avoid spinning up the full pipeline and to keep the test deterministic.

## Status

| Item | Status |
|---|---|
| Types + metrics + runner | ✅ |
| Smoke fixture (vulnerable-vault) | ✅ |
| Smoke test | ✅ |
| Deterministic scanner-output control driver | ✅ |
| Persisted plugin-pipeline AuditDriver | ⏳ credentialed/manual |
| 5 production fixtures (Code4rena × 3, pashov × 3, EVMBench) | ⏳ Sprint 1 follow-up |
| CI integration (regression gate on PR) | ⏳ after first 3 real fixtures land |
