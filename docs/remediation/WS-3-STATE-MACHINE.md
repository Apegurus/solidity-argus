# WS-3 — Audit-state durability & lifecycle: proposed state machine

**Status:** DESIGN — for Oracle Phase-0 review, before any WS-3 code is written (Phase 2).
**Base:** `origin/staging` @ `82d76a2`.
**Scope:** the 10 high-severity WS-3 findings (see `REMEDIATION-PLAN-2026-07-01.md` §4 WS-3). This document proposes the single canonical lifecycle the fixes must conform to, so they are implemented as one coherent state machine rather than 10 independent patches.

---

## 1. Entities

| Entity | Identity | Durable artifact | Current type surface |
|---|---|---|---|
| **OpenCode session** | `sessionId` (`ses_…`) | `.argus/sessions/state-{sessionId}.json` (debounced) | `session-state-registry` (`AuditStateManager` + `DebouncedSave` per session) |
| **Audit run** | `runId` | `.argus/runs/{runId}/events.jsonl` (+ findings/report/manifest) | `audit-artifact-resolver` |
| **EventSink** | keyed by `sessionId` **and** `runId` | appends to the run journal | `bounded-sink-registry` (`EventSink` with `isFinalized: boolean`, `markFinalized()`, `runId`) |
| **Finalizer** | per run | writes finalization result + quality gates | `run-finalizer.finalizeRun` (7 callers) |

The bug class: these four are managed by **independent** registries whose eviction/dispose/seal/rebind rules do not agree on when a run's evidence is safe to drop, seal, or reassign.

---

## 2. Grounded current behavior (the defects, by transition)

Verbatim from the current source at `82d76a2`:

- **`bounded-sink-registry.setBounded`** runs `evictStale` on every set, and `evictOldest` when `size >= maxSinks`. Both call `markFinalizedBestEffort(sink)` → `sink.markFinalized()` **without consulting whether a live session still references that sink** (finding **#11**, `bounded-sink-registry.ts:45`). Note the registry already has `releaseUnreferencedRuns()` (computes active runIds from session sinks) and `getActiveRunSinks()` (`!isFinalized`) — reference-awareness exists but eviction does not use it.
- **`session-state-registry.deleteSession`** does `debouncedSave?.dispose()` then drops the manager — **no flush** (finding **#12**, `session-state-registry.ts:26`); `evictOldestSessionIfNeeded` reaches the same path, so a capacity eviction silently discards the last buffered findings/progress.
- **`session-activation`** (from findings): marks a session activated even when sink init failed (**#15**, `:196`); rebinds a recovered run to a fresh `runId` (**#14**, `:167`); discards active post-report state on `reportGenerated` alone (**#13**, `:153`).
- **`tool-tracking-hook`**: `record_finding` mutates live state before proving a durable sink exists (**#16**, `:449`); orphan event buffers for never-flushed sessions are never pruned (**#17**, `:658`).
- **`run-finalizer.finalizeRun`**: permanently seals the sink even when quality gates fail (**#18**, `:469`), so remediation/Themis/regenerated-report events can never be recorded; finalization gates read report metadata the completed event never persists (**#19**, `:101`).
- **`create-hooks` `session.deleted`**: can archive/teardown shared global state for a session that never activated (**#20**, `:415`).

---

## 3. Proposed state machines

### 3a. EventSink / Run lifecycle

Replace the single `isFinalized: boolean` with an explicit state plus an **owner set** of sessionIds. The owner set is a SET, not a scalar or a bare count: parent/child OpenCode sessions coalesce onto one run sink (many sessions → one run), so every eviction/finalization decision keys on set-emptiness.

```
                 setForSession/setForRun
        ┌───────────────────────────────────────┐
        ▼                                         │
   [ACTIVE] ──drain(flush pending)──► [DRAINING] ─┴─ finalizeRun(success) ─► [SEALED]   (terminal)
      │  ▲                                │
      │  │ later event (remediation,      │ finalizeRun(gate-fail / error)
      │  │ disposition, regen report)     ▼
      │  └──────────────────────────  [FAILED_RECOVERABLE]  ── retry finalizeRun ──► [SEALED]
      │
      └── eviction: skipped entirely while ownerSet ≠ ∅ (referenced sinks are exempt: never released, sealed, or TTL-evicted)
```

- **ACTIVE**: accepts events; `ownerSet` = referencing sessionIds.
- **DRAINING**: no new tool events expected; pending journal writes + debounced saves being flushed.
- **SEALED** (terminal): reached **only** via a *successful* `finalizeRun`. No further events.
- **FAILED_RECOVERABLE**: `finalizeRun` ran but quality gates failed or errored. The run is **not** sealed; it still accepts remediation, `argus_themis_disposition`, and regenerated-report events, and `finalizeRun` may be retried. (Resolves **#18**.)

**Eviction rule (resolves #11; conforms to I1):** a sink whose owner set is non-empty is **fully eviction-exempt** — eviction neither releases nor seals it, and it is TTL-exempt. Eviction may release **and** seal a run **only** when `ownerSet === ∅` (and the run is not ACTIVE/DRAINING). Extend the existing `releaseUnreferencedRuns` reference computation into `evictOldest`/`evictStale`; TTL applies only to runs with no live session and no recent heartbeat, and a DRAINING run carries its own bounded timeout rather than TTL.

**Persistence of FAILED_RECOVERABLE (resolves #18 durably):** record it as a distinct journal event (`run.finalization_failed`), **not** only an in-memory flag or manifest field — today `event-sink` seals the sink on any `run.finalized` event, so a new event type is required to keep the sink open after a failed finalization. Manifest/in-memory values are a derived cache of the journal.

### 3b. Session lifecycle

```
[NEW] ── activate ──► [ACTIVATING] ──(sink OK)──► [ACTIVE] ── drain(await flush) ──► [DISPOSED]
                           │                          ▲
                           │(sink init fails)         │ resume (same identity)
                           ▼                          │
                    [UNACTIVATED/DEGRADED] ── retry ──┘
                     (retryable; not counted activated)
```

- **ACTIVATING → ACTIVE** requires a durable sink. If sink init fails, the session goes to **UNACTIVATED/DEGRADED** (retryable) and is **not** recorded in `activatedSessions` (resolves **#15**, and gives **#16** a representable "no durable sink" state).
- **DISPOSED** is reached only after `await debouncedSave.flush()` completes (resolves **#12**). `deleteSession`/eviction become **fully async** (`flushAndDispose(): Promise<void>`) — not a synchronous flush barrier — and are awaited from the hook teardown paths; the 7 `finalizeRun` callers + eviction sites migrate to async. (`createDebouncedSave.flush()` and manager `dispose()` are already async.)
- **resume**: a recovered session re-enters ACTIVE under its **original** `sessionId`/`runId`/`startTime`; artifacts are never split to a new `runId` (resolves **#14**). `reportGenerated` alone does not force DISPOSED — only explicit finalization/disposition does (resolves **#13**).

---

## 4. Invariants (must always hold; each becomes a locking test)

- **I1** A sink whose `ownerSet` ≠ ∅ is never SEALED or released by eviction. *(#11)*
- **I2** No session reaches DISPOSED without a completed flush of pending debounced saves — no lost findings/progress. *(#12)*
- **I3** A run is SEALED (terminal) only on a *successful* finalization; a failed finalization → FAILED_RECOVERABLE, which still accepts remediation/disposition/regenerated-report events. *(#18)*
- **I4** A recovered run keeps its original `runId`/`sessionId`/`startTime`; no artifact is split across a fresh `runId`. *(#14)*
- **I5** A session is counted activated only if a durable sink exists; otherwise it is UNACTIVATED/DEGRADED and retryable. *(#15)*
- **I6** `record_finding` follows validate → canonicalize → append `finding.added` to the durable journal (fail-fast) → **then** mutate live state. It never mutates live state before the journal append succeeds; on unprovable durability it **rejects before mutating** (reject-before-mutate, never an optimistic append). *(#16)*
- **I7** Orphan event buffers are bounded (per-session cap + global cap + TTL) and cleared on `session.deleted`. *(#17)*
- **I8** `session.deleted` tears down shared/global state only for sessions that were activated. *(#20)*
- **I9** Finalization quality-gate inputs are persisted in the `argus_generate_report` completed event, so `finalizeRun` never certifies a run whose report warnings/gates it could not read. *(#19)*
- **I10** `reportGenerated` is NOT terminal: recovery discards or resumes a run based only on SEALED / explicit final disposition, never on report generation alone. *(#13)*
- **I11** A run sink's owner set may hold multiple sessionIds (coalesced parent/child sessions); eviction and finalization key on set-emptiness, never on a single owner. *(#11)*

---

## 5. Implementation ordering (the interacting-fix dependency graph)

1. **Schema/state foundation first.** Add the sink state enum (`ACTIVE | DRAINING | SEALED | FAILED_RECOVERABLE`), the owner set, **and** the new `run.finalization_failed` journal event type + schema-version bump — nothing else lands until this is in. Unblocks #11 and #18.
2. **#15 activation-failure "no durable sink" state** — before **#16** (record_finding needs that state representable).
3. **#11 reference-aware, referenced-exempt eviction** — before **#12** (async flush-on-delete/evict) so eviction and dispose share one owner-set rule.
4. **#19 persist report metadata** — before **#18**.
5. **#18 finalization sealing** — seal only on success; failed → FAILED_RECOVERABLE (emit `run.finalization_failed`). Depends on step 1's event type and #19's gate inputs.
6. **#14 recovered-identity preservation** — reconcile with **#13** (`reportGenerated` non-terminal, I10) in the same change so a recovered post-report session is neither discarded nor rebound.
7. **#17 orphan-buffer bounds** and **#20 unactivated-teardown guard** — relatively independent; land last.

---

## 6. Resolved by Oracle Phase-0 review (2026-07-01)

1. **Async dispose:** fully async `flushAndDispose(): Promise<void>` awaited from hook teardown — not a synchronous flush barrier (`flush()`/`dispose()` are already async).
2. **FAILED_RECOVERABLE representation:** a distinct journal event (`run.finalization_failed`); the sink stays open. Any manifest/in-memory state is a derived cache of the journal — keeps WS-5 replay faithful.
3. **Reference model:** an **owner SET** of sessionIds (many coalesced parent/child sessions → one run sink), not a scalar owner or bare refcount. Eviction/finalization key on set-emptiness (I11).
4. **TTL vs long audits:** ACTIVE/DRAINING/referenced runs are TTL-exempt; TTL applies only to runs with no live session and no recent heartbeat. DRAINING carries a bounded timeout instead of TTL.
5. **record_finding:** **reject-before-mutate** — never mutate live state on unprovable durability; append `finding.added` fail-fast first (I6). No legitimate flow depends on the optimistic append.

---

*Companion to Phase-0 module review: `src/shared/path-safety.ts`, `src/shared/untrusted-content.ts`, `src/shared/process-runner.ts`, and the hardened `src/shared/deep-merge.ts` (all built, tested, tsc+biome clean).*
