# Eval Fixtures

Curated audit targets with ground-truth findings for measuring argus regression and precision/recall.

## Layout

```
fixtures/
├── README.md                ← this file
├── <fixture-slug>/
│   ├── fixture.yaml         ← manifest + ground-truth
│   ├── project/             ← the contracts under audit (or a symlink/path reference)
│   └── NOTES.md             ← optional human notes
```

## Adding a fixture

1. Pick a public audited target with a published findings list (Code4rena contest, pashov audit, Trail of Bits report).
2. Verify the license permits redistribution (MIT / Apache-2.0 / CC0). If not, link to the source repo by commit and avoid copying the contracts.
3. Create `fixture.yaml` matching the schema in `tests/eval/runner.ts` (`FixtureManifestSchema`).
4. Transcribe each accepted finding from the audit-of-record into `expected_findings[]`. Include `id`, `title`, `severity`, `file`, `lines`, `acceptance_criteria`, and `source` (audit name + URL).
5. Run `bun test tests/eval/example.test.ts` to verify the harness loads the manifest.
6. (Optional) Add a `cost_usd` baseline once you've run a full audit against the fixture.

## Ground-truth quality

Each finding's `acceptance_criteria` is what makes a predicted finding count as a true positive. Two acceptance modes:

- `same-line` (default): predicted finding must match `file` + at least one line in `[lines[0], lines[1]]`.
- `same-file`: predicted finding only needs to be on the same `file` (less strict — record as fallback when line numbers in the audit-of-record are approximate).

Acceptance modes are an authoring choice per finding, documented in `acceptance_criteria[]`.

## Severity floor

The runner filters predicted findings below the configured `severity_threshold` (default `Low`) before matching. Ground-truth findings below the floor are also excluded from `false_negatives` to keep the metric fair.

## Fixtures shipped

- `vulnerable-vault` — internal smoke fixture (existing `tests/fixtures/vulnerable-vault`). Smoke-only; not a benchmark.
- `scanner-retained-control` — deterministic scanner-output recall control for a retained Pyth unsafe-price rule.
- `scanner-safe-control` — deterministic scanner-output precision control for an allowlisted forwarding helper.

## Fixtures to add next

Tracked in `docs/competitive-analysis/04-next-sprint-plan.md` and PR #5 follow-up:

1. Code4rena 2024-09 (3 recent contests, MIT)
2. pashov audit reports — DODO, megapot, pooltogether (MIT)
3. EVMBench (if license-compatible)
